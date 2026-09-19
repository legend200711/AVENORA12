/**
 * AVENORA RADIO — Admin Control Panel (frontend/src/pages/radioadmin.js)
 *
 * Available to admin/founder roles only.
 * Lets admins:
 *   - Start / pause / resume / skip the station
 *   - Upload new music (with copyright acknowledgement)
 *   - Add existing music from the library
 *   - Reorder / remove tracks
 *   - Toggle shuffle / repeat
 *   - See live station status
 */

registerPage('radioadmin', {
  async render(container) {
    const user = window.LegendState?.get?.('user');
    if (!user || (user.role !== 'admin' && user.role !== 'founder')) {
      container.innerHTML = `
        <div style="text-align:center;padding:var(--space-3xl);color:var(--text-muted)">
          <div style="font-size:2rem;margin-bottom:12px">🔒</div>
          <div style="font-family:var(--font-display);letter-spacing:0.18em;margin-bottom:8px">ADMIN ONLY</div>
          <div style="font-size:0.85rem">This panel requires admin or founder access.</div>
          <button class="btn btn-primary" style="margin-top:var(--space-lg)" onclick="navigateTo('radio')">← Back to Radio</button>
        </div>`;
      return;
    }
    container.innerHTML = _adminShell();
    await _initAdmin();
  }
});

