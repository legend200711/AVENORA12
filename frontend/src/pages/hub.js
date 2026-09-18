/**
 * AVENORA - Homepage (Hub)
 * Layout order:
 *   1. Cinematic welcome hero
 *   2. Continue Listening / Continue Watching
 *   3. Explore AVENORA (7 feature cards)
 *   4. Announcements (only when real data available)
 *   5. Compact profile & settings access
 *   6. Footer
 *
 * Bottom nav (Home / Feed / Video / Arcade / Chat) is in index.html.
 * No bottom-nav destinations duplicated as homepage buttons.
 */

registerPage('hub', {
  async render(container) {
    // ── Auth-loading gate ────────────────────────────────
    // If the auth provider hasn't confirmed the session yet, show the
    // branded loading screen and wait.  This is a safety net; normally
    // app.js has already awaited listenAuthState() before calling render().
    if (LegendState.get('authLoading')) {
      renderAuthLoadingScreen(container);
      await new Promise((resolve) => {
        const unsub = LegendState.subscribe('authLoading', (loading) => {
          if (!loading) { unsub(); resolve(); }
        });
      });
    }

    const user = LegendState.get('user');

    container.innerHTML = `<div class="hub-root">
      ${user ? renderProfileHeader(user) : renderGuestHero()}
      ${renderHeroArea(user)}
      ${renderContinueSection()}
      ${renderExploreSection(user)}
      ${renderAnnouncementsSection()}
      ${user ? renderCompactAccess(user) : ''}
      ${renderBuildDiagnostics()}
      <!-- Backend status banner — shown for all users when backend is unreachable -->
      <div id="hub-backend-status" style="display:none;align-items:center;gap:8px;padding:8px 12px;margin:0 0 var(--space-md);border-radius:6px;background:rgba(192,57,74,0.12);border:1px solid rgba(192,57,74,0.3);font-size:0.8rem;color:var(--text-secondary)">
        <span id="hub-backend-status-dot" style="width:8px;height:8px;border-radius:50%;background:var(--neon-red,#c0394a);flex-shrink:0;display:inline-block"></span>
        <span id="hub-backend-status-text"></span>
        <button style="margin-left:auto;background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1rem;line-height:1" onclick="document.getElementById('hub-backend-status').style.display='none'" aria-label="Dismiss">✕</button>
      </div>
      <div class="hub-footer">
        <p>AVENORA · A PLACE WHERE EVERYONE BELONGS</p>
      </div>
    </div>`;

    // Fire async data loads after paint
    if (user) {
      loadContinueItems();
    }
    loadAnnouncements();
    checkApiStatus();

    return () => {
      // Nothing to clean up for the trigger; companion lives globally
    };
  }
});

/* ─── Auth loading screen ────────────────────────────────── */
function renderAuthLoadingScreen(container) {
  container.innerHTML = `
    <div class="hub-auth-loading" role="status" aria-label="Checking session">
      <div class="hub-auth-loading__inner">
        <p class="hub-auth-loading__brand">AVENORA</p>
        <div class="hub-auth-loading__spinner" aria-hidden="true"></div>
        <p class="hub-auth-loading__label">Restoring your session…</p>
      </div>
    </div>
  `;
}

/* ─── Profile Header ────────────────────────────────────── */
function renderProfileHeader(user) {
  const displayName = user.profile?.displayName || user.username;
  const bio = user.profile?.bio || '';
  return `
    <div class="hub-profile-header">
      <div class="hub-profile-left">
        ${avatarHtml(user, 'md')}
        <div class="hub-profile-info">
          <div class="hub-profile-name">
            ${escapeHtml(displayName)}
            ${roleBadgeHtml(user.role)}
          </div>
          ${bio ? `<p class="hub-profile-bio">${escapeHtml(bio)}</p>` : ''}
        </div>
      </div>
      <div class="hub-profile-actions">
        <button class="hub-icon-btn" aria-label="Notifications" onclick="document.getElementById('btn-notif').click()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <span class="hub-notif-dot hidden" id="hub-notif-dot"></span>
        </button>
        <a href="#settings" class="hub-icon-btn" aria-label="Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </a>
        <a href="#profile" class="hub-action-link" aria-label="Edit Profile">Edit Profile</a>
      </div>
    </div>
  `;
}

