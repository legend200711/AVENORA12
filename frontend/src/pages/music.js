/**
 * AVENORA MUSIC HUB — music.js
 * Full music listening & discovery platform.
 *
 * Features:
 *   - HTML5 Audio player (real playback only — no fake play state)
 *   - Import local files (MP3, WAV, OGG, FLAC, AAC, M4A, OPUS)
 *   - Backend library (tracks, albums, artists) when MongoDB is connected
 *   - Playlists (create, rename, reorder, delete, play)
 *   - Favorites (local + synced to backend when logged in)
 *   - Recently played (local + backend)
 *   - Global search (songs, albums, artists)
 *   - Genre filters
 *   - Upload form (detects missing storage, shows honest status)
 *   - External service links (Spotify, YouTube Music, Apple Music, Amazon)
 *   - Audio-reactive visualizer (Canvas API, prefers-reduced-motion aware)
 *   - DJ System integration bridge
 *   - Mobile-first, touch-friendly
 */

registerPage('music', {
  async render(container) {
    container.innerHTML = buildMusicShell();
    initMusicPlayer();
    await musicTabSwitch('discover');
    return () => destroyMusicPlayer();
  }
});

// ─── Shell HTML ──────────────────────────────────────────────
function buildMusicShell() {
  return `
    <div class="music-hero">
      <div class="music-hero-bg"></div>
      <div class="music-ambient-flame"></div>
      <h1 class="music-hub-title">
        <span style="color:var(--neon-blue)">AVENORA</span>
        <span style="color:var(--neon-green)"> MUSIC</span>
        <span> HUB</span>
      </h1>
      <p class="music-hub-tagline">YOUR MUSIC. YOUR UNIVERSE.</p>
      <div style="display:flex;justify-content:center;gap:var(--space-sm);flex-wrap:wrap">
        <span class="dj-ready-badge">🎛 DJ SYSTEM READY</span>
        <span class="dj-ready-badge" style="color:var(--avenora-gold);border-color:rgba(184,149,75,0.30);background:rgba(184,149,75,0.08)">📻 24-HR RADIO READY</span>
      </div>
    </div>

    <div class="container-lg" style="padding-bottom:var(--space-3xl)">

      <!-- Sticky Player -->
      <div class="music-player-bar" id="mp-bar">
        <div class="mp-main-row">
          <div class="mp-art" id="mp-art">🎵</div>
          <div class="mp-info">
            <div class="mp-title" id="mp-title">No track playing</div>
            <div class="mp-artist-name" id="mp-artist">Select a track to begin</div>
            <div class="mp-next-label hidden" id="mp-next-label"></div>
          </div>

          <!-- Core controls -->
          <div class="mp-controls">
            <button class="mp-icon-btn" id="mp-btn-prev" onclick="mpPrev()" aria-label="Previous" title="Previous (P)">⏮</button>
            <button class="mp-play-btn" id="mp-btn-play" onclick="mpTogglePlay()" aria-label="Play/Pause" title="Play/Pause (Space)">▶</button>
            <button class="mp-icon-btn" id="mp-btn-next" onclick="mpNext()" aria-label="Next" title="Next (N)">⏭</button>
            <button class="mp-icon-btn" id="mp-btn-shuffle" onclick="mpToggleShuffle()" aria-label="Shuffle" title="Shuffle">⇄</button>
            <button class="mp-icon-btn" id="mp-btn-repeat" onclick="mpToggleRepeat()" aria-label="Repeat" title="Repeat">↺</button>
          </div>

          <!-- Progress + Volume (desktop) -->
          <div class="mp-progress-area desktop-only">
            <div class="mp-time-row">
              <span id="mp-current-time">0:00</span>
              <div class="mp-seek-bar" id="mp-seek-bar" onclick="mpSeek(event,this)" title="Seek">
                <div class="mp-seek-fill" id="mp-seek-fill"></div>
              </div>
              <span id="mp-duration">0:00</span>
            </div>
            <div class="mp-volume-row">
              <span title="Volume">🔊</span>
              <input type="range" min="0" max="100" value="80" id="mp-vol-slider"
                     oninput="mpSetVolume(this.value)" aria-label="Volume">
            </div>
          </div>

          <!-- Visualizer mini (desktop) -->
          <div class="music-visualizer-wrap desktop-only" style="width:80px;height:44px;flex-shrink:0">
            <canvas class="viz-canvas" id="mp-mini-viz" width="80" height="44"></canvas>
          </div>

          <!-- Queue toggle -->
          <button class="mp-icon-btn" onclick="mpToggleQueue()" aria-label="Queue" title="Queue">☰</button>
          <button class="mp-icon-btn" onclick="mpImport()" aria-label="Import files" title="Import music files">📂</button>
        </div>

        <!-- Mobile seek + volume -->
        <div class="mp-mobile-controls mobile-only" style="flex-direction:column;gap:6px;margin-top:8px">
          <div class="mp-time-row" style="font-size:0.72rem">
            <span id="mp-current-time-m">0:00</span>
            <div class="mp-seek-bar" style="flex:1" onclick="mpSeek(event,this)" id="mp-seek-bar-m">
              <div class="mp-seek-fill" id="mp-seek-fill-m"></div>
            </div>
            <span id="mp-duration-m">0:00</span>
          </div>
          <div class="mp-volume-row">
            <span>🔊</span>
            <input type="range" min="0" max="100" value="80"
                   oninput="mpSetVolume(this.value)" aria-label="Volume" style="flex:1;accent-color:var(--neon-green)">
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="tabs" role="tablist" style="margin-bottom:var(--space-xl)">
        ${[
          ['discover',        '🌌 Discover'],
          ['library',         '🎵 Library'],
          ['playlists',       '📂 Playlists'],
          ['albums',          '💿 Albums'],
          ['artists',         '🎤 Artists'],
          ['favorites',       '♥ Favorites'],
          ['recent',          '🕐 Recent'],
          ['search',          '🔍 Search'],
          ['upload',          '⬆ Upload'],
          ['external',        '🔗 Services'],
        ].map(([id, label], i) =>
          `<button class="tab-btn${i===0?' active':''}" role="tab"
             onclick="musicTabSwitch('${id}',this)">${label}</button>`
        ).join('')}
      </div>

      <!-- Content -->
      <div id="music-content"></div>
    </div>

    <!-- Queue panel (slide-in) -->
    <div class="music-queue-panel" id="mp-queue-panel" aria-label="Playback queue">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h4 style="font-family:var(--font-display);letter-spacing:0.1em;margin:0">QUEUE</h4>
        <button class="mp-icon-btn" onclick="mpToggleQueue()">✕</button>
      </div>
      <button class="btn btn-green btn-sm w-full" onclick="mpImport()">📂 Import Music Files</button>
      <div id="mp-queue-list" style="flex:1;overflow-y:auto">
        <p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:var(--space-lg) 0">Queue empty</p>
      </div>
    </div>

    <!-- Hidden audio element -->
    <audio id="mp-audio" preload="auto" style="display:none"></audio>
  `;
}

// ─── Tab router ──────────────────────────────────────────────
window.musicTabSwitch = async function (tab, clickedBtn) {
  // Update tab active state
  document.querySelectorAll('.tab-btn[role="tab"]').forEach(b => b.classList.remove('active'));
  if (clickedBtn) clickedBtn.classList.add('active');
  else {
    document.querySelectorAll('.tab-btn[role="tab"]').forEach(b => {
      if (b.textContent.toLowerCase().includes(tab.split('_')[0].slice(0,4))) b.classList.add('active');
    });
  }

  const el = document.getElementById('music-content');
  if (!el) return;

  el.innerHTML = `<div class="loading-state" style="min-height:40vh"><div class="spinner"></div></div>`;

  try {
    switch (tab) {
      case 'discover':        el.innerHTML = await renderDiscover();        break;
      case 'library':         el.innerHTML = await renderLibrary();         break;
      case 'playlists':       el.innerHTML = await renderPlaylists();       break;
      case 'albums':          el.innerHTML = await renderAlbums();          break;
      case 'artists':         el.innerHTML = await renderArtists();         break;
      case 'favorites':       el.innerHTML = await renderFavorites();       break;
      case 'recent':          el.innerHTML = await renderRecent();          break;
      case 'search':          el.innerHTML = renderSearchTab();             break;
      case 'upload':          el.innerHTML = renderUploadTab();             break;
      case 'external':        el.innerHTML = renderExternalTab();           break;
      default:                el.innerHTML = '<p class="text-muted">Section not found.</p>';
    }
  } catch (err) {
    console.warn('[AVN] Music tab error:', err);
    el.innerHTML = renderMusicError('This content is temporarily unavailable. Please try again.', () => musicTabSwitch(tab));
  }
};

// ─── DISCOVER TAB ────────────────────────────────────────────
// Module-level context registry: maps context string → tracks array.
// mpLoadBackendTrack can look up the array by context for auto-advance.
const _mpContextTracks = {};

async function renderDiscover() {
  let trackSection = '';
  let albumSection = '';

  // Try backend
  try {
    const [tracksData, albumsData] = await Promise.all([
      LegendAPI.music.tracks({ limit: 8, sort: 'popular' }),
      LegendAPI.music.albums({ limit: 6 }),
    ]);

    if (tracksData.tracks && tracksData.tracks.length > 0) {
      _mpContextTracks['popular'] = tracksData.tracks;
      trackSection = `
        <div class="section-header"><h2 class="section-title">🔥 POPULAR</h2></div>
        <div class="music-track-list" style="margin-bottom:var(--space-xl)">
          ${tracksData.tracks.map((t, i) => renderTrackRow(t, i, tracksData.tracks, 'popular')).join('')}
        </div>`;
    }

    if (albumsData.albums && albumsData.albums.length > 0) {
      albumSection = `
        <div class="section-header"><h2 class="section-title">💿 NEW ALBUMS</h2></div>
        <div class="music-card-grid" style="margin-bottom:var(--space-xl)">
          ${albumsData.albums.map(a => renderAlbumCard(a)).join('')}
        </div>`;
    }
  } catch { /* backend not connected — show local library instead */ }

  // Local imported tracks
  const localSection = MP.queue.length > 0 ? `
    <div class="section-header"><h2 class="section-title">YOUR LIBRARY</h2></div>
    <div class="music-track-list" style="margin-bottom:var(--space-xl)">
      ${MP.queue.map((t, i) => renderLocalTrackRow(t, i)).join('')}
    </div>` : '';

  const noContent = !trackSection && !albumSection && !localSection;

  return `
    <div>
      ${noContent ? renderDiscoverEmpty() : ''}
      ${localSection}
      ${trackSection}
      ${albumSection}
      ${renderPlaylistCards()}
    </div>
  `;
}

