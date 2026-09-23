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
                <div style="display:flex;align-items:center;gap:8px">
                  <span id="radmin-track-count" style="font-size:0.72rem;color:var(--text-muted)">0 tracks</span>
                  <button class="btn btn-ghost btn-sm" style="font-size:0.7rem;padding:2px 8px" onclick="radminRepairPlaylist()" title="Repair tracks with missing audio URLs">🔧 Repair</button>
                </div>
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
    let data = null;

    // Prefer the backend API when available — it reflects live engine state.
    // In production (no backend) fall back to reading Firestore directly.
    if (window.LU_CONFIG?.apiUrl) {
      try {
        data = await _radminFetch('GET', '/radio/status');
      } catch (apiErr) {
        console.warn('[RadioAdmin] Backend status fetch failed, falling back to Firestore:', apiErr.message);
      }
    }

    // Always load playlist from Firestore (source of truth for playlist content)
    await _loadPlaylistFromFirestore(data || {});

    // If backend returned data, use it for the status display
    if (data) {
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
    } else {
      // No backend — show status from Firestore
      const badge = document.getElementById('radmin-status-badge');
      const npEl  = document.getElementById('radmin-now-playing');
      const stationData = await _radminLoadFirestoreStation();
      const statusText  = stationData?.status || 'stopped';
      if (badge) {
        badge.textContent       = statusText.toUpperCase();
        badge.style.borderColor = statusText === 'playing' ? 'rgba(0,220,80,0.40)' : 'rgba(200,50,50,0.30)';
        badge.style.color       = statusText === 'playing' ? 'rgba(0,220,80,0.90)' : 'rgba(220,80,80,0.85)';
      }
      if (npEl) {
        const tracks = _radminState.playlist;
        if (tracks.length) {
          npEl.innerHTML = `<span style="color:var(--text-muted)">${tracks.length} track${tracks.length !== 1 ? 's' : ''} in playlist — station managed via Firestore</span>`;
        } else {
          npEl.textContent = 'No tracks in station — add from library';
        }
      }
    }

    _radminRenderPlaylist();
  } catch (err) {
    console.warn('[RadioAdmin] Status refresh failed:', err.message || err);
  }
};

// ─── Load playlist from Firestore ────────────────────────
async function _loadPlaylistFromFirestore(statusData) {
  try {
    const { getFirestore } = window.AvenoraFirebase || {};
    if (!getFirestore) return;
    const db  = await getFirestore();
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'radioStations', 'avenoraRadio'));
    if (snap.exists()) {
      const stationData = snap.data();
      if (stationData.playlist && stationData.playlist.length > 0) {
        _radminState.playlist = stationData.playlist;
        console.info('[RadioAdmin] Loaded', _radminState.playlist.length, 'tracks from Firestore radioStations');

        // Auto-repair: check each track and log MEDIA_RECORD_MISSING diagnostics
        // for any entry without a URL (does not modify Firestore — just diagnoses)
        const broken = _radminState.playlist.filter(t => !t.url && !t.audioUrl && !t.fileUrl);
        if (broken.length) {
          console.warn('[RadioAdmin] MEDIA_RECORD_MISSING — playlist has', broken.length, 'tracks without audio URLs:', broken.map(t => ({
            id: t.id, title: t.title, storagePath: t.storagePath, mediaId: t.mediaId, trackId: t.trackId,
          })));
        }

        return;
      }
    }
  } catch (e) {
    console.warn('[RadioAdmin] Firestore playlist load failed:', e.message);
  }

  // Fallback: use playlist data embedded in the status API response
  if (statusData?.playlist && Array.isArray(statusData.playlist) && statusData.playlist.length > 0) {
    _radminState.playlist = statusData.playlist;
    console.info('[RadioAdmin] Loaded', _radminState.playlist.length, 'tracks from status API');
  }
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
  el.innerHTML = pl.map((t, i) => {
    const hasUrl = !!(t.url || t.audioUrl || t.fileUrl);
    const isBroken = t._broken || !hasUrl;
    return `
    <div class="radio-admin-track-row${i === currentIdx ? ' current' : ''}" style="${isBroken ? 'border-left:2px solid rgba(220,60,60,0.55)' : ''}">
      <span class="radio-admin-drag-handle">⠿</span>
      <span style="font-size:0.72rem;color:var(--text-muted);width:22px;text-align:center;flex-shrink:0">${i + 1}</span>
      <div style="flex:1;min-width:0">
        <div class="radio-track-title">${escapeHtml(t.title || 'Untitled')}${isBroken ? ' <span style="color:rgba(220,60,60,0.80);font-size:0.65rem;margin-left:4px" title="No audio URL — click 🔧 Repair to fix">⚠ NO URL</span>' : ''}</div>
        <div class="radio-track-artist" style="font-size:0.73rem;color:var(--text-muted)">${escapeHtml(t.artist || '')}</div>
      </div>
      <span style="font-size:0.72rem;color:var(--text-muted);flex-shrink:0">${t.duration ? _radminFmtTime(t.duration) : ''}</span>
      <button onclick="radminRemoveTrack('${escapeHtml(t.id || '')}')"
              style="background:none;border:none;color:rgba(220,60,60,0.60);cursor:pointer;padding:4px 6px;font-size:0.9rem"
              title="Remove from station">✕</button>
    </div>`;
  }).join('');
}