function renderGuestHero() {
  return `
    <div class="hub-guest-banner">
      <div class="hub-guest-text">
        <p class="hub-guest-label">WELCOME TO</p>
        <h1 class="hub-title text-pulse-blue">AVENORA</h1>
        <p class="hub-subtitle">A place where everyone belongs.</p>
      </div>
      <div class="hub-guest-cta">
        <button class="btn btn-primary btn-lg" onclick="Modal.open('auth-modal')">Sign In</button>
        <button class="btn btn-secondary btn-lg" onclick="Modal.open('auth-modal');switchAuthTab('register')">Create Account</button>
      </div>
    </div>
  `;
}

/* ─── Cinematic Hero ─────────────────────────────────────── */
function renderHeroArea(user) {
  if (!user) return '';
  return `
    <div class="hub-hero">
      <div class="hub-hero-eclipse" aria-hidden="true">
        <div class="hub-eclipse-ring"></div>
        <div class="hub-eclipse-core"></div>
      </div>
      <div class="hub-hero-content">
        <p class="hub-hero-label">WELCOME TO</p>
        <h1 class="hub-title text-pulse-blue">AVENORA</h1>
        <p class="hub-subtitle">A place where everyone belongs.</p>
        <a href="#social" class="btn btn-primary hub-hero-cta">Open Feed →</a>
      </div>
      <div class="hub-hero-particles" aria-hidden="true"></div>
    </div>
  `;
}

/* ─── Continue Section ───────────────────────────────────── */
function renderContinueSection() {
  return `
    <section class="hub-section" aria-label="Continue where you left off">
      <h2 class="hub-section-title">Continue</h2>
      <div id="hub-continue" class="hub-continue-list">
        <div class="hub-empty-state">
          <span class="hub-empty-icon" aria-hidden="true">◎</span>
          <p>Your journey begins here.</p>
        </div>
      </div>
    </section>
  `;
}

