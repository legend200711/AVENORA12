/**
 * AVENORA — Discover Universe
 * Explore people, creators, rooms, posts, galleries, challenges, trending topics.
 * Replaces the old Global Search page with a universe discovery experience.
 */

registerPage('discover', {
  async render(container) {
    const query = LegendState.get('searchQuery') || '';

    container.innerHTML = `
      <div class="discover-page">
        <div class="discover-header">
          <h1 class="univ-page-title">DISCOVER UNIVERSE</h1>
          <p class="univ-page-tag">EXPLORE PEOPLE · CREATORS · ROOMS · CONTENT</p>
        </div>

        <!-- Search -->
        <div class="discover-search-wrap">
          <div class="discover-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--univ-text-muted)" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="search" id="discover-input" placeholder="Search people, rooms, galleries, posts…"
                   value="${escapeHtml(query)}"
                   oninput="DiscoverPage.search(this.value)"
                   aria-label="Discover AVENORA">
          </div>
        </div>

        <!-- Filter tabs -->
        <div class="discover-filters">
          <button class="discover-filter-btn active" onclick="DiscoverPage.setFilter('all',this)">All</button>
          <button class="discover-filter-btn" onclick="DiscoverPage.setFilter('people',this)">People</button>
          <button class="discover-filter-btn" onclick="DiscoverPage.setFilter('posts',this)">Posts</button>
          <button class="discover-filter-btn" onclick="DiscoverPage.setFilter('rooms',this)">Rooms</button>
          <button class="discover-filter-btn" onclick="DiscoverPage.setFilter('gallery',this)">Gallery</button>
        </div>

        <!-- Trending section (shown when no search) -->
        <div id="discover-trending" style="padding:0 var(--space-md)">
          <div class="univ-section"><p class="univ-section-title">Trending</p></div>
          <div id="discover-trending-list">
            <div class="loading-state" style="min-height:80px"><div class="spinner"></div></div>
          </div>
        </div>

        <!-- Results -->
        <div class="discover-results" id="discover-results" style="display:none"></div>
      </div>
    `;

    DiscoverPage._filter = 'all';

    // Subscribe to search query changes from nav search bar
    const unsub = LegendState.subscribe('searchQuery', (q) => {
      const input = document.getElementById('discover-input');
      if (input && q) { input.value = q; DiscoverPage.search(q); }
    });

    if (query) {
      DiscoverPage.search(query);
    } else {
      DiscoverPage.loadTrending();
    }

    return () => unsub();
  }
});

