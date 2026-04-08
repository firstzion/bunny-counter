'use strict';

// ===== Version =====
const VERSION = '1.6.0';

// ===== Constants =====
const STORAGE_KEY       = 'bunnywalks';
const LOC_EXPLAINED_KEY = 'bunny-loc-explained';
const INSTALL_DISMISSED = 'bunny-install-dismissed';

// ===== DOM helpers =====
const $ = id => document.getElementById(id);

// ===== Map state =====
let sightingsMap = null; // active Leaflet instance (summary screen)
const historyMaps = {};  // Leaflet instances for history cards, keyed by walk id

// ===== DOM refs =====
const screens = {
  home:    $('screen-home'),
  walk:    $('screen-walk'),
  summary: $('screen-summary'),
};

const el = {
  // Home
  btnStart:       $('btn-start-walk'),
  historyList:    $('history-list'),
  historyEmpty:   $('history-empty'),
  btnClear:       $('btn-clear-history'),

  // Walk
  walkTimer:      $('walk-timer'),
  walkCount:      $('walk-count'),
  tapZone:        $('tap-zone'),
  btnEndWalk:     $('btn-end-walk'),

  // End-walk dialog
  dlgEndWalk:     $('dialog-end-walk'),
  dlgEndCount:    $('dialog-end-count'),
  dlgEndPlural:   $('dialog-end-plural'),
  btnKeepGoing:   $('btn-keep-going'),
  btnConfirmEnd:  $('btn-confirm-end'),

  // Location dialog
  dlgLocation:    $('dialog-location'),
  btnLocOk:       $('btn-location-ok'),
  btnLocSkip:     $('btn-location-skip'),

  // Summary
  summaryEmoji:   $('summary-emoji'),
  summaryCount:   $('summary-count'),
  summaryDuration:$('summary-duration'),
  summaryDate:    $('summary-date'),
  summaryTime:    $('summary-time'),
  mapCard:        $('map-card'),
  sightingsMapEl: $('sightings-map'),
  sightingsCard:  $('sightings-card'),
  sightingsToggle:$('sightings-toggle'),
  sightingsToggleTxt: $('sightings-toggle-text'),
  sightingsList:  $('sightings-list'),
  btnSave:        $('btn-save-walk'),
  btnDiscard:     $('btn-discard-walk'),

  // Generic confirm dialog
  dlgConfirm:       $('dialog-confirm'),
  dlgConfirmTitle:  $('dlg-confirm-title'),
  dlgConfirmBody:   $('dlg-confirm-body'),
  dlgConfirmOk:     $('dlg-confirm-ok'),
  dlgConfirmCancel: $('dlg-confirm-cancel'),

  // Install banner
  installBanner:  $('install-banner'),
  installMsg:     $('install-msg'),
  installDismiss: $('install-dismiss'),
};

// ===== Application State =====
let activeWalk = null;
// { startTime: ms, count: number, sightings: Sighting[], timerInterval: id, wakeLock: WakeLockSentinel|null }

let pendingWalk = null;
// Completed walk data waiting to be saved or discarded

// ===== Screen Navigation =====
function showScreen(name) {
  for (const [key, screenEl] of Object.entries(screens)) {
    screenEl.classList.toggle('active', key === name);
  }
}

// ===== Walk Start Flow =====
function handleStartTap() {
  const alreadyExplained = localStorage.getItem(LOC_EXPLAINED_KEY);
  if (!alreadyExplained) {
    showLocationDialog();
  } else {
    beginWalk();
  }
}

function beginWalk() {
  activeWalk = {
    startTime: Date.now(),
    count: 0,
    sightings: [],
    timerInterval: null,
    wakeLock: null,
  };

  el.walkCount.textContent = '0';
  el.walkTimer.textContent = '00:00';

  activeWalk.timerInterval = setInterval(tickTimer, 1000);
  acquireWakeLock();
  showScreen('walk');
}