/* ─── Explore AVENORA Feature Cards ─────────────── */
// Full card definitions — order and visibility are resolved from user preferences
const HUB_CARD_DEFS = {
  cloudstream: {
    title: '24-Hour Cloud Stream',
    desc: 'Continuous music and video programming in one connected stream.',
    icon: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <path d="M3 15a4 4 0 0 0 4 4h10a4 4 0 0 0 0-8 5 5 0 0 0-9.9-1A4 4 0 0 0 3 15z"/>
      <path d="M12 12v4m0 0-2-2m2 2 2-2"/>
    </svg>`,
    page: 'cloudstream', accent: 'blue', founderOnly: false,
  },
  live: {
    title: 'Live',
    desc: 'Watch and access live broadcasts from the platform.',
    icon: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="2" fill="currentColor"/>
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.49-8.49a6 6 0 0 0 0 8.49"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
    </svg>`,
    page: 'live', accent: 'red', founderOnly: false,
  },
  social: {
    title: 'Share',
    desc: 'Share favorite moments, media, and updates.',
    icon: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>`,
    page: 'social', accent: 'green', founderOnly: false,
  },
  dj: {
    title: 'DJ System',
    desc: 'Mix tracks, manage playlists, and prepare audio sessions.',
    icon: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <circle cx="12" cy="12" r="8"/>
      <line x1="12" y1="2" x2="12" y2="4"/>
      <line x1="12" y1="20" x2="12" y2="22"/>
      <line x1="2" y1="12" x2="4" y2="12"/>
      <line x1="20" y1="12" x2="22" y2="12"/>
    </svg>`,
    page: 'dj', accent: 'purple', founderOnly: false,
  },
  music: {
    title: 'Music Hub',
    desc: 'Discover music, organize your library, and continue listening.',
    icon: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <path d="M9 18V5l12-2v13"/>
      <circle cx="6" cy="18" r="3"/>
      <circle cx="18" cy="16" r="3"/>
    </svg>`,
    page: 'music', accent: 'blue', founderOnly: false,
  },
  gallery: {
    title: 'Gallery',
    desc: 'Explore and organize images and visual memories.',
    icon: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>`,
    page: 'gallery', accent: 'green', founderOnly: false,
  },
  admin: {
    title: 'Founder Control Center',
    desc: 'Manage approved platform controls, moderation, and system tools.',
    icon: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>`,
    page: 'admin', accent: 'founder', founderOnly: true,
  },
};

function renderExploreSection(user) {
  const isFounder = user && ['founder', 'admin'].includes(user.role);

  // Read cached preferences for card order/visibility (applied optimistically;
  // the customize page syncs these via the full preferences API)
  let cardOrder   = ['cloudstream','live','social','dj','music','gallery'];
  let visibleSet  = new Set(cardOrder);

  try {
    const raw = localStorage.getItem('avn_prefs_cache');
    if (raw) {
      const cached = JSON.parse(raw);
      if (Array.isArray(cached.homeCards?.cardOrder) && cached.homeCards.cardOrder.length) {
        cardOrder = cached.homeCards.cardOrder;
      }
      if (Array.isArray(cached.homeCards?.visibleCards)) {
        visibleSet = new Set(cached.homeCards.visibleCards);
      }
    }
  } catch {}

  // Build ordered list of cards to render
  const rendered = cardOrder
    .filter(id => HUB_CARD_DEFS[id])
    .filter(id => !HUB_CARD_DEFS[id].founderOnly || isFounder)
    .filter(id => visibleSet.has(id))
    .map(id => ({
      id,
      ...HUB_CARD_DEFS[id],
      available: true,
    }));

  // Always hide founder card for non-founders — no hint it exists
  return `
    <section class="hub-section hub-explore-section" aria-label="Explore AVENORA">
      <h2 class="hub-section-title hub-explore-title">Explore AVENORA</h2>
      <div class="hub-explore-grid">
        ${rendered.length
          ? rendered.map(card => renderFeatureCard(card)).join('')
          : `<p style="color:var(--text-muted);font-size:0.9rem;padding:var(--space-md) 0">
               All service cards are hidden. <a href="#customize">Customize Avenora</a> to show them.
             </p>`
        }
      </div>
    </section>
  `;
}

function renderFeatureCard(card) {
  const accentClass = `hub-card-accent-${card.accent}`;
  const labelId = `hub-card-label-${card.id}`;

  if (!card.available) {
    return `
      <div class="hub-feature-card hub-feature-card--soon ${accentClass}" aria-label="${escapeHtml(card.title)} — Coming Soon">
        <div class="hub-feature-card__icon" aria-hidden="true">${card.icon}</div>
        <div class="hub-feature-card__body">
          <h3 class="hub-feature-card__title" id="${labelId}">${escapeHtml(card.title)}</h3>
          <p class="hub-feature-card__desc">${escapeHtml(card.desc)}</p>
        </div>
        <div class="hub-feature-card__action">
          <span class="hub-feature-card__soon-badge">Coming Soon</span>
        </div>
      </div>
    `;
  }

  return `
    <a href="#${card.page}" class="hub-feature-card ${accentClass}" aria-labelledby="${labelId}">
      <div class="hub-feature-card__glow" aria-hidden="true"></div>
      <div class="hub-feature-card__icon" aria-hidden="true">${card.icon}</div>
      <div class="hub-feature-card__body">
        <h3 class="hub-feature-card__title" id="${labelId}">${escapeHtml(card.title)}</h3>
        <p class="hub-feature-card__desc">${escapeHtml(card.desc)}</p>
      </div>
      <div class="hub-feature-card__action">
        <span class="hub-feature-card__enter" aria-hidden="true">Open →</span>
      </div>
    </a>
  `;
}

/* ─── Announcements ──────────────────────────────────────── */
function renderAnnouncementsSection() {
  return `
    <section class="hub-section hub-announce-section hidden" id="hub-announce-section" aria-label="Announcements">
      <h2 class="hub-section-title">Updates</h2>
      <div id="hub-announce-list"></div>
    </section>
  `;
}

/* ─── Compact Profile & Settings Access ─────────────────── */
function renderCompactAccess(user) {
  const isFounder = ['founder', 'admin'].includes(user.role);
  return `
    <section class="hub-section hub-section-sm hub-compact-access" aria-label="Account access">
      <div class="hub-quick-grid">
        <a href="#profile" class="hub-quick-item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          My Profile
        </a>
        <a href="#settings" class="hub-quick-item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Settings
        </a>
        <button class="hub-quick-item" onclick="document.getElementById('btn-notif').click()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          Notifications
        </button>
        <div class="hub-api-status" id="api-status" style="display:none">
          <span class="hub-status-dot" id="api-status-dot"></span>
          <span id="api-status-text"></span>
        </div>
      </div>
    </section>
  `;
}

/* ─── Async data loaders ─────────────────────────────────── */
async function loadContinueItems() {
  const el = document.getElementById('hub-continue');
  if (!el) return;

  // Read personalization prefs from cache
  let continueWatching  = true;
  let continueListening = true;
  let startSection = '';
  try {
    const raw = localStorage.getItem('avn_prefs_cache');
    if (raw) {
      const cached = JSON.parse(raw);
      if (typeof cached.continueWatching === 'boolean')  continueWatching  = cached.continueWatching;
      if (typeof cached.continueListening === 'boolean') continueListening = cached.continueListening;
      if (typeof cached.startSection === 'string')       startSection      = cached.startSection;
    }
  } catch {}

  const items = [];

  // Preferred starting section shortcut (optional, never forces a redirect)
  if (startSection) {
    const SECTION_LABELS = {
      social: 'Feed', video: 'Video', music: 'Music Hub', arcade: 'Arcade',
      chat: 'Chat', gallery: 'Gallery', cloudstream: 'Cloud Stream',
      live: 'Live', dj: 'DJ System',
    };
    const label = SECTION_LABELS[startSection];
    if (label) {
      items.push({
        type: 'shortcut',
        label: 'Go to',
        title: label,
        meta: 'Your preferred section',
        page: startSection,
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`,
      });
    }
  }

  // Try watch history
  if (continueWatching) {
    try {
      const history = await LegendAPI.videos.getHistory();
      const recent = (history.history || []).slice(0, 1)[0];
      if (recent?.video) {
        items.push({
          type: 'video',
          label: 'Continue watching',
          title: recent.video.title,
          meta: recent.video.channelName || '',
          page: 'video',
          icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
        });
      }
    } catch { /* offline or no history */ }
  }

  // Try recently played track
  if (continueListening) {
    try {
      const lastTrack = LS.get('lu_last_track');
      if (lastTrack && lastTrack.id) {
        items.push({
          type: 'music',
          label: 'Continue listening',
          title: lastTrack.title || 'Track',
          meta: lastTrack.artist || '',
          page: 'music',
          icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
        });
      }
    } catch { /* no local track state */ }
  }

  if (items.length === 0) {
    el.innerHTML = `
      <div class="hub-empty-state">
        <span class="hub-empty-icon" aria-hidden="true">◎</span>
        <p>Your journey begins here.</p>
      </div>`;
    return;
  }

  el.innerHTML = items.map(item => `
    <a href="#${item.page}" class="hub-continue-item" aria-label="${escapeHtml(item.label)}: ${escapeHtml(item.title)}">
      <span class="hub-continue-icon">${item.icon}</span>
      <span class="hub-continue-text">
        <span class="hub-continue-label">${escapeHtml(item.label)}</span>
        <span class="hub-continue-title">${escapeHtml(item.title)}</span>
        ${item.meta ? `<span class="hub-continue-meta">${escapeHtml(item.meta)}</span>` : ''}
      </span>
      <span class="hub-continue-arrow" aria-hidden="true">→</span>
    </a>
  `).join('');
}