function _adminShell() {
  return `
    <div class="radio-admin-page">
      <div class="radio-admin-header">
        <h1 class="radio-admin-title">
          <span style="color:var(--neon-blue)">AVENORA</span> RADIO ADMIN
        </h1>
        <p style="color:var(--text-muted);font-size:0.82rem;letter-spacing:0.15em">STATION CONTROL PANEL</p>
        <div style="margin-top:var(--space-md)">
          <button class="radio-action-btn" onclick="navigateTo('radio')">📻 Open Radio Player</button>
        </div>
      </div>

      <!-- Status card -->
      <div class="card" style="border-color:rgba(0,160,255,0.20);margin-bottom:var(--space-lg)">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-sm);margin-bottom:var(--space-md)">
          <h3 style="font-family:var(--font-display);letter-spacing:0.12em;font-size:1rem;margin:0">STATION STATUS</h3>
          <span id="radmin-status-badge" class="radio-live-badge">LOADING</span>
        </div>
        <div id="radmin-now-playing" style="color:var(--text-muted);font-size:0.85rem;margin-bottom:var(--space-md)">Loading…</div>
        <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap">
          <button class="btn btn-green" id="radmin-btn-start"  onclick="radminStartStation()">▶ Start Station</button>
          <button class="btn btn-outline" id="radmin-btn-pause"  onclick="radminPauseStation()">⏸ Pause</button>
          <button class="btn btn-outline" id="radmin-btn-resume" onclick="radminResumeStation()">▶ Resume</button>
          <button class="btn btn-outline" id="radmin-btn-skip"   onclick="radminSkipTrack()">⏭ Skip Track</button>
          <button class="btn btn-ghost btn-sm" onclick="radminRefreshStatus()">↻ Refresh</button>
        </div>
      </div>

      <!-- Shuffle / repeat toggles -->
      <div class="card" style="border-color:var(--border-subtle);margin-bottom:var(--space-lg);display:flex;gap:var(--space-md);align-items:center;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.85rem">
          <input type="checkbox" id="radmin-shuffle" onchange="radminSetShuffle(this.checked)" style="accent-color:var(--neon-green)">
          <span>⇄ Shuffle</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.85rem">
          <input type="checkbox" id="radmin-repeat" checked onchange="radminSetRepeat(this.checked)" style="accent-color:var(--neon-blue)">
          <span>↺ Repeat</span>
        </label>
      </div>

      <!-- Main panels -->
      <div class="radio-admin-panels">

        <!-- LEFT: Playlist -->
        <div>
          <div class="card" style="border-color:var(--border-subtle)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md)">
              <h3 style="font-family:var(--font-display);letter-spacing:0.1em;font-size:0.9rem;margin:0">PLAYLIST</h3>
              <span id="radmin-track-count" style="font-size:0.72rem;color:var(--text-muted)">0 tracks</span>
            </div>
            <div id="radmin-playlist" style="min-height:120px;max-height:480px;overflow-y:auto">
              <div style="text-align:center;color:var(--text-muted);font-size:0.82rem;padding:var(--space-xl)">No tracks</div>
            </div>
          </div>
        </div>

        <!-- RIGHT: Add music -->
        <div>
          <!-- Upload -->
          <div class="card" style="border-color:var(--border-subtle);margin-bottom:var(--space-lg)">
            <h3 style="font-family:var(--font-display);letter-spacing:0.1em;font-size:0.9rem;margin-bottom:var(--space-md)">UPLOAD MUSIC</h3>

            <!-- Copyright notice -->
            <div class="radio-copyright-notice">
              ⚠️ Only upload music you own or have permission/licence to broadcast publicly.
              Do not upload copyrighted material without authorisation.
            </div>

            <label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;margin-bottom:var(--space-md);cursor:pointer">
              <input type="checkbox" id="radmin-copyright-ack" style="accent-color:var(--neon-green)">
              I confirm I have the rights to broadcast this music.
            </label>

            <form id="radmin-upload-form" onsubmit="radminUploadTrack(event)">
              <div class="form-group">
                <label class="form-label">Audio File</label>
                <input type="file" id="radmin-upload-file" class="form-input" accept=".mp3,.m4a,.aac,.wav,.ogg,.opus,.flac"
                       onchange="radminFileSelected(this)" required style="padding:8px">
              </div>
              <div class="form-group">
                <label class="form-label">Title</label>
                <input type="text" id="radmin-upload-title" class="form-input" required placeholder="Track title" maxlength="200">
              </div>
              <div class="form-group">
                <label class="form-label">Artist</label>
                <input type="text" id="radmin-upload-artist" class="form-input" placeholder="Artist name" maxlength="200">
              </div>
              <div class="form-group">
                <label class="form-label">Album (optional)</label>
                <input type="text" id="radmin-upload-album" class="form-input" placeholder="Album" maxlength="200">
              </div>
              <div class="form-group">
                <label class="form-label">Genre</label>
                <select id="radmin-upload-genre" class="form-input">
                  <option value="">Select genre</option>
                  ${[
                    'Hip-Hop','R&B','Trap','Drill','Afrobeats','Pop','Rock','Electronic',
                    'House','Techno','Drum & Bass','Reggae','Gospel','Jazz','Soul',
                    'Indie','Alternative','Lo-Fi','Ambient','Cinematic','Other'
                  ].map(g => `<option value="${g}">${g}</option>`).join('')}
                </select>
              </div>
              <div id="radmin-upload-progress" class="hidden" style="margin-bottom:var(--space-sm)">
                <div style="height:4px;background:rgba(0,160,255,0.14);border-radius:2px;overflow:hidden">
                  <div id="radmin-upload-bar" style="height:100%;background:linear-gradient(90deg,#0080ff,#00ccff);width:0%;transition:width 0.3s linear;border-radius:2px"></div>
                </div>
                <div id="radmin-upload-msg" style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">Uploading…</div>
              </div>
              <div id="radmin-upload-error" class="hidden" style="color:var(--neon-red);font-size:0.8rem;margin-bottom:8px"></div>
              <button type="submit" class="btn btn-primary w-full" id="radmin-upload-btn">⬆ Upload &amp; Add to Station</button>
            </form>
          </div>

          <!-- Add from library -->
          <div class="card" style="border-color:var(--border-subtle)">
            <h3 style="font-family:var(--font-display);letter-spacing:0.1em;font-size:0.9rem;margin-bottom:var(--space-md)">ADD FROM LIBRARY</h3>
            <div class="search-bar" style="margin-bottom:var(--space-md)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input type="search" id="radmin-lib-search" placeholder="Search library…"
                     oninput="radminSearchLibrary(this.value)" aria-label="Search library">
            </div>
            <div id="radmin-lib-results" style="max-height:300px;overflow-y:auto">
              <div style="text-align:center;color:var(--text-muted);font-size:0.82rem;padding:var(--space-lg)">
                Search for tracks to add…
              </div>
            </div>
          </div>
        </div>

      </div><!-- /panels -->
    </div>
  `;
}

