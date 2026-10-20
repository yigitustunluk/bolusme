// ===== Supabase bağlantısı =====
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== Şifre sıfırlama linkiyle mi gelindi? =====
// Supabase adresi temizlemeden ÖNCE bakıyoruz.
const initialHash = window.location.hash;
let recoveryMode = initialHash.includes('type=recovery');
let linkErrorPending = initialHash.includes('error_code=');

// ===== Ayarlar =====
// Sadece 2 ondalıklı para birimleri
const CURRENCIES = [
  ['TRY', 'Türk lirası'],
  ['EUR', 'Euro'],
  ['USD', 'ABD doları'],
  ['GBP', 'İngiliz sterlini'],
  ['CHF', 'İsviçre frangı'],
  ['CZK', 'Çek korunası'],
  ['PLN', 'Polonya zlotisi'],
  ['DKK', 'Danimarka kronu'],
  ['SEK', 'İsveç kronu'],
  ['NOK', 'Norveç kronu'],
  ['GEL', 'Gürcü larisi'],
  ['AED', 'BAE dirhemi'],
];

// Veritabanı fonksiyonlarımızın kendi Türkçe hata mesajları
const OWN_ERRORS = [
  'Giriş yapılmamış', 'Grup adı boş olamaz', 'Geçersiz davet kodu',
  'Bu grubun üyesi değilsin', 'Ödeyen kişi bu grupta değil',
  'Tutar sıfırdan büyük olmalı', 'En az bir kişi dahil olmalı',
  'Dahil edilen kişilerden biri bu grupta değil', 'Bu gruba sadece',
];

// ===== Durum =====
let currentUser = null;
let currentGroup = null;
let currentMembers = [];

// ===== Yardımcılar =====
const $ = (id) => document.getElementById(id);

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $('screen-' + name).classList.remove('hidden');
  window.scrollTo(0, 0);
}

function showMessage(text, type = '', elId = 'auth-message') {
  const el = $(elId);
  el.textContent = text;
  el.className = 'message ' + type;
}

function friendlyError(error) {
  const msg = (error && error.message) || '';
  if (OWN_ERRORS.some((t) => msg.includes(t))) return msg;
  if (msg.includes('Invalid login credentials')) return 'E-posta veya şifre hatalı.';
  if (msg.includes('already registered')) return 'Bu e-posta ile zaten kayıt olunmuş.';
  if (msg.includes('Password should be at least')) return 'Şifre en az 6 karakter olmalı.';
  if (msg.includes('should be different')) return 'Yeni şifre eskisinden farklı olmalı.';
  if (msg.includes('Email not confirmed')) return 'E-postanı henüz onaylamamışsın.';
  if (msg.includes('For security purposes')) return 'Güvenlik nedeniyle biraz bekleyip tekrar dene.';
  if (msg.toLowerCase().includes('rate limit')) return 'Çok fazla deneme yapıldı, biraz bekleyip tekrar dene.';
  if (msg.includes('Failed to fetch')) return 'Sunucuya ulaşılamadı. İnternetin açıksa sunucu uyku modunda olabilir, Yiğit\'e haber ver.';
  return 'Bir hata oluştu: ' + msg;
}

// ===== Para birimi listesini doldur =====
for (const [code, label] of CURRENCIES) {
  const opt = document.createElement('option');
  opt.value = code;
  opt.textContent = `${code} – ${label}`;
  $('new-group-currency').append(opt);
}

// =====================================================
// GİRİŞ / KAYIT
// =====================================================
let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  $('tab-login').classList.toggle('active', !signup);
  $('tab-signup').classList.toggle('active', signup);
  $('name-field').classList.toggle('hidden', !signup);
  $('auth-name').required = signup;
  $('auth-password').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  $('auth-submit').textContent = signup ? 'Kayıt ol' : 'Giriş yap';
  $('forgot-link').classList.toggle('hidden', signup);
  showMessage('');
}