// ─── Station controls ─────────────────────────────────────
// When a backend is available (window.LU_CONFIG?.apiUrl set), delegate to it.
// Otherwise write directly to Firestore so the radio player picks up changes.

async function _radminFirestoreSetStatus(patch) {
  const db  = await _radminGetFirestore();
  const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const tsNow = Date.now();
  await setDoc(doc(db, 'radioStations', 'avenoraRadio'), {
    ...patch,
    updatedAt: tsNow,
  }, { merge: true });
  // Mirror status to stationNowPlaying so the radio player reacts.
  // Always include serverTime so listeners can calibrate their clock offset.
  await setDoc(doc(db, 'stationNowPlaying', 'avenoraRadio'), {
    ...patch,
    serverTime: tsNow,
    updatedAt:  tsNow,
  }, { merge: true });
}

window.radminStartStation = async function () {
  if (!_radminState.playlist.length) {
    alert('Add tracks to the playlist before starting.');
    return;
  }
  try {
    if (window.LU_CONFIG?.apiUrl) {
      await _radminFetch('POST', '/radio/station/start', {
        playlist:  _radminState.playlist,
        shuffle:   document.getElementById('radmin-shuffle')?.checked || false,
        repeat:    document.getElementById('radmin-repeat')?.checked !== false,
      });
    } else {
      // Production: start the station by writing to Firestore.
      // trackStartedAt is the master station clock — all listeners compute their
      // playback position as (serverNow - trackStartedAt).
      const playlist = _radminState.playlist;
      const track    = playlist[0];
      const tsNow    = Date.now();
      // Initialise queueRevision so the first advance can be validated.
      await _radminFirestoreSetStatus({
        status:          'playing',
        active:          true,
        currentIndex:    0,
        trackStartedAt:  tsNow,
        queueRevision:   1,
        currentTitle:    track?.title    || '',
        currentArtist:   track?.artist   || '',
        currentUrl:      track?.url      || '',
        currentDuration: track?.duration || 0,
        currentCoverUrl: track?.coverUrl || null,
        currentTrackId:  track?.id       || '',
        currentTrackIndex: 0,
        playlist,
        playlistLength:  playlist.length,
        upcoming: playlist.slice(1, 6).map(t => ({
          id: t.id, title: t.title, artist: t.artist, coverUrl: t.coverUrl || null, duration: t.duration || 0,
        })),
        recentlyPlayed: [],
        shuffle:   document.getElementById('radmin-shuffle')?.checked || false,
        repeat:    document.getElementById('radmin-repeat')?.checked !== false,
      });
    }
    if (typeof Toast !== 'undefined') Toast.show('Station started!', 'success');
    await radminRefreshStatus();
  } catch (err) {
    console.error('[RadioAdmin] startStation failed:', err.message);
    if (typeof Toast !== 'undefined') Toast.show('Error: ' + err.message, 'error');
  }
};

