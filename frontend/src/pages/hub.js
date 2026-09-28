/**
 * AVENORA — Universe Home
 * Clean, intentional homepage. One hero, a small set of primary destinations,
 * a live feed preview, and a footer. Nothing duplicated.
 *
 * Hierarchy:
 *   1. Hero / Welcome
 *   2. Primary destinations (4 cards max — most important places)
 *   3. Recent Activity (single feed preview, signed-in only)
 *   4. Footer
 *
 * Everything else is reachable through the top nav and the More menu.
 */

registerPage('hub', {
  async render(container) {
    // Wait for Firebase auth before rendering personalised content
    if (LegendState.get('authLoading')) {
      _hubRenderLoading(container);
      await new Promise((resolve) => {
        const unsub = LegendState.subscribe('authLoading', (loading) => {
          if (!loading) { unsub(); resolve(); }
        });
      });
    }

    const user = LegendState.get('user');

    container.innerHTML = `
      <div class="hub-page">

        ${user ? _hubWelcome(user) : _hubHero()}

        ${_hubPrimaryDest(user)}

        ${user ? _hubRecentActivity() : _hubGuestSecondary()}

        <div id="hub-status-banner" style="display:none;align-items:center;gap:8px;padding:8px 14px;margin:var(--space-md) var(--space-lg) 0;border-radius:8px;background:rgba(192,57,74,0.10);border:1px solid rgba(192,57,74,0.25);font-size:0.8rem;color:var(--text-secondary)">
          <span style="width:7px;height:7px;border-radius:50%;background:#c0394a;flex-shrink:0;display:inline-block"></span>
          <span id="hub-status-text"></span>
          <button style="margin-left:auto;background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1rem;padding:0 2px" onclick="document.getElementById('hub-status-banner').style.display='none'" aria-label="Dismiss">✕</button>
        </div>

        <footer class="hub-footer">
          <p>AVENORA · YOUR DIGITAL UNIVERSE</p>
        </footer>
      </div>`;

    if (user) _hubLoadActivity();
    _hubCheckStatus();

    return () => {};
  }
});

/* ─── Auth loading screen ─────────────────────────────────── */
function _hubRenderLoading(container) {
  container.innerHTML = `
    <div class="hub-auth-loading" role="status" aria-label="Entering the universe">
      <div class="hub-auth-loading__inner">
        <p class="hub-auth-loading__brand">AVENORA</p>
        <div class="hub-auth-loading__spinner" aria-hidden="true"></div>
        <p class="hub-auth-loading__label">Entering your universe…</p>
      </div>
    </div>`;
}

/* ─── Guest hero ──────────────────────────────────────────── */
function _hubHero() {
  return `
    <div class="hub-hero">
      <div class="hub-hero-orb" aria-hidden="true"></div>
      <p class="hub-hero-eyebrow">WELCOME TO</p>
      <h1 class="hub-hero-title">AVENORA</h1>
      <p class="hub-hero-sub">Your Digital Universe</p>
      <div class="hub-hero-cta">
        <button class="btn btn-primary btn-lg" onclick="Modal.open('auth-modal')">Enter the Universe</button>
        <button class="btn hub-btn-ghost-lg" onclick="navigateTo('discover')">Explore First</button>
      </div>
    </div>`;
}

/* ─── Signed-in welcome bar ───────────────────────────────── */
function _hubWelcome(user) {
  const displayName = user.profile?.displayName || user.username || 'Explorer';
  const initial     = displayName[0].toUpperCase();
  const avatarUrl   = (typeof resolveAvatarUrl === 'function') ? resolveAvatarUrl(user) : (user.profile?.avatarUrl || null);
  const avatarStyle = avatarUrl ? `background-image:url(${avatarUrl});background-size:cover;background-position:center` : '';
  const greeting    = _hubGreeting();

  return `
    <div class="hub-welcome">
      <a href="#profile" class="hub-welcome-avatar" style="${avatarStyle}" aria-label="My Universe">${avatarStyle ? '' : escapeHtml(initial)}</a>
      <div class="hub-welcome-text">
        <h2>${escapeHtml(greeting)}, <span style="color:var(--univ-blue-electric)">${escapeHtml(displayName)}</span></h2>
        <p>What will you explore today?</p>
      </div>
    </div>`;
}

function _hubGreeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

