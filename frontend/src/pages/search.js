/**
 * GLOBAL SEARCH PAGE
 */

registerPage('search', {
  async render(container) {
    const query = LegendState.get('searchQuery') || '';

    container.innerHTML = `
      <div style="padding:var(--space-lg)">
        <div class="page-header" style="padding-top:var(--space-xl);padding-bottom:var(--space-lg)">
          <h1 style="font-family:var(--font-display);letter-spacing:0.1em">
            <span style="color:var(--neon-blue)">GLOBAL</span> SEARCH
          </h1>
        </div>
        <div class="container-sm">
          <!-- Search bar -->
          <div class="search-bar" style="margin-bottom:var(--space-lg)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search" id="search-main-input" placeholder="Search users, posts, videos, music..." 
                   value="${escapeHtml(query)}"
                   style="font-size:1rem"
                   oninput="performSearch(this.value)"
                   aria-label="Search Avenora">
          </div>

          <!-- Filter tabs -->
          <div class="tabs" style="margin-bottom:var(--space-lg)">
            ${['All','Users','Posts','Videos'].map((t,i) =>
                `<button class="tab-btn ${i===0?'active':''}" onclick="searchFilter('${t.toLowerCase()}',this)">${t}</button>`
              ).join('')}
          </div>

          <!-- Results -->
          <div id="search-results">
            ${query ? '' : `<div class="error-state"><div class="error-icon">🔍</div><h3>Search Avenora</h3><p>Find users, posts, videos, music, and more.</p></div>`}
          </div>
        </div>
      </div>
    `;

    // Subscribe to search query changes
    const unsub = LegendState.subscribe('searchQuery', (q) => {
      const input = document.getElementById('search-main-input');
      if (input && q) { input.value = q; performSearch(q); }
    });

    if (query) performSearch(query);
    return () => unsub();
  }
});

// Track the active tab filter
let _searchActiveFilter = 'all';

const performSearch = debounce(async function (query) {
  const container = document.getElementById('search-results');
  if (!container) return;
  if (!query?.trim() || query.length < 2) {
    container.innerHTML = `<div class="error-state"><p style="color:var(--text-muted)">Type at least 2 characters to search</p></div>`;
    return;
  }

  showLoading(container, `Searching for "${escapeHtml(query)}"...`);

  try {
    // Pass active filter type so Firestore search can narrow results
    const filterType = _searchActiveFilter === 'all' ? null : _searchActiveFilter;
    const data = await LegendAPI.search.search(query, filterType);
    const results = data.results || {};
    const total = (results.users?.length || 0) + (results.posts?.length || 0) + (results.videos?.length || 0);

    if (total === 0) {
      container.innerHTML = `<div class="error-state"><div class="error-icon">🔍</div><h3>No results found</h3><p>Try different keywords or switch tabs</p></div>`;
      return;
    }

    let html = `<p style="color:var(--text-muted);margin-bottom:var(--space-lg);font-size:0.9rem">Found ${total} result${total === 1 ? '' : 's'} for "<strong>${escapeHtml(query)}</strong>"</p>`;

    if (results.users?.length) {
      html += `<div class="section-header"><h3 class="section-title">USERS (${results.users.length})</h3></div>`;
      html += `<div style="display:flex;flex-direction:column;gap:var(--space-sm);margin-bottom:var(--space-xl)">`;
      html += results.users.map(u => {
        // Always navigate by UID (document ID) — it is always present and the
        // profile page handles UIDs via its ≥20-char alphanumeric regex.
        // Falling back to username only when no uid is available (should never happen).
        const profileId = encodeURIComponent(u.uid || u.id || u.username || '');
        return `
        <a href="#profile/${profileId}" class="card" style="display:flex;align-items:center;gap:var(--space-md);text-decoration:none;color:inherit">
          ${avatarHtml(u, 'md')}
          <div>
            <div style="font-weight:600">${escapeHtml(u.profile?.displayName || u.username || 'Unknown')}</div>
            <div style="color:var(--text-muted);font-size:0.85rem">@${escapeHtml(u.username || '')}</div>
          </div>
          ${roleBadgeHtml(u.role)}
        </a>
      `}).join('');
      html += '</div>';
    }

    if (results.posts?.length) {
      html += `<div class="section-header"><h3 class="section-title">POSTS (${results.posts.length})</h3></div>`;
      html += `<div style="display:flex;flex-direction:column;gap:var(--space-sm);margin-bottom:var(--space-xl)">`;
      html += results.posts.map(p => `
        <div class="card">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <strong style="font-size:0.85rem">@${escapeHtml(p.author?.username || 'unknown')}</strong>
            <span style="color:var(--text-muted);font-size:0.8rem">${formatTimeAgo(p.createdAt)}</span>
          </div>
          <p style="color:var(--text-secondary);font-size:0.9rem">${escapeHtml((p.content || '').slice(0, 200))}${(p.content?.length || 0) > 200 ? '...' : ''}</p>
        </div>
      `).join('');
      html += '</div>';
    }

    if (results.videos?.length) {
      html += `<div class="section-header"><h3 class="section-title">GALLERY / VIDEOS (${results.videos.length})</h3></div>`;
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:var(--space-md)">`;
      html += results.videos.map(v => `
        <div class="card card-glow-blue" style="cursor:pointer" onclick="navigateTo('gallery')">
          ${v.url && (v.mediaType === 'image' || v.mediaType === 'artwork' || !v.mediaType)
            ? `<img src="${escapeHtml(v.url)}" alt="${escapeHtml(v.title)}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;margin-bottom:8px" loading="lazy">`
            : `<div style="aspect-ratio:16/9;background:var(--bg-secondary);border-radius:8px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:1.5rem">🎬</div>`
          }
          <h4 class="truncate" style="font-size:0.9rem">${escapeHtml(v.title)}</h4>
          <p style="color:var(--text-muted);font-size:0.8rem">@${escapeHtml(v.uploader?.username || '')}</p>
        </div>
      `).join('');
      html += '</div>';
    }

    container.innerHTML = html;
  } catch (err) {
    console.warn('[AVN] Search error:', err.code, err.message, err.original || '');
    // Map each known error code to a helpful, non-alarming message
    let msg;
    switch (err.code) {
      case 'API_NOT_CONFIGURED':
      case 'FIREBASE_NOT_READY':
        msg = 'Search is loading — please wait a moment and try again.';
        break;
      case 'permission-denied':
        msg = 'You need to be signed in to search. Please sign in and try again.';
        break;
      case 'unauthenticated':
        msg = 'Your session has expired. Please sign in again.';
        break;
      default:
        msg = 'Search encountered an error. Please try again.';
    }
    container.innerHTML = `
      <div class="error-state">
        <div class="error-icon">🔍</div>
        <p style="color:var(--text-muted)">${escapeHtml(msg)}</p>
        <button class="btn btn-outline" style="margin-top:var(--space-md)" onclick="performSearch(document.getElementById('search-main-input')?.value)">Try Again</button>
      </div>
    `;
  }
}, 400);

window.performSearch = performSearch;
window.searchFilter = function (filter, clickedBtn) {
  _searchActiveFilter = filter || 'all';
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if (clickedBtn) clickedBtn.classList.add('active');
  const query = document.getElementById('search-main-input')?.value?.trim();
  if (query) performSearch(query);
};
