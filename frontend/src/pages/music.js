/**
 * AVENORA MUSIC HUB — music.js
 * 🌌 COSMIC MUSIC UNIVERSE — Full listening & discovery platform.
 *
 * Features:
 *   - HTML5 Audio player (real playback only — no fake play state)
 *   - Import local files (MP3, WAV, OGG, FLAC, AAC, M4A, OPUS)
 *   - Backend library (tracks, albums, artists)
 *   - 12 Cosmic system playlists + Avenora Cloud Radio playlist
 *   - Playlists (create, rename, reorder, delete, play)
 *   - Per-track ⋮ context menu (play, add to playlist, like, view album/artist)
 *   - Favorites (local + synced to backend when logged in)
 *   - Recently played (local + backend)
 *   - Global search bar integrated in Discover
 *   - Genre filters & cosmic genre explorer
 *   - Upload form with post-upload "Add to Sound World" prompt
 *   - 📻 AVENORA 24-HOUR CLOUD RADIO inline card (Firestore live, listener count)
 *   - Audio-reactive visualizer
 *   - DJ System integration bridge
 *   - Mobile-first, touch-friendly
 */

registerPage('music', {
  async render(container) {
    musicEnsureSystemPlaylists();
    container.innerHTML = buildMusicShell();
    initMusicPlayer();
    await musicTabSwitch('discover');
    return () => destroyMusicPlayer();
  }
});

// ─── Cosmic System Playlists ────────────────────────────────
// Created once in localStorage on first visit. Never duplicated.
// Each playlist has a stable sysId — never recreated on login.
const SYSTEM_PLAYLISTS = [
  { sysId: 'sys-cosmic',    name: '🌌 Cosmic Frequency',  icon: '🌌', color: '#00ccff',            description: 'The gateway to the Avenora music universe' },
  { sysId: 'sys-midnight',  name: '🌙 Midnight Eclipse',  icon: '🌙', color: '#7c5cd8',             description: 'Dark, emotional, late-night music' },
  { sysId: 'sys-neon',      name: '⚡ Neon Rush',          icon: '⚡', color: '#39ff14',             description: 'High-energy music' },
  { sysId: 'sys-shadow',    name: '🔥 Shadowfire',         icon: '🔥', color: '#ff4400',             description: 'Rock, metal, hard-hitting music' },
  { sysId: 'sys-greenlight',name: '💚 Greenlight Vibes',  icon: '💚', color: '#00e676',             description: 'Positive, uplifting and feel-good music' },
  { sysId: 'sys-deepspace', name: '🌊 Deep Space Drift',  icon: '🌊', color: '#0088bb',             description: 'Relaxing, chill, atmospheric music' },
  { sysId: 'sys-darkmatter',name: '🖤 Dark Matter',        icon: '🖤', color: '#aa44ff',             description: 'Dark, mysterious and atmospheric' },
  { sysId: 'sys-hyperdrive',name: '🚀 Hyperdrive',         icon: '🚀', color: '#00ccff',             description: 'Fast, energetic — workout and driving music' },
  { sysId: 'sys-starlight', name: '💫 Starlight Sessions', icon: '💫', color: '#ffd060',             description: 'Smooth, melodic and beautiful music' },
  { sysId: 'sys-hiphop',    name: '🎤 Cosmic Hip-Hop',    icon: '🎤', color: '#00ccff',             description: 'Hip-hop and rap' },
  { sysId: 'sys-rock',      name: '🎸 Electric Galaxy',   icon: '🎸', color: '#ff6600',             description: 'Rock and alternative music' },
  { sysId: 'sys-aftermidnight', name: '🕯️ After Midnight',icon: '🕯️', color: '#c9a84c',            description: 'Emotional, reflective and slower music' },
  { sysId: 'sys-radio',     name: '📻 Avenora Cloud Radio',icon: '📻', color: 'var(--avenora-gold)', description: 'Official 24/7 radio station playlist', isRadio: true },
];

function musicEnsureSystemPlaylists() {
  const existing = LS.get('lu_music_playlists', []);
  const existingSysIds = new Set(existing.map(p => p.sysId).filter(Boolean));
  let changed = false;
  for (const sp of SYSTEM_PLAYLISTS) {
    if (!existingSysIds.has(sp.sysId)) {
      existing.push({
        id:          sp.sysId,
        sysId:       sp.sysId,
        name:        sp.name,
        icon:        sp.icon,
        color:       sp.color,
        description: sp.description,
        isRadio:     sp.isRadio || false,
        isSystem:    true,
        tracks:      [],
        visibility:  sp.isRadio ? 'private' : 'private',
        createdAt:   new Date().toISOString(),
      });
      changed = true;
    }
  }
  if (changed) LS.set('lu_music_playlists', existing);
}