async function loadAnnouncements() {
  // Announcements are only shown when real data is available from the API.
  // If posts feed is empty or unreachable, the section stays hidden.
  const section = document.getElementById('hub-announce-section');
  const list = document.getElementById('hub-announce-list');
  if (!section || !list) return;

  try {
    // Load recent posts from the feed — only show if real data is available
    const data = await LegendAPI.posts.feed(1);
    const posts = (data.posts || []).filter(p => p.content?.trim()).slice(0, 3);
    if (!posts.length) return; // keep hidden

    list.innerHTML = posts.map(p => `
      <div class="hub-announce-item">
        <div class="hub-announce-meta">
          <span class="hub-announce-author">@${escapeHtml(p.author?.username || 'legend')}</span>
          <span class="hub-announce-time">${formatTimeAgo(p.createdAt)}</span>
        </div>
        <p class="hub-announce-body">${escapeHtml(p.content || '')}</p>
      </div>
    `).join('');

    section.classList.remove('hidden');
  } catch {
    // Backend not running or no pinned posts — keep section hidden
  }
}

async function checkApiStatus() {
  // Ping the backend health endpoint. If unreachable (Render cold start,
  // misconfiguration, no internet), show a dismissible banner.
  // Never blocks the page — runs fire-and-forget after paint.
  if (!window.LU_CONFIG?.apiUrl) return;

  function _showBanner(msg) {
    // Global banner (visible to all users — below footer, dismissible)
    const el   = document.getElementById('hub-backend-status');
    const text = document.getElementById('hub-backend-status-text');
    if (el && text) { text.textContent = msg; el.style.display = 'flex'; }
    // Compact access status (logged-in users only)
    const dot  = document.getElementById('api-status-dot');
    const txt  = document.getElementById('api-status-text');
    const sEl  = document.getElementById('api-status');
    if (sEl && dot && txt) {
      dot.style.background = 'var(--neon-red,#c0394a)';
      txt.textContent = msg;
      sEl.style.display = 'flex';
    }
  }

  try {
    const result = await LegendAPI.health.check();
    const backendStatus = result.services?.find(s => s.service === 'Backend');
    if (backendStatus && backendStatus.status !== 'ok') {
      const errMsg = backendStatus.error || 'Backend unreachable';
      _showBanner('Backend offline — some features may be unavailable. ' + errMsg);
    }
    // If ok, hide any stale banner (in case of retry)
    if (backendStatus && backendStatus.status === 'ok') {
      const el = document.getElementById('hub-backend-status');
      if (el) el.style.display = 'none';
    }
  } catch {
    _showBanner('Unable to connect to AVENORA servers. Some features may be unavailable.');
  }
}