function renderDiscoverEmpty() {
  return `
    <div class="card" style="border-color:var(--border-green);margin-bottom:var(--space-xl)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:var(--space-md)">
        <div>
          <h3 style="font-family:var(--font-display);color:var(--neon-green);letter-spacing:0.08em;margin-bottom:6px">
            NO MUSIC AVAILABLE YET
          </h3>
          <p style="color:var(--text-secondary);font-size:0.9rem;max-width:480px">
            Import your own audio files to start listening, or explore the cloud library when it becomes available.
          </p>
          <ul style="color:var(--text-muted);font-size:0.82rem;margin:var(--space-sm) 0 0 var(--space-md);line-height:1.8">
            <li>Supported formats: MP3, WAV, OGG, FLAC, AAC, M4A, OPUS</li>
            <li>Files stay local in your browser — nothing is uploaded</li>
          </ul>
        </div>
        <button class="btn btn-green" onclick="mpImport()">📂 Import Files</button>
      </div>
    </div>`;
}

function renderPlaylistCards() {
  const presets = [
    { name: 'AVENORA HITS',       icon: '⭐', color: 'var(--neon-blue)' },
    { name: 'AVENORA ESSENTIALS', icon: '🌑', color: 'var(--neon-green)' },
    { name: 'AVENORA CHILL',      icon: '🌙', color: 'var(--neon-purple)' },
    { name: 'AVENORA ROCK',       icon: '🎸', color: 'var(--neon-orange)' },
    { name: '24/7 RADIO',         icon: '📻', color: 'var(--neon-red)' },
  ];
  const localPlaylists = LS.get('lu_music_playlists', []);
  const all = [...presets.map(p => ({ ...p, isPreset: true })), ...localPlaylists.map(p => ({
    name: p.name, icon: '📂', color: 'var(--neon-blue)', id: p.id
  }))];

  return `
    <div class="section-header"><h2 class="section-title">📂 PLAYLISTS</h2></div>
    <div class="music-card-grid" style="margin-bottom:var(--space-xl)">
      ${all.map(p => `
        <div class="music-card" onclick="${p.id ? `musicPlayLocalPlaylist('${p.id}')` : `musicTabSwitch('playlists')`}">
          <div class="music-card-art" style="background:var(--bg-elevated)">
            <div style="font-size:2.5rem">${p.icon}</div>
            <div class="music-card-art-overlay">
              <div class="music-card-play-icon">▶</div>
            </div>
          </div>
          <div class="music-card-body">
            <div class="music-card-title" style="color:${p.color}">${escapeHtml(p.name)}</div>
            <div class="music-card-sub">${p.isPreset ? 'Add your tracks' : 'Your playlist'}</div>
          </div>
        </div>`).join('')}
    </div>`;
}

// ─── LIBRARY TAB ─────────────────────────────────────────────
async function renderLibrary(genre = null) {
  let backendTracks = [];
  let cloudTracks   = [];   // Firestore-backed uploads (cloudStreamTracks/{uid}/tracks)
  let genres = [];

  // ── 1. Try MongoDB backend (admin-uploaded / shared catalogue) ──
  try {
    const [tracksData, genreData] = await Promise.all([
      LegendAPI.music.tracks({ limit: 50, genre: genre || undefined }),
      LegendAPI.request('GET', '/music/genres').catch(() => ({ genres: [] })),
    ]);
    backendTracks = tracksData.tracks || [];
    genres = genreData.genres || [];
  } catch { /* backend offline — skip silently */ }

  // ── 2. Load the signed-in user's own cloud-uploaded tracks from Firestore ──
  const firebaseUser = window.AvenoraFirebase?.Auth?.getUser?.();
  if (firebaseUser && window.AvenoraFirebase?.getFirestore) {
    try {
      const uid = firebaseUser.uid || firebaseUser.id;
      const fsDb = await window.AvenoraFirebase.getFirestore();
      const { collection, query, orderBy, limit, getDocs } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const snap = await getDocs(query(
        collection(fsDb, 'cloudStreamTracks', uid, 'tracks'),
        orderBy('createdAt', 'desc'),
        limit(200)
      ));
      cloudTracks = snap.docs.map(d => {
        const data = d.data();
        // Apply genre filter client-side if requested
        if (genre && data.genre !== genre) return null;
        return {
          id:          d.id,
          title:       data.title       || 'Untitled',
          artistName:  data.artist      || '',
          albumTitle:  data.album       || '',
          genre:       data.genre       || '',
          fileUrl:     data.url         || data.downloadURL || '',
          storagePath: data.storagePath || null,
          coverUrl:    data.coverUrl    || null,
          duration:    data.duration    || 0,
          visibility:  data.visibility  || 'private',
          _isFirestore: true,
        };
      }).filter(Boolean);
    } catch (fsErr) {
      console.warn('[AVN] Could not load cloud tracks from Firestore:', fsErr.message);
    }
  }

  const localTracks = MP.queue;
  const hasAny = backendTracks.length > 0 || cloudTracks.length > 0 || localTracks.length > 0;

  return `
    <div>
      <!-- Genre filter -->
      ${genres.length ? `
        <div class="genre-filter-row" id="genre-filter-row">
          <button class="genre-pill ${!genre ? 'active' : ''}" onclick="musicTabLibraryGenre(null)">All</button>
          ${genres.map(g => `
            <button class="genre-pill ${genre === g ? 'active' : ''}"
              onclick="musicTabLibraryGenre('${escapeHtml(g)}')">${escapeHtml(g)}</button>
          `).join('')}
        </div>` : ''}

      ${!hasAny ? `
        <div class="music-empty">
          <span class="music-empty-icon">🎵</span>
          <p>No music available yet.</p>
          <p style="font-size:0.82rem;color:var(--text-muted)">Upload tracks via the Upload tab, import local files, or sign in to see your cloud library.</p>
          <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;justify-content:center;margin-top:var(--space-md)">
            <button class="btn btn-green" onclick="musicTabSwitch('upload')">⬆ Upload Music</button>
            <button class="btn btn-outline" onclick="mpImport()">📂 Import Files</button>
          </div>
        </div>` : ''}

      ${localTracks.length > 0 ? `
        <div class="section-header">
          <h3 class="section-title">IMPORTED FILES</h3>
          <span style="font-size:0.8rem;color:var(--text-muted)">${localTracks.length} track${localTracks.length!==1?'s':''}</span>
        </div>
        <div class="music-track-list" style="margin-bottom:var(--space-xl)">
          ${localTracks.map((t, i) => renderLocalTrackRow(t, i)).join('')}
        </div>` : ''}

      ${cloudTracks.length > 0 ? `
        <div class="section-header">
          <h3 class="section-title">MY CLOUD UPLOADS</h3>
          <span style="font-size:0.8rem;color:var(--text-muted)">${cloudTracks.length} track${cloudTracks.length!==1?'s':''}</span>
        </div>
        <div class="music-track-list" style="margin-bottom:var(--space-xl)">
          ${cloudTracks.map((t, i) => renderTrackRow(t, i, cloudTracks, 'cloud')).join('')}
        </div>` : ''}

      ${backendTracks.length > 0 ? `
        <div class="section-header">
          <h3 class="section-title">CLOUD LIBRARY</h3>
          <span style="font-size:0.8rem;color:var(--text-muted)">${backendTracks.length} track${backendTracks.length!==1?'s':''}</span>
        </div>
        <div class="music-track-list">
          ${backendTracks.map((t, i) => renderTrackRow(t, i, backendTracks, 'library')).join('')}
        </div>` : ''}
    </div>`;
}

window.musicTabLibraryGenre = function (genre) {
  renderLibrary(genre).then(html => {
    const el = document.getElementById('music-content');
    if (el) el.innerHTML = html;
  });
};

// ─── PLAYLISTS TAB ───────────────────────────────────────────
async function renderPlaylists() {
  // Load local playlists (always available)
  let playlists = LS.get('lu_music_playlists', []);

  // Try to merge with backend playlists if logged in
  if (LegendAPI.auth.isLoggedIn()) {
    try {
      const data = await LegendAPI.music.playlists();
      if (data.playlists) {
        // Mark backend playlists distinctly
        playlists = [
          ...playlists,
          ...data.playlists.map(p => ({ ...p, _isBackend: true })),
        ];
      }
    } catch { /* not connected */ }
  }

  return `
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-lg);flex-wrap:wrap;gap:var(--space-sm)">
        <h2 class="section-title" style="margin:0">MY PLAYLISTS</h2>
        <button class="btn btn-green btn-sm" onclick="musicCreatePlaylistModal()">+ New Playlist</button>
      </div>

      ${playlists.length === 0 ? `
        <div class="music-empty">
          <span class="music-empty-icon">📂</span>
          <p>No playlists yet.</p>
          <button class="btn btn-green btn-sm" onclick="musicCreatePlaylistModal()">Create Your First Playlist</button>
        </div>` : `
        <div class="music-card-grid">
          ${playlists.map(p => renderPlaylistCard(p)).join('')}
        </div>`}

      <div class="divider" style="margin-top:var(--space-2xl)"></div>
      <div style="margin-top:var(--space-lg)">
        <h3 style="font-family:var(--font-display);letter-spacing:0.08em;margin-bottom:var(--space-md);font-size:0.9rem;color:var(--text-secondary)">
          DEFAULT COLLECTIONS
        </h3>
        <p style="font-size:0.85rem;color:var(--text-muted)">
          Create playlists named <strong>AVENORA HITS</strong>, <strong>AVENORA ESSENTIALS</strong>,
          <strong>AVENORA CHILL</strong>, or <strong>AVENORA ROCK</strong> — these will
          automatically appear in the Discover feed and DJ System.
        </p>
      </div>
    </div>`;
}

function renderPlaylistCard(p) {
  const trackCount = (p.tracks || []).length;
  return `
    <div class="music-card" onclick="musicOpenPlaylist('${escapeHtml(p.id || p._id || '')}')">
      <div class="music-card-art" style="background:var(--bg-elevated)">
        ${p.coverUrl
          ? `<img src="${escapeHtml(p.coverUrl)}" alt="${escapeHtml(p.name)}" loading="lazy">`
          : `<div style="font-size:2.5rem">📂</div>`}
        <div class="music-card-art-overlay">
          <div class="music-card-play-icon" onclick="event.stopPropagation();musicPlayLocalPlaylist('${escapeHtml(p.id||p._id||'')}')">▶</div>
        </div>
        <span class="music-card-count">${trackCount} track${trackCount!==1?'s':''}</span>
      </div>
      <div class="music-card-body">
        <div class="music-card-title">${escapeHtml(p.name)}</div>
        <div class="music-card-sub" style="display:flex;justify-content:space-between">
          <span>${p.visibility === 'public' ? 'Public' : 'Private'}</span>
          <span onclick="event.stopPropagation()" style="display:flex;gap:4px">
            <button class="mp-icon-btn" style="font-size:0.75rem;padding:2px 6px"
              onclick="musicRenamePlaylist('${escapeHtml(p.id||p._id||'')}','${escapeHtml(p.name)}')">✏</button>
            <button class="mp-icon-btn" style="font-size:0.75rem;padding:2px 6px;color:var(--neon-red)"
              onclick="musicDeletePlaylist('${escapeHtml(p.id||p._id||'')}','${escapeHtml(p.name)}')">🗑</button>
          </span>
        </div>
      </div>
    </div>`;
}

