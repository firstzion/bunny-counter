'use strict';

// ===== Sync Constants =====
const MIGRATION_KEY = 'bunny-migration-done';

// ===== Shape Converters =====
function walkToSupabase(walk, userId) {
  return {
    user_id:          userId,
    started_at:       walk.startTime,
    ended_at:         walk.endTime   || null,
    duration_seconds: walk.durationSeconds,
    count:            walk.count,
  };
}

function sightingToSupabase(sighting, walkId, userId) {
  return {
    walk_id: walkId,
    user_id: userId,
    seen_at: sighting.timestamp,
    lat:     sighting.lat ?? null,
    lng:     sighting.lng ?? null,
  };
}

// ===== Sync one walk to Supabase =====
// Returns true on success, false on failure/skip.
async function syncWalk(walk) {
  if (!currentUser || !navigator.onLine) return false;

  try {
    const { data: row, error: walkErr } = await supabaseClient
      .from('walks')
      .insert(walkToSupabase(walk, currentUser.id))
      .select()
      .single();

    if (walkErr) throw walkErr;

    if (walk.sightings && walk.sightings.length > 0) {
      const rows = walk.sightings.map(s => sightingToSupabase(s, row.id, currentUser.id));
      const { error: sErr } = await supabaseClient.from('sightings').insert(rows);
      if (sErr) throw sErr;
    }

    // Mark synced in localStorage
    const walks = loadWalks();
    const idx = walks.findIndex(w => w.id === walk.id);
    if (idx !== -1) {
      walks[idx].synced     = true;
      walks[idx].supabaseId = row.id;
      persistWalks(walks);
    }

    return true;
  } catch (err) {
    console.error('[sync] walk sync failed:', err);
    return false;
  }
}

// ===== Sync all unsynced walks =====
async function syncPendingWalks() {
  if (!currentUser || !navigator.onLine) return;
  const unsynced = loadWalks().filter(w => !w.synced);
  for (const walk of unsynced) {
    await syncWalk(walk);
  }
}

// ===== Fetch from Supabase and merge with localStorage =====
// Persists the merged result to localStorage and returns it.
async function fetchAndMergeHistory() {
  if (!currentUser || !navigator.onLine) return loadWalks();

  try {
    const { data: remoteWalks, error } = await supabaseClient
      .from('walks')
      .select('id, started_at, ended_at, duration_seconds, count, sightings(id, seen_at, lat, lng)')
      .order('started_at', { ascending: false });

    if (error) throw error;

    // Convert remote walks to local shape
    const remoteLocal = remoteWalks.map(rw => ({
      id:              rw.id,
      date:            rw.started_at.substring(0, 10),
      startTime:       rw.started_at,
      endTime:         rw.ended_at,
      durationSeconds: rw.duration_seconds,
      count:           rw.count,
      sightings:       (rw.sightings || []).map(s => ({
        timestamp: s.seen_at,
        lat:       s.lat,
        lng:       s.lng,
      })),
      synced:     true,
      supabaseId: rw.id,
    }));

    // Keep local-only walks that haven't made it to Supabase yet
    const localWalks  = loadWalks();
    const remoteIdSet = new Set(remoteWalks.map(r => r.id));
    const localOnly   = localWalks.filter(w =>
      !w.synced && !(w.supabaseId && remoteIdSet.has(w.supabaseId))
    );

    // Merge, newest first
    const merged = [...remoteLocal, ...localOnly].sort(
      (a, b) => new Date(b.startTime) - new Date(a.startTime)
    );

    persistWalks(merged);
    return merged;
  } catch (err) {
    console.error('[sync] fetch history failed:', err);
    return loadWalks();
  }
}

// ===== One-time migration prompt =====
// Shown when the user first logs in and has pre-existing local walks.
function checkMigration() {
  if (!currentUser) return;
  if (localStorage.getItem(MIGRATION_KEY)) return;

  const unsynced = loadWalks().filter(w => !w.synced);
  if (unsynced.length === 0) {
    localStorage.setItem(MIGRATION_KEY, '1');
    return;
  }

  document.getElementById('migration-walk-count').textContent = unsynced.length;
  document.getElementById('migration-walk-plural').textContent = unsynced.length === 1 ? '' : 's';
  document.getElementById('dialog-migration').classList.remove('hidden');
}

async function doMigration() {
  document.getElementById('dialog-migration').classList.add('hidden');
  localStorage.setItem(MIGRATION_KEY, '1');
  await syncPendingWalks();
  renderHistory();
}

function skipMigration() {
  document.getElementById('dialog-migration').classList.add('hidden');
  localStorage.setItem(MIGRATION_KEY, '1');
}