window.radminPauseStation = async function () {
  try {
    if (window.LU_CONFIG?.apiUrl) {
      await _radminFetch('POST', '/radio/station/pause');
    } else {
      await _radminFirestoreSetStatus({ status: 'paused', active: false });
    }
    if (typeof Toast !== 'undefined') Toast.show('Station paused', 'info');
    await radminRefreshStatus();
  } catch (err) {
    if (typeof Toast !== 'undefined') Toast.show('Error: ' + err.message, 'error');
  }
};

window.radminResumeStation = async function () {
  try {
    if (window.LU_CONFIG?.apiUrl) {
      await _radminFetch('POST', '/radio/station/resume');
    } else {
      await _radminFirestoreSetStatus({ status: 'playing', active: true });
    }
    if (typeof Toast !== 'undefined') Toast.show('Station resumed', 'success');
    await radminRefreshStatus();
  } catch (err) {
    if (typeof Toast !== 'undefined') Toast.show('Error: ' + err.message, 'error');
  }
};

window.radminSkipTrack = async function () {
  try {
    if (window.LU_CONFIG?.apiUrl) {
      await _radminFetch('POST', '/radio/station/skip');
    } else {
      // Advance to next track in Firestore.
      // Bump queueRevision so the listener-side transaction guard can detect
      // that the admin already advanced and avoid a double-skip.
      const station = await _radminLoadFirestoreStation();
      if (station && Array.isArray(station.playlist) && station.playlist.length) {
        const nextIdx    = ((station.currentIndex || 0) + 1) % station.playlist.length;
        const track      = station.playlist[nextIdx];
        const newRevision = (station.queueRevision || 0) + 1;
        const tsNow       = Date.now();

        const upcoming = [];
        for (let i = 1; i <= 5; i++) {
          const t = station.playlist[(nextIdx + i) % station.playlist.length];
          if (t) upcoming.push({ id: t.id, title: t.title, artist: t.artist, coverUrl: t.coverUrl || null, duration: t.duration || 0 });
        }

        await _radminFirestoreSetStatus({
          currentIndex:    nextIdx,
          trackStartedAt:  tsNow,
          queueRevision:   newRevision,
          currentTitle:    track?.title    || '',
          currentArtist:   track?.artist   || '',
          currentUrl:      track?.url      || '',
          currentDuration: track?.duration || 0,
          currentCoverUrl: track?.coverUrl || null,
          currentTrackId:  track?.id       || '',
          upcoming,
          // Keep recentlyPlayed intact — listeners will see it from their cached doc
        });
      }
    }
    if (typeof Toast !== 'undefined') Toast.show('Track skipped', 'info');
    await radminRefreshStatus();
  } catch (err) {
    if (typeof Toast !== 'undefined') Toast.show('Error: ' + err.message, 'error');
  }
};

window.radminSetShuffle = async function (val) {
  try {
    if (window.LU_CONFIG?.apiUrl) {
      await _radminFetch('PUT', '/radio/station/settings', { shuffle: val });
    } else {
      await _radminFirestoreSetStatus({ shuffle: val });
    }
  } catch {}
};

window.radminSetRepeat = async function (val) {
  try {
    if (window.LU_CONFIG?.apiUrl) {
      await _radminFetch('PUT', '/radio/station/settings', { repeat: val });
    } else {
      await _radminFirestoreSetStatus({ repeat: val });
    }
  } catch {}
};

