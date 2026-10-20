// =====================================================
// BAKİYELER VE ÖDEŞME (Adım 7 + 8)
// app.js ve expenses.js'teki değişken ve fonksiyonları kullanır.
// =====================================================

let currentSettlements = [];

async function loadSettlements() {
  const { data, error } = await db
    .from('settlements')
    .select('id, from_user, to_user, amount_cents, created_by, created_at')
    .eq('group_id', currentGroup.id)
    .order('created_at', { ascending: false });

  if (error) {
    currentSettlements = [];
    showMessage(friendlyError(error), 'error', 'group-message');
    return;
  }
  currentSettlements = data;
}

// Harcamaları ve ödemeleri birlikte yükle, sonra bakiyeleri ve ödemeleri çiz
async function refreshFinance() {
  showMessage('', '', 'settle-message');
  await Promise.all([loadExpenses(), loadSettlements()]);
  renderBalances();
  renderSettlements();
}

// Her kişinin net bakiyesi (kuruş). Artı = alacaklı, eksi = borçlu.
function computeBalances() {
  const net = new Map(currentMembers.map((m) => [m.id, 0]));
  const add = (id, value) => net.set(id, (net.get(id) || 0) + value);

  for (const ex of currentExpenses) {
    add(ex.paid_by, ex.base_amount_cents);
    for (const p of ex.expense_participants) add(p.user_id, -p.share_cents);
  }

  for (const s of currentSettlements) {
    add(s.from_user, s.amount_cents);  // Ödeyenin borcu azalır
    add(s.to_user, -s.amount_cents);   // Alanın alacağı azalır
  }

  return net;
}

// Borçluları alacaklılarla eşleştir: en büyük borçlu en büyük alacaklıya öder.
// En fazla (kişi sayısı - 1) transfer çıkar.
function computeTransfers(net) {
  const creditors = [];
  const debtors = [];
  for (const [id, value] of net) {
    if (value > 0) creditors.push({ id, amount: value });
    if (value < 0) debtors.push({ id, amount: -value });
  }
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }
  return transfers;
}

function personLabel(userId) {
  return userId === currentUser.id ? 'Sen' : memberName(userId);
}

// 6000 -> "60,00" (prompt kutusunda varsayılan değer için)
function centsToInput(cents) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function isParty(fromId, toId) {
  return fromId === currentUser.id || toId === currentUser.id;
}

// =====================================================
// BAKİYELER VE "KİM KİME ÖDEYECEK"
// =====================================================
function renderBalances() {
  const base = currentGroup.base_currency;
  const net = computeBalances();

  // Güvenlik kontrolü: toplam her zaman sıfır olmalı
  let sum = 0;
  for (const v of net.values()) sum += v;
  if (sum !== 0) console.error('UYARI: Bakiye toplamı sıfır değil:', sum);

  // Toplam harcama
  const total = currentExpenses.reduce((t, ex) => t + ex.base_amount_cents, 0);
  $('group-total').textContent = formatMoney(total, base);

  // Benim durumum
  const mine = net.get(currentUser.id) || 0;
  const my = $('my-balance');
  if (mine > 0) {
    my.textContent = `Sana toplam ${formatMoney(mine, base)} borçlular`;
    my.className = 'big positive';
  } else if (mine < 0) {
    my.textContent = `Toplam ${formatMoney(-mine, base)} borçlusun`;
    my.className = 'big negative';
  } else {
    my.textContent = 'Ödeşmişsin';
    my.className = 'big';
  }

  // Herkesin bakiyesi
  const list = $('balance-list');
  list.replaceChildren();
  for (const m of currentMembers) {
    const v = net.get(m.id) || 0;

    const li = document.createElement('li');
    li.className = 'row';

    const name = document.createElement('span');
    name.textContent = m.id === currentUser.id ? `${m.name} (sen)` : m.name;

    const amt = document.createElement('span');
    if (v > 0) {
      amt.textContent = `+${formatMoney(v, base)}`;
      amt.className = 'positive';
    } else if (v < 0) {
      amt.textContent = `−${formatMoney(-v, base)}`;
      amt.className = 'negative';
    } else {
      amt.textContent = 'ödeşmiş';
      amt.className = 'muted';
    }

    li.append(name, amt);
    list.append(li);
  }

  // Kim kime ödeyecek
  const transfers = computeTransfers(net);
  const tl = $('transfer-list');
  tl.replaceChildren();
  $('transfer-empty').classList.toggle('hidden', transfers.length > 0);

  for (const t of transfers) {
    const li = document.createElement('li');
    li.className = 'transfer';

    const who = document.createElement('span');
    who.textContent = `${personLabel(t.from)} → ${personLabel(t.to)}`;

    const right = document.createElement('div');
    right.className = 'transfer-right';

    const amt = document.createElement('strong');
    amt.textContent = formatMoney(t.amount, base);
    right.append(amt);

    // Sadece ödemenin tarafları düğmeyi görür
    if (isParty(t.from, t.to)) {
      li.classList.add('mine');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'small-btn';
      btn.textContent = t.from === currentUser.id ? 'Ödedim' : 'Aldım';
      btn.addEventListener('click', () => markPaid(t, btn));
      right.append(btn);
    }

    li.append(who, right);
    tl.append(li);
  }
}