// ─── ALBUMS TAB ──────────────────────────────────────────────
async function renderAlbums() {
  let albums = [];
  try {
    const data = await LegendAPI.music.albums({ limit: 40 });
    albums = data.albums || [];
  } catch { /* backend offline */ }

  if (!albums.length) return `
    <div class="music-empty">
      <span class="music-empty-icon">💿</span>
      <p>No music available yet.</p>
      <p style="font-size:0.82rem">Albums will appear here once tracks are uploaded via the Upload tab.</p>
    </div>`;

  return `
    <div class="music-card-grid">
      ${albums.map(a => renderAlbumCard(a)).join('')}
    </div>`;
}

function renderAlbumCard(a) {
  return `
    <div class="music-card" onclick="musicOpenAlbum('${escapeHtml(String(a.id))}')">
      <div class="music-card-art">
        ${a.coverUrl
          ? `<img src="${escapeHtml(a.coverUrl)}" alt="${escapeHtml(a.title)}" loading="lazy">`
          : `<div>💿</div>`}
        <div class="music-card-art-overlay">
          <div class="music-card-play-icon">▶</div>
        </div>
      </div>
      <div class="music-card-body">
        <div class="music-card-title">${escapeHtml(a.title)}</div>
        <div class="music-card-sub">${escapeHtml(a.artistName || 'Unknown artist')}</div>
        <div class="music-card-sub" style="margin-top:2px">${a.totalTracks || 0} tracks${a.genre ? ' · ' + escapeHtml(a.genre) : ''}</div>
      </div>
    </div>`;
}

// ─── ARTISTS TAB ─────────────────────────────────────────────
async function renderArtists() {
  let artists = [];
  try {
    const data = await LegendAPI.music.artists({ limit: 40 });
    artists = data.artists || [];
  } catch { /* backend offline */ }

  if (!artists.length) return `
    <div class="music-empty">
      <span class="music-empty-icon">🎤</span>
      <p>No music available yet.</p>
      <p style="font-size:0.82rem">Artists appear here once tracks with artist metadata are uploaded.</p>
    </div>`;

  return `
    <div class="music-card-grid">
      ${artists.map(a => `
        <div class="music-card" onclick="musicOpenArtist('${escapeHtml(String(a.id))}')">
          <div class="music-card-art" style="border-radius:50%;overflow:hidden;margin:var(--space-md) auto var(--space-sm);width:80%;aspect-ratio:1">
            ${a.avatarUrl
              ? `<img src="${escapeHtml(a.avatarUrl)}" alt="${escapeHtml(a.name)}" loading="lazy">`
              : `<div style="font-size:2.5rem">🎤</div>`}
          </div>
          <div class="music-card-body" style="text-align:center">
            <div class="music-card-title">${escapeHtml(a.name)}</div>
            ${a.isVerified ? '<div class="music-card-sub" style="color:var(--neon-blue)">✓ Verified</div>' : ''}
            ${a.genres && a.genres.length ? `<div class="music-card-sub">${a.genres.slice(0,2).map(escapeHtml).join(', ')}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
}

// ─── FAVORITES TAB ───────────────────────────────────────────
async function renderFavorites() {
  // Local favorites (always available)
  const localFavIds = new Set(LS.get('lu_mp_favorites', []));
  const localFavTracks = MP.queue.filter(t => localFavIds.has(t.id));

  let backendFavs = [];
  if (LegendAPI.auth.isLoggedIn()) {
    try {
      const favData = await LegendAPI.request('GET', '/music/favorites');
      backendFavs = favData.tracks || [];
    } catch { /* offline */ }
  }

  const hasAny = localFavTracks.length > 0 || backendFavs.length > 0;

  if (!hasAny) return `
    <div class="music-empty">
      <span class="music-empty-icon">♥</span>
      <p>No favorites yet.</p>
      <p style="font-size:0.82rem">Tap ♥ on any track to add it here.</p>
    </div>`;

  return `
    <div>
      ${localFavTracks.length > 0 ? `
        <div class="section-header">
          <h3 class="section-title">LOCAL FAVORITES</h3>
          <button class="btn btn-green btn-sm" onclick="mpPlayAll(${JSON.stringify(localFavTracks.map((_,i)=>MP.queue.indexOf(localFavTracks[i])))})">▶ Play All</button>
        </div>
        <div class="music-track-list" style="margin-bottom:var(--space-xl)">
          ${localFavTracks.map((t, i) => renderLocalTrackRow(t, MP.queue.indexOf(t))).join('')}
        </div>` : ''}

      ${backendFavs.length > 0 ? `
        <div class="section-header">
          <h3 class="section-title">CLOUD FAVORITES</h3>
        </div>
        <div class="music-track-list">
          ${backendFavs.map((t, i) => renderTrackRow(t, i, backendFavs, 'favorites')).join('')}
        </div>` : ''}
    </div>`;
}

// ─── RECENT TAB ──────────────────────────────────────────────
async function renderRecent() {
  const localRecent = LS.get('lu_mp_recently_played', []);

  let backendRecent = [];
  if (LegendAPI.auth.isLoggedIn()) {
    try {
      const data = await LegendAPI.request('GET', '/music/recently-played?limit=20');
      backendRecent = data.tracks || [];
    } catch { /* offline */ }
  }

  const hasAny = localRecent.length > 0 || backendRecent.length > 0;

  if (!hasAny) return `
    <div class="music-empty">
      <span class="music-empty-icon">🕐</span>
      <p>Nothing played yet.</p>
      <p style="font-size:0.82rem">Tracks you play will appear here.</p>
    </div>`;

  return `
    <div>
      ${localRecent.length > 0 ? `
        <div class="section-header"><h3 class="section-title">RECENTLY PLAYED (LOCAL)</h3></div>
        <div class="music-track-list" style="margin-bottom:var(--space-xl)">
          ${localRecent.slice(0, 20).map((t, i) => {
            const queueIdx = MP.queue.findIndex(q => q.id === t.id);
            return queueIdx >= 0 ? renderLocalTrackRow(MP.queue[queueIdx], queueIdx) : `
              <div class="mtrack-row">
                <div class="mtrack-art">🎵</div>
                <div class="mtrack-info">
                  <div class="mtrack-title">${escapeHtml(t.name || 'Unknown')}</div>
                  <div class="mtrack-meta">Not in queue</div>
                </div>
              </div>`;
          }).join('')}
        </div>` : ''}

      ${backendRecent.length > 0 ? `
        <div class="section-header"><h3 class="section-title">RECENTLY PLAYED (CLOUD)</h3></div>
        <div class="music-track-list">
          ${backendRecent.map((t, i) => renderTrackRow(t, i, backendRecent, 'recent')).join('')}
        </div>` : ''}
    </div>`;
}

// ─── SEARCH TAB ──────────────────────────────────────────────
function renderSearchTab() {
  return `
    <div>
      <div class="search-bar" style="max-width:600px;margin-bottom:var(--space-xl)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="search" id="music-search-input" placeholder="Search songs, artists, albums…"
               aria-label="Search music" oninput="musicSearch(this.value)">
      </div>

      <!-- Category filters -->
      <div class="genre-filter-row" style="margin-bottom:var(--space-lg)">
        ${['All','Songs','Albums','Artists','Playlists'].map((c,i) =>
          `<button class="genre-pill${i===0?' active':''}"
             onclick="musicSearchFilter('${c.toLowerCase()}',this)">${c}</button>`
        ).join('')}
      </div>

      <div id="music-search-results">
        <div class="music-empty">
          <span class="music-empty-icon">🔍</span>
          <p>Type to search across songs, albums, and artists.</p>
        </div>
      </div>
    </div>`;
}

let _musicSearchFilter = 'all';
let _musicSearchDebounce = null;

window.musicSearchFilter = function (filter, btn) {
  _musicSearchFilter = filter;
  document.querySelectorAll('#music-content .genre-pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const q = document.getElementById('music-search-input')?.value || '';
  if (q.trim()) musicSearch(q);
};

window.musicSearch = function (q) {
  clearTimeout(_musicSearchDebounce);
  _musicSearchDebounce = setTimeout(async () => {
    const el = document.getElementById('music-search-results');
    if (!el) return;
    const query = q.trim();
    if (!query || query.length < 2) {
      el.innerHTML = '<div class="music-empty"><span class="music-empty-icon">🔍</span><p>Type at least 2 characters.</p></div>';
      return;
    }

    el.innerHTML = '<div class="loading-state" style="min-height:20vh"><div class="spinner"></div></div>';

    // Search local queue
    const lcq = query.toLowerCase();
    const localResults = MP.queue.filter(t =>
      t.name.toLowerCase().includes(lcq) ||
      (t.artist || '').toLowerCase().includes(lcq)
    );

    // Search backend
    let backendResults = { tracks: [], albums: [], artists: [] };
    try {
      const _musicApiBase = (window.LU_CONFIG?.apiUrl || '').replace(/\/$/, '');
      const res = await fetch(`${_musicApiBase}/music/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.success) backendResults = data;
    } catch { /* not connected */ }

    const showSongs    = _musicSearchFilter === 'all' || _musicSearchFilter === 'songs';
    const showAlbums   = _musicSearchFilter === 'all' || _musicSearchFilter === 'albums';
    const showArtists  = _musicSearchFilter === 'all' || _musicSearchFilter === 'artists';

    const allEmpty =
      (!showSongs  || (localResults.length === 0 && backendResults.tracks.length === 0)) &&
      (!showAlbums || backendResults.albums.length === 0) &&
      (!showArtists|| backendResults.artists.length === 0);

    if (allEmpty) {
      el.innerHTML = `<div class="music-empty"><span class="music-empty-icon">🔍</span><p>No results for "<strong>${escapeHtml(query)}</strong>".</p></div>`;
      return;
    }

    let html = '';

    if (showSongs && (localResults.length || backendResults.tracks.length)) {
      html += `<div class="music-search-section"><h4>SONGS</h4><div class="music-track-list">`;
      localResults.forEach((t, i) => { html += renderLocalTrackRow(t, MP.queue.indexOf(t)); });
      backendResults.tracks.forEach((t, i) => { html += renderTrackRow(t, i, backendResults.tracks, 'search'); });
      html += '</div></div>';
    }
    if (showAlbums && backendResults.albums.length) {
      html += `<div class="music-search-section"><h4>ALBUMS</h4><div class="music-card-grid">${backendResults.albums.map(renderAlbumCard).join('')}</div></div>`;
    }
    if (showArtists && backendResults.artists.length) {
      html += `<div class="music-search-section"><h4>ARTISTS</h4><div class="music-card-grid">${backendResults.artists.map(a => `
        <div class="music-card" onclick="musicOpenArtist('${escapeHtml(String(a.id))}')">
          <div class="music-card-art">${a.avatarUrl ? `<img src="${escapeHtml(a.avatarUrl)}" alt="" loading="lazy">` : '<div>🎤</div>'}</div>
          <div class="music-card-body"><div class="music-card-title">${escapeHtml(a.name)}</div></div>
        </div>`).join('')}</div></div>`;
    }

    el.innerHTML = html;
  }, 350);
};

