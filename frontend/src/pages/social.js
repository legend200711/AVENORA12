/**
 * AVENORA — Avenora Feed
 * Complete social platform module for Avenora.
 *
 * Features: Post creation, feed, likes, comments, reposts, share,
 * edit/delete (owner-only), stories bar, notifications panel,
 * report system, moderation controls.
 */

// ── Timestamp helpers (Firestore Timestamp ↔ JS Date) ───────────────────────
// Firestore returns createdAt as a Timestamp object { seconds, nanoseconds }
// or with a .toDate() method. These helpers safely convert to strings for HTML.
function _tsToDate(val) {
  if (!val) return null;
  // Firestore Timestamp with .toDate()
  if (typeof val === 'object' && typeof val.toDate === 'function') {
    try {
      const d = val.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    } catch { return null; }
  }
  // Plain POJO { seconds, nanoseconds } — Timestamp serialised through JSON
  if (typeof val === 'object' && typeof val.seconds === 'number') {
    const d = new Date(val.seconds * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  // Numeric timestamp (ms)
  if (typeof val === 'number') {
    const d = new Date(val > 1e12 ? val : val * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  // ISO / RFC date string
  if (typeof val === 'string' && val) {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
function _tsToIso(val) {
  const d = _tsToDate(val);
  try { return d ? d.toISOString() : ''; } catch { return ''; }
}
function _tsToLocale(val) {
  const d = _tsToDate(val);
  try { return d ? d.toLocaleString() : ''; } catch { return ''; }
}

registerPage('social', {
  _cleanup: null,

  async render(container) {
    container.innerHTML = `
      <div class="sn-page">
        <!-- Stories bar -->
        <section class="sn-stories-bar" id="sn-stories-bar" aria-label="Stories">
          <div class="sn-stories-inner" id="sn-stories-inner">
            <div class="sn-story-add" id="sn-story-add-btn" onclick="SNStories.openCreate()" title="Add your story" style="display:none">
              <div class="sn-story-ring">
                <div class="sn-story-avatar sn-story-add-icon">＋</div>
              </div>
              <span class="sn-story-name">Your Story</span>
            </div>
            <div id="sn-stories-list" style="display:contents"></div>
          </div>
        </section>

        <!-- Header -->
        <header class="sn-header">
          <div class="sn-brand">
            <div class="sn-eclipse-icon" aria-hidden="true">
              <svg width="38" height="38" viewBox="0 0 38 38">
                <circle cx="19" cy="19" r="18" fill="rgba(0,170,255,0.05)" stroke="rgba(0,170,255,0.25)" stroke-width="1.5"/>
                <circle cx="19" cy="19" r="13" fill="rgba(0,0,0,0.8)" stroke="rgba(0,255,136,0.3)" stroke-width="1"/>
                <circle cx="24" cy="19" r="12" fill="#050508"/>
                <circle cx="24" cy="19" r="12" fill="rgba(0,170,255,0.04)" stroke="rgba(0,170,255,0.18)" stroke-width="1"/>
              </svg>
            </div>
            <div>
              <h1 class="sn-title"><span style="color:var(--neon-blue)">AVENORA</span> FEED</h1>
              <p class="sn-subtitle">A PLACE WHERE EVERYONE BELONGS</p>
            </div>
          </div>
        </header>

        <!-- Compose area -->
        <div id="sn-compose-area"></div>

        <!-- Feed -->
        <div id="sn-feed" role="feed" aria-label="Avenora Feed">
          <div class="loading-state"><div class="spinner spinner-lg"></div><span>Loading Avenora Feed…</span></div>
        </div>
      </div>
    `;

    SNFeed.renderCompose();
    await SNStories.load();
    await SNFeed.load(1);

    // Real-time notification listener via Socket.io
    if (window.io && LegendAPI.auth.isLoggedIn()) {
      const token = LegendAPI.TokenStore.getAccess();
      const socket = window.io({ auth: { token } });
      socket.on('notification:new', (n) => {
        if (window._socialNotifCallback) window._socialNotifCallback(n);
        const count = (parseInt(document.getElementById('notif-badge')?.textContent) || 0) + 1;
        const badge = document.getElementById('notif-badge');
        if (badge) { badge.textContent = count; badge.classList.remove('hidden'); }
      });
      this._cleanup = () => socket.disconnect();
    }

    return () => { if (this._cleanup) this._cleanup(); };
  }
});

// ═══════════════════════════════════════════════════════════════
// SNFeed — Main feed controller
// ═══════════════════════════════════════════════════════════════

const SNFeed = {
  currentPage: 1,
  isLoading: false,

  renderCompose() {
    const area = document.getElementById('sn-compose-area');
    if (!area) return;
    const user = LegendAPI.auth.getUser();

    if (!user) {
      area.innerHTML = `
        <div class="sn-card sn-signin-prompt">
          <p style="color:var(--text-secondary);margin-bottom:var(--space-md)">Sign in to post and interact with the Avenora community.</p>
          <button class="btn btn-primary" onclick="Modal.open('auth-modal')">Sign In</button>
        </div>
      `;
      return;
    }

    area.innerHTML = `
      <div class="sn-card sn-compose" id="sn-compose">
        <div class="sn-compose-inner">
          ${avatarHtml(user, 'md')}
          <div style="flex:1">
            <textarea
              id="sn-post-input"
              class="form-input sn-compose-input"
              placeholder="What's legendary today, ${escapeHtml(user.username)}?"
              rows="3"
              maxlength="10000"
              aria-label="Create a post"
              oninput="SNFeed.updateCharCount(this); SNFeed._clearError();"
            ></textarea>
            <div id="sn-image-preview" class="sn-image-preview"></div>
            <div id="sn-post-error" class="sn-inline-error hidden"></div>
            <div class="sn-compose-toolbar">
              <div class="sn-compose-actions">
                <button class="btn btn-ghost btn-sm sn-tool-btn" title="Add image" onclick="SNFeed.triggerImageUpload()">
                  📷 <span class="sn-tool-label">Photo</span>
                </button>
              </div>
              <div style="display:flex;align-items:center;gap:var(--space-sm)">
                <span id="sn-char-count" class="sn-char-count">0 / 10000</span>
                <button class="btn btn-primary btn-sm" id="sn-post-btn" onclick="SNFeed.submitPost()">POST</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  updateCharCount(textarea) {
    const n = textarea.value.length;
    const el = document.getElementById('sn-char-count');
    if (el) {
      el.textContent = `${n} / 10000`;
      el.style.color = n > 9500 ? 'var(--neon-red)' : 'var(--text-muted)';
    }
  },

  _pendingImages: [],

  triggerImageUpload() {
    const user = LegendAPI.auth.getUser();
    if (!user) { Modal.open('auth-modal'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from(e.target.files).slice(0, 4 - this._pendingImages.length);
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) { Toast.error(`${file.name} is too large (max 20 MB)`); continue; }
        const preview = document.getElementById('sn-image-preview');
        const placeholder = document.createElement('div');
        placeholder.className = 'sn-img-thumb sn-img-loading';
        placeholder.textContent = '…';
        preview?.appendChild(placeholder);
        try {
          const data = await LegendAPI.upload.image(file);
          this._pendingImages.push(data.url);
          placeholder.className = 'sn-img-thumb';
          placeholder.innerHTML = `
            <img src="${escapeHtml(data.url)}" alt="Attached image" loading="lazy">
            <button class="sn-img-remove" onclick="SNFeed.removeImage('${escapeHtml(data.url)}', this.parentElement)" title="Remove">✕</button>
          `;
        } catch (err) {
          placeholder.remove();
          Toast.error(`Upload failed: ${err.message}`);
        }
      }
    };
    input.click();
  },

  removeImage(url, el) {
    this._pendingImages = this._pendingImages.filter(u => u !== url);
    el?.remove();
  },

  async submitPost() {
    const input = document.getElementById('sn-post-input');
    const errEl = document.getElementById('sn-post-error');
    const btn = document.getElementById('sn-post-btn');
    const content = input?.value?.trim();

    // Client-side validation
    if (!content && !this._pendingImages.length) {
      this._showError(errEl, 'Write something or attach an image.');
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'POSTING…'; }
    if (errEl) errEl.classList.add('hidden');

    try {
      await LegendAPI.posts.create(content, this._pendingImages);
      // Clear composer
      if (input) input.value = '';
      this._pendingImages = [];
      const preview = document.getElementById('sn-image-preview');
      if (preview) preview.innerHTML = '';
      const counter = document.getElementById('sn-char-count');
      if (counter) counter.textContent = '0 / 10000';

      Toast.success('Posted! You belong here. 🌅');
      await this.load(1);
    } catch (err) {
      console.warn('[AVN] Post submit error:', err);
      this._showError(errEl, 'Your post could not be submitted. Please try again.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'POST'; }
    }
  },

  _showError(errEl, msg) {
    if (!errEl) return;
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
  },

  _clearError() {
    const errEl = document.getElementById('sn-post-error');
    if (errEl) errEl.classList.add('hidden');
  },

  async load(page = 1) {
    const container = document.getElementById('sn-feed');
    if (!container) return;
    this.currentPage = page;

    if (page === 1) {
      container.innerHTML = `<div class="loading-state"><div class="spinner spinner-lg"></div><span>Loading Avenora Feed…</span></div>`;
    }

    // Wait for Firebase auth to settle before loading the feed.
    // Attempting Firestore queries while auth is loading can cause
    // permission-denied errors even for publicly readable collections.
    if (LegendState && LegendState.get('authLoading') === true) {
      await new Promise((resolve) => {
        const unsub = LegendState.subscribe('authLoading', (loading) => {
          if (!loading) {
            if (typeof unsub === 'function') unsub();
            resolve();
          }
        });
        // Safety timeout — proceed after 8 s regardless
        setTimeout(() => { if (typeof unsub === 'function') unsub(); resolve(); }, 8000);
      });
    }

    try {
      const data = await LegendAPI.posts.feed(page);
      const posts = data.posts || [];

      if (!posts.length && page === 1) {
        container.innerHTML = `
          <div class="error-state sn-empty-state">
            <div class="error-icon">🌑</div>
            <h3>No posts yet.</h3>
            <p>Be the first to post. Avenora awaits.</p>
          </div>
        `;
        return;
      }

      if (page === 1) container.innerHTML = '';

      // Remove old load-more button
      document.getElementById('sn-load-more')?.remove();

      posts.forEach(post => {
        const el = SNPost.render(post);
        if (el) container.appendChild(el);
      });

      // Load more button
      if (posts.length === 20) {
        const more = document.createElement('div');
        more.id = 'sn-load-more';
        more.className = 'sn-load-more';
        more.innerHTML = `<button class="btn btn-outline" onclick="SNFeed.load(${page + 1})">Load More</button>`;
        container.appendChild(more);
      }
    } catch (err) {
      console.warn('[AVN] Feed load error:', err);
      const isNetwork = err.message === 'Failed to fetch' || err.message?.includes('NetworkError') || err.message?.includes('net::ERR');
      const isPermission = err.code === 'permission-denied' || err.message?.includes('permission');
      const display = isNetwork
        ? 'Could not connect. Check your connection and try again.'
        : isPermission
          ? 'Could not load posts. Please sign in and try again.'
          : 'Something went wrong loading the feed. Try again in a moment.';
      if (page === 1) {
        showError(container, display, () => SNFeed.load(1));
      } else {
        Toast.error(display);
      }
    }
  },
};
window.SNFeed = SNFeed;

// ═══════════════════════════════════════════════════════════════
// SNPost — Individual post rendering and interactions
// ═══════════════════════════════════════════════════════════════

const SNPost = {
  render(post) {
    // Firestore returns `id` (not `_id`); support both for backward compat
    const postId = post._id || post.id || '';
    post._id = postId; // normalise so template references work

    // Normalise author shape — Firestore posts may omit `profile` sub-object
    // (older posts were written with a flat author structure).
    if (post.author && !post.author.profile) {
      post.author.profile = {
        displayName: post.author.displayName || post.author.username || '',
        avatarUrl:   post.author.avatarUrl || null,
      };
    }

    const el = document.createElement('article');
    el.className = 'sn-card sn-post';
    el.dataset.postId = postId;
    el.setAttribute('aria-label', `Post by ${post.author?.username || 'Unknown'}`);

    const user = LegendAPI.auth.getUser();
    const isOwn = user && (post.author?._id === user.id || post.author?.id === user.id || post.author?.id === user.uid);
    const isMod = user && ['moderator', 'founder', 'admin'].includes(user.role);
    const likeCount = post.likeCount ?? post.likes?.length ?? 0;
    const commentCount = post.commentCount ?? (post.comments || []).filter(c => !c.isDeleted).length;
    const repostCount = post.repostCount ?? post.reposts?.length ?? 0;
    const isLiked = post.likedByMe || false;
    const isRepost = post.type === 'repost';

    el.innerHTML = `
      ${isRepost ? `
        <div class="sn-repost-banner">
          <span style="color:var(--neon-green);font-size:0.8rem;font-weight:600">↗ Reposted</span>
        </div>
      ` : ''}

      <!-- Post header -->
      <div class="sn-post-header">
        <a href="#profile/${escapeHtml(post.author?.username || '')}" class="sn-author-link">
          ${avatarHtml(post.author, 'md')}
        </a>
        <div class="sn-author-info">
          <div class="sn-author-top">
            <a href="#profile/${escapeHtml(post.author?.username || '')}" class="sn-author-name">
              ${escapeHtml(post.author?.profile?.displayName || post.author?.username || 'Unknown')}
            </a>
            ${roleBadgeHtml(post.author?.role)}
          </div>
          <div class="sn-author-meta">
            <span class="sn-author-handle">@${escapeHtml(post.author?.username || '')}</span>
            <span class="sn-dot">·</span>
            <time class="sn-timestamp" datetime="${_tsToIso(post.createdAt)}" title="${_tsToLocale(post.createdAt) || 'Unknown date'}">${formatTimeAgo(post.createdAt) || 'recently'}</time>
            ${post.isEdited ? '<span class="sn-edited">(edited)</span>' : ''}
          </div>
        </div>
        <div class="sn-post-menu-wrap" style="margin-left:auto">
          <button class="btn btn-ghost btn-sm sn-menu-btn" onclick="SNPost.toggleMenu('${post._id}')" aria-label="Post options" aria-haspopup="true">⋯</button>
          <div class="sn-post-menu hidden" id="sn-menu-${post._id}" role="menu">
            ${isOwn ? `<button class="sn-menu-item" role="menuitem" onclick="SNPost.startEdit('${post._id}')">✏️ Edit Post</button>` : ''}
            ${(isOwn || isMod) ? `<button class="sn-menu-item danger" role="menuitem" onclick="SNPost.deletePost('${post._id}')">🗑️ Delete Post</button>` : ''}
            ${!isOwn ? `<button class="sn-menu-item" role="menuitem" onclick="SNPost.reportPost('${post._id}')">🚩 Report Post</button>` : ''}
            <button class="sn-menu-item" role="menuitem" onclick="SNPost.copyLink('${post._id}')">🔗 Copy Link</button>
          </div>
        </div>
      </div>

      <!-- Post content -->
      <div class="sn-post-body" id="sn-post-body-${post._id}">
        ${post.content ? `<p class="sn-post-text">${escapeHtml(post.content)}</p>` : ''}
        ${post.mediaUrls?.length ? `
          <div class="sn-media-grid sn-media-${Math.min(post.mediaUrls.length, 4)}">
            ${post.mediaUrls.slice(0, 4).map((url, i) => `
              <img
                class="sn-media-img"
                src="${escapeHtml(url)}"
                alt="Post media ${i + 1}"
                loading="lazy"
                onclick="SNPost.fullscreen('${escapeHtml(url)}')"
              >
            `).join('')}
          </div>
        ` : ''}
      </div>

      <!-- Edit inline area (hidden until editing) -->
      <div class="sn-edit-area hidden" id="sn-edit-${post._id}">
        <textarea class="form-input sn-edit-input" id="sn-edit-input-${post._id}" maxlength="10000">${escapeHtml(post.content || '')}</textarea>
        <div class="sn-edit-actions">
          <button class="btn btn-ghost btn-sm" onclick="SNPost.cancelEdit('${post._id}')">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="SNPost.saveEdit('${post._id}')">Save</button>
        </div>
      </div>

      <!-- Action bar -->
      <div class="sn-action-bar">
        <button
          class="sn-action-btn ${isLiked ? 'sn-liked' : ''}"
          id="sn-like-btn-${post._id}"
          onclick="SNPost.toggleLike('${post._id}', this)"
          aria-label="${isLiked ? 'Unlike' : 'Like'} post"
          aria-pressed="${isLiked}"
        >
          <span class="sn-action-icon">♥</span>
          <span class="sn-action-count" id="sn-like-count-${post._id}">${formatCount(likeCount)}</span>
        </button>
        <button
          class="sn-action-btn"
          onclick="SNComments.toggle('${post._id}')"
          aria-label="Comments (${commentCount})"
        >
          <span class="sn-action-icon">💬</span>
          <span class="sn-action-count" id="sn-comment-count-${post._id}">${formatCount(commentCount)}</span>
        </button>
        <button
          class="sn-action-btn ${post.repostedByMe ? 'sn-reposted' : ''}"
          id="sn-repost-btn-${post._id}"
          onclick="SNPost.repost('${post._id}', this)"
          aria-label="Repost"
        >
          <span class="sn-action-icon">↗</span>
          <span class="sn-action-count" id="sn-repost-count-${post._id}">${formatCount(repostCount)}</span>
        </button>
        <button
          class="sn-action-btn"
          onclick="SNPost.share('${post._id}')"
          aria-label="Share post"
        >
          <span class="sn-action-icon">🔗</span>
          <span class="sn-action-label">Share</span>
        </button>
      </div>

      <!-- Comments section (collapsible) -->
      <div class="sn-comments-section hidden" id="sn-comments-${post._id}">
        <div class="sn-comments-list" id="sn-comments-list-${post._id}">
          <div class="loading-state" style="padding:8px"><div class="spinner"></div></div>
        </div>
        <div class="sn-comment-composer" id="sn-comment-form-${post._id}"></div>
      </div>
    `;

    return el;
  },

  toggleMenu(postId) {
    const menu = document.getElementById(`sn-menu-${postId}`);
    if (!menu) return;
    const isOpen = !menu.classList.contains('hidden');
    // Close all other menus
    document.querySelectorAll('.sn-post-menu').forEach(m => m.classList.add('hidden'));
    if (!isOpen) menu.classList.remove('hidden');
  },

  async toggleLike(postId, btn) {
    if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }

    // Optimistic UI
    const countEl = document.getElementById(`sn-like-count-${postId}`);
    const wasLiked = btn.classList.contains('sn-liked');
    const prevCount = parseInt(countEl?.textContent?.replace(/[KM]/g, '')) || 0;
    btn.classList.toggle('sn-liked', !wasLiked);
    btn.setAttribute('aria-pressed', String(!wasLiked));
    if (countEl) countEl.textContent = formatCount(wasLiked ? Math.max(0, prevCount - 1) : prevCount + 1);

    try {
      const data = await LegendAPI.posts.like(postId);
      // Sync with server value if returned (Firestore path returns { liked, likeCount })
      if (data && data.likeCount !== undefined) {
        if (countEl) countEl.textContent = formatCount(data.likeCount);
      }
      if (data && data.liked !== undefined) {
        btn.classList.toggle('sn-liked', data.liked);
        btn.setAttribute('aria-pressed', String(data.liked));
      }
    } catch (err) {
      console.warn('[AVN] Like error:', err);
      // Roll back
      btn.classList.toggle('sn-liked', wasLiked);
      btn.setAttribute('aria-pressed', String(wasLiked));
      if (countEl) countEl.textContent = formatCount(prevCount);
      Toast.error('Something went wrong. Please try again.');
    }
  },

  async repost(postId, btn) {
    if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }
    btn.disabled = true;
    try {
      const data = await LegendAPI.posts.repost(postId);
      const countEl = document.getElementById(`sn-repost-count-${postId}`);
      if (countEl) countEl.textContent = formatCount(data.repostCount);
      btn.classList.toggle('sn-reposted', data.reposted);
      Toast.success(data.reposted ? 'Reposted!' : 'Repost removed.');
    } catch (err) {
      console.warn('[AVN] Repost error:', err);
      Toast.error('Something went wrong. Please try again.');
    } finally {
      btn.disabled = false;
    }
  },

  share(postId) {
    const url = `${location.origin}${location.pathname}#social/post/${postId}`;
    if (navigator.share) {
      navigator.share({ title: 'Avenora Feed Post', url }).catch(() => this.copyLink(postId));
    } else {
      this.copyLink(postId);
    }
  },

  copyLink(postId) {
    const url = `${location.origin}${location.pathname}#social/post/${postId}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
        .then(() => Toast.success('Link copied!'))
        .catch(() => Toast.info(`Link: ${url}`));
    } else {
      Toast.info(`Link: ${url}`);
    }
    document.querySelectorAll('.sn-post-menu').forEach(m => m.classList.add('hidden'));
  },

  startEdit(postId) {
    document.getElementById(`sn-post-body-${postId}`)?.classList.add('hidden');
    document.getElementById(`sn-edit-${postId}`)?.classList.remove('hidden');
    document.querySelectorAll('.sn-post-menu').forEach(m => m.classList.add('hidden'));
    document.getElementById(`sn-edit-input-${postId}`)?.focus();
  },

  cancelEdit(postId) {
    document.getElementById(`sn-post-body-${postId}`)?.classList.remove('hidden');
    document.getElementById(`sn-edit-${postId}`)?.classList.add('hidden');
  },

  async saveEdit(postId) {
    const input = document.getElementById(`sn-edit-input-${postId}`);
    const content = input?.value?.trim();
    if (!content) { Toast.error('Post content cannot be empty.'); return; }

    try {
      const data = await LegendAPI.posts.update(postId, content);
      // Update post body in-place
      const body = document.getElementById(`sn-post-body-${postId}`);
      if (body) {
        const textEl = body.querySelector('.sn-post-text');
        if (textEl) textEl.textContent = content;
      }
      this.cancelEdit(postId);
      Toast.success('Post updated.');
    } catch (err) {
      console.warn('[AVN] Post edit error:', err);
      Toast.error('We couldn\'t save your changes. Please try again.');
    }
  },

  async deletePost(postId) {
    if (!confirm('Delete this post? This action cannot be undone.')) return;
    document.querySelectorAll('.sn-post-menu').forEach(m => m.classList.add('hidden'));
    try {
      await LegendAPI.posts.delete(postId);
      const article = document.querySelector(`[data-post-id="${postId}"]`);
      if (article) {
        article.style.transition = 'opacity 300ms';
        article.style.opacity = '0';
        setTimeout(() => article.remove(), 300);
      }
      Toast.success('Post deleted.');
    } catch (err) {
      console.warn('[AVN] Post delete error:', err);
      Toast.error('This post could not be deleted. Please try again.');
    }
  },

  async reportPost(postId) {
    document.querySelectorAll('.sn-post-menu').forEach(m => m.classList.add('hidden'));
    if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }

    const reasons = [
      { value: 'spam', label: 'Spam or self-promotion' },
      { value: 'harassment', label: 'Harassment or bullying' },
      { value: 'hate_speech', label: 'Hate speech' },
      { value: 'misinformation', label: 'Misinformation' },
      { value: 'nsfw', label: 'Explicit / NSFW content' },
      { value: 'violence', label: 'Violence or threats' },
      { value: 'other', label: 'Other' },
    ];

    Modal.create({
      id: 'sn-report-modal',
      title: 'Report Post',
      body: `
        <p style="color:var(--text-secondary);margin-bottom:var(--space-md)">Help keep Avenora Feed safe. Select the reason for this report.</p>
        <div class="form-group">
          <label class="form-label">Reason</label>
          <select class="form-input" id="sn-report-reason">
            ${reasons.map(r => `<option value="${r.value}">${r.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Details (optional)</label>
          <textarea class="form-input" id="sn-report-details" rows="3" placeholder="Any additional context..." maxlength="500"></textarea>
        </div>
        <div id="sn-report-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem;margin-top:8px"></div>
      `,
      actions: [
        { label: 'Cancel', class: 'btn-ghost', onclick: "Modal.close('sn-report-modal')" },
        { label: 'Submit Report', class: 'btn-danger', onclick: `SNPost._submitReport('${postId}')` },
      ],
    });
    Modal.open('sn-report-modal');
  },

  async _submitReport(postId) {
    const reason = document.getElementById('sn-report-reason')?.value;
    const details = document.getElementById('sn-report-details')?.value?.trim();
    const errEl = document.getElementById('sn-report-error');
    if (!reason) { if (errEl) { errEl.textContent = 'Please select a reason.'; errEl.classList.remove('hidden'); } return; }
    try {
      await LegendAPI.reports.submit('post', postId, reason, details);
      Modal.close('sn-report-modal');
      Toast.success('Report submitted. Our team will review it.');
    } catch (err) {
      console.warn('[AVN] Report submit error:', err);
      if (errEl) { errEl.textContent = 'Your report could not be submitted. Please try again.'; errEl.classList.remove('hidden'); }
    }
  },

  fullscreen(url) {
    const overlay = document.createElement('div');
    overlay.className = 'sn-fullscreen-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<img src="${escapeHtml(url)}" class="sn-fullscreen-img" alt="Full size image"><button class="sn-fullscreen-close" onclick="this.parentElement.remove()" aria-label="Close">✕</button>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  },
};
window.SNPost = SNPost;

// ═══════════════════════════════════════════════════════════════
// SNComments — Comment display and interactions
// ═══════════════════════════════════════════════════════════════

const SNComments = {
  loadedPosts: new Set(),

  async toggle(postId) {
    const section = document.getElementById(`sn-comments-${postId}`);
    if (!section) return;

    const isHidden = section.classList.contains('hidden');
    section.classList.toggle('hidden', !isHidden);

    if (isHidden && !this.loadedPosts.has(postId)) {
      await this.load(postId);
    }
  },

  async load(postId) {
    const listEl = document.getElementById(`sn-comments-list-${postId}`);
    const formEl = document.getElementById(`sn-comment-form-${postId}`);
    if (!listEl) return;

    listEl.innerHTML = `<div class="loading-state" style="padding:8px"><div class="spinner"></div></div>`;

    try {
      const data = await LegendAPI.posts.comments(postId);
      const comments = data.comments || [];
      this.loadedPosts.add(postId);
      this.renderList(postId, comments);
      this.renderForm(postId, formEl);
    } catch (err) {
      listEl.innerHTML = `<p class="sn-inline-error">${escapeHtml(err.message)}</p>`;
    }
  },

  renderList(postId, comments) {
    const listEl = document.getElementById(`sn-comments-list-${postId}`);
    if (!listEl) return;

    if (!comments.length) {
      listEl.innerHTML = `<p class="sn-no-comments">No comments yet. Be the first to say something.</p>`;
      return;
    }

    const user = LegendAPI.auth.getUser();
    const isMod = user && ['moderator', 'founder', 'admin'].includes(user.role);

    listEl.innerHTML = '';
    comments.forEach(c => {
      const el = document.createElement('div');
      el.className = 'sn-comment';
      el.dataset.commentId = c._id;

      const isOwn = user && (c.author?._id === user.id || c.author?.id === user.id || c.isOwn);
      const canDelete = isOwn || isMod;

      el.innerHTML = `
        <a href="#profile/${escapeHtml(c.author?.username || '')}" class="sn-comment-avatar">
          ${avatarHtml(c.author, 'sm')}
        </a>
        <div class="sn-comment-body">
          <div class="sn-comment-header">
            <a href="#profile/${escapeHtml(c.author?.username || '')}" class="sn-comment-author">
              ${escapeHtml(c.author?.profile?.displayName || c.author?.username || 'Unknown')}
            </a>
            ${roleBadgeHtml(c.author?.role)}
            <time class="sn-timestamp" style="margin-left:6px" datetime="${c.createdAt}" title="${new Date(c.createdAt).toLocaleString()}">${formatTimeAgo(c.createdAt)}</time>
            ${canDelete ? `<button class="sn-comment-delete" onclick="SNComments.deleteComment('${postId}', '${c._id}', this)" title="Delete comment">🗑️</button>` : ''}
          </div>
          <p class="sn-comment-text">${escapeHtml(c.content)}</p>
        </div>
      `;
      listEl.appendChild(el);
    });

    // Update comment count in action bar
    const countEl = document.getElementById(`sn-comment-count-${postId}`);
    if (countEl) countEl.textContent = formatCount(comments.length);
  },

  renderForm(postId, formEl) {
    if (!formEl) return;
    const user = LegendAPI.auth.getUser();

    if (!user) {
      formEl.innerHTML = `<p class="sn-no-comments"><a href="#" onclick="Modal.open('auth-modal');return false">Sign in</a> to comment.</p>`;
      return;
    }

    formEl.innerHTML = `
      <div class="sn-comment-input-row">
        ${avatarHtml(user, 'sm')}
        <input
          class="form-input sn-comment-input"
          type="text"
          placeholder="Write a comment…"
          id="sn-ci-${postId}"
          maxlength="2000"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();SNComments.submit('${postId}')}"
        >
        <button class="btn btn-primary btn-sm" onclick="SNComments.submit('${postId}')">Send</button>
      </div>
      <div id="sn-ci-error-${postId}" class="sn-inline-error hidden"></div>
    `;
  },

  async submit(postId) {
    const input = document.getElementById(`sn-ci-${postId}`);
    const errEl = document.getElementById(`sn-ci-error-${postId}`);
    const content = input?.value?.trim();

    if (!content) {
      if (errEl) { errEl.textContent = 'Comment cannot be empty.'; errEl.classList.remove('hidden'); }
      return;
    }
    if (content.length > 2000) {
      if (errEl) { errEl.textContent = 'Comment too long (max 2000 characters).'; errEl.classList.remove('hidden'); }
      return;
    }

    if (errEl) errEl.classList.add('hidden');
    const btn = input?.nextElementSibling;
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    if (input) input.disabled = true;

    try {
      await LegendAPI.posts.comment(postId, content);
      if (input) { input.value = ''; input.disabled = false; }
      if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
      this.loadedPosts.delete(postId); // Force reload
      await this.load(postId);
    } catch (err) {
      console.warn('[AVN] Comment submit error:', err);
      if (errEl) { errEl.textContent = 'Your comment could not be sent. Please try again.'; errEl.classList.remove('hidden'); }
      if (input) input.disabled = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
    }
  },

  async deleteComment(postId, commentId, btn) {
    if (!confirm('Delete this comment?')) return;
    btn.disabled = true;
    try {
      await LegendAPI.posts.deleteComment(postId, commentId);
      const commentEl = btn.closest('[data-comment-id]');
      commentEl?.remove();

      // Update count
      const listEl = document.getElementById(`sn-comments-list-${postId}`);
      const remaining = listEl?.querySelectorAll('[data-comment-id]').length || 0;
      const countEl = document.getElementById(`sn-comment-count-${postId}`);
      if (countEl) countEl.textContent = formatCount(remaining);

      if (!remaining) {
        if (listEl) listEl.innerHTML = `<p class="sn-no-comments">No comments yet. Be the first to say something.</p>`;
      }
      Toast.success('Comment deleted.');
    } catch (err) {
      console.warn('[AVN] Comment delete error:', err);
      btn.disabled = false;
      Toast.error('This comment could not be deleted. Please try again.');
    }
  },
};
window.SNComments = SNComments;

// ═══════════════════════════════════════════════════════════════
// SNStories — 24-hour stories (timestamp-based expiry)
// ═══════════════════════════════════════════════════════════════

const SNStories = {
  async load() {
    const user = LegendAPI.auth.getUser();
    const bar = document.getElementById('sn-stories-bar');
    const addBtn = document.getElementById('sn-story-add-btn');
    const list = document.getElementById('sn-stories-list');

    if (user && addBtn) addBtn.style.display = 'flex';

    if (!LegendAPI.auth.isLoggedIn()) {
      if (bar) bar.style.display = 'none';
      return;
    }

    try {
      const data = await LegendAPI.stories.feed();
      const stories = data.stories || [];

      // Filter client-side to only show stories from the last 24 hours.
      // Firestore stories do not have an `expiresAt` field — we compute expiry
      // from `createdAt` (24h window).  Guard against missing/invalid timestamps.
      const now = Date.now();
      const MS_24H = 24 * 60 * 60 * 1000;
      const active = stories.filter(s => {
        // Prefer expiresAt if present (REST backend), otherwise derive from createdAt
        if (s.expiresAt) return new Date(s.expiresAt).getTime() > now;
        const created = _tsToDate(s.createdAt);
        if (!created) return true; // no timestamp → include
        return (now - created.getTime()) < MS_24H;
      });

      if (!active.length && list) {
        list.innerHTML = '';
        return;
      }

      // Group by author
      const grouped = {};
      active.forEach(s => {
        const aid = s.author?._id || s.author?.id;
        if (!grouped[aid]) grouped[aid] = { author: s.author, stories: [] };
        grouped[aid].stories.push(s);
      });

      if (list) {
        list.innerHTML = '';
        Object.values(grouped).forEach(group => {
          const hasUnread = group.stories.some(s => !s.viewedByMe);
          const el = document.createElement('div');
          el.className = 'sn-story-item';
          el.innerHTML = `
            <div class="sn-story-ring ${hasUnread ? 'sn-story-unread' : 'sn-story-seen'}" onclick="SNStories.view('${group.stories[0]._id}', '${escapeHtml(group.author?.username || '')}')">
              <div class="sn-story-avatar">${(group.author?.username || '?')[0].toUpperCase()}</div>
            </div>
            <span class="sn-story-name">${escapeHtml(group.author?.username || '')}</span>
          `;
          list.appendChild(el);
        });
      }

      if (bar) bar.style.display = active.length ? 'block' : 'none';
    } catch {
      // Stories are non-critical; fail silently
      const bar = document.getElementById('sn-stories-bar');
      if (bar) bar.style.display = 'none';
    }
  },

  view(storyId, username) {
    // Mark as viewed
    LegendAPI.stories.view(storyId).catch(() => {});

    Modal.create({
      id: 'sn-story-viewer',
      title: `${escapeHtml(username ? '@' + username + "'s Story" : "Story")}`,
      body: `<div id="sn-story-viewer-content" style="text-align:center">
        <div class="loading-state"><div class="spinner"></div></div>
      </div>`,
      actions: [{ label: 'Close', class: 'btn-ghost', onclick: "Modal.close('sn-story-viewer')" }],
    });
    Modal.open('sn-story-viewer');

    // Load the story with a 10-second timeout — never leave the spinner spinning forever
    const _storyTimeout = setTimeout(() => {
      const c = document.getElementById('sn-story-viewer-content');
      if (c && c.querySelector('.spinner')) {
        c.innerHTML = `<div style="padding:24px 0">
          <p style="color:var(--text-muted);margin-bottom:16px">This story is temporarily unavailable.</p>
          <button class="btn btn-outline btn-sm" onclick="SNStories.view('${escapeHtml(storyId)}','${escapeHtml(username || '')}');Modal.close('sn-story-viewer')">↻ Retry</button>
        </div>`;
      }
    }, 10000);

    const _loadStory = async () => {
      const contentEl = document.getElementById('sn-story-viewer-content');
      if (!contentEl) return;
      try {
        // Use Firestore to get the specific story
        if (!window.AvenoraFirebase?.Firestore) throw new Error('Firestore not ready');
        const db = window.AvenoraFirebase.Firestore;
        const stories = await db.getStories(100);
        clearTimeout(_storyTimeout);
        const story = stories.find(s => s.id === storyId);
        const c = document.getElementById('sn-story-viewer-content');
        if (!c) return;
        if (!story) {
          c.innerHTML = `<p style="color:var(--text-muted)">This story is no longer available.</p>`;
          return;
        }
        if (story.mediaType === 'image' || !story.mediaType) {
          c.innerHTML = `<img src="${escapeHtml(story.mediaUrl || '')}" style="max-width:100%;border-radius:8px;display:block;margin:0 auto" alt="Story image">
            ${story.caption ? `<p style="margin-top:12px;color:var(--text-secondary);font-size:0.9rem">${escapeHtml(story.caption)}</p>` : ''}`;
        } else if (story.mediaType === 'video') {
          c.innerHTML = `<video src="${escapeHtml(story.mediaUrl || '')}" controls style="max-width:100%;border-radius:8px" playsinline></video>
            ${story.caption ? `<p style="margin-top:12px;color:var(--text-secondary);font-size:0.9rem">${escapeHtml(story.caption)}</p>` : ''}`;
        }
      } catch (err) {
        clearTimeout(_storyTimeout);
        const c = document.getElementById('sn-story-viewer-content');
        if (c) {
          c.innerHTML = `<div style="padding:24px 0">
            <p style="color:var(--text-muted);margin-bottom:16px">This story is temporarily unavailable.</p>
            <button class="btn btn-outline btn-sm" onclick="SNStories.view('${escapeHtml(storyId)}','${escapeHtml(username || '')}');Modal.close('sn-story-viewer')">↻ Retry</button>
          </div>`;
        }
      }
    };
    _loadStory();
  },

  openCreate() {
    if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }

    Modal.create({
      id: 'sn-story-create',
      title: 'Create Story',
      body: `
        <p style="color:var(--text-secondary);margin-bottom:var(--space-md)">Stories expire automatically after 24 hours.</p>
        <div class="form-group">
          <label class="form-label">Upload Image</label>
          <input type="file" class="form-input" id="sn-story-file" accept="image/jpeg,image/png,image/webp,image/gif">
        </div>
        <div class="form-group">
          <label class="form-label">Caption (optional)</label>
          <input type="text" class="form-input" id="sn-story-caption" maxlength="500" placeholder="Add a caption…">
        </div>
        <div id="sn-story-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem;margin-top:8px"></div>
      `,
      actions: [
        { label: 'Cancel', class: 'btn-ghost', onclick: "Modal.close('sn-story-create')" },
        { label: 'Post Story', class: 'btn-primary', onclick: 'SNStories.submitCreate()' },
      ],
    });
    Modal.open('sn-story-create');
  },

  async submitCreate() {
    const fileInput = document.getElementById('sn-story-file');
    const caption = document.getElementById('sn-story-caption')?.value?.trim();
    const errEl = document.getElementById('sn-story-error');

    if (!fileInput?.files?.[0]) {
      if (errEl) { errEl.textContent = 'Please select an image file.'; errEl.classList.remove('hidden'); }
      return;
    }

    const file = fileInput.files[0];
    if (file.size > 20 * 1024 * 1024) {
      if (errEl) { errEl.textContent = 'File too large (max 20 MB).'; errEl.classList.remove('hidden'); }
      return;
    }

    try {
      const uploaded = await LegendAPI.upload.image(file);
      await LegendAPI.stories.create(uploaded.url, 'image', caption);
      Modal.close('sn-story-create');
      Toast.success('Story posted! It will expire in 24 hours.');
      await SNStories.load();
    } catch (err) {
      console.warn('[AVN] Story create error:', err);
      if (errEl) { errEl.textContent = 'Your story could not be posted. Please try again.'; errEl.classList.remove('hidden'); }
    }
  },
};
window.SNStories = SNStories;

// Close menus when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.sn-post-menu-wrap')) {
    document.querySelectorAll('.sn-post-menu').forEach(m => m.classList.add('hidden'));
  }
});
