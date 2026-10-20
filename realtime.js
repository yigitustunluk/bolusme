// =====================================================
// CANLI GÜNCELLEME (Adım 9)
// Açık olan grubu dinler; değişiklik olunca veriyi yeniden yükler.
// =====================================================

let liveChannel = null;
let liveTimer = null;

function setLiveStatus(text, ok) {
  const el = $('live-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'small ' + (ok ? 'positive' : 'muted');
}

// Arka arkaya gelen olayları tek yenilemede topla (300 ms bekle)
function scheduleRefresh() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(liveRefresh, 300);
}

// Mesajları silmeden grubu yeniden yükle
async function liveRefresh() {
  if (!currentGroup) return;
  const groupId = currentGroup.id;

  await loadMembers();
  if (!currentGroup || currentGroup.id !== groupId) return; // Bu arada gruptan çıkıldıysa dur

  await Promise.all([loadExpenses(), loadSettlements()]);
  if (!currentGroup || currentGroup.id !== groupId) return;

  renderBalances();
  renderSettlements();
}

function startLive() {
  stopLive();
  if (!currentGroup) return;

  const groupId = currentGroup.id;
  const filter = `group_id=eq.${groupId}`;

  liveChannel = db
    .channel('group-' + groupId)
    // Eklemeler: sadece bu grubun kayıtları gelir (güvenlik kuralları da uygulanır)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'expenses', filter }, scheduleRefresh)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'settlements', filter }, scheduleRefresh)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_members', filter }, scheduleRefresh)
    // Silmeler filtrelenemiyor: gelen kimlik bizim listemizdeyse yenile
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'expenses' }, (payload) => {
      if (payload.old && currentExpenses.some((e) => e.id === payload.old.id)) scheduleRefresh();
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'settlements' }, (payload) => {
      if (payload.old && currentSettlements.some((s) => s.id === payload.old.id)) scheduleRefresh();
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') setLiveStatus('● Canlı', true);
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setLiveStatus('○ Bağlantı yok', false);
    });
}

function stopLive() {
  clearTimeout(liveTimer);
  if (liveChannel) {
    db.removeChannel(liveChannel);
    liveChannel = null;
  }
  setLiveStatus('', false);
}

// Gruptan çıkınca dinlemeyi bırak
$('back-btn').addEventListener('click', stopLive);

// Hesaptan çıkış yapınca dinlemeyi bırak
db.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') setTimeout(stopLive, 0);
});

// iPhone'da uygulamaya geri dönünce kaçırılan değişiklikleri yakala
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !currentUser) return;
  if (currentGroup) scheduleRefresh();
  else loadGroups();
});