// ─── UPLOAD TAB ──────────────────────────────────────────────
function renderUploadTab() {
  const isLoggedIn = LegendAPI.auth.isLoggedIn();

  return `
    <div style="max-width:680px;margin:0 auto">
      <h2 class="section-title" style="margin-bottom:var(--space-lg)">UPLOAD MUSIC</h2>

      <!-- Cloud upload info -->
      <div class="card" style="border-color:rgba(57,255,20,0.2);background:rgba(57,255,20,0.03);margin-bottom:var(--space-xl)">
        <div style="display:flex;gap:var(--space-md);align-items:flex-start">
          <span style="font-size:1.4rem;flex-shrink:0">☁️</span>
          <div>
            <h4 style="margin:0 0 6px;color:var(--neon-green);font-family:var(--font-display);letter-spacing:0.06em">
              CLOUD UPLOAD
            </h4>
            <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0">
              Upload audio to your cloud library. Uploaded tracks appear in your Cloud Stream playlists and are available across all devices.
            </p>
          </div>
        </div>
      </div>

      ${!isLoggedIn ? `
        <div class="card" style="border-color:var(--border-blue);margin-bottom:var(--space-xl);text-align:center">
          <p style="color:var(--text-secondary);margin-bottom:var(--space-md)">Sign in to upload music to the cloud library.</p>
          <button class="btn btn-primary" onclick="Modal.open('auth-modal')">Sign In</button>
        </div>` : ''}

      <!-- Upload form -->
      <form id="music-upload-form" onsubmit="musicUploadSubmit(event)">
        <!-- Drop zone -->
        <div class="music-upload-zone" id="music-drop-zone"
             onclick="document.getElementById('music-upload-file').click()"
             ondragover="event.preventDefault();this.classList.add('drag-over')"
             ondragleave="this.classList.remove('drag-over')"
             ondrop="musicDropFile(event)">
          <p style="font-size:2rem;margin-bottom:var(--space-sm)">🎵</p>
          <p style="font-weight:600;margin-bottom:4px">Drag & drop audio file here</p>
          <p style="font-size:0.82rem;color:var(--text-muted)">MP3, WAV, OGG, FLAC, AAC, M4A, OPUS — max 100 MB</p>
          <input type="file" id="music-upload-file" accept="audio/*" style="display:none"
                 onchange="musicUploadFileSelected(this)">
        </div>
        <div id="music-upload-file-preview" style="margin-top:var(--space-sm)"></div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-md);margin-top:var(--space-lg)">
          <div class="form-group">
            <label class="form-label">Title *</label>
            <input class="form-input" name="title" placeholder="Track title" required maxlength="300">
          </div>
          <div class="form-group">
            <label class="form-label">Artist</label>
            <input class="form-input" name="artist" placeholder="Artist name" maxlength="200">
          </div>
          <div class="form-group">
            <label class="form-label">Album</label>
            <input class="form-input" name="album" placeholder="Album title" maxlength="300">
          </div>
          <div class="form-group">
            <label class="form-label">Genre</label>
            <select class="form-input" name="genre">
              <option value="">Select genre</option>
              ${['Hip-Hop','R&B','Trap','Pop','Rock','Electronic','House','Reggae','Gospel',
                 'Jazz','Soul','Lo-Fi','Ambient','Cinematic','Other'].map(g =>
                `<option value="${g}">${g}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea class="form-input" name="description" rows="3" maxlength="2000"
            placeholder="Optional description…"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Visibility</label>
          <select class="form-input" name="visibility">
            <option value="public">Public</option>
            <option value="private" selected>Private</option>
            <option value="unlisted">Unlisted</option>
          </select>
        </div>

        <!-- Progress (only shown when a real upload starts) -->
        <div id="music-upload-progress-wrap" class="hidden">
          <div style="display:flex;justify-content:space-between;font-size:0.82rem;color:var(--text-muted);margin-bottom:4px">
            <span id="music-upload-status">Uploading…</span>
            <span id="music-upload-pct">0%</span>
          </div>
          <div class="upload-progress-bar">
            <div class="upload-progress-fill" id="music-upload-fill"></div>
          </div>
        </div>

        <div id="music-upload-error" class="hidden"
             style="margin-top:var(--space-sm);padding:var(--space-sm);background:rgba(255,50,70,0.08);
                    border:1px solid rgba(255,50,70,0.3);border-radius:var(--radius-sm);
                    font-size:0.85rem;color:var(--neon-red)"></div>

        <div id="music-upload-success" class="hidden"
             style="margin-top:var(--space-sm);padding:var(--space-sm);background:rgba(57,255,20,0.06);
                    border:1px solid rgba(57,255,20,0.3);border-radius:var(--radius-sm);
                    font-size:0.85rem;color:var(--neon-green)"></div>

        <div style="margin-top:var(--space-lg);display:flex;gap:var(--space-sm)">
          <button type="submit" class="btn btn-green" id="music-upload-btn"
                  ${!isLoggedIn ? 'disabled title="Sign in first"' : ''}>
            ⬆ Upload Track
          </button>
          <button type="button" class="btn btn-outline" onclick="musicImportLocalOnly()">
            📂 Import Locally (No Upload)
          </button>
        </div>
      </form>
    </div>`;
}

window.musicDropFile = function (e) {
  e.preventDefault();
  document.getElementById('music-drop-zone')?.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    const input = document.getElementById('music-upload-file');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    musicUploadFileSelected(input);
  }
};

window.musicUploadFileSelected = function (input) {
  const file = input.files?.[0];
  if (!file) return;
  const preview = document.getElementById('music-upload-file-preview');
  if (!preview) return;

  // Validate type
  const allowed = ['audio/mpeg','audio/wav','audio/ogg','audio/flac','audio/x-m4a','audio/mp4','audio/opus','audio/aac'];
  const extAllowed = ['.mp3','.wav','.ogg','.flac','.m4a','.opus','.aac'];
  const mime = file.type;
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(mime) && !extAllowed.includes(ext)) {
    preview.innerHTML = `<p style="color:var(--neon-red);font-size:0.85rem">❌ Unsupported file type: ${escapeHtml(mime || ext)}</p>`;
    input.value = '';
    return;
  }
  if (file.size > 100 * 1024 * 1024) {
    preview.innerHTML = `<p style="color:var(--neon-red);font-size:0.85rem">❌ File too large (max 100 MB). This file is ${(file.size/1024/1024).toFixed(1)} MB.</p>`;
    input.value = '';
    return;
  }

  // Auto-fill title from filename
  const titleInput = document.querySelector('#music-upload-form [name="title"]');
  if (titleInput && !titleInput.value) {
    titleInput.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  }

  preview.innerHTML = `
    <div style="display:flex;align-items:center;gap:var(--space-sm);padding:var(--space-sm);background:var(--bg-elevated);border-radius:var(--radius-sm);font-size:0.85rem">
      <span>🎵</span>
      <span class="truncate">${escapeHtml(file.name)}</span>
      <span style="color:var(--text-muted);white-space:nowrap">${(file.size/1024/1024).toFixed(1)} MB</span>
    </div>`;
};

window.musicUploadSubmit = async function (e) {
  e.preventDefault();
  const form    = e.target;
  const file    = document.getElementById('music-upload-file')?.files?.[0];
  const errEl   = document.getElementById('music-upload-error');
  const succEl  = document.getElementById('music-upload-success');
  const btn     = document.getElementById('music-upload-btn');
  const progW   = document.getElementById('music-upload-progress-wrap');
  const fill    = document.getElementById('music-upload-fill');
  const status  = document.getElementById('music-upload-status');
  const pct     = document.getElementById('music-upload-pct');

  errEl?.classList.add('hidden');
  succEl?.classList.add('hidden');

  if (!file) {
    errEl.textContent = 'Please select an audio file first.';
    errEl.classList.remove('hidden');
    return;
  }

  // Must be signed in
  const firebaseUser = window.AvenoraFirebase?.Auth?.getUser?.();
  if (!firebaseUser) {
    errEl.textContent = 'You must be signed in to upload music.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Uploading…';
  progW?.classList.remove('hidden');
  if (status) status.textContent = 'Uploading to cloud…';
  if (fill) fill.style.width = '0%';
  if (pct) pct.textContent = '0%';

  const titleVal = form.querySelector('[name="title"]')?.value?.trim() ||
                   file.name.replace(/\.[^.]+$/, '');
  const artist  = form.querySelector('[name="artist"]')?.value?.trim() || '';
  const album   = form.querySelector('[name="album"]')?.value?.trim() || '';
  const genre   = form.querySelector('[name="genre"]')?.value || '';
  const desc    = form.querySelector('[name="description"]')?.value?.trim() || '';
  const visibility = form.querySelector('[name="visibility"]')?.value || 'private';

  try {
    if (!window.AvenoraStorage) {
      console.error('[AVENORA] AvenoraStorage not found. Check that frontend/src/services/supabase.js loaded correctly.');
      throw new Error('Storage service not loaded. Check your browser console for details and refresh the page.');
    }

    // 1. Upload file + metadata to backend → Supabase Storage (music bucket)
    if (status) status.textContent = 'Uploading to Supabase Storage…';

    const data = await window.AvenoraStorage.uploadMusic(
      file,
      { title: titleVal, artist, album, genre },
      (p) => {
        if (fill) fill.style.width = p + '%';
        if (pct) pct.textContent = p + '%';
      }
    );

    if (fill) fill.style.width = '100%';
    if (pct) pct.textContent = '100%';
    if (status) status.textContent = 'Track saved!';

    progW?.classList.add('hidden');

    // 2. Optionally save to Firestore cloudStreamTracks so the Cloud Stream
    //    dashboard can pick it up. The backend track record is the primary store;
    //    Firestore is a secondary index used by the stream dashboard.
    try {
      const track = data.track;
      if (track && window.AvenoraFirebase?.getFirestore) {
        const uid = (firebaseUser.uid || firebaseUser.id);
        const fsDb = await window.AvenoraFirebase.getFirestore();
        const fsModule = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        await fsModule.setDoc(
          fsModule.doc(fsDb, 'cloudStreamTracks', uid, 'tracks', track.id || track._id),
          {
            uid,
            backendTrackId: track.id || track._id,
            title:        track.title,
            artist:       track.artistName || artist,
            album:        track.albumTitle || album,
            genre:        track.genre || genre,
            url:          track.fileUrl,
            storagePath:  track.storagePath || null,
            duration:     track.duration || 0,
            fileName:     file.name,
            fileSize:     file.size,
            mimeType:     file.type,
            status:       'ready',
            createdAt:    fsModule.serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (_fsErr) {
      // Firestore sync is optional — log but don't fail the upload
      console.warn('[AVN] Firestore cloudStreamTracks sync skipped:', _fsErr.message);
    }

    // Show success message
    if (succEl) {
      succEl.textContent = `✓ "${titleVal}" uploaded successfully! It is now available in your Music Hub and Cloud Stream library.`;
      succEl.classList.remove('hidden');
    }
    Toast.success(`Track "${titleVal}" uploaded!`);

    // Reset form
    form.reset();
    document.getElementById('music-upload-file-preview').innerHTML = '';

  } catch (err) {
    console.warn('[AVN] Music upload error:', err);
    progW?.classList.add('hidden');
    errEl.textContent = err.message || 'Upload failed. Please try again.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '⬆ Upload Track';
  }
};

window.musicImportLocalOnly = function () {
  mpImport();
  musicTabSwitch('library');
};

// ─── EXTERNAL SERVICES TAB ───────────────────────────────────
function renderExternalTab() {
  const services = [
    {
      name: 'Spotify',
      icon: '🟢',
      cls: 'spotify',
      url: 'https://open.spotify.com',
      desc: 'Stream on Spotify',
      color: '#1db954',
    },
    {
      name: 'YouTube Music',
      icon: '▶',
      cls: 'youtube',
      url: 'https://music.youtube.com',
      desc: 'Stream on YouTube Music',
      color: '#ff0000',
    },
    {
      name: 'Apple Music',
      icon: '🍎',
      cls: 'apple',
      url: 'https://music.apple.com',
      desc: 'Stream on Apple Music',
      color: '#fc3c44',
    },
    {
      name: 'Amazon Music',
      icon: '🎵',
      cls: 'amazon',
      url: 'https://music.amazon.com',
      desc: 'Stream on Amazon Music',
      color: '#00a8e1',
    },
  ];

  return `
    <div style="max-width:680px;margin:0 auto">
      <h2 class="section-title" style="margin-bottom:var(--space-sm)">EXTERNAL SERVICES</h2>
      <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:var(--space-xl)">
        Links to authorized music streaming platforms. Avenora does not scrape,
        copy, or redistribute copyrighted music from these services.
        Only official platform links are provided.
      </p>

      <div class="external-service-grid">
        ${services.map(s => `
          <a href="${s.url}" target="_blank" rel="noopener noreferrer"
             class="external-service-card ${s.cls}">
            <div class="external-service-icon" style="color:${s.color}">${s.icon}</div>
            <div class="external-service-name">${s.name}</div>
            <div style="font-size:0.72rem;color:var(--text-muted)">Open ↗</div>
          </a>`).join('')}
      </div>

      <div class="divider" style="margin-top:var(--space-2xl)"></div>

      <div class="card" style="margin-top:var(--space-xl);border-color:var(--border-blue)">
        <h4 style="font-family:var(--font-display);color:var(--neon-blue);letter-spacing:0.08em;margin-bottom:var(--space-sm)">
          COPYRIGHT NOTICE
        </h4>
        <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.7">
          Avenora only hosts music for which the uploader holds rights or has
          explicit permission to distribute. Unauthorized content is subject to removal.
          If you believe content infringes your copyright, use the Report feature or
          contact the platform administrator.
        </p>
      </div>
    </div>`;
}

// ─── Track row renderers ──────────────────────────────────────

function renderLocalTrackRow(track, index) {
  const isCurrent = index === MP.currentIndex;
  const favs = new Set(LS.get('lu_mp_favorites', []));
  const isFav = favs.has(track.id);

  return `
    <div class="mtrack-row ${isCurrent ? 'playing' : ''}" id="mp-ltrack-${index}"
         onclick="mpLoadTrack(${index})" role="button" tabindex="0"
         onkeydown="if(event.key==='Enter')mpLoadTrack(${index})">
      <div class="mtrack-num">
        ${isCurrent
          ? `<span class="mtrack-playing-icon">♫</span>`
          : `<span>${index + 1}</span>`}
      </div>
      <div class="mtrack-art">🎵</div>
      <div class="mtrack-info">
        <div class="mtrack-title">${escapeHtml(track.name)}</div>
        <div class="mtrack-meta">${escapeHtml(track.artist || '')}</div>
      </div>
      <div class="mtrack-duration" id="mp-ldur-${index}">—</div>
      <div class="mtrack-actions">
        <button class="mp-icon-btn ${isFav ? 'active' : ''}"
          onclick="event.stopPropagation();mpToggleFavorite('${track.id}')"
          title="${isFav ? 'Remove from favorites' : 'Add to favorites'}"
          style="font-size:0.85rem">♥</button>
        <button class="mp-icon-btn"
          onclick="event.stopPropagation();musicAddToPlaylistModal('${track.id}','${escapeHtml(track.name)}')"
          title="Add to playlist" style="font-size:0.85rem">+</button>
      </div>
    </div>`;
}

function renderTrackRow(track, index, queue, context) {
  const isCurrent = MP.backendQueue === context && MP.currentIndex === index;
  const favs = new Set(LS.get('lu_mp_favorites', []));
  const isFav = favs.has(String(track.id));

  // Store tracks in the context registry for auto-advance without inline JSON.
  if (Array.isArray(queue) && queue.length > 0 && context) {
    _mpContextTracks[context] = queue;
  }

  return `
    <div class="mtrack-row ${isCurrent ? 'playing' : ''}"
         onclick="mpLoadBackendTrack(${JSON.stringify(track).replace(/"/g,'&quot;')}, ${index}, '${context}')"
         data-track-index="${index}"
         role="button" tabindex="0">
      <div class="mtrack-num">
        ${isCurrent
          ? `<span class="mtrack-playing-icon">♫</span>`
          : `<span>${index + 1}</span>`}
      </div>
      <div class="mtrack-art">
        ${track.coverUrl
          ? `<img src="${escapeHtml(track.coverUrl)}" alt="" loading="lazy">`
          : '🎵'}
      </div>
      <div class="mtrack-info">
        <div class="mtrack-title">${escapeHtml(track.title)}</div>
        <div class="mtrack-meta">${escapeHtml(track.artistName || '')}${track.albumTitle ? ' · ' + escapeHtml(track.albumTitle) : ''}</div>
      </div>
      <div class="mtrack-duration">${track.duration ? formatDuration(track.duration) : '—'}</div>
      <div class="mtrack-actions">
        <button class="mp-icon-btn ${isFav ? 'active' : ''}"
          onclick="event.stopPropagation();mpToggleBackendFavorite('${track.id}')"
          style="font-size:0.85rem" title="${isFav ? 'Unfavorite' : 'Favorite'}">♥</button>
      </div>
    </div>`;
}

// ─── Detail views ─────────────────────────────────────────────

window.musicOpenAlbum = async function (id) {
  const el = document.getElementById('music-content');
  if (!el) return;
  el.innerHTML = '<div class="loading-state" style="min-height:40vh"><div class="spinner"></div></div>';
  try {
    const data = await LegendAPI.music.album(id);
    const a = data.album;
    el.innerHTML = `
      <div>
        <button class="btn btn-ghost btn-sm" style="margin-bottom:var(--space-lg)"
          onclick="musicTabSwitch('albums')">← Back to Albums</button>
        <div style="display:flex;gap:var(--space-lg);align-items:flex-start;flex-wrap:wrap;margin-bottom:var(--space-xl)">
          <div style="width:160px;height:160px;border-radius:var(--radius-md);overflow:hidden;flex-shrink:0;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;font-size:4rem">
            ${a.coverUrl ? `<img src="${escapeHtml(a.coverUrl)}" alt="" style="width:100%;height:100%;object-fit:cover">` : '💿'}
          </div>
          <div style="flex:1;min-width:0">
            <h2 style="font-family:var(--font-display);letter-spacing:0.08em;margin-bottom:4px">${escapeHtml(a.title)}</h2>
            <p style="color:var(--text-muted);margin-bottom:var(--space-sm)">${escapeHtml(a.artistName || 'Unknown artist')}</p>
            ${a.genre ? `<span class="genre-pill active" style="margin-bottom:var(--space-sm)">${escapeHtml(a.genre)}</span>` : ''}
            ${a.releaseDate ? `<p style="color:var(--text-muted);font-size:0.82rem">Released ${formatDate(a.releaseDate)}</p>` : ''}
            ${a.description ? `<p style="font-size:0.88rem;color:var(--text-secondary);margin-top:var(--space-sm)">${escapeHtml(a.description)}</p>` : ''}
            <div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md);flex-wrap:wrap">
              <button class="btn btn-green btn-sm" onclick="musicPlayAlbumTracks(${JSON.stringify(a.tracks||[])})">▶ Play Album</button>
              <button class="btn btn-outline btn-sm" onclick="musicAddAlbumToPlaylist(${JSON.stringify(a.tracks||[])})">+ Add to Playlist</button>
            </div>
          </div>
        </div>
        <div class="section-header"><h3 class="section-title">TRACKS</h3></div>
        ${!a.tracks || !a.tracks.length
          ? `<div class="music-empty"><span class="music-empty-icon">🎵</span><p>No tracks in this album yet.</p></div>`
          : `<div class="music-track-list">${(a.tracks).map((t, i) => renderTrackRow(t, i, a.tracks, 'album_' + id)).join('')}</div>`}
      </div>`;
  } catch (err) {
    console.warn('[AVN] Album load error:', err);
    el.innerHTML = renderMusicError('This album is temporarily unavailable.', () => musicOpenAlbum(id));
  }
};

window.musicOpenArtist = async function (id) {
  const el = document.getElementById('music-content');
  if (!el) return;
  el.innerHTML = '<div class="loading-state" style="min-height:40vh"><div class="spinner"></div></div>';
  try {
    const data = await LegendAPI.music.artists(id);
    // artist detail endpoint
    const _musicApiBase = (window.LU_CONFIG?.apiUrl || '').replace(/\/$/, '');
    const res = await fetch(`${_musicApiBase}/music/artists/${encodeURIComponent(id)}`);
    const json = await res.json();
    const a = json.artist || {};
    el.innerHTML = `
      <div>
        <button class="btn btn-ghost btn-sm" style="margin-bottom:var(--space-lg)"
          onclick="musicTabSwitch('artists')">← Back to Artists</button>
        <div class="artist-header">
          ${a.bannerUrl
            ? `<img class="artist-banner" src="${escapeHtml(a.bannerUrl)}" alt="">`
            : '<div class="artist-banner-placeholder"></div>'}
          <div class="artist-info-overlay">
            <div class="artist-avatar">
              ${a.avatarUrl ? `<img src="${escapeHtml(a.avatarUrl)}" alt="">` : '🎤'}
            </div>
            <div style="flex:1;min-width:0">
              <h2 style="font-family:var(--font-display);letter-spacing:0.1em;margin-bottom:4px">
                ${escapeHtml(a.name || 'Unknown Artist')}
                ${a.isVerified ? '<span style="color:var(--neon-blue);font-size:0.7em"> ✓</span>' : ''}
              </h2>
              ${a.genres?.length ? `<p style="color:var(--text-muted);font-size:0.82rem">${a.genres.map(escapeHtml).join(', ')}</p>` : ''}
            </div>
          </div>
        </div>
        ${a.biography ? `<div class="card" style="margin-bottom:var(--space-xl)"><p style="font-size:0.88rem;line-height:1.7;color:var(--text-secondary)">${escapeHtml(a.biography)}</p></div>` : ''}

        <!-- External links -->
        ${(a.spotifyUrl || a.appleMusicUrl || a.youtubeMusicUrl || a.amazonMusicUrl) ? `
          <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;margin-bottom:var(--space-xl)">
            ${a.spotifyUrl ? `<a href="${escapeHtml(a.spotifyUrl)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="color:#1db954;border-color:#1db954">🟢 Spotify</a>` : ''}
            ${a.youtubeMusicUrl ? `<a href="${escapeHtml(a.youtubeMusicUrl)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="color:#ff0000;border-color:#ff0000">▶ YouTube Music</a>` : ''}
            ${a.appleMusicUrl ? `<a href="${escapeHtml(a.appleMusicUrl)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="color:#fc3c44;border-color:#fc3c44">🍎 Apple Music</a>` : ''}
            ${a.amazonMusicUrl ? `<a href="${escapeHtml(a.amazonMusicUrl)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="color:#00a8e1;border-color:#00a8e1">🎵 Amazon</a>` : ''}
          </div>` : ''}

        ${a.topTracks?.length ? `
          <div class="section-header"><h3 class="section-title">TOP TRACKS</h3></div>
          <div class="music-track-list" style="margin-bottom:var(--space-xl)">
            ${a.topTracks.map((t, i) => renderTrackRow(t, i, a.topTracks, 'artist_' + id)).join('')}
          </div>` : ''}

        ${a.albums?.length ? `
          <div class="section-header"><h3 class="section-title">ALBUMS</h3></div>
          <div class="music-card-grid">
            ${a.albums.map(renderAlbumCard).join('')}
          </div>` : ''}
      </div>`;
  } catch (err) {
    console.warn('[AVN] Artist load error:', err);
    el.innerHTML = renderMusicError('This artist page is temporarily unavailable.', () => musicOpenArtist(id));
  }
};