// ===== Timer =====
function tickTimer() {
  if (!activeWalk) return;
  const elapsed = Math.floor((Date.now() - activeWalk.startTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  el.walkTimer.textContent = `${m}:${s}`;
}

// ===== Tap / Count =====
function handleTap() {
  if (!activeWalk) return;

  // Record sighting immediately — coords filled in async below
  const idx = activeWalk.sightings.length;
  activeWalk.sightings.push({
    timestamp: new Date().toISOString(),
    lat: null,
    lng: null,
  });

  activeWalk.count++;
  el.walkCount.textContent = activeWalk.count;
  bouncCount();
  buzz();
  fetchLocation(idx);
}

function bouncCount() {
  const node = el.walkCount;
  node.classList.remove('popping');
  void node.offsetWidth; // force reflow so animation restarts on rapid taps
  node.classList.add('popping');
}

function buzz() {
  if (navigator.vibrate) navigator.vibrate(50);
}

// ===== Geolocation (per sighting) =====
function fetchLocation(sightingIndex) {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    pos => {
      // Walk may have ended by the time this resolves — guard defensively
      const target = activeWalk
        ? activeWalk.sightings[sightingIndex]
        : pendingWalk?.sightings[sightingIndex];

      if (!target) return;
      target.lat = parseFloat(pos.coords.latitude.toFixed(6));
      target.lng = parseFloat(pos.coords.longitude.toFixed(6));
    },
    () => { /* silently ignore — location stored as null */ },
    { timeout: 10_000, maximumAge: 30_000, enableHighAccuracy: false }
  );
}

// ===== Wake Lock =====
async function acquireWakeLock() {
  if (!activeWalk || !('wakeLock' in navigator)) return;
  try {
    activeWalk.wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    // Not available in this context — fine
  }
}

function releaseWakeLock() {
  if (activeWalk?.wakeLock) {
    activeWalk.wakeLock.release().catch(() => {});
    activeWalk.wakeLock = null;
  }
}

// ===== End Walk Dialog =====
function showEndDialog() {
  const count = activeWalk?.count ?? 0;
  el.dlgEndCount.textContent = count;
  el.dlgEndPlural.textContent = count === 1 ? '' : 's';
  el.dlgEndWalk.classList.remove('hidden');
}

function hideEndDialog() {
  el.dlgEndWalk.classList.add('hidden');
}

function confirmEndWalk() {
  hideEndDialog();

  const endTime = Date.now();
  pendingWalk = {
    id: String(endTime),
    date: localDateString(activeWalk.startTime),
    startTime: new Date(activeWalk.startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
    durationSeconds: Math.floor((endTime - activeWalk.startTime) / 1000),
    count: activeWalk.count,
    sightings: [...activeWalk.sightings], // shallow copy — coords may still update
  };

  clearInterval(activeWalk.timerInterval);
  releaseWakeLock();
  activeWalk = null;

  renderSummary();
  showScreen('summary');
}

// ===== Summary =====
function renderSummary() {
  const w = pendingWalk;
  if (!w) return;

  const start = new Date(w.startTime);
  const n = w.sightings.length;

  // Emoji scales with count
  el.summaryEmoji.textContent = w.count === 0 ? '🌙'
    : w.count < 3 ? '🐰'
    : w.count < 7 ? '🐰🐰'
    : '🐰🐰🐰';

  el.summaryCount.textContent = w.count;
  el.summaryDuration.textContent = formatDuration(w.durationSeconds);
  el.summaryDate.textContent = start.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  el.summaryTime.textContent = start.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });

  // Sightings collapsible
  el.sightingsToggleTxt.textContent = `▸ Sightings (${n})`;
  el.sightingsList.hidden = true;
  el.sightingsToggle.setAttribute('aria-expanded', 'false');

  // Populate the list
  el.sightingsList.innerHTML = buildSightingsHTML(w.sightings);

  // Hide the sightings card entirely if there were no taps at all
  el.sightingsCard.hidden = n === 0;

  // Map — give any in-flight geolocation calls ~1s to resolve before rendering
  el.mapCard.hidden = true;
  clearMapInstance();
  const mappable = w.sightings.filter(s => s.lat != null && s.lng != null);
  if (mappable.length > 0) {
    setTimeout(() => initSightingsMap(w.sightings), 900);
  }
}

function toggleSightings() {
  const isOpen = el.sightingsList.hidden === false;
  el.sightingsList.hidden = isOpen;
  el.sightingsToggle.setAttribute('aria-expanded', !isOpen);
  const arrow = isOpen ? '▸' : '▾';
  const n = pendingWalk?.sightings.length ?? 0;
  el.sightingsToggleTxt.textContent = `${arrow} Sightings (${n})`;
}

// ===== Sightings Map =====
function clearMapInstance() {
  if (sightingsMap) {
    sightingsMap.remove();
    sightingsMap = null;
  }
}

function clearHistoryMaps() {
  for (const id of Object.keys(historyMaps)) {
    historyMaps[id].remove();
    delete historyMaps[id];
  }
}

