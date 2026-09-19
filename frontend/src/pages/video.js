/**
 * AVENORA VIDEO — Full Video Platform
 * Sections: Home, Trending, New, Movies, Shows, Music, Short, Live, Channels
 * Features: Player, Upload, Watch Later, History, Comments, Likes, Share, Search, Library
 */

/* ─── State ──────────────────────────────────────────────── */
const SOM = {
  currentTab: 'home',
  currentVideo: null,
  watchLater: LS.get('som_watch_later', []),      // [{id,title,thumbnailUrl,duration,uploader}]
  history: LS.get('som_history', []),              // [{id,title,thumbnailUrl,duration,uploader,watchedAt,position}]
  likedVideos: LS.get('som_liked', []),            // [id]
  searchQuery: '',

  saveWatchLater() { LS.set('som_watch_later', this.watchLater); },
  saveHistory()    { LS.set('som_history', this.history); },
  saveLiked()      { LS.set('som_liked', this.likedVideos); },

  addToWatchLater(video) {
    if (!video?.id && !video?._id) return;
    const id = video._id || video.id;
    if (!this.watchLater.find(v => (v._id || v.id) === id)) {
      this.watchLater.unshift({ ...video, id });
      if (this.watchLater.length > 200) this.watchLater = this.watchLater.slice(0, 200);
      this.saveWatchLater();
    }
  },

  removeFromWatchLater(id) {
    this.watchLater = this.watchLater.filter(v => (v._id || v.id) !== id);
    this.saveWatchLater();
  },

  isInWatchLater(id) {
    return !!this.watchLater.find(v => (v._id || v.id) === id);
  },

  addToHistory(video, position = 0) {
    if (!video?.id && !video?._id) return;
    const id = video._id || video.id;
    this.history = this.history.filter(v => (v._id || v.id) !== id);
    this.history.unshift({ ...video, id, watchedAt: new Date().toISOString(), position });
    if (this.history.length > 500) this.history = this.history.slice(0, 500);
    this.saveHistory();
  },

  removeFromHistory(id) {
    this.history = this.history.filter(v => (v._id || v.id) !== id);
    this.saveHistory();
  },

  clearHistory() {
    this.history = [];
    this.saveHistory();
  },

  isLiked(id) { return this.likedVideos.includes(String(id)); },

  setLiked(id, liked) {
    const sid = String(id);
    if (liked) { if (!this.likedVideos.includes(sid)) this.likedVideos.push(sid); }
    else { this.likedVideos = this.likedVideos.filter(x => x !== sid); }
    this.saveLiked();
  },
};

/* ─── Page Registration ──────────────────────────────────── */
registerPage('video', {
  async render(container) {
    container.innerHTML = buildVideoPageShell();

    const tabEl = document.getElementById('som-tabs');
    if (tabEl) {
      tabEl.addEventListener('click', e => {
        const btn = e.target.closest('.midnight-tab');
        if (!btn) return;
        tabEl.querySelectorAll('.midnight-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        SOM.currentTab = tab;
        loadTab(tab);
      });
    }

    const searchInput = document.getElementById('som-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', debounce(e => {
        const q = e.target.value.trim();
        SOM.searchQuery = q;
        if (q.length >= 2) loadTab('search');
        else if (q.length === 0) loadTab(SOM.currentTab !== 'search' ? SOM.currentTab : 'home');
      }, 350));
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const q = e.target.value.trim();
          if (q.length >= 1) { SOM.searchQuery = q; loadTab('search'); }
        }
      });
    }

    await loadTab('home');

    // Handle deep-link: #video/<id> navigates directly to that video
    if (window._somPendingVideo) {
      const id = window._somPendingVideo;
      window._somPendingVideo = null;
      await openVideoDetail(id);
    }

    return () => {}; // cleanup (player auto-stops on page unload naturally)
  }
});

/* ─── Shell HTML ─────────────────────────────────────────── */
function buildVideoPageShell() {
  const tabs = [
    { key: 'home',      label: 'Home' },
    { key: 'trending',  label: 'Trending' },
    { key: 'new',       label: 'Recently Added' },
    { key: 'movies',    label: 'Movies' },
    { key: 'shows',     label: 'Shows' },
    { key: 'music',     label: 'Music' },
    { key: 'short',     label: 'Short Videos' },
    { key: 'live',      label: 'Live' },
    { key: 'channels',  label: 'Channels' },
    { key: 'library',   label: 'Library' },
    { key: 'watchlater',label: 'Watch Later' },
    { key: 'history',   label: 'History' },
    { key: 'upload',    label: '+ Upload' },
  ];

  return `
    <div class="midnight-page" id="som-page">
      <!-- Hero Brand -->
      <div class="midnight-hero">
        <div class="midnight-brand">
          <h1>
            <span class="midnight-brand-main">AVENORA</span>
            <span class="midnight-brand-sub"> VIDEO</span>
          </h1>
          <div class="midnight-tagline">WATCH. DISCOVER. SHARE.</div>
        </div>
        <!-- Search Bar -->
        <div class="midnight-search-bar" style="margin-top:var(--space-md);max-width:480px" role="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="search" id="som-search-input" placeholder="Search videos, channels, categories..." aria-label="Search Avenora Video">
        </div>
      </div>

      <!-- Tabs -->
      <div class="midnight-tabs" id="som-tabs" role="tablist" aria-label="Avenora Video sections">
        ${tabs.map((t, i) => `
          <button class="midnight-tab${i === 0 ? ' active' : ''}" 
                  data-tab="${t.key}" 
                  role="tab" 
                  aria-selected="${i === 0}"
                  aria-controls="som-content">${escapeHtml(t.label)}</button>
        `).join('')}
      </div>

      <!-- Main content area -->
      <div id="som-content" role="tabpanel" aria-live="polite">
        <div class="midnight-empty" style="padding-top:var(--space-3xl)">
          <div class="spinner spinner-lg"></div>
        </div>
      </div>
    </div>
  `;
}

/* ─── Tab Router ─────────────────────────────────────────── */
async function loadTab(tab) {
  const content = document.getElementById('som-content');
  if (!content) return;

  const loaders = {
    home:       loadHomeTab,
    trending:   () => loadVideoListTab({ sort: 'trending', heading: 'TRENDING' }),
    new:        () => loadVideoListTab({ sort: 'new', heading: 'RECENTLY ADDED' }),
    movies:     () => loadVideoListTab({ category: 'movies', heading: 'MOVIES' }),
    shows:      () => loadVideoListTab({ category: 'shows', heading: 'SHOWS' }),
    music:      () => loadVideoListTab({ category: 'music', heading: 'MUSIC VIDEOS' }),
    short:      () => loadVideoListTab({ category: 'short', heading: 'SHORT VIDEOS' }),
    live:       loadLiveTab,
    channels:   loadChannelsTab,
    library:    loadLibraryTab,
    watchlater: loadWatchLaterTab,
    history:    loadHistoryTab,
    upload:     loadUploadTab,
    search:     loadSearchTab,
  };

  const loader = loaders[tab];
  if (loader) {
    showLoading(content, 'Loading...');
    try { await loader(content); }
    catch (err) {
      console.warn(`[AVN] Tab load error [${tab}]:`, err);
      showError(content, 'This content is temporarily unavailable. Please try again.', () => loadTab(tab));
    }
  }
}

/* ─── Home Tab ───────────────────────────────────────────── */
async function loadHomeTab(container) {
  container = document.getElementById('som-content');

  // Fetch in parallel: featured (newest 4) + trending (top viewed 8)
  let featured = [], trending = [];
  let apiError = null;

  try {
    const [f, t] = await Promise.all([
      LegendAPI.videos.list({ limit: 4, sort: 'new' }),
      LegendAPI.videos.list({ limit: 8, sort: 'trending' }),
    ]);
    featured  = f.videos || [];
    trending  = t.videos || [];
  } catch (err) {
    apiError = err.message || String(err);
    console.error('[AVN] Video home tab error:', err);
  }

  const hasContent = featured.length > 0 || trending.length > 0;

  container.innerHTML = `
    <div style="padding-bottom:var(--space-2xl)">

      <!-- Featured Section -->
      <div class="midnight-section">
        <div class="midnight-section-header">
          <span class="midnight-section-title">FEATURED</span>
          <span class="midnight-section-link" onclick="loadTab('new')" tabindex="0" role="button">See all</span>
        </div>
      </div>
      <div class="midnight-grid" id="som-featured-grid">
        ${featured.length ? featured.map(v => renderVideoCardHtml(v)).join('') : renderEmptyVideoSection('No featured videos yet.')}
      </div>

      <!-- Trending Section -->
      <div class="midnight-section" style="margin-top:var(--space-md)">
        <div class="midnight-section-header">
          <span class="midnight-section-title">TRENDING</span>
          <span class="midnight-section-link" onclick="loadTab('trending')" tabindex="0" role="button">See all</span>
        </div>
      </div>
      <div class="midnight-grid" id="som-trending-grid">
        ${trending.length ? trending.map(v => renderVideoCardHtml(v)).join('') : renderEmptyVideoSection('No videos available yet.')}
      </div>

      ${!hasContent && !apiError ? `
        <div class="midnight-empty">
          <span class="midnight-empty-icon">🎬</span>
          <h3>NO VIDEOS AVAILABLE YET</h3>
          <p>Avenora Video is ready. Upload the first video to begin.</p>
          <button class="btn btn-primary" onclick="loadTab('upload')">Upload Video</button>
        </div>
      ` : ''}
    </div>
  `;

  // Bind click events after render
  bindVideoCardClicks(container);
}

/* ─── Generic Video List Tab (with pagination) ───────────── */
async function loadVideoListTab({ category, sort = 'new', heading } = {}) {
  const container = document.getElementById('som-content');
  const PAGE_SIZE = 24;
  let currentPage = 1;
  let total = 0;

  const fetchAndRender = async (page) => {
    const params = { limit: PAGE_SIZE, sort, page };
    if (category) params.category = category;

    let videos = [], error = null;
    try {
      const data = await LegendAPI.videos.list(params);
      videos = data.videos || [];
      total  = data.total || 0;
    } catch (err) {
      error = err.message || String(err);
      console.error('[AVN] Video list error:', err);
    }

    const grid = document.getElementById('som-list-grid');
    if (!grid) return;

    if (error) {
      if (page === 1) {
        grid.innerHTML = `<div style="grid-column:1/-1">${renderEmptyVideoSection('Failed to load videos: ' + escapeHtml(error))}</div>`;
      }
      return;
    }

    const cards = videos.map(v => renderVideoCardHtml(v)).join('');
    if (page === 1) {
      grid.innerHTML = cards || renderEmptyVideoSection('No videos available yet.');
    } else {
      grid.insertAdjacentHTML('beforeend', cards);
    }
    bindVideoCardClicks(grid);

    // Update total count
    const countEl = document.getElementById('som-list-count');
    if (countEl && total) countEl.textContent = `${formatCount(total)} videos`;

    // Show/hide Load More
    const loadMoreBtn = document.getElementById('som-load-more');
    if (loadMoreBtn) {
      const loaded = page * PAGE_SIZE;
      loadMoreBtn.style.display = loaded < total ? 'block' : 'none';
    }
  };

  container.innerHTML = `
    <div style="padding-bottom:var(--space-2xl)">
      <div class="midnight-section">
        <div class="midnight-section-header">
          <span class="midnight-section-title">${escapeHtml(heading || 'VIDEOS')}</span>
          <span style="font-size:0.78rem;color:var(--text-muted)" id="som-list-count"></span>
        </div>
      </div>
      <div class="midnight-grid" id="som-list-grid">
        <div style="grid-column:1/-1" class="loading-state"><div class="spinner"></div></div>
      </div>
      <div style="text-align:center;padding:var(--space-lg)">
        <button class="btn btn-outline" id="som-load-more" style="display:none" aria-label="Load more videos">
          Load More
        </button>
      </div>
    </div>
  `;

  await fetchAndRender(1);

  // Load More handler
  document.getElementById('som-load-more')?.addEventListener('click', async () => {
    currentPage++;
    const btn = document.getElementById('som-load-more');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
    await fetchAndRender(currentPage);
    if (btn) { btn.disabled = false; btn.textContent = 'Load More'; }
  });
}