const DiscoverPage = {
  _filter: 'all',
  _searchTimer: null,

  setFilter(f, btn) {
    this._filter = f;
    document.querySelectorAll('.discover-filters .discover-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const query = document.getElementById('discover-input')?.value || '';
    if (query.trim().length >= 2) this.search(query);
  },

  search(query) {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this._doSearch(query), 320);
  },

  async _doSearch(query) {
    const resultsEl = document.getElementById('discover-results');
    const trendingEl = document.getElementById('discover-trending');
    if (!resultsEl) return;

    if (!query?.trim() || query.length < 2) {
      resultsEl.style.display = 'none';
      if (trendingEl) trendingEl.style.display = '';
      return;
    }

    if (trendingEl) trendingEl.style.display = 'none';
    resultsEl.style.display = '';
    resultsEl.innerHTML = `<div class="loading-state" style="min-height:80px"><div class="spinner"></div></div>`;

    try {
      // Search via the correct SearchAPI — LegendAPI.search.search(query, type)
      const filter = this._filter;
      let html = '';

      if (filter === 'all' || filter === 'people') {
        try {
          const data = await LegendAPI.search.search(query, 'users');
          const users = (data.results?.users || []);
          if (users.length) {
            html += `<div class="univ-section"><p class="univ-section-title">People</p></div>`;
            html += users.slice(0,8).map(u => this._renderUserRow(u)).join('');
          }
        } catch {}
      }

      if (filter === 'all' || filter === 'posts') {
        try {
          const data = await LegendAPI.search.search(query, 'posts');
          const posts = (data.results?.posts || []);
          if (posts.length) {
            html += `<div class="univ-section"><p class="univ-section-title">Posts</p></div>`;
            html += posts.slice(0,5).map(p => this._renderPostRow(p)).join('');
          }
        } catch {}
      }

      if (filter === 'all' || filter === 'rooms') {
        try {
          const { getFirestore } = window.AvenoraFirebase || {};
          if (getFirestore) {
            const db = await getFirestore();
            const { collection, query: fsQuery, where, orderBy, limit, getDocs } = await import(
              'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
            );
            const q = fsQuery(collection(db, 'rooms'), where('privacy', '==', 'public'), orderBy('createdAt', 'desc'), limit(10));
            const snap = await getDocs(q);
            const rooms = [];
            snap.forEach(doc => {
              const d = { id: doc.id, ...doc.data() };
              if ((d.name||'').toLowerCase().includes(query.toLowerCase())) rooms.push(d);
            });
            if (rooms.length) {
              html += `<div class="univ-section"><p class="univ-section-title">Rooms</p></div>`;
              html += rooms.slice(0,5).map(r => this._renderRoomRow(r)).join('');
            }
          }
        } catch {}
      }

      if (!html) {
        html = `<div class="error-state" style="min-height:120px">
          <div class="error-icon">🔭</div>
          <h3>No Results</h3>
          <p>Nothing found for "<strong>${escapeHtml(query)}</strong>". Try a different search.</p>
        </div>`;
      }

      resultsEl.innerHTML = html;
    } catch {
      resultsEl.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:var(--space-xl)">Search failed. Check your connection.</p>`;
    }
  },

  _renderUserRow(u) {
    const displayName = u.profile?.displayName || u.username || u.name;
    const initial = (displayName || '?')[0].toUpperCase();
    const avatarUrl = (typeof resolveAvatarUrl === 'function') ? resolveAvatarUrl(u) : u.profile?.avatarUrl;
    const avatarStyle = avatarUrl ? `background-image:url(${avatarUrl});background-size:cover;background-position:center` : '';
    return `
      <a href="#profile/${escapeHtml(u.uid||u._id||u.id||u.username||'')}" class="discover-result-row" data-page="profile"
         aria-label="${escapeHtml(displayName)}">
        <div style="width:40px;height:40px;border-radius:50%;background:var(--univ-card);border:1px solid var(--univ-border);display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;${avatarStyle}">
          ${avatarStyle ? '' : escapeHtml(initial)}
        </div>
        <div style="flex:1;min-width:0">
          <p style="font-size:0.9rem;font-weight:600;color:var(--univ-text);margin:0 0 2px">${escapeHtml(displayName)}</p>
          <p style="font-size:0.78rem;color:var(--univ-text-muted);margin:0">@${escapeHtml(u.username||'')}</p>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--univ-text-muted)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </a>`;
  },

  _renderPostRow(p) {
    return `
      <a href="#social" class="discover-result-row" aria-label="${escapeHtml(p.content||'Post').slice(0,60)}">
        <div style="width:40px;height:40px;border-radius:var(--radius-sm);background:rgba(0,102,255,0.10);border:1px solid var(--univ-border);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--univ-blue-electric)" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div style="flex:1;min-width:0">
          <p style="font-size:0.88rem;color:var(--univ-text);margin:0 0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.content||'')}</p>
          <p style="font-size:0.75rem;color:var(--univ-text-muted);margin:0">@${escapeHtml(p.author?.username||'')} · ${formatTimeAgo(p.createdAt)}</p>
        </div>
      </a>`;
  },

  _renderRoomRow(r) {
    return `
      <a href="#rooms" class="discover-result-row" aria-label="${escapeHtml(r.name||'Room')}">
        <div style="width:40px;height:40px;border-radius:var(--radius-sm);background:rgba(0,255,136,0.08);border:1px solid var(--univ-border-green);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">${r.emoji||'🌌'}</div>
        <div style="flex:1;min-width:0">
          <p style="font-size:0.9rem;font-weight:600;color:var(--univ-text);margin:0 0 2px">${escapeHtml(r.name||'Room')}</p>
          <p style="font-size:0.75rem;color:var(--univ-text-muted);margin:0">${(r.memberCount||0)} members · ${r.privacy||'public'}</p>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--univ-text-muted)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </a>`;
  },

  async loadTrending() {
    const list = document.getElementById('discover-trending-list');
    if (!list) return;

    try {
      // Load recent users via Firestore directly (no SearchAPI needed for trending)
      let users = [];
      try {
        const { getFirestore } = window.AvenoraFirebase || {};
        if (getFirestore) {
          const db = await getFirestore();
          const { collection, query: fsQuery, orderBy, limit, getDocs } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
          );
          const q = fsQuery(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(8));
          const snap = await getDocs(q);
          snap.forEach(doc => users.push({ uid: doc.id, ...doc.data() }));
        }
      } catch {}

      if (!users.length) {
        list.innerHTML = `<p style="color:var(--univ-text-muted);text-align:center;padding:var(--space-lg) 0">Search to discover people and content in the universe.</p>`;
        return;
      }

      list.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:var(--space-sm)">
          ${users.map(u => {
            const displayName = u.profile?.displayName || u.username || 'Explorer';
            const initial = displayName[0].toUpperCase();
            const avatarUrl = (typeof resolveAvatarUrl === 'function') ? resolveAvatarUrl(u) : u.profile?.avatarUrl;
            const avatarStyle = avatarUrl ? `background-image:url(${avatarUrl});background-size:cover;background-position:center` : '';
            return `
              <a href="#profile/${escapeHtml(u.uid||u._id||u.id||u.username||'')}" style="display:flex;flex-direction:column;align-items:center;gap:var(--space-sm);padding:var(--space-md);background:var(--univ-card);border:1px solid var(--univ-border);border-radius:var(--radius-lg);text-decoration:none;transition:border-color 150ms"
                 onmouseenter="this.style.borderColor='var(--univ-border-glow)'" onmouseleave="this.style.borderColor='var(--univ-border)'">
                <div style="width:48px;height:48px;border-radius:50%;background:var(--univ-card);border:2px solid var(--univ-border-glow);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.1rem;${avatarStyle}">${avatarStyle?'':escapeHtml(initial)}</div>
                <span style="font-size:0.82rem;font-weight:600;color:var(--univ-text);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${escapeHtml(displayName)}</span>
                <span style="font-size:0.72rem;color:var(--univ-text-muted)">@${escapeHtml(u.username||'')}</span>
              </a>`;
          }).join('')}
        </div>`;
    } catch {
      list.innerHTML = `<p style="color:var(--univ-text-muted);text-align:center;padding:var(--space-lg) 0">Search to discover content in the universe.</p>`;
    }
  },
};

window.DiscoverPage = DiscoverPage;

// 'search' registration stays in search.js which loads before this file.
// discover.js does not override it — search.js will forward to discover if available.
