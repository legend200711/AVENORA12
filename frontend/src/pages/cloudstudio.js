/**
 * AVENORA — Cloud Stream Creator Studio (SPA page)
 *
 * Lets authenticated users:
 *   - View and manage their uploaded cloud music library (cloudStreamTracks/{uid}/tracks)
 *   - Create, rename, and delete stream playlists (studioPlaylists/{uid}/playlists)
 *   - Add / reorder / remove tracks in a playlist
 *   - Navigate to the 24-Hour Cloud Stream to go live
 *
 * Firestore collections used:
 *   cloudStreamTracks/{uid}/tracks/{trackId}
 *   studioPlaylists/{uid}/playlists/{plId}
 *
 * Layout is driven by cloudstudio.css (mobile-first, no inline grid hacks).
 */

registerPage('cloudstudio', {
  async render(container) {
    container.innerHTML = `
      <div class="csstudio-page">

        <!-- ── Page header ───────────────────────────────── -->
        <div class="csstudio-header">
          <h1 class="csstudio-title">
            <span style="color:var(--neon-blue)">AVENORA</span> CREATOR STUDIO
          </h1>
          <p class="csstudio-tagline">BUILD YOUR 24-HOUR CLOUD STREAM PLAYLIST</p>
        </div>

        <!-- ── Auth gate (shown when logged out) ─────────── -->
        <div id="csstudio-auth-gate" style="display:none;">
          <div class="card csstudio-auth-gate">
            <p style="font-size:2rem;margin-bottom:var(--space-md)">🔒</p>
            <h3 style="font-family:var(--font-display);margin-bottom:var(--space-sm)">SIGN IN REQUIRED</h3>
            <p style="color:var(--text-secondary);margin-bottom:var(--space-lg)">
              Sign in to access the Creator Studio and manage your cloud music library.
            </p>
            <button class="btn btn-primary" onclick="Modal.open('auth-modal')">Sign In</button>
          </div>
        </div>

        <!-- ── Loading state ─────────────────────────────── -->
        <div id="csstudio-loading" style="display:flex;flex-direction:column;align-items:center;padding:var(--space-3xl);gap:var(--space-md)">
          <div class="spinner spinner-lg"></div>
          <span style="color:var(--text-muted)">Loading Creator Studio…</span>
        </div>

        <!-- ── Main app ───────────────────────────────────── -->
        <div id="csstudio-app" style="display:none;">

          <!-- Action button bar -->
          <div class="csstudio-actions">
            <button class="btn btn-green" onclick="cssGoLive()">
              📡 Go to Cloud Stream
            </button>
            <button class="btn btn-outline" onclick="cssUploadMusic()">
              ⬆ Upload Music
            </button>
            <button class="btn btn-primary" onclick="cssCreatePlaylist()">
              ➕ New Playlist
            </button>
          </div>

          <!-- Two-panel grid — stacks to single column on mobile -->
          <div class="csstudio-panels">

            <!-- LEFT: Cloud Music Library -->
            <div class="csstudio-panel">
              <div class="csstudio-section-hdr">
                <h2 class="section-title">CLOUD LIBRARY</h2>
                <button class="btn btn-ghost btn-sm" onclick="cssRefreshTracks()" title="Refresh">↻ Refresh</button>
              </div>
              <div id="csstudio-tracks-list" style="min-height:200px">
                <div style="text-align:center;color:var(--text-muted);padding:var(--space-xl)">Loading tracks…</div>
              </div>
            </div>

            <!-- RIGHT: Playlists -->
            <div class="csstudio-panel">
              <div class="csstudio-section-hdr">
                <h2 class="section-title">PLAYLISTS</h2>
                <button class="btn btn-primary btn-sm" onclick="cssCreatePlaylist()">➕ New</button>
              </div>
              <div id="csstudio-playlists-area" style="min-height:200px">
                <div style="text-align:center;color:var(--text-muted);padding:var(--space-xl)">Loading playlists…</div>
              </div>
            </div>

          </div><!-- /.csstudio-panels -->

          <!-- Playlist editor (shown when a playlist is selected) -->
          <div id="csstudio-editor" class="csstudio-editor" style="display:none;">
            <div class="card" style="border-color:var(--border-blue)">
              <div class="csstudio-editor-header">
                <h3 id="csstudio-editor-title" class="csstudio-editor-title">EDITING PLAYLIST</h3>
                <div class="csstudio-editor-btns">
                  <button class="btn btn-green btn-sm" onclick="cssSavePlaylist()">💾 Save</button>
                  <button class="btn btn-outline btn-sm" onclick="cssCloseEditor()">✕ Close</button>
                </div>
              </div>
              <div id="csstudio-editor-body">
                <p style="color:var(--text-muted);font-size:0.85rem">Select tracks from the library above to add them here.</p>
              </div>
            </div>
          </div>

        </div><!-- /#csstudio-app -->
      </div><!-- /.csstudio-page -->
    `;

    // ── Bootstrap ─────────────────────────────────────────────────────────
    // listenAuthState returns a Promise that resolves only after the first
    // onAuthStateChanged callback fires (i.e. after Firebase has confirmed
    // whether a persisted session exists).  We must wait for that before
    // deciding whether to show the auth gate — otherwise we always show it
    // because getUser() returns null while Firebase is still restoring.

    // Show loading spinner while we wait
    document.getElementById('csstudio-loading').style.display = 'flex';
    document.getElementById('csstudio-app').style.display    = 'none';
    document.getElementById('csstudio-auth-gate').style.display = 'none';

    // Attempt to get the user synchronously first (fast path when already known)
    let user = window.AvenoraFirebase?.Auth?.getUser?.() || null;

    if (!user && window.AvenoraFirebase?.Auth?.listenAuthState) {
      // Wait for Firebase to resolve the persisted session (fires once)
      await new Promise((resolve) => {
        // If auth is already resolved (authLoading=false) get the user directly
        if (LegendState && LegendState.get('authLoading') === false) {
          user = window.AvenoraFirebase.Auth.getUser();
          return resolve();
        }
        // Otherwise subscribe; the listener fires and resolves the promise
        const unsub = LegendState?.subscribe?.('user', (u) => {
          user = u;
          if (typeof unsub === 'function') unsub();
          resolve();
        });
        // Safety timeout — if state subscription never fires, proceed after 5 s
        setTimeout(() => {
          if (typeof unsub === 'function') unsub();
          user = window.AvenoraFirebase?.Auth?.getUser?.() || null;
          resolve();
        }, 5000);
      });
    }

    if (!user) {
      document.getElementById('csstudio-loading').style.display = 'none';
      document.getElementById('csstudio-auth-gate').style.display = '';
      // Listen for sign-in so we can initialize without a page reload
      const authUnsub = LegendState?.subscribe?.('user', async (u) => {
        if (u) {
          if (typeof authUnsub === 'function') authUnsub();
          document.getElementById('csstudio-auth-gate').style.display = 'none';
          await _cssInit(u);
        }
      });
      return () => { if (typeof authUnsub === 'function') authUnsub(); };
    }

    await _cssInit(user);
    return () => { _cssState.cleanup(); };
  }
});