// ─── Track remove ─────────────────────────────────────────
window.radminRemoveTrack = async function (trackId) {
  if (!trackId) return;
  try {
    if (window.LU_CONFIG?.apiUrl) {
      await _radminFetch('DELETE', `/radio/station/playlist/${encodeURIComponent(trackId)}`);
    } else {
      // Remove from Firestore playlist directly
      const db = await _radminGetFirestore();
      const { doc, getDoc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const stationRef = doc(db, 'radioStations', 'avenoraRadio');
      const snap = await getDoc(stationRef);
      if (snap.exists()) {
        const data = snap.data();
        const newPlaylist = (data.playlist || []).filter(t => t.id !== trackId);
        await setDoc(stationRef, {
          playlist:      newPlaylist,
          playlistLength: newPlaylist.length,
          updatedAt:     Date.now(),
        }, { merge: true });
        // Update NowPlaying count too
        const { doc: d2, setDoc: s2 } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        await s2(d2(db, 'stationNowPlaying', 'avenoraRadio'), {
          playlistLength: newPlaylist.length,
          serverTime:    Date.now(),
        }, { merge: true });
      }
    }
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

    // Add the uploaded track to the station playlist.
    // In production (no backend): write directly to Firestore.
    // With backend: use both Firestore and the API.
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
      mediaId:     track.id || '',
    };

    try {
      // Always write to Firestore first (works in production without a backend)
      await _radminAddTrackFirestore(addPayload);
      // If backend is configured, also notify it
      if (window.LU_CONFIG?.apiUrl) {
        await _radminFetch('POST', '/radio/station/playlist/add', addPayload).catch(apiErr => {
          console.warn('[RadioAdmin] Backend add-track notification failed (non-fatal):', apiErr.message);
        });
      }
      _radminState.playlist.push(addPayload);
      _radminRenderPlaylist();
      if (typeof Toast !== 'undefined') Toast.show('Track uploaded and added to station!', 'success');
    } catch (addErr) {
      console.error('[RadioAdmin] addTrack to station failed:', addErr.message);
      if (typeof Toast !== 'undefined') Toast.show(
        `Uploaded, but could not add to station: ${addErr.message || 'unknown error'}. Use "Add from Library" to add manually.`,
        'info'
      );
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

    // Resolve the best available audio URL using MusicService.resolveAudioUrl
    // if available, otherwise fall back to known field names.
    const resolvedUrl = (typeof MusicService !== 'undefined' && MusicService.resolveAudioUrl)
      ? MusicService.resolveAudioUrl(t)
      : (t.fileUrl || t.audioUrl || t.url || t.publicUrl || '');

    const payload = {
      id:          t._id || t.id || String(Date.now()),
      title:       t.title || 'Untitled',
      artist:      t.artist || t.artistName || '',
      album:       t.album  || '',
      genre:       t.genre  || '',
      url:         resolvedUrl || '',
      duration:    t.duration || 0,
      storagePath: t.storagePath || '',
      coverUrl:    t.coverUrl || t.albumArt || null,
      mediaId:     t._id || t.id || t.mediaId || '',
    };

    console.info('[RadioAdmin] addFromLibrary — track info', {
      trackId:     payload.id,
      title:       payload.title,
      url:         payload.url,
      storagePath: payload.storagePath,
      mediaId:     payload.mediaId,
    });

    if (!payload.url) {
      // Try to derive URL from storagePath via AvenoraStorage
      if (payload.storagePath && window.AvenoraStorage?.getPublicUrl) {
        payload.url = window.AvenoraStorage.getPublicUrl('music', payload.storagePath);
        console.info('[RadioAdmin] Derived URL from storagePath:', payload.url);
      }
      if (!payload.url) {
        if (typeof Toast !== 'undefined') Toast.show('Track has no audio URL — cannot add to station', 'error');
        return;
      }
    }

    // Always write to Firestore directly (works in production without a backend).
    // If a backend is configured, also call the API so the engine picks it up.
    await _radminAddTrackFirestore(payload);

    // If backend is configured, also notify it
    if (window.LU_CONFIG?.apiUrl) {
      try {
        await _radminFetch('POST', '/radio/station/playlist/add', payload);
      } catch (apiErr) {
        // Non-fatal when backend is present but returns an error
        console.warn('[RadioAdmin] Backend add-track call failed (non-fatal — Firestore already updated):', apiErr.message);
      }
    }

    _radminState.playlist.push(payload);
    _radminRenderPlaylist();

    // Read back the record to confirm it was written
    try {
      const snap = await _radminLoadFirestoreStation();
      if (snap && Array.isArray(snap.playlist)) {
        const found = snap.playlist.find(p => p.id === payload.id);
        if (!found) {
          console.warn('[RadioAdmin] Track not found in Firestore after write — playlist may not have saved', payload.id);
        } else {
          console.info('[RadioAdmin] Track confirmed in Firestore:', found.id, found.title);
        }
      }
    } catch (_) { /* read-back is best-effort */ }

    if (typeof Toast !== 'undefined') Toast.show(`"${payload.title}" added to station!`, 'success');

    // Refresh the admin view to confirm the cloud state
    await radminRefreshStatus();

  } catch (err) {
    console.error('[RadioAdmin] addFromLibrary failed:', {
      message: err.message,
      code:    err.code,
      status:  err.status,
      url:     window.LU_CONFIG?.apiUrl,
      firebaseUid: (window.AvenoraFirebase?.Auth?.getUser?.())?.uid || '(unknown)',
    });
    if (typeof Toast !== 'undefined') Toast.show(`Error: ${err.message}`, 'error');
  }
};

// ─── Firestore direct station operations ────────────────
// Used in production (no backend) to read/write radioStations/avenoraRadio.

async function _radminGetFirestore() {
  const { getFirestore } = window.AvenoraFirebase || {};
  if (!getFirestore) throw new Error('Firebase not available');
  return getFirestore();
}

async function _radminLoadFirestoreStation() {
  try {
    const db = await _radminGetFirestore();
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'radioStations', 'avenoraRadio'));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.warn('[RadioAdmin] Firestore station load failed:', e.message);
    return null;
  }
}