window.musicOpenPlaylist = function (id) {
  const playlists = LS.get('lu_music_playlists', []);
  const pl = playlists.find(p => p.id === id);
  if (!pl) { Toast.error('Playlist not found'); return; }

  const el = document.getElementById('music-content');
  if (!el) return;

  const tracks = (pl.tracks || []).map(tid => MP.queue.find(t => t.id === tid)).filter(Boolean);

  el.innerHTML = `
    <div>
      <button class="btn btn-ghost btn-sm" style="margin-bottom:var(--space-lg)"
        onclick="musicTabSwitch('playlists')">← Back to Playlists</button>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-lg);flex-wrap:wrap;gap:var(--space-sm)">
        <div>
          <h2 style="font-family:var(--font-display);letter-spacing:0.08em;margin-bottom:4px">${escapeHtml(pl.name)}</h2>
          <p style="color:var(--text-muted);font-size:0.85rem">${tracks.length} track${tracks.length!==1?'s':''}</p>
        </div>
        <div style="display:flex;gap:var(--space-sm)">
          <button class="btn btn-green btn-sm" onclick="musicPlayPlaylistTracks(${JSON.stringify(tracks.map((_,i)=>MP.queue.indexOf(tracks[i])))})">▶ Play All</button>
          <button class="btn btn-outline btn-sm" onclick="mpShufflePlaylist(${JSON.stringify(tracks.map((_,i)=>MP.queue.indexOf(tracks[i])))})">⇄ Shuffle</button>
        </div>
      </div>
      ${!tracks.length
        ? `<div class="music-empty"><span class="music-empty-icon">📂</span><p>No tracks in this playlist yet.</p><p style="font-size:0.82rem">Import music and tap + on tracks to add them.</p></div>`
        : `<div class="music-track-list">${tracks.map((t) => renderLocalTrackRow(t, MP.queue.indexOf(t))).join('')}</div>`}
    </div>`;
};