/* ─── Primary destinations ────────────────────────────────── */
function _hubPrimaryDest(user) {
  // Four primary cards — the most important places.
  // Everything else is in the nav/More menu.
  const isFounder = user && ['founder', 'admin'].includes(user.role);

  const primary = [
    {
      page: 'social',
      title: 'UNIVERSE FEED',
      desc: 'Posts, images, polls and community activity.',
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    },
    {
      page: 'discover',
      title: 'DISCOVER',
      desc: 'Find people, rooms, galleries and creators.',
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
      green: true,
    },
    {
      page: 'gallery',
      title: 'CREATOR GALLERY',
      desc: 'Artwork, photography, design and projects.',
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    },
    {
      page: 'rooms',
      title: 'UNIVERSE ROOMS',
      desc: 'Public and private community spaces.',
      icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
      green: true,
    },
  ];

  // Compact secondary row — important but not in the primary nav bar.
  // Omit anything already in the mobile bottom nav (Home, Universe, Discover, Messages).
  const secondary = [
    { page: 'live',        label: '📡 Live' },
    { page: 'moments',     label: '✨ Moments' },
    { page: 'challenges',  label: '🏆 Challenges' },
  ];

  if (isFounder) {
    secondary.push({ page: 'admin', label: '🛡️ Control' });
  }

  return `
    <section class="hub-section" aria-label="Primary destinations">
      <div class="hub-cards-grid">
        ${primary.map(c => `
          <a href="#${c.page}" class="hub-dest-card ${c.green ? 'hub-dest-card--green' : ''}" data-page="${c.page}" aria-label="${c.title}">
            <div class="hub-dest-card__glow" aria-hidden="true"></div>
            <div class="hub-dest-card__icon">${c.icon}</div>
            <h3 class="hub-dest-card__title">${c.title}</h3>
            <p class="hub-dest-card__desc">${c.desc}</p>
          </a>`).join('')}
      </div>

      <div class="hub-secondary-row">
        ${secondary.map(s => `
          <a href="#${s.page}" class="hub-secondary-pill" data-page="${s.page}">${s.label}</a>
        `).join('')}
      </div>
    </section>`;
}

/* ─── Guest: secondary links (no account) ────────────────── */
function _hubGuestSecondary() {
  return `
    <div class="hub-guest-links">
      <p style="font-size:0.78rem;color:var(--univ-text-muted);text-align:center;margin:0 0 var(--space-md)">
        Explore freely — no account needed
      </p>
      <div style="display:flex;gap:var(--space-sm);justify-content:center;flex-wrap:wrap">
        <a href="#gallery"    class="hub-secondary-pill" data-page="gallery">🖼️ Gallery</a>
        <a href="#live"       class="hub-secondary-pill" data-page="live">📡 Live</a>
        <a href="#challenges" class="hub-secondary-pill" data-page="challenges">🏆 Challenges</a>
      </div>
    </div>`;
}

/* ─── Recent Activity (signed-in only) ───────────────────── */
function _hubRecentActivity() {
  return `
    <section class="hub-section hub-activity-section" aria-label="Recent activity">
      <h2 class="hub-section-label">Recent Activity</h2>
      <div id="hub-feed-preview" class="hub-activity-list">
        <div class="loading-state" style="min-height:72px"><div class="spinner"></div></div>
      </div>
      <a href="#social" class="hub-activity-more">See all in Universe Feed →</a>
    </section>`;
}

/* ─── Async: load recent posts ───────────────────────────── */
async function _hubLoadActivity() {
  const el = document.getElementById('hub-feed-preview');
  if (!el) return;
  try {
    const data  = await LegendAPI.posts.feed(1);
    const posts = (data.posts || []).filter(p => p.content?.trim()).slice(0, 3);
    if (!posts.length) {
      el.innerHTML = `<p class="hub-activity-empty"><a href="#social">Be the first to post in the Universe Feed →</a></p>`;
      return;
    }
    el.innerHTML = posts.map(p => `
      <a href="#social" class="hub-activity-item">
        <span class="hub-activity-item__author">@${escapeHtml(p.author?.username || 'user')}</span>
        <span class="hub-activity-item__dot">·</span>
        <span class="hub-activity-item__time">${formatTimeAgo(p.createdAt)}</span>
        <p class="hub-activity-item__text">${escapeHtml((p.content || '').slice(0, 120))}${(p.content||'').length > 120 ? '…' : ''}</p>
      </a>`).join('');
  } catch {
    el.innerHTML = `<p class="hub-activity-empty"><a href="#social">Open the Universe Feed →</a></p>`;
  }
}

/* ─── Status banner (storage check) ─────────────────────── */
async function _hubCheckStatus() {
  const SUPABASE_URL      = 'https://licuiqxkkfboqezzmsqu.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpY3VpcXhra2Zib3Flenptc3F1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTYxMDQsImV4cCI6MjEwNDkzMjEwNH0.tsYOyCI7skF6Otz2W0oNYhxM63-0551lrqIDCO8NoJo';
  function _show(msg) {
    const el   = document.getElementById('hub-status-banner');
    const text = document.getElementById('hub-status-text');
    if (el && text) { text.textContent = msg; el.style.display = 'flex'; }
  }
  try {
    const ac  = new AbortController();
    const tid = setTimeout(() => ac.abort(), 8000);
    const r   = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      headers: { apikey: SUPABASE_ANON_KEY },
      signal: ac.signal,
    }).finally(() => clearTimeout(tid));
    if (!r.ok && r.status !== 401 && r.status !== 404) {
      _show('Storage service unavailable — uploads may be limited.');
    }
  } catch (e) {
    if (e.name !== 'AbortError') _show('Storage service unreachable — check your connection.');
  }
}

// Kept for backward compat — admin.js / other pages may call these
function checkApiStatus()    { return _hubCheckStatus(); }
function loadAnnouncements() { /* no-op: removed from homepage, replaced by feed preview */ }