function initHistoryMap(walkId) {
  if (historyMaps[walkId]) return;
  if (typeof L === 'undefined') return;

  const container = document.getElementById(`history-map-${walkId}`);
  if (!container) return;

  const walk = loadWalks().find(w => w.id === walkId);
  if (!walk) return;

  const pins = (walk.sightings || [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.lat != null && s.lng != null);

  if (pins.length === 0) return;

  const map = L.map(container, { zoomControl: true, attributionControl: true });

  const tileStyle = document.documentElement.getAttribute('data-theme') === 'light' ? 'light_all' : 'dark_all';
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/${tileStyle}/{z}/{x}/{y}{r}.png`, {
    attribution: '© <a href="https://openstreetmap.org">OSM</a> © <a href="https://carto.com">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  const bounds = [];
  pins.forEach(({ s, i }) => {
    const num = i + 1;
    const icon = L.divIcon({
      html: `<div class="map-pin">${num}</div>`,
      className: '',
      iconSize:   [28, 28],
      iconAnchor: [14, 14],
      popupAnchor:[0, -16],
    });
    const time = new Date(s.timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', second: '2-digit',
    });
    L.marker([s.lat, s.lng], { icon })
      .bindPopup(
        `<div class="map-popup-num">Sighting #${num}</div><div class="map-popup-time">${time}</div>`,
        { maxWidth: 160 }
      )
      .addTo(map);
    bounds.push([s.lat, s.lng]);
  });

  if (bounds.length === 1) {
    map.setView(bounds[0], 16);
  } else {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
  }

  historyMaps[walkId] = map;
  // Leaflet needs a size check after the panel becomes visible
  setTimeout(() => map.invalidateSize(), 50);
}

function initSightingsMap(sightings) {
  // Leaflet might not be available offline
  if (typeof L === 'undefined') return;

  const pins = sightings
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.lat != null && s.lng != null);

  if (pins.length === 0) return;

  el.mapCard.hidden = false;

  // Destroy any previous instance before re-initialising
  clearMapInstance();

  sightingsMap = L.map('sightings-map', {
    zoomControl: true,
    attributionControl: true,
  });

  // CartoDB tiles — dark or light depending on current theme
  const tileStyle = document.documentElement.getAttribute('data-theme') === 'light' ? 'light_all' : 'dark_all';
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/${tileStyle}/{z}/{x}/{y}{r}.png`, {
    attribution: '© <a href="https://openstreetmap.org">OSM</a> © <a href="https://carto.com">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(sightingsMap);

  const bounds = [];

  pins.forEach(({ s, i }) => {
    const num = i + 1; // 1-based sighting number

    // Amber numbered circle marker
    const icon = L.divIcon({
      html: `<div class="map-pin">${num}</div>`,
      className: '',        // must be empty string — Leaflet adds its own class otherwise
      iconSize:   [28, 28],
      iconAnchor: [14, 14],
      popupAnchor:[0, -16],
    });

    const time = new Date(s.timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', second: '2-digit',
    });

    L.marker([s.lat, s.lng], { icon })
      .bindPopup(`
        <div class="map-popup-num">Sighting #${num}</div>
        <div class="map-popup-time">${time}</div>
      `, { maxWidth: 160 })
      .addTo(sightingsMap);

    bounds.push([s.lat, s.lng]);
  });

  // Fit the map to show all pins, with generous padding
  if (bounds.length === 1) {
    sightingsMap.setView(bounds[0], 16);
  } else {
    sightingsMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
  }
}

// ===== Save / Discard =====
function saveWalk() {
  if (!pendingWalk) return;

  // Mark as unsynced before persisting
  pendingWalk.synced = false;

  const walks = loadWalks();
  walks.unshift(pendingWalk);
  persistWalks(walks);

  // Fire-and-forget sync; re-render on success to update the sync indicator
  const walkToSync = { ...pendingWalk };
  pendingWalk = null;
  clearMapInstance();
  renderHistory();
  showScreen('home');

  if (currentUser) {
    syncWalk(walkToSync).then(success => { if (success) renderHistory(); });
  }
}

function discardWalk() {
  showConfirm(
    'Discard this walk?',
    'Your count and sighting data will not be saved.',
    'Discard',
    () => {
      pendingWalk = null;
      clearMapInstance();
      showScreen('home');
    }
  );
}

// ===== History =====
function loadWalks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function persistWalks(walks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(walks));
}

function clearHistory() {
  showConfirm(
    'Clear history?',
    'All past walks will be permanently deleted.',
    'Clear All',
    () => {
      localStorage.removeItem(STORAGE_KEY);
      renderHistory();
    }
  );
}

function deleteWalk(walkId) {
  showConfirm(
    'Delete this walk?',
    'This walk will be permanently deleted.',
    'Delete',
    async () => {
      const walks = loadWalks();
      const walk = walks.find(w => w.id === walkId);
      if (walk?.supabaseId && currentUser && navigator.onLine) {
        try {
          await supabaseClient.from('walks').delete().eq('id', walk.supabaseId);
        } catch (err) {
          console.error('[sync] delete walk failed:', err);
        }
      }
      persistWalks(walks.filter(w => w.id !== walkId));
      renderHistory();
    }
  );
}

function renderHistory() {
  clearHistoryMaps();
  const walks = loadWalks();
  const hasWalks = walks.length > 0;

  el.historyEmpty.hidden = hasWalks;
  el.btnClear.style.visibility = hasWalks ? 'visible' : 'hidden';

  el.historyList.innerHTML = walks.map(w => {
    const date = new Date(w.date + 'T12:00:00'); // noon avoids DST edge cases
    const dateStr = date.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    const countLabel = w.count === 1 ? '1 rabbit' : `${w.count} rabbits`;
    const dur = formatDuration(w.durationSeconds);
    const rabbits = w.count === 0 ? '🌙'
      : '🐰'.repeat(Math.min(w.count, 3));

    const syncDot = currentUser
      ? `<span class="sync-dot ${w.synced ? 'synced' : 'local'}" aria-label="${w.synced ? 'Synced to cloud' : 'Local only'}"></span>`
      : '';

    const hasMappableSightings = (w.sightings || []).some(s => s.lat != null && s.lng != null);
    const mapHTML = hasMappableSightings
      ? `<div class="history-map-wrap"><div id="history-map-${w.id}" class="history-map"></div><p class="map-caption">tap a pin to see sighting details</p></div>`
      : '';

    return `
      <div class="walk-card" role="listitem" data-walk-id="${w.id}">
        <button class="walk-card-header" aria-expanded="false" onclick="toggleWalkCard(this)">
          <div class="walk-card-left">
            <span class="walk-card-date">${dateStr}</span>
            <span class="walk-card-stats">${countLabel} · ${dur}</span>
          </div>
          <div class="walk-card-right">
            ${syncDot}
            <span class="walk-card-rabbits" aria-hidden="true">${rabbits}</span>
            <span class="walk-card-chevron" aria-hidden="true">›</span>
          </div>
        </button>
        <div class="walk-card-sightings" hidden>
          ${mapHTML}
          ${buildSightingsHTML(w.sightings) || '<p class="no-sightings">No sighting details recorded.</p>'}
          <div class="walk-card-delete">
            <button class="btn-delete-walk" onclick="deleteWalk('${w.id}')">Delete walk</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function toggleWalkCard(btn) {
  const panel = btn.nextElementSibling;
  const isExpanded = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!isExpanded));
  panel.hidden = isExpanded;

  if (!isExpanded) {
    const walkId = btn.closest('.walk-card').dataset.walkId;
    initHistoryMap(walkId);
  }
}