window.musicPlayPlaylistTracks = function (indices) {
  if (!indices.length) { Toast.info('Playlist is empty'); return; }
  const valid = indices.filter(i => i >= 0 && i < MP.queue.length);
  if (!valid.length) { Toast.info('No tracks in queue for this playlist'); return; }
  mpLoadTrack(valid[0]);
};

window.musicPlayAlbumTracks = function (tracks) {
  if (!tracks || !tracks.length) { Toast.info('No tracks in album'); return; }
  Toast.info('Album playback requires tracks to have audio files (fileUrl). Connect storage to enable.');
};

window.musicAddAlbumToPlaylist = function (tracks) {
  Toast.info('Add album to playlist feature coming with full backend storage integration.');
};

// ─── Playlist management ──────────────────────────────────────

window.musicCreatePlaylistModal = function () {
  Modal.create({
    id: 'create-playlist-modal',
    title: 'New Playlist',
    body: `
      <div class="form-group">
        <label class="form-label">Playlist Name</label>
        <input class="form-input" id="new-pl-name" placeholder="e.g. AVENORA HITS" maxlength="200" autofocus>
      </div>
      <div class="form-group">
        <label class="form-label">Description (optional)</label>
        <input class="form-input" id="new-pl-desc" placeholder="Short description" maxlength="500">
      </div>`,
    actions: [
      { label: 'Cancel', class: 'btn-outline', onclick: `Modal.close('create-playlist-modal')` },
      { label: 'Create', class: 'btn-green', onclick: `musicConfirmCreatePlaylist()` },
    ],
  });
  Modal.open('create-playlist-modal');
  setTimeout(() => document.getElementById('new-pl-name')?.focus(), 100);
};