/* ─── Live Tab ───────────────────────────────────────────── */
async function loadLiveTab(container) {
  container = document.getElementById('som-content');
  let streams = [], error = null;
  try {
    const data = await LegendAPI.streams.list('live');
    streams = data.streams || [];
  } catch (err) { error = err.message; }

  container.innerHTML = `
    <div style="padding-bottom:var(--space-2xl)">
      <div class="midnight-section">
        <div class="midnight-section-header">
          <span class="midnight-section-title">
            <span class="midnight-live-dot"></span>LIVE NOW
          </span>
        </div>
      </div>
      ${streams.length === 0 ? `
        <div class="midnight-empty">
          <span class="midnight-empty-icon">📡</span>
          <h3>NO LIVE STREAMS RIGHT NOW</h3>
          <p>Check back later. Only active live streams appear here.</p>
        </div>
      ` : `
        <div class="midnight-grid">
          ${streams.map(s => renderLiveCardHtml(s)).join('')}
        </div>
      `}
    </div>
  `;
}

/* ─── Channels Tab ───────────────────────────────────────── */
async function loadChannelsTab(container) {
  container = document.getElementById('som-content');
  let channels = [], error = null;
  try {
    const data = await LegendAPI.videos.channels({ limit: 24 });
    channels = data.channels || [];
  } catch (err) { error = err.message; }

  container.innerHTML = `
    <div style="padding-bottom:var(--space-2xl)">
      <div class="midnight-section">
        <div class="midnight-section-header">
          <span class="midnight-section-title">CHANNELS</span>
        </div>
      </div>
      ${channels.length === 0 ? `
        <div class="midnight-empty">
          <span class="midnight-empty-icon">📺</span>
          <h3>NO CHANNELS YET</h3>
          <p>Channels are created automatically when users upload videos. No channels exist yet.</p>
        </div>
      ` : `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-md);padding:0 var(--space-lg)">
          ${channels.map(c => renderChannelCardHtml(c)).join('')}
        </div>
      `}
    </div>
  `;

  container.querySelectorAll('[data-channel-id]').forEach(el => {
    el.addEventListener('click', () => openChannelPage(el.dataset.channelId));
  });
}