/* ─── Build / PWA Diagnostic Panel ──────────────────────── */
/**
 * Renders a small, always-visible diagnostic strip at the bottom of the hub.
 * Shows app version, build timestamp, API base URL, Firebase project ID,
 * and service-worker version so you can confirm a fresh build is loaded.
 * No private secrets are exposed here.
 */
function renderBuildDiagnostics() {
  const b = window.AVENORA_BUILD || {};
  const swStatus = ('serviceWorker' in navigator)
    ? 'supported'
    : 'not supported';
  return `
    <section class="hub-section hub-section-sm hub-diagnostics" aria-label="Build diagnostics" id="hub-diagnostics">
      <details style="width:100%">
        <summary style="cursor:pointer;font-size:0.75rem;color:var(--text-muted);letter-spacing:0.08em;user-select:none">
          ▸ BUILD DIAGNOSTICS
        </summary>
        <div class="hub-diagnostics__grid" style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:0.72rem;color:var(--text-muted)">
          <span style="color:var(--text-secondary)">App version</span>
          <span id="diag-version">${escapeHtml(b.version || '—')}</span>

          <span style="color:var(--text-secondary)">Build timestamp</span>
          <span id="diag-build-ts">${escapeHtml(b.buildTimestamp || '—')}</span>

          <span style="color:var(--text-secondary)">API base URL</span>
          <span id="diag-api-url" style="word-break:break-all">${escapeHtml(b.apiBaseUrl || window.LU_CONFIG?.apiUrl || '—')}</span>

          <span style="color:var(--text-secondary)">Firebase project</span>
          <span id="diag-firebase">${escapeHtml(b.firebaseProject || '—')}</span>

          <span style="color:var(--text-secondary)">SW version</span>
          <span id="diag-sw-version">${escapeHtml(b.swVersion || '—')}</span>

          <span style="color:var(--text-secondary)">SW cache name</span>
          <span id="diag-sw-cache">${escapeHtml(b.swCacheName || '—')}</span>

          <span style="color:var(--text-secondary)">SW support</span>
          <span id="diag-sw-support">${swStatus}</span>

          <span style="color:var(--text-secondary)">Base path</span>
          <span id="diag-base-path">${escapeHtml(b.basePath || location.pathname)}</span>
        </div>
        <p style="margin-top:8px;font-size:0.68rem;color:var(--text-muted);opacity:0.6">
          Visible to all users for deployment verification. No private secrets are shown here.
        </p>
      </details>
    </section>
  `;
}