// ─── Module-level state ──────────────────────────────────
const _cssState = {
  uid: null,
  tracks:    [],   // cloudStreamTracks
  playlists: [],   // studioPlaylists
  editingPl: null, // { id, name, trackIds:[] }
  cleanup() { /* no live subscriptions */ }
};

async function _cssInit(user) {
  _cssState.uid = user.uid || user.id;
  document.getElementById('csstudio-loading').style.display = 'none';
  document.getElementById('csstudio-app').style.display = '';
  await Promise.all([cssRefreshTracks(), cssRefreshPlaylists()]);
}

// ─── Firestore helpers ───────────────────────────────────
async function _cssGetFs() {
  const db  = await window.AvenoraFirebase.getFirestore();
  const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  return { db, ...mod };
}

// ─── Track library ───────────────────────────────────────
window.cssRefreshTracks = async function () {
  const el = document.getElementById('csstudio-tracks-list');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:var(--space-lg)">Loading…</div>';
  try {
    const { db, collection, query, orderBy, limit, getDocs } = await _cssGetFs();
    const snap = await getDocs(query(
      collection(db, 'cloudStreamTracks', _cssState.uid, 'tracks'),
      orderBy('createdAt', 'desc'),
      limit(200)
    ));
    _cssState.tracks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _cssRenderTracks();
  } catch (err) {
    el.innerHTML = `<div class="card" style="color:var(--neon-red);font-size:0.85rem">Could not load tracks: ${escapeHtml(err.message)}</div>`;
  }
};