/* ─── Library Tab ────────────────────────────────────────── */
async function loadLibraryTab(container) {
  container = document.getElementById('som-content');

  const categories = ['All','Movies','Shows','Music','Gaming','Education','Comedy','Other'];
  let activeCategory = 'All';
  let sortBy = 'new';

  const renderLibrary = async () => {
    const grid = document.getElementById('som-library-grid');
    if (!grid) return;
    showLoading(grid, 'Loading...');
    try {
      const params = { limit: 24, sort: sortBy };
      if (activeCategory !== 'All') params.category = activeCategory.toLowerCase();
      const data = await LegendAPI.videos.list(params);
      const videos = data.videos || [];
      grid.innerHTML = videos.length
        ? videos.map(v => renderVideoCardHtml(v)).join('')
        : renderEmptyVideoSection('No videos in this category yet.');
      bindVideoCardClicks(grid);
    } catch (err) {
      console.warn('[AVN] Video library error:', err);
      grid.innerHTML = renderEmptyVideoSection('Videos are temporarily unavailable. Please try again later.');
    }
  };

  container.innerHTML = `
    <div style="padding-bottom:var(--space-2xl)">
      <div class="midnight-section">
        <div class="midnight-section-header">
          <span class="midnight-section-title">VIDEO LIBRARY</span>
        </div>
        <!-- Category Filters -->
        <div class="midnight-filters" id="som-cat-filters" role="group" aria-label="Category filter">
          ${categories.map(c => `
            <button class="midnight-filter-chip${c === 'All' ? ' active' : ''}" data-cat="${c}" aria-pressed="${c === 'All'}">${escapeHtml(c)}</button>
          `).join('')}
        </div>
        <!-- Sort -->
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:var(--space-md)">
          <label style="font-size:0.8rem;color:var(--text-muted)" for="som-sort-select">Sort:</label>
          <select id="som-sort-select" class="form-input" style="width:auto;padding:4px 10px;font-size:0.82rem;background:var(--bg-elevated);border-color:rgba(0,168,255,0.2)">
            <option value="new">Newest</option>
            <option value="trending">Most Viewed</option>
            <option value="top">Top Liked</option>
          </select>
        </div>
      </div>
      <div class="midnight-grid" id="som-library-grid">
        <div class="loading-state" style="grid-column:1/-1"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  // Bind filter clicks
  document.getElementById('som-cat-filters')?.addEventListener('click', e => {
    const chip = e.target.closest('.midnight-filter-chip');
    if (!chip) return;
    document.querySelectorAll('#som-cat-filters .midnight-filter-chip').forEach(c => {
      c.classList.remove('active');
      c.setAttribute('aria-pressed', 'false');
    });
    chip.classList.add('active');
    chip.setAttribute('aria-pressed', 'true');
    activeCategory = chip.dataset.cat;
    renderLibrary();
  });

  document.getElementById('som-sort-select')?.addEventListener('change', e => {
    sortBy = e.target.value;
    renderLibrary();
  });

  await renderLibrary();
}

/* ─── Watch Later Tab ────────────────────────────────────── */
async function loadWatchLaterTab(container) {
  container = document.getElementById('som-content');
  showLoading(container, 'Loading Watch Later...');

  let list = SOM.watchLater;

  // Try to fetch from server if logged in (server is source of truth)
  if (LegendAPI.auth.isLoggedIn()) {
    try {
      const data = await LegendAPI.videos.getWatchLater();
      list = data.videos || [];
      // Sync to local
      SOM.watchLater = list.map(v => ({ ...v, id: v._id || v.id }));
      SOM.saveWatchLater();
    } catch {
      // Fall back to local list silently
    }
  }

  container.innerHTML = `
    <div style="padding-bottom:var(--space-2xl)">
      <div class="midnight-section">
        <div class="midnight-section-header">
          <span class="midnight-section-title">WATCH LATER</span>
          ${list.length ? `<span style="font-size:0.78rem;color:var(--text-muted)">${list.length} video${list.length !== 1 ? 's' : ''}</span>` : ''}
        </div>
        ${list.length ? `<button class="btn btn-outline btn-sm" onclick="somClearWatchLater()" style="margin-bottom:var(--space-md)">Clear All</button>` : ''}
        ${LegendAPI.auth.isLoggedIn()
          ? `<p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:var(--space-sm)">Synced to your account.</p>`
          : `<p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:var(--space-sm)">Saved locally. <button class="btn btn-ghost btn-sm" onclick="Modal.open('auth-modal')" style="font-size:0.73rem">Sign in</button> to sync across devices.</p>`}
      </div>
      <div id="som-wl-list" style="padding:0 var(--space-lg)">
        ${list.length ? list.map(v => renderSavedItemHtml(v, 'wl')).join('') : `
          <div class="midnight-empty">
            <span class="midnight-empty-icon">🕐</span>
            <h3>NOTHING SAVED YET</h3>
            <p>When you save a video to Watch Later, it will appear here.</p>
          </div>
        `}
      </div>
    </div>
  `;

  bindSavedListClicks(container, 'wl');
}

/* ─── History Tab ────────────────────────────────────────── */
async function loadHistoryTab(container) {
  container = document.getElementById('som-content');
  showLoading(container, 'Loading history...');

  let list = SOM.history;
  let fromServer = false;

  // Fetch from server when logged in
  if (LegendAPI.auth.isLoggedIn()) {
    try {
      const data = await LegendAPI.videos.getHistory();
      if (data.history?.length) {
        // Server history entries have video populated
        list = data.history.map(h => ({
          ...(h.video || {}),
          id: (h.video?._id || h.video?.id),
          watchedAt: h.watchedAt,
          position:  h.position,
        })).filter(v => v.id);
        // Merge into local history (server takes precedence)
        SOM.history = list;
        SOM.saveHistory();
        fromServer = true;
      }
    } catch {
      // Fall back to local list silently
    }
  }

  container.innerHTML = `
    <div style="padding-bottom:var(--space-2xl)">
      <div class="midnight-section">
        <div class="midnight-section-header">
          <span class="midnight-section-title">WATCH HISTORY</span>
          ${list.length ? `<span style="font-size:0.78rem;color:var(--text-muted)">${list.length} video${list.length !== 1 ? 's' : ''}</span>` : ''}
        </div>
        ${list.length ? `
          <button class="btn btn-outline btn-sm" onclick="somClearHistory()" style="margin-bottom:var(--space-md)">Clear History</button>
          <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:var(--space-sm)">
            ${fromServer
              ? 'Synced to your account. Only watch time is stored — no unnecessary personal data.'
              : 'Stored locally. Sign in for cloud sync.'}
          </p>
        ` : ''}
      </div>
      <div id="som-hist-list" style="padding:0 var(--space-lg)">
        ${list.length ? list.map(v => renderSavedItemHtml(v, 'hist')).join('') : `
          <div class="midnight-empty">
            <span class="midnight-empty-icon">📋</span>
            <h3>NO HISTORY YET</h3>
            <p>Videos you watch will appear here. Only video title and timestamp are stored — no unnecessary personal information.</p>
          </div>
        `}
      </div>
    </div>
  `;

  bindSavedListClicks(container, 'hist');
}

/* ─── Upload Tab ─────────────────────────────────────────── */
function loadUploadTab(container) {
  container = document.getElementById('som-content');

  if (!LegendAPI.auth.isLoggedIn()) {
    container.innerHTML = `
      <div class="midnight-empty" style="padding-top:var(--space-3xl)">
        <span class="midnight-empty-icon">🔒</span>
        <h3>SIGN IN REQUIRED</h3>
        <p>You must be signed in to upload videos.</p>
        <button class="btn btn-primary" onclick="Modal.open('auth-modal')">Sign In</button>
      </div>
    `;
    return;
  }

  const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
  const maxMB = Math.round(MAX_VIDEO_BYTES / (1024 * 1024));

  container.innerHTML = `
    <div class="av-upload-page">

      <!-- Hero -->
      <div class="av-upload-hero">
        <div class="av-upload-hero-title">AVENORA UPLOAD STUDIO</div>
        <div class="av-upload-hero-sub">Upload &amp; share your content with the AVENORA community</div>
      </div>

      <form id="som-upload-form" novalidate>

        <!-- Drop Zone -->
        <div class="av-drop-zone" id="som-drop-zone" role="button" tabindex="0" aria-label="Drop video file here or click to browse">
          <input type="file" id="som-video-file" accept="video/mp4,video/webm,video/ogg,video/quicktime,video/x-msvideo" aria-label="Select video file">
          <div id="som-drop-label">
            <div class="av-drop-icon">🎬</div>
            <div class="av-drop-label">Drop your video here or click to browse</div>
            <div class="av-drop-hint">Drag &amp; drop or tap to select</div>
            <div class="av-format-chips">
              <span class="av-format-chip">MP4</span>
              <span class="av-format-chip">WebM</span>
              <span class="av-format-chip">MOV</span>
              <span class="av-format-chip">AVI</span>
            </div>
            <div class="av-size-limit">Max ${maxMB} MB</div>
          </div>
        </div>

        <!-- File selected state -->
        <div id="som-file-info" style="display:none"></div>
        <div id="som-file-error" style="display:none;color:#ff5c6e;font-size:0.82rem;margin-bottom:8px"></div>

        <!-- Validation row -->
        <div class="av-validation-row" id="som-validation-row" style="display:none">
          <span class="av-val-item" id="av-val-type">◌ File type</span>
          <span class="av-val-item" id="av-val-size">◌ File size</span>
          <span class="av-val-item" id="av-val-ready">◌ Ready to upload</span>
        </div>

        <!-- Thumbnail -->
        <div class="som-field" style="margin-bottom:var(--space-md)">
          <label class="som-label" for="som-thumbnail" style="font-size:0.75rem;letter-spacing:0.1em;color:var(--text-muted)">
            THUMBNAIL
            <span style="font-weight:400;text-transform:none;letter-spacing:0;margin-left:6px;color:var(--text-muted)">optional · JPG/PNG/WebP · max 5 MB</span>
          </label>
          <input type="file" id="som-thumbnail" accept="image/jpeg,image/png,image/webp" class="som-file-input">
          <div id="som-thumb-preview" style="margin-top:10px;display:none">
            <img id="som-thumb-img" src="" alt="Thumbnail preview" class="som-thumb-preview-img">
          </div>
        </div>

        <!-- Title -->
        <div class="som-field" style="margin-bottom:var(--space-md)">
          <label class="som-label" for="som-title" style="font-size:0.75rem;letter-spacing:0.1em;color:var(--text-muted)">
            TITLE <span style="color:#c9a84c">*</span>
          </label>
          <input type="text" id="som-title" class="som-input" placeholder="Enter video title" maxlength="200" required>
          <small class="som-count" id="som-title-count">0 / 200</small>
        </div>

        <!-- Description -->
        <div class="som-field" style="margin-bottom:var(--space-md)">
          <label class="som-label" for="som-desc" style="font-size:0.75rem;letter-spacing:0.1em;color:var(--text-muted)">DESCRIPTION</label>
          <textarea id="som-desc" class="som-input som-textarea" placeholder="Describe your video…" rows="4" maxlength="5000"></textarea>
          <small class="som-count" id="som-desc-count">0 / 5000</small>
        </div>

        <!-- Category -->
        <div class="som-field" style="margin-bottom:var(--space-md)">
          <label class="som-label" for="som-category" style="font-size:0.75rem;letter-spacing:0.1em;color:var(--text-muted)">CATEGORY</label>
          <select id="som-category" class="som-input">
            <option value="other">Other</option>
            <option value="movies">Movies</option>
            <option value="shows">Shows</option>
            <option value="music">Music</option>
            <option value="short">Short Videos</option>
            <option value="gaming">Gaming</option>
            <option value="education">Education</option>
            <option value="comedy">Comedy</option>
          </select>
        </div>

        <!-- Visibility -->
        <div class="som-field" style="margin-bottom:var(--space-lg)">
          <label class="som-label" style="font-size:0.75rem;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:10px;display:block">VISIBILITY</label>
          <div class="av-visibility-group">
            ${[
              { val: 'public',   label: 'Public',   icon: '🌐', desc: 'Anyone can watch' },
              { val: 'unlisted', label: 'Unlisted',  icon: '🔗', desc: 'Only with link' },
              { val: 'private',  label: 'Private',   icon: '🔒', desc: 'Only you' },
            ].map((opt, i) => `
              <label class="av-vis-card${i === 0 ? ' selected' : ''}" onclick="document.querySelectorAll('.av-vis-card').forEach(c=>c.classList.remove('selected'));this.classList.add('selected')">
                <input type="radio" name="som-visibility" value="${opt.val}" ${i === 0 ? 'checked' : ''}>
                <div class="av-vis-icon">${opt.icon}</div>
                <div class="av-vis-label">${opt.label}</div>
                <div class="av-vis-desc">${opt.desc}</div>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Progress (hidden until upload starts) -->
        <div id="som-upload-progress" class="av-upload-progress" style="display:none">
          <div class="av-progress-header">
            <span id="som-progress-label">Uploading…</span>
            <span id="som-progress-pct" class="av-progress-pct">0%</span>
          </div>
          <div class="av-progress-bar-wrap">
            <div class="av-progress-bar-fill" id="som-progress-fill" style="width:0%"></div>
          </div>
          <div id="som-upload-status" class="av-progress-status"></div>
        </div>

        <div id="som-upload-result" style="display:none"></div>

        <button type="submit" class="btn btn-primary" id="som-upload-btn" style="width:100%;padding:14px;font-family:var(--font-display,'Cinzel',serif);letter-spacing:0.12em;font-size:0.9rem;margin-top:var(--space-sm)">
          🎬 UPLOAD VIDEO
        </button>

      </form>
    </div>
  `;

  // Wire up drop-zone visual feedback for drag events
  const dropZone = document.getElementById('som-drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
  }

  // Wire up file input → show selected state + validation row
  const fileInput = document.getElementById('som-video-file');
  const fileInfoEl = document.getElementById('som-file-info');
  const validationRow = document.getElementById('som-validation-row');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;

      // Show file-selected card
      const sizeMB = (f.size / (1024 * 1024)).toFixed(1);
      const ext = (f.name.split('.').pop() || '').toUpperCase();
      fileInfoEl.style.display = 'flex';
      fileInfoEl.className = 'av-file-selected';
      fileInfoEl.innerHTML = `
        <div class="av-file-selected-icon">✅</div>
        <div class="av-file-selected-info">
          <div class="av-file-selected-name">${escapeHtml(f.name)}</div>
          <div class="av-file-selected-meta">${ext} · ${sizeMB} MB</div>
        </div>
        <button type="button" class="av-file-remove" aria-label="Remove file" onclick="document.getElementById('som-video-file').value='';document.getElementById('som-file-info').style.display='none';document.getElementById('som-validation-row').style.display='none'">✕</button>
      `;

      // Validation row
      if (validationRow) {
        validationRow.style.display = 'flex';
        const isVideo = f.type.startsWith('video/') || /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(f.name);
        const isSize  = f.size <= MAX_VIDEO_BYTES;
        const typeEl  = document.getElementById('av-val-type');
        const sizeEl  = document.getElementById('av-val-size');
        const readyEl = document.getElementById('av-val-ready');
        if (typeEl) { typeEl.textContent = (isVideo ? '✓' : '✗') + ' File type'; typeEl.className = 'av-val-item ' + (isVideo ? 'ok' : 'fail'); }
        if (sizeEl) { sizeEl.textContent = (isSize ? '✓' : '✗') + ' File size'; sizeEl.className = 'av-val-item ' + (isSize ? 'ok' : 'fail'); }
        if (readyEl) { readyEl.textContent = (isVideo && isSize ? '✓' : '✗') + ' Ready to upload'; readyEl.className = 'av-val-item ' + (isVideo && isSize ? 'ok' : 'fail'); }
      }
    });
  }

  initUploadForm();
}

/* ─── Search Tab ─────────────────────────────────────────── */
async function loadSearchTab(container) {
  container = document.getElementById('som-content');
  const q = SOM.searchQuery;

  if (!q) {
    container.innerHTML = `
      <div class="midnight-empty">
        <span class="midnight-empty-icon">🔍</span>
        <h3>SEARCH AVENORA VIDEO</h3>
        <p>Enter a query above to search videos, channels, and categories.</p>
      </div>
    `;
    return;
  }

  let videos = [], channels = [], error = null;
  try {
    const data = await LegendAPI.search.search(q);
    videos   = data.results?.videos   || data.videos   || [];
    channels = data.results?.channels || data.channels || [];
  } catch (err) { error = err.message; }

  const total = videos.length + channels.length;

  container.innerHTML = `
    <div style="padding-bottom:var(--space-2xl)">
      <div class="midnight-section">
        <div class="midnight-section-header">
          <span class="midnight-section-title">RESULTS FOR "${escapeHtml(q)}"</span>
          <span style="font-size:0.78rem;color:var(--text-muted)">${total > 0 ? `${total} found` : ''}</span>
        </div>
      </div>

      ${channels.length ? `
        <div class="midnight-section" style="padding-bottom:0">
          <div class="midnight-section-header">
            <span class="midnight-section-title">CHANNELS</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--space-md);padding:0 var(--space-lg) var(--space-lg)">
          ${channels.map(c => renderChannelCardHtml(c)).join('')}
        </div>
      ` : ''}

      ${videos.length ? `
        <div class="midnight-section" style="padding-bottom:0">
          <div class="midnight-section-header">
            <span class="midnight-section-title">VIDEOS</span>
          </div>
        </div>
        <div class="midnight-grid">
          ${videos.map(v => renderVideoCardHtml(v)).join('')}
        </div>
      ` : ''}

      ${total === 0 && !error ? `
        <div class="midnight-empty">
          <span class="midnight-empty-icon">🔍</span>
          <h3>NO RESULTS</h3>
          <p>Nothing found for "${escapeHtml(q)}". Try different keywords.</p>
        </div>
      ` : ''}
    </div>
  `;

  bindVideoCardClicks(container);
  container.querySelectorAll('[data-channel-id]').forEach(el => {
    el.addEventListener('click', () => openChannelPage(el.dataset.channelId));
  });
}