/**
 * Add a track to the Firestore radioStations/avenoraRadio playlist.
 * Also updates stationNowPlaying/avenoraRadio so listeners see the new count.
 * Safe: verifies media URL exists before writing.
 */
async function _radminAddTrackFirestore(track) {
  const db = await _radminGetFirestore();
  const { doc, getDoc, setDoc, serverTimestamp } =
    await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

  // Verify/normalize the track URL one more time
  const audioUrl = track.url || (track.storagePath && window.AvenoraStorage?.getPublicUrl
    ? window.AvenoraStorage.getPublicUrl('music', track.storagePath)
    : '');
  if (!audioUrl) throw new Error('Track has no resolvable audio URL');

  // Read current station state
  const stationRef = doc(db, 'radioStations', 'avenoraRadio');
  const snap = await getDoc(stationRef);
  const existing = snap.exists() ? snap.data() : {};
  const playlist = Array.isArray(existing.playlist) ? [...existing.playlist] : [];

  // Avoid duplicates by track id
  const isDupe = playlist.some(p => p.id === track.id);
  if (isDupe) {
    console.info('[RadioAdmin] Track already in playlist:', track.id, '— skipping duplicate');
    return;
  }

  const safeTrack = {
    id:          String(track.id || `track-${Date.now()}`).slice(0, 200),
    title:       String(track.title || 'Untitled').slice(0, 200),
    artist:      String(track.artist || '').slice(0, 200),
    album:       String(track.album || '').slice(0, 200),
    genre:       String(track.genre || '').slice(0, 100),
    url:         audioUrl,
    duration:    Number(track.duration) || 0,
    storagePath: String(track.storagePath || '').slice(0, 500),
    coverUrl:    track.coverUrl || null,
    mediaId:     String(track.mediaId || track.id || '').slice(0, 200),
    addedAt:     Date.now(),
  };
  playlist.push(safeTrack);

  // Write updated playlist back to radioStations
  await setDoc(stationRef, {
    playlist,
    updatedAt:    Date.now(),
    playlistLength: playlist.length,
  }, { merge: true });

  // Also update stationNowPlaying so the radio player sees the updated track count
  try {
    const npRef = doc(db, 'stationNowPlaying', 'avenoraRadio');
    const npSnap = await getDoc(npRef);
    if (npSnap.exists()) {
      await setDoc(npRef, {
        playlistLength: playlist.length,
        updatedAt: Date.now(),
        serverTime: Date.now(),
      }, { merge: true });
    } else {
      // Station hasn't started yet — write a minimal NowPlaying doc so the radio
      // player shows the playlist count and doesn't stay on "Loading tracks..."
      await setDoc(npRef, {
        stationId:     'avenoraRadio',
        stationName:   existing.stationName || 'AVENORA CLOUD RADIO',
        status:        existing.status || 'stopped',
        currentUrl:    '',
        currentTitle:  '',
        currentArtist: '',
        playlistLength: playlist.length,
        upcoming:      playlist.slice(0, 5).map(t => ({
          id: t.id, title: t.title, artist: t.artist, coverUrl: t.coverUrl || null, duration: t.duration || 0,
        })),
        recentlyPlayed: [],
        serverTime:    Date.now(),
        updatedAt:     Date.now(),
      }, { merge: true });
    }
  } catch (npErr) {
    console.warn('[RadioAdmin] NowPlaying update skipped (non-fatal):', npErr.message);
  }

  console.info('[RadioAdmin] Track written to Firestore:', safeTrack.id, safeTrack.title, '— playlist now', playlist.length, 'tracks');
}

