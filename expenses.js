// =====================================================
// HARCAMALAR
// Her harcama grubun para biriminde girilir.
// app.js'teki db, $, currentGroup, currentMembers, currentUser,
// showMessage, friendlyError ve showScreen'i kullanır.
// =====================================================

let currentExpenses = [];

// ----- Yardımcılar (balances.js de kullanıyor) -----

function todayLocal() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// "150", "150,5", "150,50", "1.250,50" -> kuruş (tam sayı). Geçersizse null.
function parseAmountToCents(input) {
  let s = String(input).trim().replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function formatMoney(cents, currency) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(cents / 100);
}

function formatDate(isoDate) {
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('tr-TR', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function memberName(userId) {
  const m = currentMembers.find((x) => x.id === userId);
  return m ? m.name : '?';
}

function fillSelect(select, options, selected) {
  select.replaceChildren();
  for (const [value, label] of options) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === selected) opt.selected = true;
    select.append(opt);
  }
}

// Bu harcamayı silebilir miyim? (Veritabanı kuralıyla aynı mantık)
function canDeleteExpense(ex) {
  return ex.created_by === currentUser.id || ex.paid_by === currentUser.id;
}

// =====================================================
// HARCAMA LİSTESİ
// =====================================================
async function loadExpenses() {
  const list = $('expense-list');
  list.replaceChildren();

  const { data, error } = await db
    .from('expenses')
    .select('id, description, amount_cents, currency, base_amount_cents, paid_by, created_by, spent_at, created_at, expense_participants(user_id, share_cents)')
    .eq('group_id', currentGroup.id)
    .order('spent_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    showMessage(friendlyError(error), 'error', 'group-message');
    return;
  }

  currentExpenses = data;
  $('expense-empty').classList.toggle('hidden', data.length > 0);

  for (const ex of data) list.append(renderExpense(ex));
}

function renderExpense(ex) {
  const li = document.createElement('li');
  li.className = 'expense';

  const main = document.createElement('div');
  main.className = 'expense-main';

  const top = document.createElement('div');
  top.className = 'row';
  const desc = document.createElement('strong');
  desc.textContent = ex.description;
  const amount = document.createElement('strong');
  amount.textContent = formatMoney(ex.base_amount_cents, currentGroup.base_currency);
  top.append(desc, amount);

  const meta = document.createElement('div');
  meta.className = 'muted small';
  const who = ex.created_by === ex.paid_by
    ? `${memberName(ex.paid_by)} ödedi ve ekledi`
    : `${memberName(ex.paid_by)} ödedi · ${memberName(ex.created_by)} ekledi`;
  let text = `${who} · ${ex.expense_participants.length} kişi · ${formatDate(ex.spent_at)}`;
  // Eski test verilerinde dövizli harcama olabilir: orijinal tutarı göster
  if (ex.currency !== currentGroup.base_currency) {
    text += ` · ${formatMoney(ex.amount_cents, ex.currency)}`;
  }
  meta.textContent = text;

  main.append(top, meta);
  li.append(main);

  // Sil düğmesi sadece ekleyene ve ödeyene görünür
  if (canDeleteExpense(ex)) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'link danger';
    del.textContent = 'Sil';
    del.addEventListener('click', () => deleteExpense(ex));
    li.append(del);
  }

  return li;
}

async function deleteExpense(ex) {
  if (!confirm(`"${ex.description}" harcaması silinsin mi? Bu geri alınamaz.`)) return;

  const { data, error } = await db
    .from('expenses')
    .delete()
    .eq('id', ex.id)
    .select('id');

  if (error) {
    showMessage(friendlyError(error), 'error', 'group-message');
    return;
  }
  if (!data || data.length === 0) {
    showMessage('Bu harcamayı sadece ekleyen ya da ödeyen kişi silebilir.', 'error', 'group-message');
    return;
  }
  await refreshFinance();
}

// =====================================================
// HARCAMA EKLEME FORMU
// =====================================================
function openExpenseForm() {
  $('expense-form').reset();
  showMessage('', '', 'expense-message');
  $('expense-group-name').textContent = currentGroup.name;
  $('expense-currency-label').textContent = currentGroup.base_currency;

  fillSelect(
    $('expense-payer'),
    currentMembers.map((m) => [m.id, m.id === currentUser.id ? `${m.name} (sen)` : m.name]),
    currentUser.id
  );

  $('expense-date').value = todayLocal();
  $('expense-date').max = todayLocal();

  const box = $('expense-participants');
  box.replaceChildren();
  for (const m of currentMembers) {
    const label = document.createElement('label');
    label.className = 'check';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = m.id;
    cb.checked = true;
    cb.addEventListener('change', updatePreview);

    const span = document.createElement('span');
    span.textContent = m.id === currentUser.id ? `${m.name} (sen)` : m.name;

    label.append(cb, span);
    box.append(label);
  }

  updatePreview();
  showScreen('expense');
}

function selectedParticipants() {
  return [...$('expense-participants').querySelectorAll('input:checked')].map((cb) => cb.value);
}

function updatePreview() {
  const preview = $('expense-preview');
  const cents = parseAmountToCents($('expense-amount').value);
  const people = selectedParticipants().length;

  if (!cents || people === 0) {
    preview.textContent = '';
    return;
  }

  const share = Math.floor(cents / people);
  preview.textContent = `${people} kişi, kişi başı ≈ ${formatMoney(share, currentGroup.base_currency)}`;
}

// ----- Olay dinleyicileri -----
$('add-expense-btn').addEventListener('click', openExpenseForm);
$('expense-cancel').addEventListener('click', () => showScreen('group'));
$('expense-amount').addEventListener('input', updatePreview);

$('toggle-all-btn').addEventListener('click', () => {
  const boxes = [...$('expense-participants').querySelectorAll('input')];
  const allChecked = boxes.every((b) => b.checked);
  boxes.forEach((b) => { b.checked = !allChecked; });
  updatePreview();
});

// ----- Kaydet -----
$('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage('', '', 'expense-message');

  const description = $('expense-description').value.trim();
  const cents = parseAmountToCents($('expense-amount').value);
  const participants = selectedParticipants();
  const date = $('expense-date').value || todayLocal();

  if (!description) return showMessage('Açıklama yaz.', 'error', 'expense-message');
  if (!cents) return showMessage('Tutarı doğru yaz (ör. 150 veya 150,50).', 'error', 'expense-message');
  if (participants.length === 0) return showMessage('En az bir kişi seç.', 'error', 'expense-message');
  if (date > todayLocal()) return showMessage('Gelecek tarihli harcama eklenemez.', 'error', 'expense-message');

  const btn = $('expense-submit');
  btn.disabled = true;

  try {
    const { error } = await db.rpc('add_expense', {
      p_group_id: currentGroup.id,
      p_description: description,
      p_amount_cents: cents,
      p_currency: currentGroup.base_currency,
      p_fx_rate: 1,
      p_paid_by: $('expense-payer').value,
      p_participants: participants,
      p_spent_at: date,
    });
    if (error) throw error;

    await refreshFinance();
    showScreen('group');
  } catch (err) {
    showMessage(friendlyError(err), 'error', 'expense-message');
  } finally {
    btn.disabled = false;
  }
});