/* ─── Channel Page ───────────────────────────────────────── */
async function openChannelPage(channelId) {
  const content = document.getElementById('som-content');
  showLoading(content, 'Loading channel...');

  let channel = null, videos = [], error = null;
  try {
    const data = await LegendAPI.videos.channel(channelId);
    channel = data.channel;
    videos  = data.videos || [];
  } catch (err) { error = err.message; }

  if (error || !channel) {
    showError(content, error || 'Channel not found', () => openChannelPage(channelId));
    return;
  }

  const isLoggedIn = LegendAPI.auth.isLoggedIn();
  const initial = (channel.name || '?')[0].toUpperCase();

  content.innerHTML = `
    <div style="padding-bottom:var(--space-2xl)">
      <!-- Banner -->
      <div class="midnight-channel-banner">
        ${channel.bannerUrl ? `<img src="${escapeHtml(channel.bannerUrl)}" alt="Channel banner" loading="lazy">` : ''}
        <div class="midnight-channel-banner-overlay"></div>
      </div>

      <!-- Channel Header -->
      <div class="midnight-channel-header">
        <div class="midnight-channel-avatar-lg">
          ${channel.avatarUrl
            ? `<img src="${escapeHtml(channel.avatarUrl)}" alt="${escapeHtml(channel.name)}">`
            : initial}
        </div>
        <div style="flex:1;min-width:0">
          <h2 style="font-family:var(--font-display);letter-spacing:0.06em;margin-bottom:4px">${escapeHtml(channel.name)}</h2>
          <div style="font-size:0.82rem;color:var(--text-muted)">
            ${formatCount(channel.subscriberCount || 0)} subscribers · ${formatCount(videos.length)} videos
          </div>
        </div>
        ${isLoggedIn ? `
          <button class="midnight-action-btn" id="som-follow-btn" onclick="somToggleFollow('${channelId}', this)">
            + Subscribe
          </button>
        ` : ''}
      </div>

      ${channel.description ? `
        <div class="midnight-description" style="margin:0 var(--space-lg)">
          ${escapeHtml(channel.description)}
        </div>
      ` : ''}

      <!-- Channel Videos -->
      <div class="midnight-section">
        <div class="midnight-section-header">
          <span class="midnight-section-title">VIDEOS</span>
        </div>
      </div>
      <div class="midnight-grid">
        ${videos.length
          ? videos.map(v => renderVideoCardHtml(v)).join('')
          : renderEmptyVideoSection('This channel has no videos yet.')}
      </div>
    </div>
  `;

  bindVideoCardClicks(content);
}