/**
 * resolveMediaRecord — resolve a radio playlist entry to its canonical media record.
 * Resolution order:
 *   1. entry.url — already a valid audio URL
 *   2. entry.mediaId / entry.trackId — look up in cloudStreamTracks sub-collections
 *   3. entry.storagePath — derive Supabase public URL
 * Returns { url, title, artist, storagePath } or null if unresolvable.
 */
async function _resolveMediaRecord(entry) {
  // Step 1: Direct URL already present
  const directUrl = entry.url || entry.audioUrl || entry.fileUrl;
  if (directUrl && typeof directUrl === 'string' && directUrl.trim()) {
    return { ...entry, url: directUrl.trim(), _resolved: 'directUrl' };
  }

  // Step 2: Look up by mediaId / trackId in Firestore cloudStreamTracks
  const lookupId = entry.mediaId || entry.trackId || entry.id;
  if (lookupId) {
    try {
      const db = await _radminGetFirestore();
      const { collectionGroup, query, where, limit: fsLimit, getDocs } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      // Try collection-group query on 'tracks' sub-collection
      try {
        const q = query(collectionGroup(db, 'tracks'), where('__name__', '==', lookupId), fsLimit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const d = snap.docs[0].data();
          const url = d.url || d.audioUrl || d.fileUrl;
          if (url) {
            console.info('[RadioAdmin] resolveMediaRecord — found by collectionGroup id:', lookupId, url);
            return { ...entry, ...d, url, _resolved: 'collectionGroup-id' };
          }
        }
      } catch (_) { /* index may not exist */ }
      // Try exact doc path if it looks like {uid}_{timestamp}
      // cloudStreamTracks/{uid}/tracks/{docId}
      if (lookupId.includes('_')) {
        const [uid] = lookupId.split('_');
        try {
          const { doc: fsDoc, getDoc: fsGet } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
          const snap = await fsGet(fsDoc(db, 'cloudStreamTracks', uid, 'tracks', lookupId));
          if (snap.exists()) {
            const d = snap.data();
            const url = d.url || d.audioUrl || d.fileUrl;
            if (url) {
              console.info('[RadioAdmin] resolveMediaRecord — found by exact path:', lookupId, url);
              return { ...entry, ...d, url, _resolved: 'exact-path' };
            }
          }
        } catch (_) { /* ignore */ }
      }
    } catch (err) {
      console.warn('[RadioAdmin] resolveMediaRecord Firestore lookup failed:', err.message);
    }
  }

  // Step 3: Derive URL from storagePath
  if (entry.storagePath && window.AvenoraStorage?.getPublicUrl) {
    const derived = window.AvenoraStorage.getPublicUrl('music', entry.storagePath);
    if (derived) {
      console.info('[RadioAdmin] resolveMediaRecord — derived from storagePath:', entry.storagePath, derived);
      return { ...entry, url: derived, _resolved: 'storagePath-derived' };
    }
  }

  // Unresolvable
  console.error('[RadioAdmin] MEDIA_RECORD_MISSING — could not resolve entry:', {
    radioEntryId: entry.id,
    mediaId:      entry.mediaId,
    trackId:      entry.trackId,
    storagePath:  entry.storagePath,
    urlFields:    { url: entry.url, audioUrl: entry.audioUrl, fileUrl: entry.fileUrl },
    collectionsSearched: ['cloudStreamTracks/*/tracks'],
  });
  return null;
}