$('tab-login').addEventListener('click', () => setAuthMode('login'));
$('tab-signup').addEventListener('click', () => setAuthMode('signup'));

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  const name = $('auth-name').value.trim();

  $('auth-submit').disabled = true;
  showMessage('');

  try {
    if (authMode === 'signup') {
      if (!name) {
        showMessage('Adını yaz.', 'error');
        return;
      }
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: { data: { display_name: name } },
      });
      if (error) throw error;
      if (!data.session) {
        setAuthMode('login');
        showMessage('Kayıt alındı. E-postana gelen onay linkine tıkla, sonra giriş yap.', 'success');
      }
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    showMessage(friendlyError(err), 'error');
  } finally {
    $('auth-submit').disabled = false;
  }
});

$('logout-btn').addEventListener('click', async () => {
  await db.auth.signOut();
});

// =====================================================
// ŞİFREMİ UNUTTUM
// =====================================================
function showForgot(on) {
  $('auth-tabs').classList.toggle('hidden', on);
  $('auth-form').classList.toggle('hidden', on);
  $('forgot-link').classList.toggle('hidden', on);
  $('forgot-form').classList.toggle('hidden', !on);
  if (on) {
    $('forgot-email').value = $('auth-email').value.trim();
    showMessage('', '', 'forgot-message');
  }
}

$('forgot-link').addEventListener('click', () => showForgot(true));
$('forgot-cancel').addEventListener('click', () => showForgot(false));

$('forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('forgot-email').value.trim();
  const btn = $('forgot-submit');
  btn.disabled = true;
  showMessage('', '', 'forgot-message');

  // Link bu sayfaya geri dönecek (Supabase'de izinli adres olmalı)
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });

  btn.disabled = false;
  if (error) {
    showMessage(friendlyError(error), 'error', 'forgot-message');
  } else {
    // Güvenlik: e-postanın kayıtlı olup olmadığını söylemiyoruz
    showMessage('Bu e-posta kayıtlıysa sıfırlama linki gönderildi. Gereksiz klasörünü de kontrol et.', 'success', 'forgot-message');
  }
});

// =====================================================
// YENİ ŞİFRE BELİRLEME
// =====================================================
$('recovery-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p1 = $('recovery-password').value;
  const p2 = $('recovery-password2').value;
  showMessage('', '', 'recovery-message');

  if (p1.length < 6) return showMessage('Şifre en az 6 karakter olmalı.', 'error', 'recovery-message');
  if (p1 !== p2) return showMessage('İki şifre aynı değil.', 'error', 'recovery-message');

  const btn = $('recovery-submit');
  btn.disabled = true;
  const { error } = await db.auth.updateUser({ password: p1 });
  btn.disabled = false;

  if (error) {
    showMessage(friendlyError(error), 'error', 'recovery-message');
    return;
  }

  $('recovery-form').reset();
  recoveryMode = false;
  currentUser = null; // Ana ekranın baştan çizilmesi için
  const { data } = await db.auth.getSession();
  await handleSession(data.session);
});

// =====================================================
// OTURUM
// =====================================================
async function handleSession(session) {
  if (!session) {
    currentUser = null;
    currentGroup = null;
    currentMembers = [];
    showForgot(false);
    setAuthMode('login');
    if (linkErrorPending) {
      linkErrorPending = false;
      history.replaceState(null, '', window.location.pathname);
      showMessage('Link geçersiz ya da süresi dolmuş. "Şifremi unuttum" ile yeniden iste.', 'error');
    }
    showScreen('auth');
    return;
  }

  // Sıfırlama linkinden gelindiyse önce yeni şifre iste
  if (recoveryMode) {
    currentUser = session.user;
    showScreen('recovery');
    return;
  }

  // Aynı kullanıcı için oturum yenilemesiyse tekrar çizme
  if (currentUser && currentUser.id === session.user.id) return;

  currentUser = session.user;

  const { data, error } = await db
    .from('profiles')
    .select('display_name')
    .eq('id', currentUser.id)
    .single();

  $('home-name').textContent = error ? currentUser.email : data.display_name;
  await loadGroups();
  showScreen('home');
}