// ─── Admin state ──────────────────────────────────────────
let _radminState = {
  playlist:       [],
  status:         null,
  libSearchTimer: null,
};

async function _initAdmin() {
  await radminRefreshStatus();
}

// ─── Status refresh ───────────────────────────────────────
window.radminRefreshStatus = async function () {
  try {
    const data = await _radminFetch('GET', '/radio/status');
    _radminState.status = data;

    const badge = document.getElementById('radmin-status-badge');
    const npEl  = document.getElementById('radmin-now-playing');

    if (badge) {
      badge.textContent = data.status ? data.status.toUpperCase() : 'UNKNOWN';
      badge.style.borderColor = data.running ? 'rgba(0,220,80,0.40)' : 'rgba(200,50,50,0.30)';
      badge.style.color       = data.running ? 'rgba(0,220,80,0.90)' : 'rgba(220,80,80,0.85)';
    }

    if (npEl) {
      if (data.currentTrack) {
        npEl.innerHTML = `
          <strong style="color:var(--text-primary)">${escapeHtml(data.currentTrack.title || 'Unknown')}</strong>
          <span style="color:var(--text-muted)"> — ${escapeHtml(data.currentTrack.artist || '')}</span>
          <span style="color:rgba(0,160,255,0.55);margin-left:8px;font-size:0.78rem">
            track ${(data.currentIndex || 0) + 1}/${data.playlistLength || 0}
          </span>
        `;
      } else {
        npEl.textContent = data.running ? 'Station running — no track info' : 'Station not playing';
      }
    }

    // Shuffle/repeat checkboxes
    const shuf = document.getElementById('radmin-shuffle');
    const rep  = document.getElementById('radmin-repeat');
    if (shuf) shuf.checked = !!data.shuffle;
    if (rep)  rep.checked  = data.repeat !== false;

    // Update playlist from station status
    if (data.currentIndex !== undefined && _radminState.playlist.length === 0) {
      // Try to load playlist from Firestore
      await _loadPlaylistFromFirestore();
    }

    _radminRenderPlaylist();
  } catch (err) {
    console.warn('[RadioAdmin] Status refresh failed:', err);
  }
};

// ─── Load playlist from Firestore ────────────────────────
async function _loadPlaylistFromFirestore() {
  try {
    const { getFirestore } = window.AvenoraFirebase || {};
    if (!getFirestore) return;
    const db  = await getFirestore();
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'radioStations', 'avenoraRadio'));
    if (snap.exists() && snap.data().playlist) {
      _radminState.playlist = snap.data().playlist;
    }
  } catch {}
}

// ─── Render playlist ──────────────────────────────────────
function _radminRenderPlaylist() {
  const pl = _radminState.playlist;
  const el = document.getElementById('radmin-playlist');
  const ct = document.getElementById('radmin-track-count');

  if (ct) ct.textContent = `${pl.length} track${pl.length !== 1 ? 's' : ''}`;

  if (!el) return;
  if (!pl.length) {
    el.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:0.82rem;padding:var(--space-xl)">No tracks in station playlist</div>`;
    return;
  }

  const currentIdx = _radminState.status?.currentIndex || 0;
  el.innerHTML = pl.map((t, i) => `
    <div class="radio-admin-track-row${i === currentIdx ? ' current' : ''}">
      <span class="radio-admin-drag-handle">⠿</span>
      <span style="font-size:0.72rem;color:var(--text-muted);width:22px;text-align:center;flex-shrink:0">${i + 1}</span>
      <div style="flex:1;min-width:0">
        <div class="radio-track-title">${escapeHtml(t.title || 'Untitled')}</div>
        <div class="radio-track-artist" style="font-size:0.73rem;color:var(--text-muted)">${escapeHtml(t.artist || '')}</div>
      </div>
      <span style="font-size:0.72rem;color:var(--text-muted);flex-shrink:0">${t.duration ? _radminFmtTime(t.duration) : ''}</span>
      <button onclick="radminRemoveTrack('${escapeHtml(t.id || '')}')"
              style="background:none;border:none;color:rgba(220,60,60,0.60);cursor:pointer;padding:4px 6px;font-size:0.9rem"
              title="Remove from station">✕</button>
    </div>`).join('');
}