// ─── Shell HTML ──────────────────────────────────────────────
function buildMusicShell() {
  return `
    <!-- ✦ COSMIC HERO ✦ -->
    <div class="music-hero">
      <div class="music-hero-bg"></div>
      <div class="music-hero-stars" aria-hidden="true"></div>
      <div class="music-ambient-flame"></div>
      <div class="music-hub-hero-content">
        <div class="music-hub-badge">🎵 AVENORA MUSIC</div>
        <h1 class="music-hub-title">
          <span class="mh-title-avenora">ENTER THE</span>
          <span class="mh-title-music"> SOUND UNIVERSE</span>
        </h1>
        <p class="music-hub-tagline">Discover music. Build your world. Tune into the universe.</p>

        <!-- Hero search -->
        <div class="music-hero-search">
          <div class="mh-search-inner">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="search" id="discover-search-input" placeholder="🔍  Search the music universe…"
                   aria-label="Search music"
                   oninput="musicDiscoverSearch(this.value)"
                   onfocus="musicTabSwitch('search')">
          </div>
        </div>
      </div>
    </div>

    <div class="container-lg" style="padding-bottom:var(--space-3xl)">

      <!-- ✦ Cosmic Nav Cards ✦ -->
      <div class="music-cosmic-nav" aria-label="Music sections">
        <button class="mcn-card" onclick="musicTabSwitch('discover',document.querySelectorAll('.music-hub-tab-btn')[0])">
          <span class="mcn-icon">🌌</span>
          <span class="mcn-title">DISCOVER</span>
          <span class="mcn-sub">Explore the music universe</span>
        </button>
        <button class="mcn-card mcn-music" onclick="musicTabSwitch('library',document.querySelectorAll('.music-hub-tab-btn')[2])">
          <span class="mcn-icon">🎧</span>
          <span class="mcn-title">YOUR MUSIC</span>
          <span class="mcn-sub">Your personal collection</span>
        </button>
        <button class="mcn-card mcn-playlists" onclick="musicTabSwitch('playlists',document.querySelectorAll('.music-hub-tab-btn')[3])">
          <span class="mcn-icon">📂</span>
          <span class="mcn-title">SOUND WORLDS</span>
          <span class="mcn-sub">Your cosmic playlists</span>
        </button>
        <button class="mcn-card mcn-radio" onclick="musicTabSwitch('radio',document.querySelectorAll('.music-hub-tab-btn')[1])">
          <span class="mcn-icon">📻</span>
          <span class="mcn-title">CLOUD RADIO</span>
          <span class="mcn-sub">Non-stop music 24/7</span>
        </button>
        <button class="mcn-card mcn-upload" onclick="musicTabSwitch('upload',document.querySelectorAll('.music-hub-tab-btn')[9])">
          <span class="mcn-icon">⬆</span>
          <span class="mcn-title">UPLOAD</span>
          <span class="mcn-sub">Add music to the universe</span>
        </button>
      </div>

      <!-- ✦ Sticky Player ✦ -->
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
                   oninput="mpSetVolume(this.value)" aria-label="Volume" style="flex:1;accent-color:#00ccff">
          </div>
        </div>
      </div>

      <!-- ✦ Tabs ✦ -->
      <div class="tabs music-hub-tabs" role="tablist" style="margin-bottom:var(--space-xl)">
        ${[
          ['discover',  '🌌 Discover'],
          ['radio',     '📻 Radio'],
          ['library',   '🎵 Songs'],
          ['playlists', '📂 Sound Worlds'],
          ['albums',    '💿 Albums'],
          ['artists',   '🎤 Artists'],
          ['favorites', '❤️ Liked'],
          ['recent',    '🕘 Recent'],
          ['search',    '🔍 Search'],
          ['upload',    '⬆ Upload'],
          ['external',  '🔗 Services'],
        ].map(([id, label], i) =>
          `<button class="tab-btn music-hub-tab-btn${i===0?' active':''}" role="tab"
             onclick="musicTabSwitch('${id}',this)">${label}</button>`
        ).join('')}
      </div>

      <!-- Content -->
      <div id="music-content"></div>
    </div>

    <!-- Queue panel (slide-in) -->
    <div class="music-queue-panel" id="mp-queue-panel" aria-label="Playback queue">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h4 style="font-family:var(--font-display);letter-spacing:0.1em;margin:0;color:#00ccff">⚡ QUEUE</h4>
        <button class="mp-icon-btn" onclick="mpToggleQueue()">✕</button>
      </div>
      <button class="btn btn-cosmic btn-sm w-full" onclick="mpImport()">📂 Import Music Files</button>
      <div id="mp-queue-list" style="flex:1;overflow-y:auto">
        <p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:var(--space-lg) 0">Queue empty</p>
      </div>
    </div>

    <!-- Track context menu (shared) -->
    <div id="music-track-menu" class="music-track-ctx-menu hidden" role="menu"></div>

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

  // Clean up any active real-time listeners from previous tab
  if (typeof _radioTabCleanup === 'function') _radioTabCleanup();

  el.innerHTML = `<div class="loading-state" style="min-height:40vh"><div class="spinner"></div></div>`;

  try {
    switch (tab) {
      case 'discover':        el.innerHTML = await renderDiscover();        break;
      case 'radio':           el.innerHTML = await renderRadioTab();        break;
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
        <div class="section-header">
          <h2 class="section-title cosmic-section-title">🔥 TRENDING NOW</h2>
        </div>
        <div class="music-track-list" style="margin-bottom:var(--space-xl)">
          ${tracksData.tracks.map((t, i) => renderTrackRow(t, i, tracksData.tracks, 'popular')).join('')}
        </div>`;
    }

    if (albumsData.albums && albumsData.albums.length > 0) {
      albumSection = `
        <div class="section-header">
          <h2 class="section-title cosmic-section-title">✨ NEW IN THE GALAXY</h2>
        </div>
        <div class="music-card-grid" style="margin-bottom:var(--space-xl)">
          ${albumsData.albums.map(a => renderAlbumCard(a)).join('')}
        </div>`;
    }
  } catch { /* backend not connected — show local library instead */ }

  // Local imported tracks
  const localSection = MP.queue.length > 0 ? `
    <div class="section-header">
      <h2 class="section-title cosmic-section-title">🎧 YOUR LIBRARY</h2>
    </div>
    <div class="music-track-list" style="margin-bottom:var(--space-xl)">
      ${MP.queue.map((t, i) => renderLocalTrackRow(t, i)).join('')}
    </div>` : '';

  const noContent = !trackSection && !albumSection && !localSection;

  return `
    <div>
      <!-- 📻 Cosmic Radio Teaser Portal -->
      <div class="music-radio-portal" onclick="musicTabSwitch('radio',document.querySelectorAll('.music-hub-tab-btn')[1])"
           role="button" tabindex="0" onkeydown="if(event.key==='Enter')musicTabSwitch('radio')">
        <div class="mrp-glow" aria-hidden="true"></div>
        <div class="mrp-left">
          <div class="mrp-badge">
            <span class="radio-on-air-dot" style="width:8px;height:8px"></span>
            ON AIR
          </div>
          <div class="mrp-name">📻 AVENORA 24-HOUR CLOUD RADIO</div>
          <div class="mrp-sub" id="discover-radio-np">Non-stop music • No skipping</div>
        </div>
        <button class="mrp-listen-btn" onclick="event.stopPropagation();musicTabSwitch('radio',document.querySelectorAll('.music-hub-tab-btn')[1])">
          ▶ LISTEN LIVE
        </button>
      </div>

      <!-- 🌌 Explore the Universe — section grid -->
      <div class="section-header" style="margin-top:var(--space-xl)">
        <h2 class="section-title cosmic-section-title">🌌 EXPLORE THE UNIVERSE</h2>
      </div>
      <div class="music-explore-grid">
        <button class="mex-card" onclick="musicTabSwitch('favorites',document.querySelectorAll('.music-hub-tab-btn')[6])">
          <span>❤️</span><span>Favorites</span>
        </button>
        <button class="mex-card" onclick="musicTabSwitch('recent',document.querySelectorAll('.music-hub-tab-btn')[7])">
          <span>🕘</span><span>Recent Orbits</span>
        </button>
        <button class="mex-card" onclick="musicTabSwitch('albums',document.querySelectorAll('.music-hub-tab-btn')[4])">
          <span>💿</span><span>Album Galaxy</span>
        </button>
        <button class="mex-card" onclick="musicTabSwitch('artists',document.querySelectorAll('.music-hub-tab-btn')[5])">
          <span>🎤</span><span>Artist Constellations</span>
        </button>
        <button class="mex-card" onclick="musicTabSwitch('library',document.querySelectorAll('.music-hub-tab-btn')[2])">
          <span>🎵</span><span>All Songs</span>
        </button>
        <button class="mex-card" onclick="musicTabSwitch('upload',document.querySelectorAll('.music-hub-tab-btn')[9])">
          <span>⬆</span><span>Upload Music</span>
        </button>
      </div>

      ${noContent ? renderDiscoverEmpty() : ''}
      ${localSection}
      ${trackSection}
      ${albumSection}

      <!-- 🌌 Sound Worlds preview -->
      ${renderPlaylistCards()}
    </div>
  `;
}

// Kick off a background fetch of radio now-playing for the teaser card
(function _discoverRadioNP() {
  setTimeout(async () => {
    const el = document.getElementById('discover-radio-np');
    if (!el) return;
    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (getFirestore) {
        const db   = await getFirestore();
        const snap = await db.collection('stationNowPlaying').doc('avenoraRadio').get();
        if (snap.exists) {
          const d = snap.data();
          if (d.currentTitle) {
            el.textContent = `${d.currentTitle}${d.currentArtist ? ' — ' + d.currentArtist : ''}`;
            return;
          }
        }
      }
    } catch {}
    // Fallback to API
    try {
      const apiBase = (window.LU_CONFIG?.apiUrl || '').replace(/\/$/, '');
      const data = await fetch(`${apiBase}/radio/status`).then(r => r.json());
      if (data?.currentTrack?.title) {
        el.textContent = `${data.currentTrack.title}${data.currentTrack.artist ? ' — ' + data.currentTrack.artist : ''}`;
        return;
      }
    } catch {}
    el.textContent = '24 hours a day • 7 days a week';
  }, 800);
}());

window.musicDiscoverSearch = function (q) {
  if (q && q.trim().length >= 2) {
    musicTabSwitch('search');
    setTimeout(() => {
      const inp = document.getElementById('music-search-input');
      if (inp) { inp.value = q; musicSearch(q); }
    }, 100);
  }
};