window.musicConfirmCreatePlaylist = function () {
  const name = document.getElementById('new-pl-name')?.value.trim();
  if (!name) { Toast.error('Please enter a playlist name'); return; }
  const playlists = LS.get('lu_music_playlists', []);
  const newPl = {
    id: `pl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    description: document.getElementById('new-pl-desc')?.value.trim() || '',
    tracks: [],
    visibility: 'private',
    createdAt: new Date().toISOString(),
  };
  playlists.push(newPl);
  LS.set('lu_music_playlists', playlists);
  Modal.close('create-playlist-modal');
  Toast.success(`Playlist "${name}" created!`);
  musicTabSwitch('playlists');
};

window.musicRenamePlaylist = function (id, currentName) {
  Modal.create({
    id: 'rename-pl-modal',
    title: 'Rename Playlist',
    body: `<div class="form-group"><label class="form-label">New Name</label>
      <input class="form-input" id="rename-pl-input" value="${escapeHtml(currentName)}" maxlength="200"></div>`,
    actions: [
      { label: 'Cancel', class: 'btn-outline', onclick: `Modal.close('rename-pl-modal')` },
      { label: 'Rename', class: 'btn-green', onclick: `musicConfirmRenamePlaylist('${id}')` },
    ],
  });
  Modal.open('rename-pl-modal');
};

window.musicConfirmRenamePlaylist = function (id) {
  const name = document.getElementById('rename-pl-input')?.value.trim();
  if (!name) { Toast.error('Name cannot be empty'); return; }
  const playlists = LS.get('lu_music_playlists', []);
  const pl = playlists.find(p => p.id === id);
  if (pl) { pl.name = name; LS.set('lu_music_playlists', playlists); }
  Modal.close('rename-pl-modal');
  Toast.success('Playlist renamed');
  musicTabSwitch('playlists');
};

window.musicDeletePlaylist = function (id, name) {
  if (!confirm(`Delete playlist "${name}"? This cannot be undone.`)) return;
  const playlists = LS.get('lu_music_playlists', []).filter(p => p.id !== id);
  LS.set('lu_music_playlists', playlists);
  Toast.success('Playlist deleted');
  musicTabSwitch('playlists');
};

window.musicAddToPlaylistModal = function (trackId, trackName) {
  const playlists = LS.get('lu_music_playlists', []);
  if (!playlists.length) {
    if (confirm('No playlists yet. Create one now?')) musicCreatePlaylistModal();
    return;
  }
  Modal.create({
    id: 'add-to-pl-modal',
    title: `Add to Playlist`,
    body: `
      <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:var(--space-md)">${escapeHtml(trackName)}</p>
      <div style="display:flex;flex-direction:column;gap:var(--space-xs)">
        ${playlists.map(p => `
          <button class="btn btn-outline w-full" style="text-align:left;justify-content:flex-start"
            onclick="musicConfirmAddToPlaylist('${p.id}','${trackId}','${escapeHtml(p.name)}')">
            📂 ${escapeHtml(p.name)}
            <span style="color:var(--text-muted);font-size:0.78rem;margin-left:auto">${(p.tracks||[]).length} tracks</span>
          </button>`).join('')}
      </div>`,
    actions: [
      { label: 'New Playlist', class: 'btn-green', onclick: `Modal.close('add-to-pl-modal');musicCreatePlaylistModal()` },
    ],
  });
  Modal.open('add-to-pl-modal');
};

window.musicConfirmAddToPlaylist = function (playlistId, trackId, playlistName) {
  const playlists = LS.get('lu_music_playlists', []);
  const pl = playlists.find(p => p.id === playlistId);
  if (!pl) { Toast.error('Playlist not found'); return; }
  if (!pl.tracks) pl.tracks = [];
  if (!pl.tracks.includes(trackId)) {
    pl.tracks.push(trackId);
    LS.set('lu_music_playlists', playlists);
    Toast.success(`Added to ${playlistName}`);
  } else {
    Toast.info('Already in this playlist');
  }
  Modal.close('add-to-pl-modal');
};

window.musicPlayLocalPlaylist = function (id) {
  const playlists = LS.get('lu_music_playlists', []);
  const pl = playlists.find(p => p.id === id);
  if (!pl || !pl.tracks || !pl.tracks.length) { Toast.info('Playlist is empty'); return; }
  const indices = pl.tracks
    .map(tid => MP.queue.findIndex(t => t.id === tid))
    .filter(i => i >= 0);
  if (!indices.length) { Toast.info('No imported tracks in this playlist'); return; }
  mpLoadTrack(indices[0]);
};

window.mpShufflePlaylist = function (indices) {
  if (!indices || !indices.length) { Toast.info('Nothing to shuffle'); return; }
  const valid = indices.filter(i => i >= 0 && i < MP.queue.length);
  if (!valid.length) return;
  const shuffled = [...valid].sort(() => Math.random() - 0.5);
  mpLoadTrack(shuffled[0]);
  Toast.info('Shuffled playlist — playing first track');
};

// ─── MUSIC PLAYER ENGINE ──────────────────────────────────────

const MP = {
  queue:         [],          // local imported tracks
  currentIndex:  -1,
  isPlaying:     false,
  shuffle:       false,
  repeat:        false,
  backendQueue:  null,        // context string for backend tracks
  backendTracks: [],          // full array of backend tracks for auto-advance
  favorites:     [],
  _vizAnim:      null,
  _vizCtx:       null,
  _vizAnalyser:  null,
  _vizSource:    null,
  _audioCtx:     null,
};

function initMusicPlayer() {
  const audio = document.getElementById('mp-audio');
  if (!audio) return;

  MP.favorites = LS.get('lu_mp_favorites', []);
  audio.volume = 0.8;

  audio.addEventListener('ended',        mpHandleEnded);
  audio.addEventListener('timeupdate',   mpUpdateProgress);
  audio.addEventListener('loadedmetadata', mpOnMetadata);
  audio.addEventListener('playing',      () => { MP.isPlaying = true; mpUpdatePlayBtn(); });
  audio.addEventListener('pause',        () => { MP.isPlaying = false; mpUpdatePlayBtn(); });
  audio.addEventListener('waiting',      () => mpSetStatus('Buffering…'));
  audio.addEventListener('canplaythrough', () => mpSetStatus(null));
  audio.addEventListener('error',        mpHandleAudioError);

  // Keyboard shortcuts
  document.addEventListener('keydown', mpKeyHandler);
}

function destroyMusicPlayer() {
  const audio = document.getElementById('mp-audio');
  if (audio) { audio.pause(); audio.src = ''; }
  document.removeEventListener('keydown', mpKeyHandler);
  mpStopVisualizer();
  if (MP._audioCtx) { MP._audioCtx.close(); MP._audioCtx = null; }
}

function mpKeyHandler(e) {
  // Only fire if not focused on an input
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  if (e.key === ' ')       { e.preventDefault(); mpTogglePlay(); }
  if (e.key === 'ArrowRight' && e.altKey) mpNext();
  if (e.key === 'ArrowLeft'  && e.altKey) mpPrev();
}

function mpOnMetadata() {
  const audio = document.getElementById('mp-audio');
  if (!audio) return;
  const dur = formatDuration(audio.duration);
  ['mp-duration', 'mp-duration-m'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = dur;
  });
  // Update duration in track list row
  const durEl = document.getElementById(`mp-ldur-${MP.currentIndex}`);
  if (durEl) durEl.textContent = dur;
}

function mpHandleAudioError(e) {
  const audio = document.getElementById('mp-audio');
  const code = audio?.error?.code;
  const msgs = { 1: 'Playback aborted', 2: 'Network error', 3: 'Decode error', 4: 'Unsupported format' };
  const msg  = msgs[code] || 'Audio error';
  Toast.error(`${msg} — skipping track.`);
  mpUpdatePlayBtn();
  MP.isPlaying = false;

  // Show retry in player
  const titleEl = document.getElementById('mp-title');
  if (titleEl && MP.currentIndex >= 0 && MP.queue[MP.currentIndex]) {
    titleEl.textContent = `⚠ Error: ${msg}`;
  }

  // Auto-advance on network/decode error
  if (code === 2 || code === 3 || code === 4) {
    setTimeout(() => mpNext(), 2000);
  }
}

function mpHandleEnded() {
  if (MP.repeat) { document.getElementById('mp-audio')?.play().catch(()=>{}); return; }

  // Backend tracks mode: auto-advance through backendTracks array
  if (MP.backendTracks && MP.backendTracks.length > 0) {
    const next = MP.currentIndex + 1;
    if (MP.shuffle) {
      const randIdx = Math.floor(Math.random() * MP.backendTracks.length);
      window.mpLoadBackendTrack(MP.backendTracks[randIdx], randIdx, MP.backendQueue);
      return;
    }
    if (next < MP.backendTracks.length) {
      window.mpLoadBackendTrack(MP.backendTracks[next], next, MP.backendQueue);
    }
    // else end of backend queue — stop
    return;
  }

  // Local queue mode
  if (MP.shuffle) { mpLoadTrack(Math.floor(Math.random() * MP.queue.length)); return; }
  const next = MP.currentIndex + 1;
  if (next < MP.queue.length) mpLoadTrack(next);
  // else end of queue — stop
}

window.mpLoadTrack = function (index) {
  if (!MP.queue.length || index < 0 || index >= MP.queue.length) return;
  MP.currentIndex = index;
  MP.backendQueue = null;
  const track     = MP.queue[index];
  const audio     = document.getElementById('mp-audio');
  if (!audio) return;

  audio.src = track.url;

  // Update player UI
  document.getElementById('mp-title').textContent  = track.name;
  document.getElementById('mp-artist').textContent = track.artist || '';

  // Art
  const artEl = document.getElementById('mp-art');
  if (artEl) {
    artEl.innerHTML = '🎵';
    artEl.className = 'mp-art playing';
  }

  // Next label
  const nextTrack = MP.queue[index + 1];
  const nextLabel = document.getElementById('mp-next-label');
  if (nextLabel) {
    if (nextTrack) {
      nextLabel.textContent = `Next: ${nextTrack.name}`;
      nextLabel.classList.remove('hidden');
    } else {
      nextLabel.classList.add('hidden');
    }
  }

  mpUpdateQueueHighlight();
  mpRecordRecentlyPlayed(track);

  // Notify shared music service (DJ System, Cloud Stream, etc.)
  if (typeof MusicService !== 'undefined') MusicService._notifyTrackChange(track);

  audio.play().catch(err => {
    console.warn('[AVN] Audio playback error:', err);
    Toast.error('This track could not be played. Please try another.');
    MP.isPlaying = false;
    mpUpdatePlayBtn();
  });

  mpInitVisualizer(audio);
};

window.mpLoadBackendTrack = async function (track, index, context, tracksArray) {
  if (!track.fileUrl && !track.storagePath) {
    Toast.error('This track is not available for playback.');
    return;
  }
  MP.backendQueue = context;
  MP.currentIndex = index;
  // Store the full tracks array for auto-advance.
  // Priority: explicit tracksArray argument → context registry → keep existing
  if (Array.isArray(tracksArray) && tracksArray.length > 0) {
    MP.backendTracks = tracksArray;
  } else if (context && _mpContextTracks[context] && _mpContextTracks[context].length > 0) {
    MP.backendTracks = _mpContextTracks[context];
  }
  // Note: MP.queue (local imports) is kept separate and unmodified.
  // mpHandleEnded will use backendTracks when it's populated.

  const audio = document.getElementById('mp-audio');
  if (!audio) return;

  // For Firestore-backed cloud tracks the music bucket is public — use fileUrl directly.
  // For MongoDB backend tracks with a storagePath, refresh the signed URL so an expired
  // URL does not cause a 403 on the audio element.
  let playUrl = track.fileUrl;
  if (track.storagePath && track.id && !track._isFirestore) {
    try {
      const refreshed = await LegendAPI.request('GET', `/music/tracks/${track.id}/url`).catch(() => null);
      if (refreshed?.url) playUrl = refreshed.url;
    } catch (_) {}
  }

  if (!playUrl) {
    Toast.error('This track has no audio URL.');
    return;
  }

  audio.src = playUrl;

  document.getElementById('mp-title').textContent  = track.title || 'Unknown';
  document.getElementById('mp-artist').textContent = track.artistName || '';

  const artEl = document.getElementById('mp-art');
  if (artEl) {
    if (track.coverUrl) {
      artEl.innerHTML = `<img src="${escapeHtml(track.coverUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:6px">`;
    } else {
      artEl.innerHTML = '🎵';
    }
    artEl.className = 'mp-art playing';
  }

  audio.play().catch(err => {
    console.warn('[AVN] Backend track playback error:', err);
    Toast.error('This track could not be played. Please try another.');
    MP.isPlaying = false;
    mpUpdatePlayBtn();
  });

  // Record server-side play for MongoDB-backed tracks only (non-critical)
  if (track.id && !track._isFirestore) {
    LegendAPI.request('POST', `/music/tracks/${track.id}/play`).catch(() => {});
  }

  mpInitVisualizer(audio);
};

window.mpTogglePlay = function () {
  const audio = document.getElementById('mp-audio');
  if (!audio) return;
  if (MP.isPlaying) {
    audio.pause();
  } else {
    if (!audio.src && MP.queue.length > 0) {
      mpLoadTrack(Math.max(0, MP.currentIndex));
    } else if (audio.src) {
      audio.play().catch(err => {
        console.warn('[AVN] Track playback error:', err);
        Toast.error('This track could not be played. Please try another.');
      });
    } else {
      Toast.info('Import music files or connect a cloud library to start listening.');
    }
  }
};

window.mpPrev = function () {
  const audio = document.getElementById('mp-audio');
  // If more than 3 seconds played — restart current
  if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }

  // Backend tracks mode
  if (MP.backendTracks && MP.backendTracks.length > 0) {
    const prev = MP.currentIndex <= 0 ? MP.backendTracks.length - 1 : MP.currentIndex - 1;
    window.mpLoadBackendTrack(MP.backendTracks[prev], prev, MP.backendQueue);
    return;
  }

  if (MP.queue.length === 0) return;
  mpLoadTrack(MP.currentIndex <= 0 ? MP.queue.length - 1 : MP.currentIndex - 1);
};

window.mpNext = function () {
  // Backend tracks mode
  if (MP.backendTracks && MP.backendTracks.length > 0) {
    const next = MP.shuffle
      ? Math.floor(Math.random() * MP.backendTracks.length)
      : (MP.currentIndex + 1) % MP.backendTracks.length;
    window.mpLoadBackendTrack(MP.backendTracks[next], next, MP.backendQueue);
    return;
  }

  if (!MP.queue.length) return;
  if (MP.shuffle) { mpLoadTrack(Math.floor(Math.random() * MP.queue.length)); return; }
  const next = (MP.currentIndex + 1) % MP.queue.length;
  mpLoadTrack(next);
};

window.mpToggleShuffle = function () {
  MP.shuffle = !MP.shuffle;
  const btn = document.getElementById('mp-btn-shuffle');
  if (btn) btn.classList.toggle('active', MP.shuffle);
  Toast.info(MP.shuffle ? 'Shuffle on' : 'Shuffle off');
};

window.mpToggleRepeat = function () {
  MP.repeat = !MP.repeat;
  const btn = document.getElementById('mp-btn-repeat');
  if (btn) btn.classList.toggle('active', MP.repeat);
  Toast.info(MP.repeat ? 'Repeat on' : 'Repeat off');
};

window.mpSetVolume = function (val) {
  const audio = document.getElementById('mp-audio');
  if (audio) audio.volume = parseFloat(val) / 100;
};

window.mpSeek = function (e, bar) {
  const audio = document.getElementById('mp-audio');
  if (!audio || !audio.duration) return;
  const rect = bar.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.currentTime = frac * audio.duration;
};

function mpUpdateProgress() {
  const audio = document.getElementById('mp-audio');
  if (!audio || !audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  const cur = formatDuration(audio.currentTime);

  ['mp-seek-fill', 'mp-seek-fill-m'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.width = pct + '%';
  });
  ['mp-current-time', 'mp-current-time-m'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = cur;
  });
}

function mpUpdatePlayBtn() {
  const btn = document.getElementById('mp-btn-play');
  if (btn) btn.textContent = MP.isPlaying ? '⏸' : '▶';
}

function mpSetStatus(msg) {
  const artist = document.getElementById('mp-artist');
  if (!artist) return;
  if (msg) { artist._savedText = artist.textContent; artist.textContent = msg; }
  else if (artist._savedText !== undefined) { artist.textContent = artist._savedText; }
}

function mpUpdateQueueHighlight() {
  document.querySelectorAll('[id^="mp-ltrack-"]').forEach(el => {
    const idx = parseInt(el.id.replace('mp-ltrack-', ''));
    el.classList.toggle('playing', idx === MP.currentIndex);
    const numEl = el.querySelector('.mtrack-num');
    if (numEl) numEl.innerHTML = idx === MP.currentIndex
      ? `<span class="mtrack-playing-icon">♫</span>`
      : `<span>${idx + 1}</span>`;
  });
  mpRenderQueueList();
}

function mpRecordRecentlyPlayed(track) {
  const recent = LS.get('lu_mp_recently_played', []).filter(t => t.id !== track.id);
  recent.unshift({ id: track.id, name: track.name, artist: track.artist || '' });
  LS.set('lu_mp_recently_played', recent.slice(0, 50));
}

// ─── MusicService bridge hooks ────────────────────────────────
// Called by queue-modifying operations to keep MusicService in sync.
function _mpNotifyQueueChange() {
  if (typeof MusicService !== 'undefined') MusicService._notifyQueueChange(MP.queue);
}

// ─── Import ───────────────────────────────────────────────────

window.mpImport = function () {
  const input = document.createElement('input');
  input.type     = 'file';
  input.accept   = 'audio/*';
  input.multiple = true;

  input.onchange = (e) => {
    const files = Array.from(e.target.files || []);
    const ext   = ['.mp3','.wav','.ogg','.flac','.aac','.m4a','.opus'];
    const valid = files.filter(f => ext.some(x => f.name.toLowerCase().endsWith(x)));
    if (!valid.length) { Toast.error('No supported audio files found.'); return; }

    const tracks = valid.map(f => ({
      id:     `lt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name:   f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      artist: '',
      url:    URL.createObjectURL(f),
      _file:  f,
    }));

    MP.queue.push(...tracks);
    mpRenderQueueList();
    _mpNotifyQueueChange();

    // Re-render track list if on library/discover tab
    const listEl = document.getElementById('music-track-list');
    if (listEl) {
      // legacy target — force re-render of content area
      const tab = document.querySelector('.tab-btn.active')?.textContent?.toLowerCase();
      if (tab && (tab.includes('discover') || tab.includes('library'))) {
        musicTabSwitch(tab.includes('discover') ? 'discover' : 'library');
        return;
      }
    }

    // Refresh current tab's track list inline if possible
    const contentEl = document.getElementById('music-content');
    if (contentEl) {
      const tl = contentEl.querySelector('.music-track-list');
      if (tl) {
        tl.insertAdjacentHTML('beforeend', tracks.map((t, i) => renderLocalTrackRow(t, MP.queue.length - tracks.length + i)).join(''));
      }
    }

    Toast.success(`${tracks.length} track${tracks.length !== 1 ? 's' : ''} imported!`);
    if (!MP.isPlaying && MP.currentIndex === -1) mpLoadTrack(0);
  };

  input.click();
};