// ─── Station controls ─────────────────────────────────────
window.radminStartStation = async function () {
  if (!_radminState.playlist.length) {
    alert('Add tracks to the playlist before starting.');
    return;
  }
  try {
    await _radminFetch('POST', '/radio/station/start', {
      playlist:  _radminState.playlist,
      shuffle:   document.getElementById('radmin-shuffle')?.checked || false,
      repeat:    document.getElementById('radmin-repeat')?.checked !== false,
    });
    if (typeof Toast !== 'undefined') Toast.show('Station started!', 'success');
    await radminRefreshStatus();
  } catch (err) {
    if (typeof Toast !== 'undefined') Toast.show('Error: ' + err.message, 'error');
  }
};

window.radminPauseStation = async function () {
  try {
    await _radminFetch('POST', '/radio/station/pause');
    if (typeof Toast !== 'undefined') Toast.show('Station paused', 'info');
    await radminRefreshStatus();
  } catch (err) {
    if (typeof Toast !== 'undefined') Toast.show('Error: ' + err.message, 'error');
  }
};

window.radminResumeStation = async function () {
  try {
    await _radminFetch('POST', '/radio/station/resume');
    if (typeof Toast !== 'undefined') Toast.show('Station resumed', 'success');
    await radminRefreshStatus();
  } catch (err) {
    if (typeof Toast !== 'undefined') Toast.show('Error: ' + err.message, 'error');
  }
};

window.radminSkipTrack = async function () {
  try {
    await _radminFetch('POST', '/radio/station/skip');
    if (typeof Toast !== 'undefined') Toast.show('Track skipped', 'info');
    await radminRefreshStatus();
  } catch (err) {
    if (typeof Toast !== 'undefined') Toast.show('Error: ' + err.message, 'error');
  }
};

window.radminSetShuffle = async function (val) {
  try {
    await _radminFetch('PUT', '/radio/station/settings', { shuffle: val });
  } catch {}
};

window.radminSetRepeat = async function (val) {
  try {
    await _radminFetch('PUT', '/radio/station/settings', { repeat: val });
  } catch {}
};

// ─── Track remove ─────────────────────────────────────────
window.radminRemoveTrack = async function (trackId) {
  if (!trackId) return;
  try {
    await _radminFetch('DELETE', `/radio/station/playlist/${encodeURIComponent(trackId)}`);
    _radminState.playlist = _radminState.playlist.filter(t => t.id !== trackId);
    _radminRenderPlaylist();
    if (typeof Toast !== 'undefined') Toast.show('Track removed', 'info');
  } catch (err) {
    if (typeof Toast !== 'undefined') Toast.show('Error: ' + err.message, 'error');
  }
};

// ─── Upload music ─────────────────────────────────────────
window.radminFileSelected = function (input) {
  const file = input.files[0];
  if (!file) return;
  // Auto-fill title from filename
  const titleInput = document.getElementById('radmin-upload-title');
  if (titleInput && !titleInput.value) {
    titleInput.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
  }
};