function buildSightingsHTML(sightings) {
  if (!sightings || sightings.length === 0) return '';
  return sightings.map((s, i) => {
    const time = new Date(s.timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', second: '2-digit',
    });
    const coords = (s.lat != null && s.lng != null)
      ? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`
      : 'No location';
    return `
      <div class="sighting-row">
        <span class="sighting-num">${i + 1}</span>
        <span class="sighting-time">${time}</span>
        <span class="sighting-coords">${coords}</span>
      </div>
    `;
  }).join('');
}

// ===== Location Dialog =====
function showLocationDialog() {
  el.dlgLocation.classList.remove('hidden');
}

function hideLocationDialog() {
  el.dlgLocation.classList.add('hidden');
}

function onLocationOk() {
  localStorage.setItem(LOC_EXPLAINED_KEY, 'granted');
  hideLocationDialog();
  beginWalk();
}

function onLocationSkip() {
  localStorage.setItem(LOC_EXPLAINED_KEY, 'skipped');
  hideLocationDialog();
  beginWalk();
}

// ===== Generic Confirm Dialog =====
// Replaces window.confirm(), which is silently blocked in iOS standalone mode.
function showConfirm(title, body, okLabel, onConfirm) {
  el.dlgConfirmTitle.textContent  = title;
  el.dlgConfirmBody.textContent   = body;
  el.dlgConfirmOk.textContent     = okLabel;
  el.dlgConfirm.classList.remove('hidden');

  function cleanup() {
    el.dlgConfirm.classList.add('hidden');
    el.dlgConfirmOk.removeEventListener('click', handleOk);
    el.dlgConfirmCancel.removeEventListener('click', handleCancel);
    el.dlgConfirm.removeEventListener('click', handleBackdrop);
  }

  function handleOk()       { cleanup(); onConfirm(); }
  function handleCancel()   { cleanup(); }
  function handleBackdrop(e){ if (e.target === el.dlgConfirm) cleanup(); }

  el.dlgConfirmOk.addEventListener('click', handleOk);
  el.dlgConfirmCancel.addEventListener('click', handleCancel);
  el.dlgConfirm.addEventListener('click', handleBackdrop);
}

// ===== Helpers =====
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/** Returns YYYY-MM-DD in local time (avoids UTC offset surprises) */
function localDateString(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

// ===== Touch handling for tap zone =====
// Uses touchstart to eliminate iOS 300ms tap delay.
// e.preventDefault() in touchstart stops the ghost click from firing,
// so the click listener below only handles desktop/mouse input.
let recentTouch = false;

function setupTapZone() {
  el.tapZone.addEventListener('touchstart', e => {
    e.preventDefault();       // stops ghost click 300ms later
    recentTouch = true;
    handleTap();
  }, { passive: false });

  el.tapZone.addEventListener('touchend', e => {
    e.preventDefault();       // prevents any residual synthetic events
    setTimeout(() => { recentTouch = false; }, 600);
  }, { passive: false });

  // Fallback for desktop / mouse testing
  el.tapZone.addEventListener('click', () => {
    if (recentTouch) return;
    handleTap();
  });
}

// ===== PWA: Service Worker =====
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('./sw.js').catch(() => {});

  // When the service worker sends SW_UPDATED (a new version just activated),
  // reload the page — but only if there's no walk currently in progress,
  // since a reload would lose unsaved count data.
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type !== 'SW_UPDATED') return;
    if (activeWalk) return; // don't interrupt a walk mid-count
    window.location.reload();
  });
}

// ===== PWA: Install Prompt (iOS) =====
function setupInstallPrompt() {
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (window.navigator.standalone === true) return; // iOS standalone
  if (localStorage.getItem(INSTALL_DISMISSED)) return;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS) {
    el.installMsg.textContent = 'Install: tap the Share button, then "Add to Home Screen"';
    el.installBanner.classList.remove('hidden');
  }
}

// ===== Event Binding =====
function bindEvents() {
  // Home
  el.btnStart.addEventListener('click', handleStartTap);
  el.btnClear.addEventListener('click', clearHistory);
  $('btn-theme-toggle').addEventListener('click', toggleTheme);

  // Walk (tap zone wired separately for touchstart)
  setupTapZone();
  el.btnEndWalk.addEventListener('click', showEndDialog);

  // End-walk dialog
  el.btnKeepGoing.addEventListener('click', hideEndDialog);
  el.btnConfirmEnd.addEventListener('click', confirmEndWalk);
  el.dlgEndWalk.addEventListener('click', e => {
    if (e.target === el.dlgEndWalk) hideEndDialog();
  });

  // Location dialog
  el.btnLocOk.addEventListener('click', onLocationOk);
  el.btnLocSkip.addEventListener('click', onLocationSkip);
  el.dlgLocation.addEventListener('click', e => {
    // Backdrop tap = same as "skip" (non-committal)
    if (e.target === el.dlgLocation) onLocationSkip();
  });

  // Summary
  el.sightingsToggle.addEventListener('click', toggleSightings);
  el.btnSave.addEventListener('click', saveWalk);
  el.btnDiscard.addEventListener('click', discardWalk);

  // Migration dialog
  document.getElementById('btn-migration-sync').addEventListener('click', doMigration);
  document.getElementById('btn-migration-skip').addEventListener('click', skipMigration);

  // Install banner
  el.installDismiss.addEventListener('click', () => {
    el.installBanner.classList.add('hidden');
    localStorage.setItem(INSTALL_DISMISSED, '1');
  });

  // Re-acquire wake lock if the tab regains focus mid-walk
  document.addEventListener('visibilitychange', () => {
    if (activeWalk && document.visibilityState === 'visible') {
      acquireWakeLock();
    }
  });
}

// ===== Theme Toggle =====
function updateThemeButton() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  $('btn-theme-toggle').textContent = isLight ? '☾' : '☀';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', isLight ? '#f5f5f0' : '#1a1a2e');
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('bunny-theme', next);
  updateThemeButton();
}

// ===== Boot =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('app-version').textContent = `v${VERSION}`;
  updateThemeButton();
  renderHistory();
  bindEvents();
  registerServiceWorker();
  setupInstallPrompt();
  // Auth — only runs when Supabase is configured with real credentials
  if (supabaseClient) {
    setupAuthUI();
    initAuth(async () => {
      await fetchAndMergeHistory();
      renderHistory();
      syncPendingWalks(); // fire and forget
      checkMigration();
    });
  }
});