/**
 * Repair all broken tracks in the radio playlist.
 * Resolves each entry, writes canonical mediaId/url back, does not duplicate or delete.
 */
window.radminRepairPlaylist = async function () {
  try {
    const db = await _radminGetFirestore();
    const { doc, getDoc, setDoc } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const stationRef = doc(db, 'radioStations', 'avenoraRadio');
    const snap = await getDoc(stationRef);
    if (!snap.exists()) {
      if (typeof Toast !== 'undefined') Toast.show('No station found in Firestore', 'info');
      return;
    }
    const data = snap.data();
    const playlist = Array.isArray(data.playlist) ? data.playlist : [];
    if (!playlist.length) {
      if (typeof Toast !== 'undefined') Toast.show('Playlist is empty', 'info');
      return;
    }

    let repaired = 0;
    let failed = 0;
    const repairedPlaylist = [];
    for (const entry of playlist) {
      const resolved = await _resolveMediaRecord(entry);
      if (resolved) {
        repairedPlaylist.push({ ...entry, url: resolved.url });
        if (!entry.url || entry.url !== resolved.url) repaired++;
      } else {
        // Keep the broken entry with a diagnostic flag instead of deleting it
        repairedPlaylist.push({ ...entry, _broken: true, _brokenReason: 'MEDIA_RECORD_MISSING' });
        failed++;
      }
    }

    await setDoc(stationRef, { playlist: repairedPlaylist, updatedAt: Date.now() }, { merge: true });
    _radminState.playlist = repairedPlaylist;
    _radminRenderPlaylist();

    const msg = `Repair complete: ${repaired} fixed, ${failed} still unresolvable`;
    console.info('[RadioAdmin]', msg);
    if (typeof Toast !== 'undefined') Toast.show(msg, failed ? 'info' : 'success');
  } catch (err) {
    console.error('[RadioAdmin] radminRepairPlaylist failed:', err.message);
    if (typeof Toast !== 'undefined') Toast.show('Repair failed: ' + err.message, 'error');
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

/**
 * _radminFetch — send an API request to the backend.
 * IMPORTANT: only call this when window.LU_CONFIG?.apiUrl is set (backend available).
 * In production (GitHub Pages, no backend), use Firestore operations directly.
 */
async function _radminFetch(method, path, body) {
  const apiUrl = window.LU_CONFIG?.apiUrl;
  if (!apiUrl) {
    console.error('[RadioAdmin] _radminFetch called but apiUrl is not configured.', {
      method, path,
      hint: 'Production uses Firestore directly — this call should not have been made.',
    });
    throw new Error(
      `Radio API not configured (HTTP ${method} ${path}). ` +
      'This is a Firestore-only deployment — station operations use Firestore directly.'
    );
  }

  const token = await _radminGetToken();
  if (!token) {
    console.error('[RadioAdmin] _radminFetch — no Firebase ID token. User may not be authenticated.', {
      method, path,
      url: `${apiUrl}${path}`,
      user: (window.AvenoraFirebase?.Auth?.getUser?.())?.uid || '(none)',
    });
  }
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body)  opts.body = JSON.stringify(body);

  const url = `${apiUrl}${path}`;
  console.info('[RadioAdmin] _radminFetch', method, url);
  const res  = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[RadioAdmin] _radminFetch error', {
      method, url,
      status:       res.status,
      responseBody: data,
      firebaseUid:  (window.AvenoraFirebase?.Auth?.getUser?.())?.uid || '(unknown)',
    });
    throw new Error(data.message || `HTTP ${res.status}`);
  }
  return data;
}

function _radminFmtTime(sec) {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}