window.radminUploadTrack = async function (e) {
  e.preventDefault();

  if (!document.getElementById('radmin-copyright-ack')?.checked) {
    alert('Please confirm you have rights to broadcast this music.');
    return;
  }

  const file   = document.getElementById('radmin-upload-file')?.files?.[0];
  const title  = document.getElementById('radmin-upload-title')?.value?.trim();
  const artist = document.getElementById('radmin-upload-artist')?.value?.trim() || '';
  const album  = document.getElementById('radmin-upload-album')?.value?.trim() || '';
  const genre  = document.getElementById('radmin-upload-genre')?.value || '';

  if (!file || !title) return;

  const btn = document.getElementById('radmin-upload-btn');
  const errEl = document.getElementById('radmin-upload-error');
  const progWrap = document.getElementById('radmin-upload-progress');
  const progBar  = document.getElementById('radmin-upload-bar');
  const progMsg  = document.getElementById('radmin-upload-msg');

  btn.disabled = true;
  btn.textContent = '⬆ Uploading…';
  errEl?.classList.add('hidden');
  progWrap?.classList.remove('hidden');

  try {
    // Use AvenoraStorage.uploadMusic — same path as the Music Hub.
    // This uploads directly to Supabase Storage and saves metadata to Firestore.
    if (!window.AvenoraStorage) {
      throw new Error('Storage service not loaded. Refresh the page and try again.');
    }

    const result = await window.AvenoraStorage.uploadMusic(
      file,
      { title, artist, album, genre },
      (pct) => {
        if (progBar) progBar.style.width = Math.round(pct * 0.9) + '%';
      }
    );

    if (!result.success && !result.track) throw new Error('Upload failed');

    const track = result.track;
    if (progBar) progBar.style.width = '100%';
    if (progMsg) progMsg.textContent = 'Upload complete! Adding to station…';

    // Add the uploaded track to the station playlist via API
    const addPayload = {
      id:          track.id || String(Date.now()),
      title:       track.title || title,
      artist:      track.artistName || artist,
      album:       track.albumTitle || album,
      genre:       track.genre  || genre,
      url:         track.fileUrl || track.url || '',
      duration:    track.duration || 0,
      storagePath: track.storagePath || '',
      coverUrl:    track.coverUrl || null,
      uploadedBy:  '',
    };

    try {
      await _radminFetch('POST', '/radio/station/playlist/add', addPayload);
      _radminState.playlist.push(addPayload);
      _radminRenderPlaylist();
      if (typeof Toast !== 'undefined') Toast.show('Track uploaded and added to station!', 'success');
    } catch {
      if (typeof Toast !== 'undefined') Toast.show('Uploaded, but could not add to station — use "Add from Library"', 'info');
    }

    // Reset form
    e.target.reset();
    document.getElementById('radmin-copyright-ack').checked = false;

  } catch (err) {
    if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
  } finally {
    btn.disabled    = false;
    btn.textContent = '⬆ Upload & Add to Station';
    setTimeout(() => progWrap?.classList.add('hidden'), 2000);
  }
};

// ─── Library search ───────────────────────────────────────
window.radminSearchLibrary = function (q) {
  clearTimeout(_radminState.libSearchTimer);
  _radminState.libSearchTimer = setTimeout(() => _doLibSearch(q), 350);
};

async function _doLibSearch(q) {
  const el = document.getElementById('radmin-lib-results');
  if (!el) return;
  if (!q || q.length < 2) {
    el.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:0.82rem;padding:var(--space-lg)">Search for tracks to add…</div>`;
    return;
  }
  el.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:0.82rem;padding:var(--space-md)"><div class="spinner spinner-sm"></div></div>`;
  try {
    // Search Firestore cloudStreamTracks (where AvenoraStorage.uploadMusic stores tracks).
    // This works without the backend being awake and covers all uploaded music.
    let tracks = await _searchFirestoreTracks(q);

    // Fallback: try backend API if Firestore returns nothing
    if (!tracks.length) {
      try {
        const data = await LegendAPI.music.search(q, 20);
        tracks = (data.tracks || []).map(t => ({
          id:          t.id || t._id,
          title:       t.title,
          artist:      t.artistName || t.artist || '',
          album:       t.albumTitle || t.album  || '',
          genre:       t.genre  || '',
          url:         t.fileUrl || t.url || '',
          duration:    t.duration || 0,
          storagePath: t.storagePath || '',
          coverUrl:    t.coverUrl || null,
        }));
      } catch { /* backend unavailable — stay with empty */ }
    }

    if (!tracks.length) {
      el.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:0.82rem;padding:var(--space-lg)">No tracks found</div>`;
      return;
    }
    // Store in module-level cache; use index in onclick to avoid inline JSON
    window._radminLibResults = tracks;
    el.innerHTML = tracks.map((t, idx) => `
      <div class="radio-admin-track-row">
        <div style="flex:1;min-width:0">
          <div class="radio-track-title">${escapeHtml(t.title || 'Untitled')}</div>
          <div class="radio-track-artist" style="font-size:0.73rem;color:var(--text-muted)">${escapeHtml(t.artist || '')}</div>
        </div>
        <button onclick="radminAddFromLibrary(${idx})"
                class="btn btn-ghost btn-sm" style="white-space:nowrap;font-size:0.75rem">+ Add</button>
      </div>`).join('');
  } catch (err) {
    el.innerHTML = `<div style="color:var(--neon-red);font-size:0.8rem;padding:var(--space-md)">Search failed: ${escapeHtml(err.message)}</div>`;
  }
}