db.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') recoveryMode = true;
  // Bu dinleyicinin içinde doğrudan Supabase çağrısı yapılmaz (kilitlenme riski)
  setTimeout(() => handleSession(session), 0);
});

// =====================================================
// GRUP LİSTESİ
// =====================================================
async function loadGroups() {
  const list = $('group-list');
  list.replaceChildren();
  showMessage('', '', 'home-message');

  const { data, error } = await db
    .from('groups')
    .select('id, name, base_currency')
    .order('created_at', { ascending: false });

  if (error) {
    showMessage(friendlyError(error), 'error', 'home-message');
    return;
  }

  $('group-empty').classList.toggle('hidden', data.length > 0);

  for (const g of data) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'list-item';

    const name = document.createElement('span');
    name.textContent = g.name;

    const cur = document.createElement('span');
    cur.className = 'muted';
    cur.textContent = g.base_currency;

    btn.append(name, cur);
    btn.addEventListener('click', () => openGroup(g.id));
    list.append(btn);
  }
}

// Grup kur
$('create-group-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.currentTarget.querySelector('button[type="submit"]');
  btn.disabled = true;
  showMessage('', '', 'create-group-message');

  try {
    const { data: groupId, error } = await db.rpc('create_group', {
      p_name: $('new-group-name').value.trim(),
      p_currency: $('new-group-currency').value,
    });
    if (error) throw error;
    $('new-group-name').value = '';
    await openGroup(groupId);
  } catch (err) {
    showMessage(friendlyError(err), 'error', 'create-group-message');
  } finally {
    btn.disabled = false;
  }
});

// Davet koduyla katıl
$('join-group-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.currentTarget.querySelector('button[type="submit"]');
  btn.disabled = true;
  showMessage('', '', 'join-group-message');

  try {
    const { data: groupId, error } = await db.rpc('join_group', {
      p_code: $('join-code').value.trim(),
    });
    if (error) throw error;
    $('join-code').value = '';
    await openGroup(groupId);
  } catch (err) {
    showMessage(friendlyError(err), 'error', 'join-group-message');
  } finally {
    btn.disabled = false;
  }
});

// =====================================================
// GRUP EKRANI
// =====================================================
async function openGroup(groupId) {
  const { data: group, error } = await db
    .from('groups')
    .select('id, name, base_currency, invite_code, created_by')
    .eq('id', groupId)
    .single();

  if (error) {
    showMessage(friendlyError(error), 'error', 'home-message');
    return;
  }

  currentGroup = group;
  $('group-title').textContent = group.name;
  $('group-currency').textContent = group.base_currency;
  $('group-code').textContent = group.invite_code;
  showMessage('', '', 'group-message');

  await loadMembers();
  await refreshFinance();
  showScreen('group');
  startLive();
}

async function loadMembers() {
  const list = $('member-list');
  list.replaceChildren();

  const { data, error } = await db
    .from('group_members')
    .select('user_id, joined_at, profiles(display_name)')
    .eq('group_id', currentGroup.id)
    .order('joined_at');

  if (error) {
    showMessage(friendlyError(error), 'error', 'group-message');
    return;
  }

  currentMembers = data.map((m) => ({
    id: m.user_id,
    name: m.profiles ? m.profiles.display_name : '?',
  }));

  for (const m of currentMembers) {
    const li = document.createElement('li');
    let text = m.name;
    if (m.id === currentUser.id) text += ' (sen)';
    if (m.id === currentGroup.created_by) text += ' · kurucu';
    li.textContent = text;
    list.append(li);
  }
}

$('copy-code-btn').addEventListener('click', async () => {
  const code = currentGroup.invite_code;
  try {
    await navigator.clipboard.writeText(code);
    showMessage('Kod kopyalandı. Arkadaşına gönder.', 'success', 'group-message');
  } catch {
    showMessage('Kopyalanamadı, kodu elle yaz: ' + code, 'error', 'group-message');
  }
});

$('back-btn').addEventListener('click', async () => {
  currentGroup = null;
  currentMembers = [];
  await loadGroups();
  showScreen('home');
});