/* ─── Video Detail (full page in content area) ───────────── */
async function openVideoDetail(videoId) {
  const content = document.getElementById('som-content');
  showLoading(content, 'Loading video...');

  let video = null, errorCode = null, errorMsg = null;
  try {
    const data = await LegendAPI.videos.get(videoId);
    video = data.video || data;

    // Ensure we have a playback URL.
    // For Supabase public-bucket videos, videoUrl is the direct public CDN URL.
    // For MongoDB videos without a stored URL, fetch a fresh one from the backend.
    const hasUrl = video?.videoUrl || video?.hlsUrl || video?.originalFileUrl;
    if (video && !hasUrl) {
      try {
        const freshUrl = await LegendAPI.videos.getPlaybackUrl(videoId);
        if (freshUrl) {
          video.videoUrl        = freshUrl;
          video.hlsUrl          = freshUrl;
          video.originalFileUrl = freshUrl;
        } else if (video.storagePath) {
          // Reconstruct the public URL from storagePath for public videos bucket
          // Encode segments so Android Chrome can load the URL (MediaError code 4 fix)
          const encodedPath = video.storagePath.split('/').map(encodeURIComponent).join('/');
          video.videoUrl = `https://licuiqxkkfboqezzmsqu.supabase.co/storage/v1/object/public/videos/${encodedPath}`;
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn('[AVN] Video detail error:', err);
    errorCode = err.status === 404 ? 'VIDEO_NOT_FOUND'
               : err.code === 'API_NOT_CONFIGURED' || err.code === 'BACKEND_NOT_CONFIGURED' ? 'BACKEND_UNAVAILABLE'
               : err.code === 'BACKEND_UNREACHABLE' || err.code === 'BACKEND_NOT_RUNNING' ? 'BACKEND_UNAVAILABLE'
               : err.status === 401 ? 'AUTH_REQUIRED'
               : err.status === 403 ? 'ACCESS_DENIED'
               : 'DATABASE_ERROR';
    errorMsg = err.message;
  }

  if (!video) {
    const msgMap = {
      VIDEO_NOT_FOUND:   'Video not found.',
      BACKEND_UNAVAILABLE: 'The video service is currently unavailable. Please try again later.',
      AUTH_REQUIRED:     'Sign in to watch this video.',
      ACCESS_DENIED:     'You do not have permission to watch this video.',
      DATABASE_ERROR:    'Could not load this video. Please try again.',
    };
    const displayMsg = msgMap[errorCode] || (errorMsg || 'This video is temporarily unavailable.');
    showError(content, displayMsg, () => openVideoDetail(videoId));
    return;
  }

  // Record in history
  SOM.addToHistory(video, 0);
  SOM.currentVideo = video;

  const id = video._id || video.id;
  const isLoggedIn = LegendAPI.auth.isLoggedIn();
  const isLiked = SOM.isLiked(id);
  const isWL = SOM.isInWatchLater(id);

  content.innerHTML = `
    <div class="midnight-video-detail" id="som-video-detail">
      <!-- Back -->
      <button class="midnight-action-btn" style="margin-bottom:var(--space-md)" onclick="loadTab(SOM.currentTab || 'home')">
        ← Back
      </button>

      <!-- Player -->
      <div class="midnight-player-wrap" id="som-player-wrap">
        ${buildPlayerHtml(video)}
      </div>

      <!-- Title & Meta -->
      <div class="midnight-video-meta">
        <h2 class="midnight-video-title">${escapeHtml(video.title)}</h2>
        <div class="midnight-video-stats">
          <span>${formatCount(video.views || 0)} views</span>
          <span>·</span>
          <span>${formatDate(video.createdAt)}</span>
          ${video.category ? `<span>·</span><span style="text-transform:capitalize">${escapeHtml(video.category)}</span>` : ''}
        </div>
      </div>

      <!-- Action Bar -->
      <div class="midnight-action-bar">
        <button class="midnight-action-btn${isLiked ? ' active' : ''}" id="som-like-btn"
                onclick="somToggleLike('${id}', this)"
                aria-label="${isLiked ? 'Unlike video' : 'Like video'}"
                aria-pressed="${isLiked}">
          👍 <span id="som-like-count">${formatCount(video.likes?.length || 0)}</span>
        </button>

        <button class="midnight-action-btn${isWL ? ' active' : ''}" id="som-wl-btn"
                onclick="somToggleWatchLater('${id}', this)"
                aria-label="${isWL ? 'Remove from Watch Later' : 'Save to Watch Later'}"
                aria-pressed="${isWL}">
          🕐 ${isWL ? 'Saved' : 'Watch Later'}
        </button>

        <button class="midnight-action-btn" onclick="somOpenShare('${id}')" aria-label="Share video">
          🔗 Share
        </button>

        ${isLoggedIn ? `
          <button class="midnight-action-btn danger" onclick="somReportVideo('${id}')" aria-label="Report video">
            ⚑ Report
          </button>
        ` : ''}
      </div>

      <!-- Channel Bar -->
      ${video.uploader ? `
        <div class="midnight-channel-bar">
          <div class="midnight-channel-avatar" onclick="somOpenUploaderChannel('${video.uploader._id || video.uploader.id || ''}')">
            ${video.uploader.profile?.avatarUrl
              ? `<img src="${escapeHtml(video.uploader.profile.avatarUrl)}" alt="${escapeHtml(video.uploader.username)}">`
              : (video.uploader.profile?.displayName || video.uploader.username || '?')[0].toUpperCase()}
          </div>
          <div class="midnight-channel-info">
            <div class="midnight-channel-name" onclick="somOpenUploaderChannel('${video.uploader._id || video.uploader.id || ''}')">
              ${escapeHtml(video.uploader.profile?.displayName || video.uploader.username || 'Unknown')}
            </div>
            <div class="midnight-channel-subs">${escapeHtml(video.uploader.username || '')}</div>
          </div>
          ${isLoggedIn ? `
            <button class="midnight-action-btn" onclick="somFollowUploader('${video.uploader._id || video.uploader.id || ''}', this)">
              + Follow
            </button>
          ` : ''}
        </div>
      ` : ''}

      <!-- Description -->
      ${video.description ? `
        <div id="som-desc-wrap">
          <div class="midnight-description" id="som-desc-box" style="max-height:80px;overflow:hidden;position:relative">
            ${escapeHtml(video.description)}
            <div style="position:absolute;bottom:0;left:0;right:0;height:30px;background:linear-gradient(transparent,var(--bg-primary))"></div>
          </div>
          <button class="midnight-action-btn" style="margin-top:6px" onclick="somExpandDesc()" id="som-desc-toggle">Show more</button>
        </div>
      ` : ''}

      <!-- Comments -->
      <div class="midnight-comments-section" id="som-comments-section">
        <div class="midnight-section-header" style="padding:0">
          <span class="midnight-section-title">COMMENTS</span>
          <span style="font-size:0.78rem;color:var(--text-muted)" id="som-comment-count">Loading...</span>
        </div>
        ${isLoggedIn ? `
          <div class="midnight-comment-compose">
            <div class="midnight-channel-avatar" style="width:36px;height:36px;font-size:14px">
              ${(LegendAPI.auth.getUser()?.profile?.displayName || LegendAPI.auth.getUser()?.username || '?')[0].toUpperCase()}
            </div>
            <div style="flex:1">
              <textarea class="midnight-comment-input" id="som-comment-input" placeholder="Add a comment..." rows="2" maxlength="2000" aria-label="Write a comment"></textarea>
              <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">
                <button class="btn btn-ghost btn-sm" onclick="document.getElementById('som-comment-input').value=''">Cancel</button>
                <button class="btn btn-primary btn-sm" onclick="somPostComment('${id}')">Post</button>
              </div>
            </div>
          </div>
        ` : `
          <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:var(--space-md)">
            <button class="btn btn-ghost btn-sm" onclick="Modal.open('auth-modal')">Sign in</button> to comment.
          </p>
        `}
        <div id="som-comments-list">
          <div class="loading-state"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;

  // Initialize player error/event handlers after DOM is set
  initVideoElement(id);

  // Load comments
  loadComments(id);

  // Server-side history sync (non-blocking)
  if (isLoggedIn) {
    LegendAPI.videos.updateHistory(id, 0).catch(() => {});
  }
}

/* ─── Player HTML ────────────────────────────────────────── */
function buildPlayerHtml(video) {
  // Accept videoUrl (Supabase Storage), hlsUrl, or originalFileUrl (legacy API)
  const rawSrc = video.videoUrl || video.hlsUrl || video.originalFileUrl;
  if (!rawSrc) {
    return `
      <div class="av-player-error" style="position:relative;min-height:280px;border-radius:var(--radius-md)">
        <div class="av-player-error-icon">🎬</div>
        <div class="av-player-error-title">VIDEO NOT YET AVAILABLE</div>
        <div class="av-player-error-msg">
          Processing status: <strong>${escapeHtml(video.processingStatus || 'pending')}</strong><br>
          ${video.processingStatus === 'failed'
            ? 'This video failed to process. Please try re-uploading.'
            : 'This video is being processed. Check back soon.'}
        </div>
      </div>
    `;
  }

  // Ensure the URL is properly encoded so Android Chrome can load it.
  // We only encode the pathname — never re-encode an already-encoded URL.
  function _encodeSrc(url) {
    try {
      const u = new URL(url);
      u.pathname = u.pathname.split('/').map(seg => {
        try { return encodeURIComponent(decodeURIComponent(seg)); }
        catch { return encodeURIComponent(seg); }
      }).join('/');
      return u.toString();
    } catch {
      return url;
    }
  }
  const src = _encodeSrc(rawSrc);
  const thumbSrc = video.thumbnailUrl ? _encodeSrc(video.thumbnailUrl) : null;

  // Determine the MIME type to declare on <source>.
  // Declaring the correct type prevents browsers from firing MEDIA_ERR_SRC_NOT_SUPPORTED
  // when Supabase serves the file with Content-Type: application/octet-stream (which
  // it does when the content-type was not set at upload time).
  // Priority: video.mimeType (stored in Supabase music_library.mime_type) → inferred from extension.
  function _inferMime(url, stored) {
    if (stored && stored.startsWith('video/') && stored !== 'video/octet-stream') return stored;
    const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
    const map = {
      mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4',
      webm: 'video/webm',
      ogg: 'video/ogg', ogv: 'video/ogg',
      mkv: 'video/x-matroska',
      avi: 'video/x-msvideo',
    };
    return map[ext] || '';   // empty string → no type attr → let browser sniff
  }
  const mimeType = _inferMime(rawSrc, video.mimeType);

  return `
    <div class="avenora-player" id="som-player-container">
      <div class="avenora-player-stage" style="aspect-ratio:16/9;position:relative;background:#000;border-radius:var(--radius-md);overflow:hidden">
        <video
          id="som-video-el"
          controls
          playsinline
          preload="metadata"
          style="width:100%;height:100%;display:block;background:#000"
          aria-label="${escapeHtml(video.title)}"
          ${thumbSrc ? `poster="${escapeHtml(thumbSrc)}"` : ''}
        >
          <source src="${escapeHtml(src)}"${mimeType ? ` type="${escapeHtml(mimeType)}"` : ''}>
          <track kind="captions" label="Captions" srclang="en" id="som-captions-track">
        </video>
        <div class="avenora-player-overlay" id="som-player-overlay" style="display:none">
          <div class="avenora-player-overlay-inner">
            <div class="avenora-player-spinner"></div>
            <div class="avenora-player-overlay-msg" id="som-overlay-msg">Loading video…</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* After inserting player, attach error & progress handlers */
function initVideoElement(videoId) {
  const el = document.getElementById('som-video-el');
  if (!el) return;

  const wrap = document.getElementById('som-player-wrap');

  // ── Overlay helpers ──────────────────────────────────────
  function showOverlay(msg) {
    const ov = document.getElementById('som-player-overlay');
    const msgEl = document.getElementById('som-overlay-msg');
    if (ov) { ov.style.display = 'flex'; }
    if (msgEl) msgEl.textContent = msg || '';
  }
  function hideOverlay() {
    const ov = document.getElementById('som-player-overlay');
    if (ov) ov.style.display = 'none';
  }

  // ── Error card ───────────────────────────────────────────
  // canRetry=false must be respected for codec errors (codes 3/4 format fail).
  let retryCount = 0;
  const maxNetworkRetries = 3;

  const showPlayerError = (msg, detail = '', canRetry = false) => {
    wrap.innerHTML = `
      <div class="av-player-error" style="position:relative;min-height:280px;border-radius:var(--radius-md)">
        <div class="av-player-error-icon">⚠</div>
        <div class="av-player-error-title">VIDEO PLAYBACK ERROR</div>
        <div class="av-player-error-msg">${escapeHtml(msg)}${detail ? '<br><span style="font-size:0.75rem;opacity:0.7">' + escapeHtml(detail) + '</span>' : ''}</div>
        <div class="av-player-error-actions">
          ${canRetry && retryCount < maxNetworkRetries ? `
            <button class="btn btn-outline btn-sm" onclick="somRetryPlayer('${escapeHtml(videoId)}')">
              ↻ Try Again (${retryCount + 1}/${maxNetworkRetries})
            </button>
          ` : canRetry ? `
            <p style="color:var(--text-muted);font-size:0.8rem">Max retries reached. Check your connection.</p>
          ` : ''}
          <button class="btn btn-ghost btn-sm" onclick="loadTab(SOM.currentTab || 'home')">◀ Back to Videos</button>
        </div>
      </div>
    `;
  };

  // ── Error handler ────────────────────────────────────────
  // When a <source> element is rejected (canPlayType returns "") the browser fires
  // 'error' on the <source> element — el.error may be null at that point.
  // Attach the same handler to the <source> element so we always catch rejections.
  const sourceEl = el.querySelector('source');
  if (sourceEl) {
    sourceEl.addEventListener('error', () => {
      // Synthesise a code-4 error so the main handler can show a useful message.
      if (!el.error) {
        const src = sourceEl.src || el.currentSrc || '';
        const ext = (src.split('?')[0].split('.').pop() || '').toLowerCase();
        const badCodec = ['avi','mkv','wmv','flv','3gp','hevc','h265','ts'].includes(ext);
        const msg = badCodec
          ? `${ext.toUpperCase()} files are not supported on this browser.`
          : 'This video format is not supported on this device.';
        const detail = badCodec
          ? 'Please re-upload as MP4 (H.264 video + AAC audio) for best compatibility.'
          : 'Re-uploading as MP4 (H.264 + AAC) usually fixes this.';
        showPlayerError(msg, detail, false);
      }
    });
  }

  el.addEventListener('error', async () => {
    const err = el.error;
    if (!err) return;

    console.warn(`[SOM] Video error code=${err.code} videoId=${videoId}`, err.message || '');

    switch (err.code) {
      case 1:
        // MEDIA_ERR_ABORTED — user/browser cancelled; not a real error
        showPlayerError('Playback was stopped.', '', true);
        break;

      case 2:
        retryCount++;
        showPlayerError('Network connection interrupted.', 'Check your connection and try again.', true);
        break;

      case 3:
        // Codec/decode failure — retrying is pointless
        showPlayerError(
          'Video decoding error — this format may not be supported.',
          'Try re-uploading as MP4 (H.264 + AAC).',
          false
        );
        break;

      case 4: {
        // MEDIA_ERR_SRC_NOT_SUPPORTED.
        // Common causes on mobile/Android Chrome:
        //   1. The video file is genuinely an unsupported codec (e.g. AVI, MKV, HEVC)
        //   2. The URL is broken (404, wrong path, un-encoded special chars)
        //   3. The <video> had crossorigin="anonymous" set, causing a CORS-mode fetch
        //      that fails when the CDN doesn't return Access-Control-Allow-Origin.
        //      (crossorigin attr has been removed from buildPlayerHtml to prevent this)
        //
        // Probe WITHOUT CORS mode so we can distinguish 404 from codec issues.
        // el.currentSrc is set once the browser picks a <source>; fall back to reading
        // the <source> child's src attribute (now that we use <source> instead of src=).
        const videoSrc = el.currentSrc
          || el.querySelector('source')?.src
          || el.getAttribute('src')
          || '';
        let probeStatus = 0;
        let probeOk = false;
        if (videoSrc) {
          try {
            // no-cors probe: we only care about whether the resource exists, not its body
            const resp = await fetch(videoSrc, { method: 'HEAD', mode: 'no-cors' });
            // no-cors always returns type=opaque with status=0 — that still means reachable
            probeOk = true;
            probeStatus = resp.status;
          } catch {
            probeOk = false;
          }
        }

        let friendlyMsg, friendlyDetail, canRetry;
        if (!probeOk) {
          // Can't reach the URL at all → network or storage is down
          friendlyMsg = 'Cannot reach video storage.';
          friendlyDetail = 'Check your connection and try again.';
          canRetry = true;
          retryCount++;
        } else if (probeStatus === 404) {
          // URL is reachable but file is gone
          friendlyMsg = 'Video file not found.';
          friendlyDetail = 'The video may have been deleted. Please re-upload.';
          canRetry = false;
        } else {
          // URL is reachable (200/opaque) but the browser still can't play it.
          // Common causes:
          //   a) File was uploaded with Content-Type: application/octet-stream (Supabase
          //      sometimes does this). The <source type="..."> fix above should prevent
          //      this for new loads; here we just report what happened.
          //   b) Genuinely unsupported codec (AVI, MKV on some browsers, HEVC on Android)
          //   c) Corrupt or partially-uploaded file
          const ext = (videoSrc.split('?')[0].split('.').pop() || '').toLowerCase();
          const badCodec = ['avi','mkv','wmv','flv','3gp','hevc','h265','ts'].includes(ext);
          // .mov is only unsupported on some Android builds — don't definitively blame the codec
          const commonFormat = ['mp4','m4v','webm','ogg','ogv'].includes(ext);
          if (badCodec) {
            friendlyMsg = `${ext.toUpperCase()} files are not supported on this browser.`;
            friendlyDetail = 'Please re-upload as MP4 (H.264 video + AAC audio) for best compatibility.';
          } else if (commonFormat) {
            // MP4/WebM that won't play: likely a Content-Type or upload issue, not the codec.
            friendlyMsg = 'There was a problem playing this video.';
            friendlyDetail = 'The file may have uploaded incorrectly. Try refreshing, or re-upload the video if the problem persists.';
            canRetry = true;
            retryCount++;
          } else {
            friendlyMsg = 'This video cannot be played on this device.';
            friendlyDetail = 'The video codec may not be supported. Re-uploading as MP4 (H.264 + AAC) usually fixes this.';
          }
        }

        showPlayerError(friendlyMsg, friendlyDetail, canRetry);
        break;
      }

      default:
        retryCount++;
        showPlayerError('Playback error.', `Error code: ${err.code}`, true);
    }
  });

  // ── Loading / buffering state ────────────────────────────
  el.addEventListener('loadstart', () => showOverlay('Loading video…'));
  el.addEventListener('loadedmetadata', () => hideOverlay());
  el.addEventListener('canplay', () => { hideOverlay(); });
  el.addEventListener('waiting', () => showOverlay('Buffering…'));
  el.addEventListener('playing', () => hideOverlay());

  el.addEventListener('stalled', () => {
    console.warn('[SOM] Video stalled — buffering or network issue');
  });

  // ── Watch position tracking ──────────────────────────────
  el.addEventListener('timeupdate', throttle(() => {
    if (SOM.currentVideo) {
      const pos = Math.floor(el.currentTime);
      SOM.addToHistory(SOM.currentVideo, pos);
      if (LegendAPI.auth.isLoggedIn()) {
        LegendAPI.videos.updateHistory(videoId, pos).catch(() => {});
      }
    }
  }, 15000));

  // PiP support
  if (document.pictureInPictureEnabled) {
    el.addEventListener('enterpictureinpicture', () => {
      console.log('[SOM] Entered Picture-in-Picture');
    });
  }

  // Playback speed restoration
  const savedSpeed = LS.get('som_playback_speed', 1);
  el.playbackRate = savedSpeed;
  el.addEventListener('ratechange', () => {
    LS.set('som_playback_speed', el.playbackRate);
  });
}

window.somRetryPlayer = async function(videoId) {
  const wrap = document.getElementById('som-player-wrap');
  if (!wrap) return;
  wrap.innerHTML = `<div class="player-loading-overlay" style="position:relative;min-height:200px"><div class="spinner spinner-lg"></div></div>`;
  try {
    const data = await LegendAPI.videos.get(videoId);
    const video = data.video || data;

    // Always attempt to get a fresh playback URL (covers both signed and public URLs)
    const hasUrl = video.videoUrl || video.hlsUrl || video.originalFileUrl;
    if (!hasUrl) {
      try {
        const freshUrl = await LegendAPI.videos.getPlaybackUrl(videoId);
        if (freshUrl) {
          video.videoUrl = freshUrl;
          video.hlsUrl   = freshUrl;
          video.originalFileUrl = freshUrl;
        } else if (video.storagePath) {
          // Encode each path segment so the URL is valid on Android Chrome
          const encodedPath = video.storagePath.split('/').map(encodeURIComponent).join('/');
          video.videoUrl = `https://licuiqxkkfboqezzmsqu.supabase.co/storage/v1/object/public/videos/${encodedPath}`;
        }
      } catch (_) {}
    }

    wrap.innerHTML = buildPlayerHtml(video);
    initVideoElement(videoId);
  } catch (err) {
    console.warn('[AVN] Video load error:', err);
    const msg = err.status === 404 ? 'Video not found.'
              : err.status === 403 ? 'Access denied.'
              : 'Could not reload video. Please try again.';
    wrap.innerHTML = `
      <div class="player-error-overlay" style="position:relative;min-height:200px">
        <div class="player-error-icon">⚠️</div>
        <div class="player-error-msg">${escapeHtml(msg)}</div>
        <div class="player-error-sub">Error: ${escapeHtml(err.message || 'unknown')}</div>
      </div>
    `;
  }
};

/* ─── Comments ───────────────────────────────────────────── */
async function loadComments(videoId) {
  const list = document.getElementById('som-comments-list');
  const countEl = document.getElementById('som-comment-count');
  if (!list) return;

  try {
    const data = await LegendAPI.videos.comments(videoId);
    const comments = data.comments || [];
    if (countEl) countEl.textContent = `${comments.length} comment${comments.length !== 1 ? 's' : ''}`;

    if (!comments.length) {
      list.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;padding:var(--space-md) 0">No comments yet. Be the first!</p>`;
      return;
    }

    const me = LegendAPI.auth.getUser();
    const meId = me?._id || me?.id || '';
    const isMod = me && ['founder','admin','moderator'].includes(me.role);

    list.innerHTML = comments.map(c => {
      const cId   = c._id || c.id;
      const cUid  = c.author?._id || c.author?.id || '';
      const canDel = meId && (String(meId) === String(cUid) || isMod);
      return `
        <div class="midnight-comment-item" id="som-comment-${cId}">
          <div class="midnight-channel-avatar" style="width:36px;height:36px;font-size:13px">
            ${c.author?.profile?.avatarUrl
              ? `<img src="${escapeHtml(c.author.profile.avatarUrl)}" alt="${escapeHtml(c.author.username)}">`
              : (c.author?.profile?.displayName || c.author?.username || '?')[0].toUpperCase()}
          </div>
          <div class="midnight-comment-body">
            <div class="midnight-comment-header">
              <span class="midnight-comment-author">${escapeHtml(c.author?.username || 'Unknown')}</span>
              ${roleBadgeHtml(c.author?.role || '')}
              <span class="midnight-comment-time">${formatTimeAgo(c.createdAt)}</span>
            </div>
            <div class="midnight-comment-text">${escapeHtml(c.content || '')}</div>
            <div class="midnight-comment-actions">
              ${canDel ? `
                <button class="midnight-comment-action-btn danger" onclick="somDeleteComment('${videoId}','${cId}')" aria-label="Delete comment">Delete</button>
              ` : ''}
              ${meId ? `
                <button class="midnight-comment-action-btn" onclick="somReportComment('${cId}')" aria-label="Report comment">Report</button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.warn('[AVN] Video comments error:', err);
    if (list) {
      list.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:16px">Comments are temporarily unavailable.</p>`;
      if (countEl) countEl.textContent = '';
    }
  }
}

window.somPostComment = async function(videoId) {
  const input = document.getElementById('som-comment-input');
  if (!input) return;
  const content = input.value.trim();
  if (!content || content.length > 2000) {
    Toast.warning('Comment must be between 1 and 2000 characters.');
    return;
  }
  try {
    await LegendAPI.videos.addComment(videoId, content);
    input.value = '';
    Toast.success('Comment posted.');
    await loadComments(videoId);
  } catch (err) {
    console.warn('[AVN] Post comment error:', err);
    Toast.error('Your comment could not be sent. Please try again.');
  }
};

window.somDeleteComment = async function(videoId, commentId) {
  try {
    await LegendAPI.videos.deleteComment(videoId, commentId);
    document.getElementById(`som-comment-${commentId}`)?.remove();
    Toast.success('Comment deleted.');
  } catch (err) {
    console.warn('[AVN] Delete comment error:', err);
    Toast.error('This comment could not be deleted. Please try again.');
  }
};

window.somReportComment = function(commentId) {
  somOpenReport('comment', commentId);
};

/* ─── Likes ──────────────────────────────────────────────── */
window.somToggleLike = async function(videoId, btn) {
  if (!LegendAPI.auth.isLoggedIn()) {
    Modal.open('auth-modal');
    return;
  }
  const wasLiked = btn.classList.contains('active');
  // Optimistic update
  btn.classList.toggle('active', !wasLiked);
  btn.setAttribute('aria-pressed', String(!wasLiked));
  SOM.setLiked(videoId, !wasLiked);

  try {
    const data = await LegendAPI.videos.like(videoId);
    const countEl = document.getElementById('som-like-count');
    if (countEl) countEl.textContent = formatCount(data.likeCount || 0);
    SOM.setLiked(videoId, data.liked);
    btn.classList.toggle('active', data.liked);
    btn.setAttribute('aria-pressed', String(data.liked));
  } catch (err) {
    console.warn('[AVN] Video like error:', err);
    // Revert on failure
    btn.classList.toggle('active', wasLiked);
    btn.setAttribute('aria-pressed', String(wasLiked));
    SOM.setLiked(videoId, wasLiked);
    Toast.error('Something went wrong. Please try again.');
  }
};

/* ─── Watch Later ────────────────────────────────────────── */
window.somToggleWatchLater = async function(videoId, btn) {
  const was = SOM.isInWatchLater(videoId);
  // Optimistic local update
  if (was) {
    SOM.removeFromWatchLater(videoId);
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = '🕐 Watch Later';
  } else {
    if (SOM.currentVideo) SOM.addToWatchLater(SOM.currentVideo);
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    btn.textContent = '🕐 Saved';
  }

  // Server sync if logged in
  if (LegendAPI.auth.isLoggedIn()) {
    try {
      await LegendAPI.videos.toggleWatchLater(videoId);
      Toast.success(was ? 'Removed from Watch Later.' : 'Saved to Watch Later.');
    } catch (err) {
      console.warn('[AVN] Watch later error:', err);
      // Revert on failure
      if (was) {
        if (SOM.currentVideo) SOM.addToWatchLater(SOM.currentVideo);
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        btn.textContent = '🕐 Saved';
      } else {
        SOM.removeFromWatchLater(videoId);
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
        btn.textContent = '🕐 Watch Later';
      }
      Toast.error('Something went wrong. Please try again.');
    }
  } else {
    Toast.success(was ? 'Removed from Watch Later.' : 'Saved to Watch Later.');
  }
};

window.somClearWatchLater = async function() {
  if (!confirm('Clear all Watch Later videos?')) return;
  // Server-side removal (best effort — toggle each off)
  if (LegendAPI.auth.isLoggedIn()) {
    const ids = [...SOM.watchLater].map(v => v._id || v.id).filter(Boolean);
    await Promise.allSettled(ids.map(id => LegendAPI.videos.toggleWatchLater(id)));
  }
  SOM.watchLater = [];
  SOM.saveWatchLater();
  loadWatchLaterTab();
};

window.somClearHistory = async function() {
  if (!confirm('Clear your entire watch history?')) return;
  // Server-side removal (best effort)
  if (LegendAPI.auth.isLoggedIn()) {
    const ids = [...SOM.history].map(v => v._id || v.id).filter(Boolean);
    await Promise.allSettled(ids.map(id => LegendAPI.videos.deleteHistory(id)));
  }
  SOM.clearHistory();
  loadHistoryTab();
};

/* ─── Share ──────────────────────────────────────────────── */
window.somOpenShare = function(videoId) {
  const url = `${location.origin}${location.pathname}#video/${videoId}`;
  const tryNative = () => {
    if (navigator.share) {
      navigator.share({ title: SOM.currentVideo?.title || 'Avenora Video', url })
        .catch(err => { if (err.name !== 'AbortError') showShareFallback(url); });
    } else {
      showShareFallback(url);
    }
  };

  tryNative();
};

function showShareFallback(url) {
  Modal.create({
    id: 'som-share-modal',
    title: 'Share Video',
    body: `
      <div class="midnight-share-box">
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:var(--space-sm)">Copy link:</p>
        <div class="midnight-share-url">
          <input type="text" readonly value="${escapeHtml(url)}" id="som-share-url-input" onclick="this.select()" aria-label="Shareable video URL">
          <button class="btn btn-primary btn-sm" onclick="somCopyShareUrl()">Copy</button>
        </div>
      </div>
    `,
  });
  Modal.open('som-share-modal');
}

window.somCopyShareUrl = function() {
  const input = document.getElementById('som-share-url-input');
  if (!input) return;
  try {
    navigator.clipboard.writeText(input.value).then(() => {
      Toast.success('Link copied to clipboard!');
      Modal.close('som-share-modal');
    }).catch(() => {
      input.select();
      document.execCommand('copy');
      Toast.success('Link copied!');
      Modal.close('som-share-modal');
    });
  } catch {
    input.select();
    Toast.info('Select the text above and copy manually.');
  }
};

/* ─── Report ─────────────────────────────────────────────── */
window.somReportVideo = function(videoId) {
  somOpenReport('video', videoId);
};

window.somOpenReport = function(type, targetId) {
  if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }
  Modal.create({
    id: 'som-report-modal',
    title: `Report ${type.charAt(0).toUpperCase() + type.slice(1)}`,
    body: `
      <div>
        <div class="form-group">
          <label class="form-label" for="som-report-reason">Reason</label>
          <select id="som-report-reason" class="form-input">
            <option value="spam">Spam</option>
            <option value="inappropriate">Inappropriate content</option>
            <option value="copyright">Copyright violation</option>
            <option value="misinformation">Misinformation</option>
            <option value="harassment">Harassment</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="som-report-details">Details (optional)</label>
          <textarea id="som-report-details" class="form-input" rows="3" maxlength="500" placeholder="Provide additional context..."></textarea>
        </div>
        <div id="som-report-error" style="color:var(--neon-red);font-size:0.82rem;display:none;margin-bottom:8px"></div>
        <button class="btn btn-primary w-full" onclick="somSubmitReport('${type}','${targetId}')">Submit Report</button>
      </div>
    `,
  });
  Modal.open('som-report-modal');
};

window.somSubmitReport = async function(type, targetId) {
  const reason  = document.getElementById('som-report-reason')?.value;
  const details = document.getElementById('som-report-details')?.value || '';
  const errEl   = document.getElementById('som-report-error');
  try {
    await LegendAPI.reports.submit(type, targetId, reason, details);
    Modal.close('som-report-modal');
    Toast.success('Report submitted. Thank you.');
  } catch (err) {
    console.warn('[AVN] Video report error:', err);
    if (errEl) { errEl.textContent = 'Your report could not be submitted. Please try again.'; errEl.style.display = 'block'; }
  }
};

/* ─── Subscribe/Follow Channel ───────────────────────────── */
window.somToggleFollow = async function(channelId, btn) {
  if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }
  const isFollowing = btn.classList.contains('active');
  try {
    const data = await LegendAPI.videos.subscribeChannel(channelId);
    if (data.subscribed) {
      btn.textContent = '✓ Subscribed';
      btn.classList.add('active');
      Toast.success('Subscribed to channel.');
    } else {
      btn.textContent = '+ Subscribe';
      btn.classList.remove('active');
      Toast.info('Unsubscribed from channel.');
    }
  } catch (err) {
    console.warn('[AVN] Subscribe error:', err);
    Toast.error('Something went wrong. Please try again.');
  }
};

window.somFollowUploader = async function(uploaderId, btn) {
  if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }
  try {
    // uploaderId here is a User ID — find or create their channel, then subscribe
    // For now, use the user follow system as fallback
    await LegendAPI.users.follow(uploaderId);
    btn.textContent = '✓ Following';
    btn.classList.add('active');
    Toast.success('Following creator.');
  } catch (err) {
    console.warn('[AVN] Follow error:', err);
    Toast.error('Something went wrong. Please try again.');
  }
};

window.somOpenUploaderChannel = function(uploaderId) {
  if (uploaderId) openChannelPage(uploaderId);
};

/* ─── Description expand ─────────────────────────────────── */
window.somExpandDesc = function() {
  const box = document.getElementById('som-desc-box');
  const btn = document.getElementById('som-desc-toggle');
  if (!box) return;
  box.style.maxHeight = '';
  box.style.overflow = 'visible';
  const overlay = box.querySelector('div[style*="linear-gradient"]');
  if (overlay) overlay.remove();
  if (btn) btn.style.display = 'none';
};

/* ─── Retry metadata without re-uploading the file ──────── */
window.somRetryMetadata = async function () {
  const payload = window._somPendingMetaPayload;
  const resultEl = document.getElementById('som-upload-result');
  if (!payload) {
    if (resultEl) {
      resultEl.innerHTML = '<p style="color:var(--neon-red);font-size:0.82rem">No pending upload to retry. Please start a fresh upload.</p>';
    }
    return;
  }

  if (resultEl) {
    resultEl.innerHTML = `
      <div style="background:rgba(0,168,255,0.05);border:1px solid rgba(0,168,255,0.2);border-radius:var(--radius-md);padding:var(--space-md)">
        <p style="font-size:0.82rem;color:var(--text-secondary)">Retrying metadata save…</p>
        <div class="spinner" style="margin:8px auto"></div>
      </div>
    `;
  }

  try {
    if (!window.AvenoraStorage?.retryMetadataOnly) {
      throw new Error('Storage service not ready. Refresh the page and try again.');
    }
    const data = await window.AvenoraStorage.retryMetadataOnly(payload);
    window._somPendingMetaPayload = null;

    if (resultEl) {
      resultEl.innerHTML = `
        <div style="background:rgba(0,232,122,0.07);border:1px solid rgba(0,232,122,0.25);border-radius:var(--radius-md);padding:var(--space-md)">
          <p style="color:var(--midnight-green,#00e87a);font-weight:700;margin-bottom:6px">✓ Video saved!</p>
          <p style="font-size:0.82rem;color:var(--text-secondary)">
            "${escapeHtml(payload.title)}" has been saved and is ready to watch.
          </p>
          <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="loadTab('new')">View Videos</button>
        </div>
      `;
    }
  } catch (retryErr) {
    console.warn('[AVN] Metadata retry error:', retryErr);
    const msg = retryErr.message || 'Retry failed. Please try again.';
    if (resultEl) {
      resultEl.innerHTML = `
        <div style="background:rgba(255,51,68,0.07);border:1px solid rgba(255,51,68,0.25);border-radius:var(--radius-md);padding:var(--space-md)">
          <p style="color:var(--neon-red);font-weight:700;margin-bottom:6px">⚠ Retry failed</p>
          <p style="font-size:0.82rem;color:var(--text-secondary)">${escapeHtml(msg)}</p>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="somRetryMetadata()">Try Again</button>
            <button class="btn btn-outline btn-sm"
                    onclick="document.getElementById('som-upload-result').style.display='none'">Dismiss</button>
          </div>
        </div>
      `;
    }
  }
};

/* ─── Upload Form ────────────────────────────────────────── */
function initUploadForm() {
  const ALLOWED_VIDEO_TYPES = ['video/mp4','video/webm','video/ogg','video/quicktime','video/x-msvideo'];
  const ALLOWED_THUMB_TYPES = ['image/jpeg','image/png','image/webp'];
  // Application-level video size limit. Supabase Storage is configured to 500 MB.
  // Files above this limit are rejected before any upload attempt begins.
  const MAX_VIDEO_BYTES = 500 * 1024 * 1024;        // 500 MB
  const MAX_THUMB_BYTES = 5 * 1024 * 1024;           // 5 MB

  let selectedVideoFile = null;

  const videoInput  = document.getElementById('som-video-file');
  const thumbInput  = document.getElementById('som-thumbnail');
  const titleInput  = document.getElementById('som-title');
  const descInput   = document.getElementById('som-desc');
  const titleCount  = document.getElementById('som-title-count');
  const descCount   = document.getElementById('som-desc-count');
  const fileInfo    = document.getElementById('som-file-info');
  const fileError   = document.getElementById('som-file-error');
  const dropZone    = document.getElementById('som-drop-zone');
  const form        = document.getElementById('som-upload-form');

  const showFileError = msg => {
    fileError.textContent = msg;
    fileError.style.display = 'block';
    fileInfo.style.display = 'none';
    selectedVideoFile = null;
  };

  const clearFileError = () => { fileError.style.display = 'none'; };

  const validateVideo = (file) => {
    if (!file) return 'Please select a video file.';
    if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
      return `Unsupported format: ${file.type || 'unknown'}. Use MP4, WebM, MOV, or AVI.`;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      return `Video is too large. Maximum video size is 500 MB. ` +
             `Your file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`;
    }
    if (file.size === 0) return 'File is empty. Please select a valid video.';
    return null;
  };

  const handleVideoFile = (file) => {
    clearFileError();
    const err = validateVideo(file);
    if (err) { showFileError(err); return; }
    selectedVideoFile = file;
    fileInfo.style.display = 'block';
    fileInfo.textContent = `Selected: ${escapeHtml(file.name)} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
  };

  videoInput?.addEventListener('change', e => {
    if (e.target.files[0]) handleVideoFile(e.target.files[0]);
  });

  // Click on the drop zone opens the file picker (the file input itself is hidden)
  if (dropZone) {
    dropZone.addEventListener('click', (e) => {
      // Only trigger when clicking the zone itself or its non-input children
      if (e.target !== videoInput) videoInput?.click();
    });
    dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); videoInput?.click(); }
    });
  }

  // Drag & drop
  if (dropZone) {
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleVideoFile(file);
    });
  }

  // Thumbnail preview
  thumbInput?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!ALLOWED_THUMB_TYPES.includes(file.type)) {
      Toast.warning('Thumbnail must be JPG, PNG, or WebP.');
      thumbInput.value = '';
      return;
    }
    if (file.size > MAX_THUMB_BYTES) {
      Toast.warning('Thumbnail must be under 5 MB.');
      thumbInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      const preview = document.getElementById('som-thumb-preview');
      const img = document.getElementById('som-thumb-img');
      if (img) img.src = ev.target.result;
      if (preview) preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  });

  // Character counters
  titleInput?.addEventListener('input', () => {
    if (titleCount) titleCount.textContent = `${titleInput.value.length} / 200`;
  });
  descInput?.addEventListener('input', () => {
    if (descCount) descCount.textContent = `${descInput.value.length} / 5000`;
  });

  // Form submit — uploads to Supabase Storage via AVENORA backend, then saves metadata to MongoDB.
  let _uploadInProgress = false;
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    if (_uploadInProgress) return; // prevent duplicate submission on multiple taps
    const title = titleInput?.value.trim();
    if (!title) { Toast.warning('Please enter a title.'); titleInput?.focus(); return; }
    if (!selectedVideoFile) { Toast.warning('Please select a video file.'); return; }

    const progressWrap  = document.getElementById('som-upload-progress');
    const progressFill  = document.getElementById('som-progress-fill');
    const progressPct   = document.getElementById('som-progress-pct');
    const progressLabel = document.getElementById('som-progress-label');
    const statusEl      = document.getElementById('som-upload-status');
    const resultEl      = document.getElementById('som-upload-result');
    const uploadBtn     = document.getElementById('som-upload-btn');

    _uploadInProgress = true;
    progressWrap.style.display = 'block';
    resultEl.style.display = 'none';
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'UPLOADING...';

    const category    = document.getElementById('som-category')?.value || 'other';
    const visibility  = document.querySelector('input[name="som-visibility"]:checked')?.value || 'public';
    const description = descInput?.value.trim() || '';

    try {
      const user = LegendState.get('user');
      if (!user) throw new Error('You must be signed in to upload videos.');

      // Wait up to 5 s for the Supabase Storage service to initialise.
      // If the SW served a cached page without supabase.js this gives it time to catch up.
      if (!window.AvenoraStorage) {
        statusEl.textContent = 'Waiting for storage service…';
        for (let _i = 0; _i < 20 && !window.AvenoraStorage; _i++) {
          await new Promise(r => setTimeout(r, 250));
        }
      }
      if (!window.AvenoraStorage) {
        console.error('[AVENORA] AvenoraStorage not found after 5 s. supabase.js may not have loaded.');
        throw new Error(
          'Storage service failed to load. ' +
          'Hard-refresh the page (Ctrl+Shift+R / ⌘+Shift+R) to clear the browser cache and try again.'
        );
      }

      // ── Upload video + thumbnail via backend → Supabase Storage ──
      progressLabel.textContent = 'Uploading video…';
      statusEl.textContent = 'Transferring to Supabase Storage…';
      progressFill.style.width = '0%';
      progressPct.textContent = '0%';

      const thumbFile = thumbInput?.files[0] || null;

      const data = await window.AvenoraStorage.uploadVideoWithMeta(
        selectedVideoFile,
        thumbFile,
        { title, description, category, visibility },
        (pct) => {
          if (progressFill) progressFill.style.width = `${pct}%`;
          if (progressPct)  progressPct.textContent  = `${pct}%`;
          if (pct === 100) {
            progressLabel.textContent = 'Finalising…';
            statusEl.textContent = 'Saving to database…';
          }
        }
      );

      progressFill.style.width = '100%';
      progressPct.textContent = '100%';

      // ── Success ────────────────────────────────────────────────
      progressLabel.textContent = 'Upload complete!';
      statusEl.textContent = 'Your video is now live.';

      resultEl.style.display = 'block';
      resultEl.innerHTML = `
        <div style="background:rgba(0,232,122,0.07);border:1px solid rgba(0,232,122,0.25);border-radius:var(--radius-md);padding:var(--space-md);margin-top:var(--space-sm)">
          <p style="color:var(--midnight-green,#00e87a);font-weight:700;margin-bottom:6px">✓ Upload successful!</p>
          <p style="font-size:0.82rem;color:var(--text-secondary)">
            "${escapeHtml(title)}" has been uploaded and is now ready to watch.
          </p>
          <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="loadTab('new')">View Videos</button>
        </div>
      `;

      _uploadInProgress = false;
      uploadBtn.textContent = 'UPLOAD ANOTHER';
      uploadBtn.disabled = false;
      form.reset();
      selectedVideoFile = null;
      fileInfo.style.display = 'none';
      const preview = document.getElementById('som-thumb-preview');
      if (preview) preview.style.display = 'none';

    } catch (err) {
      _uploadInProgress = false;
      progressWrap.style.display = 'none';
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'UPLOAD VIDEO';

      console.warn('[AVN] Video upload error:', err);

      // Determine user-visible error message and whether a retry is possible.
      let errMsg = err.message || 'Your video could not be uploaded. Please try again.';
      let retryHtml = '';

      if (err.code === 'FILE_TOO_LARGE_FOR_STORAGE') {
        // Storage bucket rejected the file — happens when bucket limit < file size.
        // Our videos bucket is configured to 500 MB; this path means the bucket
        // was not yet updated. Show a clear actionable message.
        errMsg = 'Upload failed because the storage limit rejected this file. ' +
                 'Maximum video size is 500 MB. ' +
                 'If this video is under 500 MB, the storage bucket limit needs to be ' +
                 'updated — run scripts/fix-video-bucket-limit.js.';
      } else if (err.code === 'BACKEND_NOT_CONFIGURED' || err.code === 'API_NOT_CONFIGURED') {
        errMsg = 'Video upload service is not configured. Please use Supabase Storage for uploads.';
      } else if (err.code === 'SERVICE_NOT_RUNNING' || err.code === 'SERVICE_UNREACHABLE') {
        errMsg = 'Cannot reach the upload service. ' +
                 'Network error: ' + escapeHtml(err.originalError || '');
      } else if (err.code === 'UNAUTHORIZED') {
        errMsg = 'Your session has expired. Please sign in again, then retry your upload.';
      } else if (err.code === 'FORBIDDEN') {
        errMsg = 'You do not have permission to upload videos.';
      }

      // If file uploaded but metadata save failed — offer retry without re-uploading
      if (err.isOrphanRisk && err.metaPayload) {
        const _pendingPayload = err.metaPayload;
        // Store on window temporarily for the retry button
        window._somPendingMetaPayload = _pendingPayload;
        retryHtml = `
          <button class="btn btn-primary btn-sm" style="margin-top:8px;margin-right:8px"
                  onclick="somRetryMetadata()">
            Retry Metadata (no re-upload)
          </button>`;
        errMsg += ' The video file is safely stored. Use the retry button to save the record without uploading again.';
      }

      resultEl.style.display = 'block';
      resultEl.innerHTML = `
        <div style="background:rgba(255,51,68,0.07);border:1px solid rgba(255,51,68,0.25);border-radius:var(--radius-md);padding:var(--space-md)">
          <p style="color:var(--neon-red);font-weight:700;margin-bottom:6px">⚠ Upload failed</p>
          <p style="font-size:0.82rem;color:var(--text-secondary)">${escapeHtml(errMsg)}</p>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            ${retryHtml}
            <button class="btn btn-primary btn-sm"
                    onclick="document.getElementById('som-upload-result').style.display='none';document.getElementById('som-upload-btn').disabled=false;document.getElementById('som-upload-btn').textContent='UPLOAD VIDEO'">
              Retry
            </button>
            <button class="btn btn-outline btn-sm"
                    onclick="document.getElementById('som-upload-result').style.display='none'">Dismiss</button>
          </div>
        </div>
      `;
    }
  });
}

/* ─── Render Helpers ─────────────────────────────────────── */
function renderVideoCardHtml(v) {
  const id    = v._id || v.id;
  const title = v.title || 'Untitled';
  const uploader = v.uploader?.profile?.displayName || v.uploader?.username || '';
  const initial = uploader ? uploader[0].toUpperCase() : '?';
  const views = formatCount(v.views || 0);
  const ago   = formatTimeAgo(v.createdAt);
  const dur   = v.duration ? formatDuration(v.duration) : '';

  return `
    <div class="video-card-midnight" 
         data-video-id="${escapeHtml(id)}"
         role="button"
         tabindex="0"
         aria-label="Watch ${escapeHtml(title)}">
      <div class="video-thumb-wrap">
        ${v.thumbnailUrl
          ? `<img src="${escapeHtml(v.thumbnailUrl)}" alt="${escapeHtml(title)}" loading="lazy">`
          : `<div class="video-thumb-empty">🎬</div>`}
        ${dur ? `<span class="video-duration-badge" aria-label="Duration ${dur}">${escapeHtml(dur)}</span>` : ''}
        ${v.isLive ? `<span class="video-live-badge" aria-label="Live stream">LIVE</span>` : ''}
      </div>
      <div class="video-card-body">
        <div class="video-card-avatar">
          ${v.uploader?.profile?.avatarUrl
            ? `<img src="${escapeHtml(v.uploader.profile.avatarUrl)}" alt="${escapeHtml(uploader)}">`
            : initial}
        </div>
        <div class="video-card-info">
          <div class="video-card-title">${escapeHtml(title)}</div>
          <div class="video-card-meta">${escapeHtml(uploader)}</div>
          <div class="video-card-meta">${views} views · ${ago}</div>
        </div>
      </div>
    </div>
  `;
}

function renderLiveCardHtml(s) {
  const id    = s._id || s.id;
  const title = s.title || 'Live Stream';
  const host  = s.host?.username || s.streamer?.username || 'Unknown';

  return `
    <div class="video-card-midnight"
         data-stream-id="${escapeHtml(id)}"
         role="button"
         tabindex="0"
         aria-label="Watch live: ${escapeHtml(title)}">
      <div class="video-thumb-wrap">
        ${s.thumbnailUrl ? `<img src="${escapeHtml(s.thumbnailUrl)}" alt="${escapeHtml(title)}" loading="lazy">` : `<div class="video-thumb-empty">📡</div>`}
        <span class="video-live-badge" aria-label="Live stream">LIVE</span>
      </div>
      <div class="video-card-body">
        <div class="video-card-avatar">${host[0].toUpperCase()}</div>
        <div class="video-card-info">
          <div class="video-card-title">${escapeHtml(title)}</div>
          <div class="video-card-meta">${escapeHtml(host)}</div>
          <div class="video-card-meta">${formatCount(s.viewerCount || 0)} watching</div>
        </div>
      </div>
    </div>
  `;
}

function renderChannelCardHtml(c) {
  const id   = c._id || c.id;
  const name = c.name || c.username || 'Unknown Channel';
  const subs = formatCount(c.subscriberCount || 0);
  const vids = formatCount(c.videoCount || 0);
  const initial = name[0].toUpperCase();

  return `
    <div class="video-card-midnight" data-channel-id="${escapeHtml(id)}" role="button" tabindex="0" aria-label="Open channel ${escapeHtml(name)}"
         style="padding:var(--space-md);text-align:center">
      <div style="display:flex;justify-content:center;margin-bottom:var(--space-sm)">
        <div class="midnight-channel-avatar-lg" style="margin:0">
          ${c.avatarUrl ? `<img src="${escapeHtml(c.avatarUrl)}" alt="${escapeHtml(name)}">` : initial}
        </div>
      </div>
      <div class="video-card-title" style="text-align:center">${escapeHtml(name)}</div>
      <div class="video-card-meta" style="text-align:center">${subs} subscribers · ${vids} videos</div>
    </div>
  `;
}

function renderSavedItemHtml(v, type) {
  const id    = v._id || v.id;
  const title = v.title || 'Untitled';
  const uploader = v.uploader?.profile?.displayName || v.uploader?.username || v.uploader || '';
  const dur   = v.duration ? formatDuration(v.duration) : '';
  const time  = type === 'hist' ? `Watched ${formatTimeAgo(v.watchedAt)}` : (dur || '');

  return `
    <div class="midnight-saved-item"
         data-video-id="${escapeHtml(id)}"
         role="button"
         tabindex="0"
         aria-label="Watch ${escapeHtml(title)}">
      <div class="midnight-saved-thumb">
        ${v.thumbnailUrl
          ? `<img src="${escapeHtml(v.thumbnailUrl)}" alt="${escapeHtml(title)}" loading="lazy">`
          : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:rgba(0,168,255,0.3)">🎬</div>`}
      </div>
      <div class="midnight-saved-info">
        <div class="midnight-saved-title">${escapeHtml(title)}</div>
        <div class="midnight-saved-meta">${escapeHtml(uploader)}</div>
        <div class="midnight-saved-meta">${escapeHtml(time)}</div>
      </div>
      <button class="midnight-saved-remove"
              data-remove-id="${escapeHtml(id)}"
              data-remove-type="${type}"
              aria-label="Remove from ${type === 'wl' ? 'Watch Later' : 'History'}">✕</button>
    </div>
  `;
}

function renderEmptyVideoSection(msg) {
  return `
    <div style="grid-column:1/-1">
      <div class="midnight-empty">
        <span class="midnight-empty-icon">🎬</span>
        <p>${escapeHtml(msg)}</p>
      </div>
    </div>
  `;
}

/* ─── Event Binding ──────────────────────────────────────── */
function bindVideoCardClicks(root) {
  root.querySelectorAll('[data-video-id]').forEach(el => {
    const handler = () => openVideoDetail(el.dataset.videoId);
    el.addEventListener('click', handler);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  });
}

function bindSavedListClicks(root, type) {
  root.querySelectorAll('[data-video-id]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.dataset.removeId) return; // let remove button handle it
      openVideoDetail(el.dataset.videoId);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openVideoDetail(el.dataset.videoId); }
    });
  });

  root.querySelectorAll('[data-remove-id]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id   = btn.dataset.removeId;
      const kind = btn.dataset.removeType;
      if (kind === 'wl') {
        SOM.removeFromWatchLater(id);
        if (LegendAPI.auth.isLoggedIn()) {
          LegendAPI.videos.toggleWatchLater(id).catch(() => {});
        }
        loadWatchLaterTab();
      }
      if (kind === 'hist') {
        SOM.removeFromHistory(id);
        if (LegendAPI.auth.isLoggedIn()) {
          LegendAPI.videos.deleteHistory(id).catch(() => {});
        }
        loadHistoryTab();
      }
    });
  });
}

/* ─── Deep-link routing (hash: #video/<id>) ─────────────── */
(function handleVideoDeepLink() {
  const origHash = location.hash;
  const match = origHash.match(/^#video\/([^/]+)/);
  if (match && match[1]) {
    window._somPendingVideo = match[1];
  }
})();

// Expose globals needed elsewhere
window.SOM = SOM;
window.loadTab = loadTab;
window.openVideoDetail = openVideoDetail;
window.openChannelPage = openChannelPage;