// Search all cloudStreamTracks sub-collections for any uid whose tracks match q.
// Since Firestore collection-group queries require an index, we query the current
// user's own tracks (always available) plus any uid stored in _radminState.
async function _searchFirestoreTracks(q) {
  const lq = q.toLowerCase();
  try {
    const { getFirestore } = window.AvenoraFirebase || {};
    if (!getFirestore) return [];
    const db  = await getFirestore();

    // Try a collection-group query on "tracks" sub-collections first
    const { collection, collectionGroup, query, where, limit, getDocs, orderBy } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    let snap;
    try {
      snap = await getDocs(query(collectionGroup(db, 'tracks'), where('status', '==', 'ready'), limit(200)));
    } catch {
      // Collection-group index may not exist — fall back to current user's own tracks
      const user = window.AvenoraFirebase?.Auth?.getUser?.();
      const uid  = user?.uid || user?.id;
      if (!uid) return [];
      snap = await getDocs(query(collection(db, 'cloudStreamTracks', uid, 'tracks'), limit(200)));
    }

    const results = [];
    snap.forEach(docSnap => {
      const d = docSnap.data();
      const matchesQ =
        (d.title  || '').toLowerCase().includes(lq) ||
        (d.artist || '').toLowerCase().includes(lq) ||
        (d.album  || '').toLowerCase().includes(lq);
      if (matchesQ && (d.url || d.fileUrl)) {
        results.push({
          id:          docSnap.id,
          title:       d.title  || 'Untitled',
          artist:      d.artist || '',
          album:       d.album  || '',
          genre:       d.genre  || '',
          url:         d.url    || d.fileUrl || '',
          duration:    d.duration || 0,
          storagePath: d.storagePath || '',
          coverUrl:    d.coverUrl || null,
        });
      }
    });
    return results.slice(0, 30);
  } catch {
    return [];
  }
}

window.radminAddFromLibrary = async function (indexOrJson) {
  try {
    const t = (typeof indexOrJson === 'number')
      ? (window._radminLibResults || [])[indexOrJson]
      : JSON.parse(indexOrJson);
    if (!t) return;
    const payload = {
      id:          t._id || t.id || String(Date.now()),
      title:       t.title || 'Untitled',
      artist:      t.artist || t.artistName || '',
      album:       t.album  || '',
      genre:       t.genre  || '',
      url:         t.fileUrl || t.url || '',
      duration:    t.duration || 0,
      storagePath: t.storagePath || '',
      coverUrl:    t.coverUrl || t.albumArt || null,
    };
    if (!payload.url) {
      if (typeof Toast !== 'undefined') Toast.show('Track has no audio URL', 'error');
      return;
    }
    await _radminFetch('POST', '/radio/station/playlist/add', payload);
    _radminState.playlist.push(payload);
    _radminRenderPlaylist();
    if (typeof Toast !== 'undefined') Toast.show(`"${payload.title}" added to station!`, 'success');
  } catch (err) {
    if (typeof Toast !== 'undefined') Toast.show('Error: ' + err.message, 'error');
  }
};

// ─── Helpers ─────────────────────────────────────────────
async function _radminGetToken() {
  try {
    const { getFirebaseAuth } = window.AvenoraFirebase || {};
    if (!getFirebaseAuth) return null;
    const auth = await getFirebaseAuth();
    return auth.currentUser ? await auth.currentUser.getIdToken() : null;
  } catch { return null; }
}

async function _radminFetch(method, path, body) {
  const token = await _radminGetToken();
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body)  opts.body = JSON.stringify(body);

  const url = `${LU_CONFIG.apiUrl}${path}`;
  const res  = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

function _radminFmtTime(sec) {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}