// =====================================================
// ÖDEME KAYDETME
// =====================================================
async function markPaid(t, btn) {
  const base = currentGroup.base_currency;
  const max = formatMoney(t.amount, base);
  const iAmPayer = t.from === currentUser.id;
  const other = memberName(iAmPayer ? t.to : t.from);

  const question = iAmPayer
    ? `${other} kişisine ne kadar ödedin? (en fazla ${max})`
    : `${other} sana ne kadar ödedi? (en fazla ${max})`;

  const input = prompt(question, centsToInput(t.amount));
  if (input === null) return; // Vazgeçildi

  const cents = parseAmountToCents(input);
  if (!cents || cents > t.amount) {
    showMessage(`Geçerli bir tutar yaz: sıfırdan büyük, en fazla ${max}.`, 'error', 'settle-message');
    return;
  }

  btn.disabled = true;

  const { error } = await db.from('settlements').insert({
    group_id: currentGroup.id,
    from_user: t.from,
    to_user: t.to,
    amount_cents: cents,
    created_by: currentUser.id,
  });

  if (error) {
    btn.disabled = false;
    showMessage(friendlyError(error), 'error', 'settle-message');
    return;
  }

  await refreshFinance();
  showMessage(`${formatMoney(cents, base)} ödeme kaydedildi.`, 'success', 'settle-message');
}

// =====================================================
// YAPILAN ÖDEMELER LİSTESİ
// =====================================================
function renderSettlements() {
  const base = currentGroup.base_currency;
  const list = $('settlement-list');
  list.replaceChildren();
  $('settlement-empty').classList.toggle('hidden', currentSettlements.length > 0);

  for (const s of currentSettlements) {
    const li = document.createElement('li');
    li.className = 'expense';

    const main = document.createElement('div');
    main.className = 'expense-main';

    const top = document.createElement('div');
    top.className = 'row';
    const who = document.createElement('strong');
    who.textContent = `${personLabel(s.from_user)} → ${personLabel(s.to_user)}`;
    const amt = document.createElement('strong');
    amt.textContent = formatMoney(s.amount_cents, base);
    top.append(who, amt);

    const meta = document.createElement('div');
    meta.className = 'muted small';
    const date = new Date(s.created_at).toLocaleDateString('tr-TR', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
    meta.textContent = `${date} · ${personLabel(s.created_by)} kaydetti`;

    main.append(top, meta);
    li.append(main);

    if (isParty(s.from_user, s.to_user)) {
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'link danger';
      undo.textContent = 'Geri al';
      undo.addEventListener('click', () => undoSettlement(s));
      li.append(undo);
    }

    list.append(li);
  }
}

async function undoSettlement(s) {
  const base = currentGroup.base_currency;
  const text = `${personLabel(s.from_user)} → ${personLabel(s.to_user)} ${formatMoney(s.amount_cents, base)} ödemesi geri alınsın mı?`;
  if (!confirm(text)) return;

  const { data, error } = await db
    .from('settlements')
    .delete()
    .eq('id', s.id)
    .select('id');

  if (error) {
    showMessage(friendlyError(error), 'error', 'settle-message');
    return;
  }
  if (!data || data.length === 0) {
    showMessage('Bu ödemeyi sadece ödemenin tarafları geri alabilir.', 'error', 'settle-message');
    return;
  }

  await refreshFinance();
  showMessage('Ödeme geri alındı.', 'success', 'settle-message');
}