function renderDiscoverEmpty() {
  return `
    <div class="cosmic-empty-card" style="margin-bottom:var(--space-xl)">
      <div class="cosmic-empty-icon">🌌</div>
      <h3 class="cosmic-empty-title">YOUR UNIVERSE AWAITS</h3>
      <p class="cosmic-empty-sub">
        Import your own music or upload tracks to begin your journey through the sound universe.
      </p>
      <ul style="color:var(--text-muted);font-size:0.82rem;text-align:left;margin:var(--space-sm) auto var(--space-lg);max-width:360px;line-height:2">
        <li>🎵 Supported: MP3, WAV, OGG, FLAC, AAC, M4A, OPUS</li>
        <li>☁️ Upload to your cloud library from the Upload tab</li>
      </ul>
      <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;justify-content:center">
        <button class="btn btn-cosmic" onclick="mpImport()">📂 Import Local Files</button>
        <button class="btn btn-cosmic-outline" onclick="musicTabSwitch('upload')">⬆ Upload Track</button>
      </div>
    </div>`;
}

// ─── RADIO TAB ────────────────────────────────────────────
// Shows the Avenora Radio card inline in the Music Hub with a real-time
// Firestore onSnapshot listener that updates Now Playing/listener count without
// re-rendering the whole tab. Falls back to API polling if Firestore is unavailable.

let _radioTabUnsub = null; // cleanup handle for the onSnapshot subscription

function _radioTabCleanup() {
  if (_radioTabUnsub) { try { _radioTabUnsub(); } catch {} _radioTabUnsub = null; }
}