function _cssRenderTracks() {
  const el = document.getElementById('csstudio-tracks-list');
  if (!el) return;

  if (!_cssState.tracks.length) {
    el.innerHTML = `
      <div class="card css-empty-state">
        <p class="css-empty-icon">🎵</p>
        <p style="color:var(--text-secondary);margin-bottom:var(--space-md)">No tracks in your cloud library yet.</p>
        <button class="btn btn-green btn-sm" onclick="cssUploadMusic()">⬆ Upload Music</button>
      </div>`;
    return;
  }

  const inEditor = _cssState.editingPl ? new Set(_cssState.editingPl.trackIds) : new Set();
  el.innerHTML = _cssState.tracks.map(t => {
    const added = inEditor.has(t.id);
    return `
      <div class="card css-track-card">
        <div class="css-track-info">
          <div class="css-track-title">${escapeHtml(t.title || 'Untitled')}</div>
          <div class="css-track-meta">${escapeHtml(t.artist || '')}${t.duration ? ' · ' + _cssFmtDuration(t.duration) : ''}</div>
        </div>
        ${_cssState.editingPl ? `
          <button class="btn btn-sm ${added ? 'btn-outline' : 'btn-green'}"
                  onclick="cssToggleTrackInEditor('${escapeHtml(t.id)}')"
                  title="${added ? 'Remove from playlist' : 'Add to playlist'}">
            ${added ? '✓' : '+'}
          </button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="cssDeleteTrack('${escapeHtml(t.id)}')" title="Delete track" style="color:var(--neon-red)">🗑</button>
      </div>`;
  }).join('');
}

// ─── Playlist management ─────────────────────────────────
window.cssRefreshPlaylists = async function () {
  const el = document.getElementById('csstudio-playlists-area');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:var(--space-lg)">Loading…</div>';
  try {
    const { db, collection, query, orderBy, getDocs } = await _cssGetFs();
    const snap = await getDocs(query(
      collection(db, 'studioPlaylists', _cssState.uid, 'playlists'),
      orderBy('createdAt', 'desc')
    ));
    _cssState.playlists = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _cssRenderPlaylists();
  } catch (err) {
    el.innerHTML = `<div style="color:var(--neon-red);font-size:0.85rem">Could not load playlists: ${escapeHtml(err.message)}</div>`;
  }
};

function _cssRenderPlaylists() {
  const el = document.getElementById('csstudio-playlists-area');
  if (!el) return;

  if (!_cssState.playlists.length) {
    el.innerHTML = `
      <div class="card css-empty-state">
        <p class="css-empty-icon">📂</p>
        <p style="color:var(--text-secondary);margin-bottom:var(--space-md)">No playlists yet. Create one to start your broadcast.</p>
        <button class="btn btn-primary btn-sm" onclick="cssCreatePlaylist()">➕ Create Playlist</button>
      </div>`;
    return;
  }

  el.innerHTML = _cssState.playlists.map(pl => {
    const isEditing = _cssState.editingPl && _cssState.editingPl.id === pl.id;
    const count = (pl.trackIds || []).length;
    return `
      <div class="card css-pl-card" style="border-color:${isEditing ? 'var(--neon-blue)' : 'var(--border-subtle)'}">
        <div class="css-pl-row">
          <div class="css-pl-info">
            <div class="css-pl-name">${escapeHtml(pl.name || 'Untitled Playlist')}</div>
            <div class="css-pl-meta">${count} track${count !== 1 ? 's' : ''}</div>
          </div>
          <div class="css-pl-actions">
            <button class="btn btn-sm ${isEditing ? 'btn-primary' : 'btn-outline'}"
                    onclick="cssEditPlaylist('${escapeHtml(pl.id)}')">
              ✏️ ${isEditing ? 'Editing' : 'Edit'}
            </button>
            <button class="btn btn-ghost btn-sm" onclick="cssDeletePlaylist('${escapeHtml(pl.id)}')" title="Delete playlist" style="color:var(--neon-red)">🗑</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ─── Create playlist ─────────────────────────────────────
window.cssCreatePlaylist = function () {
  document.getElementById('css-create-pl-modal')?.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'css-create-pl-modal';
  backdrop.className = 'modal-backdrop';
  backdrop.style.display = 'flex';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:420px">
      <div class="modal-header">
        <h3 style="margin:0;font-family:var(--font-display);letter-spacing:0.1em">NEW PLAYLIST</h3>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('css-create-pl-modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Playlist Name *</label>
          <input class="form-input" id="css-new-pl-name" placeholder="My Cloud Mix" maxlength="100">
        </div>
        <div id="css-new-pl-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem;margin-bottom:var(--space-sm)"></div>
        <button class="btn btn-primary w-full" onclick="cssConfirmCreatePlaylist()">Create Playlist</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  setTimeout(() => {
    const nameEl = document.getElementById('css-new-pl-name');
    if (nameEl) {
      nameEl.focus();
      nameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') cssConfirmCreatePlaylist();
      });
    }
  }, 50);
};

window.cssConfirmCreatePlaylist = async function () {
  const nameEl = document.getElementById('css-new-pl-name');
  const errEl  = document.getElementById('css-new-pl-error');
  const name   = nameEl?.value?.trim();
  if (!name) {
    if (errEl) { errEl.textContent = 'Playlist name required.'; errEl.classList.remove('hidden'); }
    return;
  }
  try {
    const { db, collection, addDoc, serverTimestamp } = await _cssGetFs();
    const ref = await addDoc(
      collection(db, 'studioPlaylists', _cssState.uid, 'playlists'),
      { name, trackIds: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
    );
    document.getElementById('css-create-pl-modal')?.remove();
    await cssRefreshPlaylists();
    cssEditPlaylist(ref.id);
    Toast.success(`Playlist "${name}" created!`);
  } catch (err) {
    if (errEl) { errEl.textContent = err.message || 'Could not create playlist.'; errEl.classList.remove('hidden'); }
  }
};

// ─── Edit playlist ───────────────────────────────────────
window.cssEditPlaylist = function (plId) {
  const pl = _cssState.playlists.find(p => p.id === plId);
  if (!pl) return;
  _cssState.editingPl = { id: pl.id, name: pl.name, trackIds: [...(pl.trackIds || [])] };
  _cssRenderTracks();
  _cssRenderPlaylists();
  _cssRenderEditor();
  const editor = document.getElementById('csstudio-editor');
  editor.style.display = '';
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.cssCloseEditor = function () {
  _cssState.editingPl = null;
  document.getElementById('csstudio-editor').style.display = 'none';
  _cssRenderTracks();
  _cssRenderPlaylists();
};

function _cssRenderEditor() {
  const pl = _cssState.editingPl;
  if (!pl) return;
  document.getElementById('csstudio-editor-title').textContent = `EDITING: ${pl.name}`;
  const body = document.getElementById('csstudio-editor-body');
  if (!body) return;

  if (!pl.trackIds.length) {
    body.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:var(--space-lg)">No tracks yet. Add tracks from the Cloud Library above.</p>`;
    return;
  }

  const trackMap = new Map(_cssState.tracks.map(t => [t.id, t]));
  body.innerHTML = `
    <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:var(--space-md)">${pl.trackIds.length} track${pl.trackIds.length !== 1 ? 's' : ''} · Drag to reorder</p>
    <div id="css-editor-track-list">
    ${pl.trackIds.map((tid, i) => {
      const t = trackMap.get(tid) || { title: 'Unknown Track', artist: '' };
      return `
        <div class="card css-editor-row" data-trackid="${escapeHtml(tid)}">
          <span style="color:var(--text-muted);font-size:0.78rem;min-width:20px;flex-shrink:0">${i + 1}</span>
          <div class="css-editor-row-info">
            <div class="css-editor-row-title">${escapeHtml(t.title || 'Untitled')}</div>
            <div class="css-editor-row-meta">${escapeHtml(t.artist || '')}${t.duration ? ' · ' + _cssFmtDuration(t.duration) : ''}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="cssMoveTrackUp('${escapeHtml(tid)}')" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="btn btn-ghost btn-sm" onclick="cssMoveTrackDown('${escapeHtml(tid)}')" title="Move down" ${i === pl.trackIds.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="btn btn-ghost btn-sm" onclick="cssToggleTrackInEditor('${escapeHtml(tid)}')" title="Remove" style="color:var(--neon-red)">✕</button>
        </div>`;
    }).join('')}
    </div>`;
}

window.cssToggleTrackInEditor = function (trackId) {
  const pl = _cssState.editingPl;
  if (!pl) return;
  const idx = pl.trackIds.indexOf(trackId);
  if (idx === -1) {
    pl.trackIds.push(trackId);
  } else {
    pl.trackIds.splice(idx, 1);
  }
  _cssRenderTracks();
  _cssRenderEditor();
};

window.cssMoveTrackUp = function (trackId) {
  const pl = _cssState.editingPl;
  if (!pl) return;
  const idx = pl.trackIds.indexOf(trackId);
  if (idx <= 0) return;
  [pl.trackIds[idx - 1], pl.trackIds[idx]] = [pl.trackIds[idx], pl.trackIds[idx - 1]];
  _cssRenderEditor();
};

window.cssMoveTrackDown = function (trackId) {
  const pl = _cssState.editingPl;
  if (!pl) return;
  const idx = pl.trackIds.indexOf(trackId);
  if (idx === -1 || idx >= pl.trackIds.length - 1) return;
  [pl.trackIds[idx], pl.trackIds[idx + 1]] = [pl.trackIds[idx + 1], pl.trackIds[idx]];
  _cssRenderEditor();
};

// ─── Save playlist ───────────────────────────────────────
window.cssSavePlaylist = async function () {
  const pl = _cssState.editingPl;
  if (!pl) return;
  try {
    const { db, doc, setDoc, serverTimestamp } = await _cssGetFs();
    await setDoc(
      doc(db, 'studioPlaylists', _cssState.uid, 'playlists', pl.id),
      { name: pl.name, trackIds: pl.trackIds, updatedAt: serverTimestamp() },
      { merge: true }
    );
    const idx = _cssState.playlists.findIndex(p => p.id === pl.id);
    if (idx !== -1) _cssState.playlists[idx].trackIds = [...pl.trackIds];
    Toast.success(`Playlist "${pl.name}" saved!`);
    _cssRenderPlaylists();
    _cssRenderEditor();
  } catch (err) {
    Toast.error ? Toast.error('Could not save: ' + err.message) : alert('Could not save: ' + err.message);
  }
};

// ─── Delete playlist ──────────────────────────────────────
window.cssDeletePlaylist = async function (plId) {
  const pl = _cssState.playlists.find(p => p.id === plId);
  if (!pl) return;
  if (!confirm(`Delete playlist "${pl.name}"? This cannot be undone.`)) return;
  try {
    const { db, doc, deleteDoc } = await _cssGetFs();
    await deleteDoc(doc(db, 'studioPlaylists', _cssState.uid, 'playlists', plId));
    _cssState.playlists = _cssState.playlists.filter(p => p.id !== plId);
    if (_cssState.editingPl?.id === plId) {
      _cssState.editingPl = null;
      document.getElementById('csstudio-editor').style.display = 'none';
    }
    _cssRenderPlaylists();
    _cssRenderTracks();
    Toast.success('Playlist deleted.');
  } catch (err) {
    alert('Could not delete: ' + err.message);
  }
};

// ─── Delete track ─────────────────────────────────────────
window.cssDeleteTrack = async function (trackId) {
  const t = _cssState.tracks.find(tr => tr.id === trackId);
  if (!t) return;
  if (!confirm(`Delete "${t.title || trackId}" from your cloud library? This cannot be undone.`)) return;
  try {
    const { db, doc, deleteDoc } = await _cssGetFs();
    await deleteDoc(doc(db, 'cloudStreamTracks', _cssState.uid, 'tracks', trackId));
    _cssState.tracks = _cssState.tracks.filter(tr => tr.id !== trackId);
    if (_cssState.editingPl) {
      _cssState.editingPl.trackIds = _cssState.editingPl.trackIds.filter(id => id !== trackId);
    }
    _cssRenderTracks();
    _cssRenderEditor();
    Toast.success('Track deleted.');
  } catch (err) {
    alert('Could not delete: ' + err.message);
  }
};

// ─── Navigation helpers ───────────────────────────────────
window.cssGoLive = function () {
  navigateTo('cloudstream');
};

window.cssUploadMusic = function () {
  navigateTo('music');
  setTimeout(() => {
    if (typeof musicTabSwitch === 'function') musicTabSwitch('upload');
  }, 400);
};

// ─── Utility ─────────────────────────────────────────────
function _cssFmtDuration(secs) {
  if (!secs || secs <= 0) return '0:00';
  const h   = Math.floor(secs / 3600);
  const m   = Math.floor((secs % 3600) / 60);
  const s   = Math.floor(secs % 60);
  const pad = n => (n < 10 ? '0' : '') + n;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