// ─── Queue panel ──────────────────────────────────────────────

window.mpToggleQueue = function () {
  document.getElementById('mp-queue-panel')?.classList.toggle('open');
};

function mpRenderQueueList() {
  const el = document.getElementById('mp-queue-list');
  if (!el) return;
  if (!MP.queue.length) {
    el.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:var(--space-lg) 0">Queue empty</p>`;
    return;
  }
  el.innerHTML = MP.queue.map((t, i) => `
    <div class="mtrack-row ${i === MP.currentIndex ? 'playing' : ''}" onclick="mpLoadTrack(${i})">
      <div class="mtrack-num" style="font-size:0.72rem">${i === MP.currentIndex ? '♫' : i + 1}</div>
      <div class="mtrack-info">
        <div class="mtrack-title" style="font-size:0.82rem">${escapeHtml(t.name)}</div>
      </div>
      <button class="mp-icon-btn" style="font-size:0.78rem;padding:2px 6px"
        onclick="event.stopPropagation();mpRemoveFromQueue(${i})" title="Remove">✕</button>
    </div>`).join('');
}

window.mpRemoveFromQueue = function (index) {
  if (index < 0 || index >= MP.queue.length) return;
  // Revoke object URL to free memory
  if (MP.queue[index].url?.startsWith('blob:')) URL.revokeObjectURL(MP.queue[index].url);
  MP.queue.splice(index, 1);
  if (MP.currentIndex >= index) MP.currentIndex = Math.max(-1, MP.currentIndex - 1);
  mpRenderQueueList();
};

window.mpPlayAll = function (indices) {
  if (!indices || !indices.length) return;
  const valid = Array.isArray(indices) ? indices.filter(i => i >= 0 && i < MP.queue.length) : [];
  if (valid.length) mpLoadTrack(valid[0]);
};

// ─── Favorites ────────────────────────────────────────────────

window.mpToggleFavorite = function (trackId) {
  const favs = LS.get('lu_mp_favorites', []);
  const idx  = favs.indexOf(trackId);
  if (idx === -1) {
    favs.push(trackId);
    LS.set('lu_mp_favorites', favs);
    Toast.success('Added to favorites ♥');
  } else {
    favs.splice(idx, 1);
    LS.set('lu_mp_favorites', favs);
    Toast.info('Removed from favorites');
  }
  MP.favorites = favs;
  // Toggle button state inline
  const btn = document.querySelector(`button[onclick*="mpToggleFavorite('${trackId}')"]`);
  if (btn) btn.classList.toggle('active', idx === -1);
};

window.mpToggleBackendFavorite = async function (trackId) {
  if (!LegendAPI.auth.isLoggedIn()) {
    Toast.info('Sign in to save favorites to the cloud.');
    // Still save locally
    mpToggleFavorite(String(trackId));
    return;
  }
  try {
    const res  = await LegendAPI.music.like(trackId);
    const liked = res.liked;
    Toast[liked ? 'success' : 'info'](liked ? 'Added to favorites ♥' : 'Removed from favorites');
  } catch (err) {
    console.warn('[AVN] Favorite error:', err);
    Toast.error('Something went wrong. Please try again.');
  }
};

// ─── Visualizer ───────────────────────────────────────────────

function mpInitVisualizer(audioEl) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.getElementById('mp-mini-viz');
  if (!canvas) return;

  mpStopVisualizer();

  try {
    if (!MP._audioCtx) {
      MP._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (MP._audioCtx.state === 'suspended') MP._audioCtx.resume();

    if (!MP._vizSource) {
      MP._vizSource = MP._audioCtx.createMediaElementSource(audioEl);
    }
    MP._vizAnalyser = MP._audioCtx.createAnalyser();
    MP._vizAnalyser.fftSize = 64;
    MP._vizSource.connect(MP._vizAnalyser);
    MP._vizAnalyser.connect(MP._audioCtx.destination);

    MP._vizCtx = canvas.getContext('2d');
    mpDrawVisualizer();
  } catch {
    // AudioContext blocked or unsupported — silent fallback
  }
}

function mpDrawVisualizer() {
  if (!MP._vizAnalyser || !MP._vizCtx) return;
  const canvas  = document.getElementById('mp-mini-viz');
  if (!canvas) return;

  const analyser = MP._vizAnalyser;
  const ctx      = MP._vizCtx;
  const W = canvas.width;
  const H = canvas.height;
  const bufLen   = analyser.frequencyBinCount;
  const dataArr  = new Uint8Array(bufLen);

  function draw() {
    MP._vizAnim = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArr);

    ctx.clearRect(0, 0, W, H);

    const barW = (W / bufLen) * 2.2;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const v  = dataArr[i] / 255;
      const bH = v * H;
      // Blue-green gradient based on amplitude
      const r = Math.round(0   + v * 0);
      const g = Math.round(170 + v * 85);
      const b = Math.round(255 - v * 100);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, H - bH, barW - 1, bH);
      x += barW + 1;
    }
  }
  draw();
}

function mpStopVisualizer() {
  if (MP._vizAnim) { cancelAnimationFrame(MP._vizAnim); MP._vizAnim = null; }
  if (MP._vizAnalyser) {
    try { MP._vizAnalyser.disconnect(); } catch {}
    MP._vizAnalyser = null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function renderMusicError(msg, onRetry) {
  return `
    <div class="error-state" style="min-height:30vh">
      <div class="error-icon">⚠️</div>
      <h3>Something went wrong</h3>
      <p>${escapeHtml(msg || 'Unknown error')}</p>
      <button class="btn btn-outline" onclick="(${onRetry.toString()})()">Try Again</button>
    </div>`;
}