function _renderRadioCardContent(d) {
  // d is the Firestore document data (stationNowPlaying/avenoraRadio)
  const isPlaying   = d?.status === 'playing';
  const title       = d?.currentTitle  || '';
  const artist      = d?.currentArtist || '';
  const coverUrl    = d?.currentCoverUrl || null;
  const upcoming    = (d?.upcoming || []).slice(0, 4);
  const stationName = d?.stationName || 'AVENORA RADIO';
  const plLen       = d?.playlistLength || 0;
  const listeners   = d?.listenerCount  || 0;

  const artHtml = coverUrl
    ? `<img src="${escapeHtml(coverUrl)}" alt="Cover"
           style="width:100%;height:100%;object-fit:cover;border-radius:inherit"
           onerror="this.parentElement.innerHTML='🎵'">`
    : '🎵';

  const nowPlayingSection = title ? `
    <div class="music-radio-body">
      <div class="music-radio-np-art">${artHtml}</div>
      <div class="music-radio-np-info">
        <div class="music-radio-np-title">${escapeHtml(title)}</div>
        ${artist ? `<div class="music-radio-np-artist">${escapeHtml(artist)}</div>` : ''}
        ${listeners > 0 ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px">👥 ${listeners} listener${listeners!==1?'s':''}</div>` : ''}
      </div>
      <button class="music-radio-listen-btn" onclick="navigateTo('radio')">▶ LISTEN LIVE</button>
    </div>` : `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-md)">
      <div style="color:var(--text-muted);font-size:0.85rem">
        ${isPlaying === false && d ? 'Station is paused.' : 'Waiting for station data…'}
      </div>
      <button class="music-radio-listen-btn" onclick="navigateTo('radio')">📻 OPEN RADIO</button>
    </div>`;

  const upcomingSection = upcoming.length ? `
    <div class="music-radio-upcoming">
      <div class="music-radio-upcoming-title">NEXT UP</div>
      <div class="music-radio-upcoming-list">
        ${upcoming.map((t, i) => `
          <div class="music-radio-upcoming-item">
            <span class="num">${i + 1}.</span>
            <span>${escapeHtml(t.title || 'Untitled')}</span>
            ${t.artist ? `<span style="color:var(--text-muted)"> — ${escapeHtml(t.artist)}</span>` : ''}
          </div>`).join('')}
      </div>
    </div>` : '';

  return `
    <div class="music-radio-header">
      <div class="music-radio-title">${escapeHtml(stationName)}</div>
      <div style="display:flex;align-items:center;gap:8px">
        ${isPlaying ? `
          <span class="radio-live-badge" style="font-size:0.6rem;padding:2px 8px">
            <span class="radio-on-air-dot" style="width:6px;height:6px"></span>
            ON AIR
          </span>` : `<span style="font-size:0.72rem;color:var(--text-muted);letter-spacing:0.18em">${d ? 'PAUSED' : 'LOADING'}</span>`}
        ${plLen ? `<span style="font-size:0.65rem;color:rgba(0,160,255,0.45);letter-spacing:0.2em">${plLen} TRACKS</span>` : ''}
      </div>
    </div>
    ${nowPlayingSection}
    ${upcomingSection}`;
}

async function renderRadioTab() {
  // Render a cosmic broadcast portal shell immediately
  const html = `
    <div>
      <!-- COSMIC BROADCAST PORTAL -->
      <div class="cosmic-radio-portal" id="music-radio-tab-card"
           onclick="navigateTo('radio')" role="button" tabindex="0"
           onkeydown="if(event.key==='Enter')navigateTo('radio')"
           aria-label="Open Avenora Radio Station">
        <div class="crp-header">
          <div class="crp-station-name">📻 AVENORA RADIO</div>
          <div class="crp-onair-badge" id="crp-onair-badge">
            <span class="radio-on-air-dot"></span> LOADING…
          </div>
        </div>
        <div id="music-radio-tab-inner" class="crp-body">
          <div class="crp-art-placeholder">📻</div>
          <div class="crp-np-label">NOW PLAYING</div>
          <div class="crp-track-title" id="crp-track-title">Connecting to station…</div>
          <div class="crp-track-artist" id="crp-track-artist"></div>
        </div>
        <button class="crp-listen-btn" onclick="event.stopPropagation();navigateTo('radio')">▶ LISTEN LIVE</button>
        <div class="crp-tagline">Non-stop music • No skipping • Always broadcasting</div>
      </div>

      <!-- Station info -->
      <div class="cosmic-radio-info-row">
        <div class="cri-stat">
          <span class="cri-stat-icon">📡</span>
          <span class="cri-stat-label">24/7 BROADCAST</span>
        </div>
        <div class="cri-stat">
          <span class="cri-stat-icon">🎵</span>
          <span class="cri-stat-label">SERVER-CONTROLLED</span>
        </div>
        <div class="cri-stat">
          <span class="cri-stat-icon">🔒</span>
          <span class="cri-stat-label">LISTENER — NO SKIP</span>
        </div>
      </div>

      <div style="display:flex;gap:var(--space-sm);justify-content:center;flex-wrap:wrap;margin-bottom:var(--space-xl)">
        <button class="btn btn-cosmic" onclick="navigateTo('radio')">📻 Open Full Radio Player</button>
        <button class="btn btn-cosmic-outline btn-sm" onclick="navigateTo('radioadmin')">⚙️ Radio Admin</button>
      </div>
    </div>`;

  // Kick off real-time listener asynchronously (non-blocking)
  _radioTabCleanup();
  setTimeout(async () => {
    const innerEl = document.getElementById('music-radio-tab-inner');
    if (!innerEl) return;

    // Try Firestore onSnapshot
    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (getFirestore) {
        const db = await getFirestore();
        const fsModule = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const docRef = fsModule.doc(db, 'stationNowPlaying', 'avenoraRadio');
        _radioTabUnsub = fsModule.onSnapshot(docRef, (snap) => {
          _updateCosmicRadioPortal(snap.exists() ? snap.data() : null);
        });
        return; // onSnapshot set up — done
      }
    } catch (fsErr) {
      console.warn('[AVN Radio Tab] Firestore listener failed:', fsErr.message);
    }

    // Firestore unavailable — fall back to one API call + 30s polling
    async function _apiFetch() {
      if (!document.getElementById('music-radio-tab-inner')) return;
      try {
        const apiBase = (window.LU_CONFIG?.apiUrl || '').replace(/\/$/, '');
        const data = await fetch(`${apiBase}/radio/status`).then(r => r.json());
        if (data?.currentTrack) {
          const t = data.currentTrack;
          _updateCosmicRadioPortal({
            status:         data.status,
            stationName:    data.stationName || 'AVENORA RADIO',
            currentTitle:   t.title,
            currentArtist:  t.artist,
            currentCoverUrl:t.coverUrl || null,
            upcoming:       data.upcoming || [],
            playlistLength: data.playlistLength || 0,
            listenerCount:  data.listenerCount || 0,
          });
        }
      } catch {}
    }
    _apiFetch();
    const _pollTimer = setInterval(() => {
      if (!document.getElementById('music-radio-tab-inner')) { clearInterval(_pollTimer); return; }
      _apiFetch();
    }, 30000);
  }, 200);

  return html;
}

// Update the cosmic radio portal with real-time data (called from Firestore + API fallback)
function _updateCosmicRadioPortal(d) {
  const isPlaying = d?.status === 'playing';
  const title     = d?.currentTitle  || '';
  const artist    = d?.currentArtist || '';
  const coverUrl  = d?.currentCoverUrl || null;
  const upcoming  = (d?.upcoming || []).slice(0, 4);
  const listeners = d?.listenerCount  || 0;

  // Update discover teaser
  const teaserEl = document.getElementById('discover-radio-np');
  if (teaserEl && title) teaserEl.textContent = `${title}${artist ? ' — ' + artist : ''}`;

  // Update cosmic portal card
  const badgeEl  = document.getElementById('crp-onair-badge');
  const titleEl  = document.getElementById('crp-track-title');
  const artistEl = document.getElementById('crp-track-artist');
  const artEl    = document.querySelector('.crp-art-placeholder');

  if (badgeEl) {
    badgeEl.innerHTML = isPlaying
      ? `<span class="radio-on-air-dot"></span> ON AIR`
      : `<span style="color:var(--text-muted)">${d ? 'PAUSED' : 'LOADING…'}</span>`;
  }

  if (title) {
    if (titleEl)  titleEl.textContent  = title;
    if (artistEl) artistEl.textContent = artist || '';
    if (artEl && coverUrl) {
      artEl.outerHTML = `<img src="${escapeHtml(coverUrl)}" class="crp-art-img" alt="Cover"
        onerror="this.outerHTML='<div class=\\'crp-art-placeholder\\'>🎵</div>'">`;
    }
    // Also update upcoming
    const innerEl = document.getElementById('music-radio-tab-inner');
    if (innerEl && upcoming.length) {
      let upHtml = innerEl.innerHTML;
      const upSection = document.getElementById('crp-upcoming');
      if (!upSection) {
        innerEl.insertAdjacentHTML('beforeend', `
          <div id="crp-upcoming" class="crp-upcoming">
            <div class="crp-upcoming-label">NEXT UP</div>
            <div class="crp-upcoming-list">
              ${upcoming.map((t,i) => `
                <div class="crp-upcoming-item">
                  <span class="crp-upcoming-num">${i+1}</span>
                  <span>${escapeHtml(t.title||'?')}${t.artist?' <span class="crp-upcoming-artist">— '+escapeHtml(t.artist)+'</span>':''}</span>
                </div>`).join('')}
            </div>
          </div>`);
      } else {
        upSection.querySelector('.crp-upcoming-list').innerHTML =
          upcoming.map((t,i) => `
            <div class="crp-upcoming-item">
              <span class="crp-upcoming-num">${i+1}</span>
              <span>${escapeHtml(t.title||'?')}${t.artist?' <span class="crp-upcoming-artist">— '+escapeHtml(t.artist)+'</span>':''}</span>
            </div>`).join('');
      }
    }
  }
}

// ─── COSMIC PLAYLIST ARTWORK — CSS gradients per system playlist ─
const PLAYLIST_ARTWORK = {
  'sys-cosmic':       { bg: 'linear-gradient(135deg, #000428 0%, #004e92 100%)',      stars: true },
  'sys-midnight':     { bg: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' },
  'sys-neon':         { bg: 'linear-gradient(135deg, #1a0040 0%, #00ff7f20 100%)',    neon: '#39ff14' },
  'sys-shadow':       { bg: 'linear-gradient(135deg, #1a0000 0%, #ff440020 100%)',    neon: '#ff4400' },
  'sys-greenlight':   { bg: 'linear-gradient(135deg, #003300 0%, #00e67620 100%)',    neon: '#00e676' },
  'sys-deepspace':    { bg: 'linear-gradient(135deg, #000428 0%, #0088bb30 100%)' },
  'sys-darkmatter':   { bg: 'linear-gradient(135deg, #0a0014 0%, #aa44ff20 100%)',    neon: '#aa44ff' },
  'sys-hyperdrive':   { bg: 'linear-gradient(135deg, #000022 0%, #00ccff30 100%)' },
  'sys-starlight':    { bg: 'linear-gradient(135deg, #1a1a2e 0%, #ffd06020 100%)',    neon: '#ffd060' },
  'sys-hiphop':       { bg: 'linear-gradient(135deg, #001122 0%, #00ccff25 100%)' },
  'sys-rock':         { bg: 'linear-gradient(135deg, #1a0a00 0%, #ff660025 100%)',    neon: '#ff6600' },
  'sys-aftermidnight':{ bg: 'linear-gradient(135deg, #0d0d0d 0%, #c9a84c18 100%)',   neon: '#c9a84c' },
  'sys-radio':        { bg: 'linear-gradient(135deg, #001030 0%, #c9a84c20 100%)',    neon: '#c9a84c', isRadio: true },
};

function _playlistArtHtml(sysId, icon, color) {
  const aw = PLAYLIST_ARTWORK[sysId] || { bg: 'var(--bg-elevated)' };
  const glowColor = aw.neon || '#00ccff';
  return `<div class="cosmic-pl-art" style="background:${aw.bg}">
    <div class="cosmic-pl-art-icon" style="text-shadow:0 0 20px ${glowColor}88">${icon}</div>
    ${aw.stars ? '<div class="cosmic-pl-art-stars" aria-hidden="true"></div>' : ''}
    <div class="cosmic-pl-art-glow" style="background:radial-gradient(ellipse 60% 40% at 50% 100%, ${glowColor}22, transparent)"></div>
  </div>`;
}

function renderPlaylistCards() {
  const playlists = LS.get('lu_music_playlists', []);
  // Show all system playlists (including radio) + user-created playlists
  const sysCards  = SYSTEM_PLAYLISTS.map(sp => {
    const stored = playlists.find(p => p.sysId === sp.sysId);
    const count  = (stored?.tracks || []).length;
    return { id: sp.sysId, name: sp.name, icon: sp.icon, color: sp.color,
             description: sp.description, count, isSystem: true, sysId: sp.sysId, isRadio: sp.isRadio || false };
  });
  const userCards = playlists
    .filter(p => !p.isSystem)
    .map(p => ({ id: p.id, name: p.name, icon: '🌌', color: '#00ccff',
                 description: p.description || 'Your playlist', count: (p.tracks||[]).length, isSystem: false, sysId: null }));

  const all = [...sysCards, ...userCards];

  return `
    <div class="section-header" style="margin-top:var(--space-xl)">
      <h2 class="section-title cosmic-section-title">🌌 YOUR SOUND WORLDS</h2>
      <button class="btn btn-cosmic-outline btn-sm" onclick="musicTabSwitch('playlists',document.querySelectorAll('.music-hub-tab-btn')[3])">
        View All →
      </button>
    </div>
    <div class="cosmic-playlist-grid" style="margin-bottom:var(--space-2xl)">
      ${all.map(p => `
        <div class="cosmic-pl-card ${p.isRadio ? 'cosmic-pl-card--radio' : ''}" onclick="musicOpenPlaylist('${p.id}')">
          ${_playlistArtHtml(p.sysId, p.icon, p.color)}
          <div class="cosmic-pl-body">
            <div class="cosmic-pl-name" style="color:${p.color}">${escapeHtml(p.name)}</div>
            <div class="cosmic-pl-desc">${escapeHtml(p.description || '')}</div>
            <div class="cosmic-pl-meta">
              <span class="cosmic-pl-count">${p.count} track${p.count!==1?'s':''}</span>
              ${p.isRadio ? '<span class="cosmic-pl-radio-badge">📻 RADIO</span>' : ''}
            </div>
            <div class="cosmic-pl-actions" onclick="event.stopPropagation()">
              <button class="cosmic-pl-play-btn" onclick="musicPlayLocalPlaylist('${p.id}')" title="Play">▶ PLAY</button>
              ${!p.isRadio ? `<button class="cosmic-pl-add-btn" onclick="musicTabSwitch('upload')" title="Add Music">+ ADD</button>` : ''}
            </div>
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
        <div class="cosmic-empty-card" style="margin-bottom:var(--space-xl)">
          <div class="cosmic-empty-icon">🎵</div>
          <h3 class="cosmic-empty-title">🎧 YOUR MUSIC UNIVERSE</h3>
          <p class="cosmic-empty-sub">Upload tracks, import local files, or sign in to see your cloud library.</p>
          <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;justify-content:center">
            <button class="btn btn-cosmic" onclick="musicTabSwitch('upload')">⬆ Upload Music</button>
            <button class="btn btn-cosmic-outline" onclick="mpImport()">📂 Import Files</button>
          </div>
        </div>` : ''}

      ${localTracks.length > 0 ? `
        <div class="section-header">
          <h3 class="section-title cosmic-section-title">📂 IMPORTED FILES</h3>
          <span style="font-size:0.8rem;color:var(--text-muted)">${localTracks.length} track${localTracks.length!==1?'s':''}</span>
        </div>
        <div class="music-track-list" style="margin-bottom:var(--space-xl)">
          ${localTracks.map((t, i) => renderLocalTrackRow(t, i)).join('')}
        </div>` : ''}

      ${cloudTracks.length > 0 ? `
        <div class="section-header">
          <h3 class="section-title cosmic-section-title">☁️ MY CLOUD UPLOADS</h3>
          <span style="font-size:0.8rem;color:var(--text-muted)">${cloudTracks.length} track${cloudTracks.length!==1?'s':''}</span>
        </div>
        <div class="music-track-list" style="margin-bottom:var(--space-xl)">
          ${cloudTracks.map((t, i) => renderTrackRow(t, i, cloudTracks, 'cloud')).join('')}
        </div>` : ''}

      ${backendTracks.length > 0 ? `
        <div class="section-header">
          <h3 class="section-title cosmic-section-title">🌌 CLOUD LIBRARY</h3>
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
  let playlists = LS.get('lu_music_playlists', []);

  // Try to merge with backend playlists if logged in
  if (LegendAPI.auth.isLoggedIn()) {
    try {
      const data = await LegendAPI.music.playlists();
      if (data.playlists) {
        playlists = [
          ...playlists,
          ...data.playlists.map(p => ({ ...p, _isBackend: true })),
        ];
      }
    } catch { /* not connected */ }
  }

  const systemPlaylists = playlists.filter(p => p.isSystem);
  const userPlaylists   = playlists.filter(p => !p.isSystem);

  return `
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-lg);flex-wrap:wrap;gap:var(--space-sm)">
        <h2 class="section-title cosmic-section-title" style="margin:0">🌌 YOUR SOUND WORLDS</h2>
        <button class="btn btn-cosmic btn-sm" onclick="musicCreatePlaylistModal()">+ New Sound World</button>
      </div>

      ${systemPlaylists.length > 0 ? `
        <div class="section-header" style="margin-bottom:var(--space-md)">
          <h3 class="section-title" style="font-size:0.75rem;color:#00ccff;letter-spacing:0.22em;opacity:0.7">✦ COSMIC COLLECTIONS</h3>
        </div>
        <div class="cosmic-playlist-grid" style="margin-bottom:var(--space-xl)">
          ${systemPlaylists.map(p => renderPlaylistCard(p)).join('')}
        </div>` : ''}

      ${userPlaylists.length > 0 ? `
        <div class="section-header" style="margin-bottom:var(--space-md)">
          <h3 class="section-title" style="font-size:0.75rem;color:#c9a84c;letter-spacing:0.22em;opacity:0.7">✦ YOUR PERSONAL WORLDS</h3>
        </div>
        <div class="cosmic-playlist-grid">
          ${userPlaylists.map(p => renderPlaylistCard(p)).join('')}
        </div>` : `
        <div class="cosmic-empty-card" style="padding:var(--space-xl) 0;margin-top:var(--space-md)">
          <div class="cosmic-empty-icon" style="font-size:2rem">🌌</div>
          <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:var(--space-md)">No custom sound worlds yet.</p>
          <button class="btn btn-cosmic btn-sm" onclick="musicCreatePlaylistModal()">✦ Create Your First Sound World</button>
        </div>`}
    </div>`;
}

function renderPlaylistCard(p) {
  const trackCount = (p.tracks || []).length;
  const pid    = escapeHtml(p.id || p._id || '');
  const pname  = escapeHtml(p.name);
  const sp     = SYSTEM_PLAYLISTS.find(s => s.sysId === p.sysId);
  const icon   = sp ? sp.icon : '🌌';
  const color  = sp ? sp.color : '#00ccff';
  const sysId  = p.sysId || null;
  const isRadio = sp?.isRadio || false;

  const editBtns = p.isSystem ? '' : `
    <span onclick="event.stopPropagation()" style="display:flex;gap:4px;margin-top:4px">
      <button class="cosmic-pl-edit-btn" onclick="musicRenamePlaylist('${pid}','${pname}')">✏</button>
      <button class="cosmic-pl-edit-btn cosmic-pl-del-btn" onclick="musicDeletePlaylist('${pid}','${pname}')">🗑</button>
    </span>`;

  return `
    <div class="cosmic-pl-card ${isRadio ? 'cosmic-pl-card--radio' : ''}" onclick="musicOpenPlaylist('${pid}')">
      ${p.coverUrl
        ? `<div class="cosmic-pl-art"><img src="${escapeHtml(p.coverUrl)}" alt="${pname}" loading="lazy" style="width:100%;height:100%;object-fit:cover"></div>`
        : _playlistArtHtml(sysId, icon, color)}
      <div class="cosmic-pl-body">
        <div class="cosmic-pl-name" style="color:${color}">${pname}</div>
        <div class="cosmic-pl-desc">${escapeHtml(sp?.description || p.description || (p.isSystem ? 'Cosmic collection' : (p.visibility === 'public' ? 'Public' : 'Private')))}</div>
        <div class="cosmic-pl-meta">
          <span class="cosmic-pl-count">${trackCount} track${trackCount!==1?'s':''}</span>
          ${isRadio ? '<span class="cosmic-pl-radio-badge">📻 RADIO</span>' : ''}
          ${p.isSystem && !isRadio ? '<span class="cosmic-pl-sys-badge">✦ COSMIC</span>' : ''}
        </div>
        <div class="cosmic-pl-actions" onclick="event.stopPropagation()">
          <button class="cosmic-pl-play-btn" onclick="musicPlayLocalPlaylist('${pid}')">▶ PLAY</button>
          ${!isRadio ? `<button class="cosmic-pl-add-btn" onclick="musicAddToPlaylistViaCardBtn && musicAddToPlaylistViaCardBtn('${pid}')">+ ADD</button>` : ''}
          ${editBtns}
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
    <div class="cosmic-empty-card">
      <div class="cosmic-empty-icon">💿</div>
      <h3 class="cosmic-empty-title">💿 ALBUM GALAXY</h3>
      <p class="cosmic-empty-sub">Albums will appear here once tracks are uploaded.</p>
      <button class="btn btn-cosmic btn-sm" onclick="musicTabSwitch('upload')">⬆ Upload Music</button>
    </div>`;

  return `
    <div>
      <div class="section-header" style="margin-bottom:var(--space-lg)">
        <h2 class="section-title cosmic-section-title">💿 ALBUM GALAXY</h2>
      </div>
      <div class="music-card-grid">
        ${albums.map(a => renderAlbumCard(a)).join('')}
      </div>
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
    <div class="cosmic-empty-card">
      <div class="cosmic-empty-icon">🎤</div>
      <h3 class="cosmic-empty-title">🎤 ARTIST CONSTELLATIONS</h3>
      <p class="cosmic-empty-sub">Artists appear here once tracks with artist metadata are uploaded.</p>
      <button class="btn btn-cosmic btn-sm" onclick="musicTabSwitch('upload')">⬆ Upload Music</button>
    </div>`;

  return `
    <div>
      <div class="section-header" style="margin-bottom:var(--space-lg)">
        <h2 class="section-title cosmic-section-title">🎤 ARTIST CONSTELLATIONS</h2>
      </div>
      <div class="music-card-grid">
        ${artists.map(a => `
          <div class="music-card cosmic-artist-card" onclick="musicOpenArtist('${escapeHtml(String(a.id))}')">
            <div class="music-card-art" style="border-radius:50%;overflow:hidden;margin:var(--space-md) auto var(--space-sm);width:80%;aspect-ratio:1;border:2px solid rgba(0,204,255,0.25)">
              ${a.avatarUrl
                ? `<img src="${escapeHtml(a.avatarUrl)}" alt="${escapeHtml(a.name)}" loading="lazy">`
                : `<div style="font-size:2.5rem;background:radial-gradient(ellipse at 40% 40%,rgba(0,204,255,0.15),transparent)">🎤</div>`}
            </div>
            <div class="music-card-body" style="text-align:center">
              <div class="music-card-title">${escapeHtml(a.name)}</div>
              ${a.isVerified ? `<div class="music-card-sub" style="color:#00ccff">✓ Verified</div>` : ''}
              ${a.genres && a.genres.length ? `<div class="music-card-sub">${a.genres.slice(0,2).map(escapeHtml).join(' · ')}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>
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
    <div class="cosmic-empty-card">
      <div class="cosmic-empty-icon">❤️</div>
      <h3 class="cosmic-empty-title">❤️ FAVORITE FREQUENCIES</h3>
      <p class="cosmic-empty-sub">Tap ♥ on any track to add it to your favorites.</p>
    </div>`;

  return `
    <div>
      <div class="section-header" style="margin-bottom:var(--space-lg)">
        <h2 class="section-title cosmic-section-title">❤️ FAVORITE FREQUENCIES</h2>
      </div>

      ${localFavTracks.length > 0 ? `
        <div class="section-header">
          <h3 class="section-title cosmic-section-title">📂 LOCAL FAVORITES</h3>
          <button class="btn btn-cosmic btn-sm" onclick="mpPlayAll(${JSON.stringify(localFavTracks.map((_,i)=>MP.queue.indexOf(localFavTracks[i])))})">▶ Play All</button>
        </div>
        <div class="music-track-list" style="margin-bottom:var(--space-xl)">
          ${localFavTracks.map((t, i) => renderLocalTrackRow(t, MP.queue.indexOf(t))).join('')}
        </div>` : ''}

      ${backendFavs.length > 0 ? `
        <div class="section-header">
          <h3 class="section-title cosmic-section-title">☁️ CLOUD FAVORITES</h3>
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
    <div class="cosmic-empty-card">
      <div class="cosmic-empty-icon">🕘</div>
      <h3 class="cosmic-empty-title">🕘 RECENT ORBITS</h3>
      <p class="cosmic-empty-sub">Tracks you play will appear here. Start your journey through the sound universe.</p>
    </div>`;

  return `
    <div>
      <div class="section-header" style="margin-bottom:var(--space-lg)">
        <h2 class="section-title cosmic-section-title">🕘 RECENT ORBITS</h2>
      </div>

      ${localRecent.length > 0 ? `
        <div class="section-header">
          <h3 class="section-title cosmic-section-title">📂 LOCAL RECENTLY PLAYED</h3>
        </div>
        <div class="music-track-list" style="margin-bottom:var(--space-xl)">
          ${localRecent.slice(0, 20).map((t, i) => {
            const queueIdx = MP.queue.findIndex(q => q.id === t.id);
            return queueIdx >= 0 ? renderLocalTrackRow(MP.queue[queueIdx], queueIdx) : `
              <div class="mtrack-row">
                <div class="mtrack-art">🎵</div>
                <div class="mtrack-info">
                  <div class="mtrack-title">${escapeHtml(t.name || 'Unknown')}</div>
                  <div class="mtrack-meta" style="color:rgba(0,204,255,0.45)">Not in current queue</div>
                </div>
              </div>`;
          }).join('')}
        </div>` : ''}

      ${backendRecent.length > 0 ? `
        <div class="section-header">
          <h3 class="section-title cosmic-section-title">☁️ CLOUD RECENTLY PLAYED</h3>
        </div>
        <div class="music-track-list">
          ${backendRecent.map((t, i) => renderTrackRow(t, i, backendRecent, 'recent')).join('')}
        </div>` : ''}
    </div>`;
}

// ─── SEARCH TAB ──────────────────────────────────────────────
function renderSearchTab() {
  return `
    <div>
      <div class="section-header" style="margin-bottom:var(--space-lg)">
        <h2 class="section-title cosmic-section-title">🔍 SEARCH THE UNIVERSE</h2>
      </div>

      <div class="music-hero-search" style="margin-bottom:var(--space-lg)">
        <div class="mh-search-inner">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="search" id="music-search-input" placeholder="Search songs, artists, albums, playlists…"
                 aria-label="Search music" oninput="musicSearch(this.value)">
        </div>
      </div>

      <!-- Category filters -->
      <div class="genre-filter-row" style="margin-bottom:var(--space-lg)">
        ${['All','Songs','Albums','Artists','Playlists'].map((c,i) =>
          `<button class="genre-pill${i===0?' active':''}"
             onclick="musicSearchFilter('${c.toLowerCase()}',this)">${c}</button>`
        ).join('')}
      </div>

      <div id="music-search-results">
        <div class="cosmic-empty-card">
          <div class="cosmic-empty-icon">🔍</div>
          <h3 class="cosmic-empty-title">SEARCH THE MUSIC UNIVERSE</h3>
          <p class="cosmic-empty-sub">Search for songs, artists, albums, and playlists.</p>
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
      el.innerHTML = '<div class="cosmic-empty-card"><div class="cosmic-empty-icon">🔍</div><p class="cosmic-empty-sub">Type at least 2 characters to search.</p></div>';
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
      el.innerHTML = `<div class="cosmic-empty-card"><div class="cosmic-empty-icon">🔍</div><h3 class="cosmic-empty-title">NO SIGNALS DETECTED</h3><p class="cosmic-empty-sub">No results for "<strong>${escapeHtml(query)}</strong>".</p></div>`;
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
      <div class="section-header" style="margin-bottom:var(--space-lg)">
        <h2 class="section-title cosmic-section-title">⬆ UPLOAD TO THE UNIVERSE</h2>
      </div>

      <!-- Cloud upload info -->
      <div class="cosmic-upload-info" style="margin-bottom:var(--space-xl)">
        <span style="font-size:1.6rem;flex-shrink:0">☁️</span>
        <div>
          <h4 style="margin:0 0 4px;color:#00ccff;font-family:var(--font-display);letter-spacing:0.08em">
            ADD MUSIC TO YOUR UNIVERSE
          </h4>
          <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0">
            Upload audio to your cloud library. Tracks become available in your Sound Worlds and across all devices.
          </p>
        </div>
      </div>

      ${!isLoggedIn ? `
        <div class="card" style="border-color:rgba(0,204,255,0.22);margin-bottom:var(--space-xl);text-align:center;background:rgba(0,204,255,0.04)">
          <p style="color:var(--text-secondary);margin-bottom:var(--space-md)">Sign in to upload music to your cloud library.</p>
          <button class="btn btn-cosmic" onclick="Modal.open('auth-modal')">Sign In</button>
        </div>` : ''}

      <!-- Upload form -->
      <form id="music-upload-form" onsubmit="musicUploadSubmit(event)">
        <!-- Drop zone -->
        <div class="music-upload-zone" id="music-drop-zone"
             onclick="document.getElementById('music-upload-file').click()"
             ondragover="event.preventDefault();this.classList.add('drag-over')"
             ondragleave="this.classList.remove('drag-over')"
             ondrop="musicDropFile(event)">
          <p style="font-size:2.4rem;margin-bottom:var(--space-sm)">🎵</p>
          <p style="font-weight:600;margin-bottom:4px;color:#00ccff">Drag & drop audio file here</p>
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

        <div style="margin-top:var(--space-lg);display:flex;gap:var(--space-sm);flex-wrap:wrap">
          <button type="submit" class="btn btn-cosmic" id="music-upload-btn"
                  ${!isLoggedIn ? 'disabled title="Sign in first"' : ''}>
            ⬆ Upload to Universe
          </button>
          <button type="button" class="btn btn-cosmic-outline" onclick="musicImportLocalOnly()">
            📂 Import Locally
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
      succEl.textContent = `✓ "${titleVal}" uploaded successfully!`;
      succEl.classList.remove('hidden');
    }
    Toast.success(`Track "${titleVal}" uploaded!`);

    // Reset form
    form.reset();
    document.getElementById('music-upload-file-preview').innerHTML = '';

    // Post-upload: offer to add to a playlist
    const uploadedTrackId = data?.track?.id || data?.track?._id;
    if (uploadedTrackId) {
      setTimeout(() => musicAddToPlaylistModal(String(uploadedTrackId), titleVal), 400);
    }

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
          onclick="event.stopPropagation();musicOpenTrackMenu(event,{id:'${track.id}',name:${JSON.stringify(track.name)},artist:${JSON.stringify(track.artist||'')},_isLocal:true,_localIndex:${index}})"
          title="More options" style="font-size:1rem;padding:4px 6px">⋮</button>
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

  // Encode only what the context menu needs
  const menuData = JSON.stringify({
    id: track.id, title: track.title, artistName: track.artistName || '',
    albumTitle: track.albumTitle || '', albumId: track.albumId || null,
    artistId: track.artistId || null, context, index
  }).replace(/"/g, '&quot;');

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
        <button class="mp-icon-btn"
          onclick="event.stopPropagation();musicOpenTrackMenu(event,JSON.parse(this.dataset.t))"
          data-t="${menuData}"
          title="More options" style="font-size:1rem;padding:4px 6px">⋮</button>
      </div>
    </div>`;
}

// ─── Track context menu ────────────────────────────────────────

let _trackMenuTrack = null;
let _trackMenuDismiss = null;

window.musicOpenTrackMenu = function (evtOrBtn, trackData) {
  // evtOrBtn can be an event or a DOM element when called from onclick
  const evt = (evtOrBtn instanceof Event) ? evtOrBtn : window.event;
  if (evt) evt.stopPropagation();

  const menu = document.getElementById('music-track-menu');
  if (!menu) return;

  _trackMenuTrack = trackData;

  const isLocal = trackData._isLocal;
  const trackId = String(trackData.id || '');
  const trackName = trackData.name || trackData.title || 'Track';
  const artistName = trackData.artist || trackData.artistName || '';
  const hasAlbum = !!trackData.albumId;
  const hasArtist = !!trackData.artistId;

  menu.innerHTML = `
    <div class="music-ctx-header">
      <div class="music-ctx-title">${escapeHtml(trackName)}</div>
      ${artistName ? `<div class="music-ctx-sub">${escapeHtml(artistName)}</div>` : ''}
    </div>
    <div class="music-ctx-divider"></div>
    <button class="music-ctx-item" onclick="musicCtxPlay()">
      <span>▶</span> Play Now
    </button>
    <button class="music-ctx-item" onclick="musicCtxAddToPlaylist()">
      <span>📂</span> Add to Playlist…
    </button>
    <button class="music-ctx-item" onclick="musicCtxToggleLike()">
      <span>♥</span> ${new Set(LS.get('lu_mp_favorites',[])).has(trackId) ? 'Remove from Liked' : 'Add to Liked'}
    </button>
    ${hasAlbum ? `<button class="music-ctx-item" onclick="musicOpenAlbum('${escapeHtml(String(trackData.albumId))}');musicCtxClose()">
      <span>💿</span> View Album
    </button>` : ''}
    ${hasArtist ? `<button class="music-ctx-item" onclick="musicOpenArtist('${escapeHtml(String(trackData.artistId))}');musicCtxClose()">
      <span>🎤</span> View Artist
    </button>` : ''}
    <div class="music-ctx-divider"></div>
    <button class="music-ctx-item music-ctx-cancel" onclick="musicCtxClose()">
      Cancel
    </button>
  `;

  // Position near the click / button
  const btn = evt?.currentTarget || evt?.target;
  if (btn) {
    const rect = btn.getBoundingClientRect();
    const menuW = 200;
    let left = rect.right - menuW;
    let top  = rect.bottom + 4;
    if (left < 8) left = 8;
    if (top + 260 > window.innerHeight) top = rect.top - 4 - Math.min(260, window.innerHeight - 100);
    menu.style.left = left + 'px';
    menu.style.top  = top  + 'px';
  }

  menu.classList.remove('hidden');

  // Dismiss on outside click
  if (_trackMenuDismiss) document.removeEventListener('click', _trackMenuDismiss);
  _trackMenuDismiss = (e) => {
    if (!menu.contains(e.target)) musicCtxClose();
  };
  setTimeout(() => document.addEventListener('click', _trackMenuDismiss), 10);
};

window.musicCtxClose = function () {
  const menu = document.getElementById('music-track-menu');
  if (menu) menu.classList.add('hidden');
  if (_trackMenuDismiss) {
    document.removeEventListener('click', _trackMenuDismiss);
    _trackMenuDismiss = null;
  }
};

window.musicCtxPlay = function () {
  musicCtxClose();
  if (!_trackMenuTrack) return;
  if (_trackMenuTrack._isLocal) {
    mpLoadTrack(_trackMenuTrack._localIndex);
  } else {
    const ctx = _trackMenuTrack.context;
    const idx = _trackMenuTrack.index;
    const tracks = ctx ? (_mpContextTracks[ctx] || []) : [];
    const track  = tracks[idx];
    if (track) window.mpLoadBackendTrack(track, idx, ctx, tracks);
  }
};

window.musicCtxToggleLike = function () {
  musicCtxClose();
  if (!_trackMenuTrack) return;
  if (_trackMenuTrack._isLocal) {
    mpToggleFavorite(String(_trackMenuTrack.id));
  } else {
    mpToggleBackendFavorite(String(_trackMenuTrack.id));
  }
};

window.musicCtxAddToPlaylist = function () {
  musicCtxClose();
  if (!_trackMenuTrack) return;
  const name = _trackMenuTrack.name || _trackMenuTrack.title || 'Track';
  musicAddToPlaylistModal(String(_trackMenuTrack.id), name);
};

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

  // Resolve tracks: prefer local queue, then fire-and-forget cloud lookups
  const trackIds = pl.tracks || [];
  const localTracks = trackIds.map(tid => MP.queue.find(t => t.id === tid)).filter(Boolean);

  // Build the valid local indices for play-all / shuffle
  const localIndices = localTracks.map(t => MP.queue.indexOf(t)).filter(i => i >= 0);

  const sp = SYSTEM_PLAYLISTS.find(s => s.sysId === pl.sysId);
  const icon = sp ? sp.icon : '📂';
  const color = sp ? sp.color : 'var(--neon-blue)';

  const editControls = pl.isSystem ? '' : `
    <button class="btn btn-outline btn-sm"
      onclick="musicRenamePlaylist('${escapeHtml(id)}','${escapeHtml(pl.name)}')">✏ Rename</button>
    <button class="btn btn-outline btn-sm" style="color:var(--neon-red);border-color:rgba(255,60,80,0.3)"
      onclick="musicDeletePlaylist('${escapeHtml(id)}','${escapeHtml(pl.name)}')">🗑 Delete</button>`;

  el.innerHTML = `
    <div>
      <button class="btn btn-ghost btn-sm" style="margin-bottom:var(--space-lg)"
        onclick="musicTabSwitch('playlists')">← Back to Playlists</button>

      <div style="display:flex;gap:var(--space-lg);align-items:flex-start;flex-wrap:wrap;margin-bottom:var(--space-xl)">
        <div style="width:100px;height:100px;border-radius:var(--radius-md);background:var(--bg-elevated);
                    display:flex;align-items:center;justify-content:center;font-size:3rem;flex-shrink:0">
          ${icon}
        </div>
        <div style="flex:1;min-width:0">
          <h2 style="font-family:var(--font-display);letter-spacing:0.08em;color:${color};margin-bottom:4px">
            ${escapeHtml(pl.name)}
          </h2>
          ${pl.description ? `<p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:var(--space-sm)">${escapeHtml(pl.description)}</p>` : ''}
          <p style="color:var(--text-muted);font-size:0.8rem">${trackIds.length} track${trackIds.length!==1?'s':''}</p>
          <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;margin-top:var(--space-md)">
            <button class="btn btn-green btn-sm" onclick="musicPlayPlaylistTracks(${JSON.stringify(localIndices)})">▶ Play All</button>
            <button class="btn btn-outline btn-sm" onclick="mpShufflePlaylist(${JSON.stringify(localIndices)})">⇄ Shuffle</button>
            <button class="btn btn-outline btn-sm" onclick="musicTabSwitch('library')">+ Add Tracks</button>
            ${editControls}
          </div>
        </div>
      </div>

      ${!localTracks.length
        ? `<div class="music-empty">
             <span class="music-empty-icon">${icon}</span>
             <p>${trackIds.length > 0 ? 'Tracks not in current queue. Import music first.' : 'This playlist is empty.'}</p>
             <p style="font-size:0.82rem;color:var(--text-muted)">Import music files or go to the Songs tab and tap ⋮ → Add to Playlist.</p>
             <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;justify-content:center;margin-top:var(--space-md)">
               <button class="btn btn-green btn-sm" onclick="mpImport()">📂 Import Files</button>
               <button class="btn btn-outline btn-sm" onclick="musicTabSwitch('library')">Browse Songs</button>
             </div>
           </div>`
        : `<div class="music-track-list">${localTracks.map((t) => renderLocalTrackRow(t, MP.queue.indexOf(t))).join('')}</div>`}
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
    title: '🌌 NEW SOUND WORLD',
    body: `
      <div class="form-group">
        <label class="form-label" style="color:#00ccff;letter-spacing:0.08em">Sound World Name</label>
        <input class="form-input" id="new-pl-name" placeholder="e.g. MIDNIGHT SESSIONS" maxlength="200" autofocus>
      </div>
      <div class="form-group">
        <label class="form-label">Description (optional)</label>
        <input class="form-input" id="new-pl-desc" placeholder="Short description" maxlength="500">
      </div>`,
    actions: [
      { label: 'Cancel', class: 'btn-outline', onclick: `Modal.close('create-playlist-modal')` },
      { label: '✦ Create Sound World', class: 'btn-cosmic', onclick: `musicConfirmCreatePlaylist()` },
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

  // Build checkbox list — all playlists (system + user), mark which already contain this track
  const items = playlists.map(p => {
    const has = (p.tracks || []).includes(trackId);
    const sp  = SYSTEM_PLAYLISTS.find(s => s.sysId === p.sysId);
    const icon = sp ? sp.icon : '📂';
    return `
      <label class="music-pl-check-row ${has ? 'has-track' : ''}">
        <input type="checkbox" name="pl-check" value="${escapeHtml(p.id)}" ${has ? 'checked' : ''}
               data-name="${escapeHtml(p.name)}">
        <span class="music-pl-check-icon">${icon}</span>
        <span class="music-pl-check-name">${escapeHtml(p.name)}</span>
        <span class="music-pl-check-count">${(p.tracks||[]).length} tracks</span>
        ${has ? '<span class="music-pl-has-badge">✓</span>' : ''}
      </label>`;
  }).join('');

  Modal.create({
    id: 'add-to-pl-modal',
    title: '🌌 ADD TO YOUR SOUND WORLDS',
    body: `
      <p style="font-size:0.85rem;color:#00ccff;margin-bottom:var(--space-md);font-family:var(--font-display);letter-spacing:0.06em">${escapeHtml(trackName)}</p>
      <div class="music-pl-check-list" id="music-pl-check-list">
        ${items}
      </div>`,
    actions: [
      { label: '✦ New Sound World', class: 'btn-cosmic-outline btn-sm', onclick: `Modal.close('add-to-pl-modal');musicCreatePlaylistModal()` },
      { label: 'Done', class: 'btn-cosmic', onclick: `musicConfirmAddToPlaylist('${trackId}')` },
    ],
  });
  Modal.open('add-to-pl-modal');
};

window.musicConfirmAddToPlaylist = function (trackId) {
  const checked = document.querySelectorAll('#music-pl-check-list input[name="pl-check"]');
  if (!checked.length) { Modal.close('add-to-pl-modal'); return; }

  const playlists = LS.get('lu_music_playlists', []);
  let added = 0, removed = 0;

  checked.forEach(cb => {
    const pl = playlists.find(p => p.id === cb.value);
    if (!pl) return;
    if (!pl.tracks) pl.tracks = [];
    if (cb.checked) {
      if (!pl.tracks.includes(trackId)) { pl.tracks.push(trackId); added++; }
    } else {
      const idx = pl.tracks.indexOf(trackId);
      if (idx !== -1) { pl.tracks.splice(idx, 1); removed++; }
    }
  });

  LS.set('lu_music_playlists', playlists);

  if (added > 0 && removed === 0) Toast.success(`Added to ${added} playlist${added!==1?'s':''}`);
  else if (removed > 0 && added === 0) Toast.info(`Removed from ${removed} playlist${removed!==1?'s':''}`);
  else if (added > 0 || removed > 0) Toast.success('Playlists updated');
  else Toast.info('No changes');

  Modal.close('add-to-pl-modal');
};

// Alias used by cosmic playlist "+ ADD" buttons (opens the add-to-playlist modal
// for any song currently in the queue — or prompts to import music first).
window.musicAddToPlaylistViaCardBtn = function (playlistId) {
  const current = MP.currentTrack;
  if (current) {
    musicAddToPlaylistModal(current.id || String(current.name), current.name || current.title || 'Track');
  } else if (MP.queue.length > 0) {
    const t = MP.queue[0];
    musicAddToPlaylistModal(t.id || t.name, t.name || t.title || 'Track');
  } else {
    Toast.info('Play a track first, or use ⋮ menu on any track to add it to a playlist.');
  }
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
      window.mpLoadBackendTrack(MP.backendTracks[randIdx], randIdx, MP.backendQueue, MP.backendTracks);
      return;
    }
    if (next < MP.backendTracks.length) {
      window.mpLoadBackendTrack(MP.backendTracks[next], next, MP.backendQueue, MP.backendTracks);
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
    window.mpLoadBackendTrack(MP.backendTracks[prev], prev, MP.backendQueue, MP.backendTracks);
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
    window.mpLoadBackendTrack(MP.backendTracks[next], next, MP.backendQueue, MP.backendTracks);
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
