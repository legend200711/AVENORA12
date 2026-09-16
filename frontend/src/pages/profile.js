/**
 * PROFILE PAGE — Avenora
 * Full profile with follow/unfollow, profile editing,
 * avatar upload, user posts, followers/following lists.
 */

registerPage('profile', {
  async render(container) {
    const currentUser = LegendAPI.auth.getUser();
    const hashParts = location.hash.replace('#', '').split('/');
    const targetUsername = hashParts[1] ? decodeURIComponent(hashParts[1]) : currentUser?.username;

    if (!targetUsername) {
      container.innerHTML = `
        <div class="error-state" style="min-height:80vh">
          <div class="error-icon">👤</div>
          <h3>No profile specified</h3>
          <p>Sign in to view your profile, or visit a user's profile link.</p>
          <button class="btn btn-primary" onclick="Modal.open('auth-modal')">Sign In</button>
        </div>
      `;
      return;
    }

    showLoading(container, 'Loading profile…');

    try {
      const data = await LegendAPI.users.profile(targetUsername);
      const profile = data.user;
      const isOwn = !!profile.isOwnProfile;
      let isFollowing = profile.isFollowing || false;

      container.innerHTML = `
        <div class="sn-profile-page">

          <!-- Banner -->
          <div class="sn-profile-banner" id="sn-profile-banner">
            ${profile.profile?.bannerUrl
              ? `<img src="${escapeHtml(profile.profile.bannerUrl)}" class="sn-banner-img" alt="Profile banner">`
              : '<div class="sn-banner-placeholder"></div>'
            }
            ${isOwn ? `<button class="btn btn-ghost btn-sm sn-banner-edit-btn" onclick="SNProfile.editBanner()">🖼️ Edit Banner</button>` : ''}
          </div>

          <!-- Avatar + action row -->
          <div class="sn-profile-top">
            <div class="sn-profile-avatar-wrap">
              <div class="sn-profile-avatar-ring">
                ${profile.profile?.avatarUrl
                  ? `<img class="sn-profile-avatar-img" src="${escapeHtml(profile.profile.avatarUrl)}" alt="${escapeHtml(profile.username)}">`
                  : `<div class="sn-profile-avatar-placeholder">${(profile.username||'?')[0].toUpperCase()}</div>`
                }
              </div>
              ${isOwn ? `<button class="sn-avatar-edit-btn" onclick="SNProfile.editAvatar()" title="Change avatar">📷</button>` : ''}
            </div>
            <div class="sn-profile-actions">
              ${isOwn
                ? `<button class="btn btn-outline" id="sn-edit-profile-btn" onclick="SNProfile.openEdit()">✏️ Edit Profile</button>`
                : (currentUser
                    ? `<button
                         class="btn ${isFollowing ? 'btn-outline' : 'btn-primary'}"
                         id="sn-follow-btn"
                         onclick="SNProfile.toggleFollow('${profile.id}', ${isFollowing})"
                         data-following="${isFollowing}"
                       >${isFollowing ? 'Unfollow' : 'Follow'}</button>`
                    : `<button class="btn btn-primary" onclick="Modal.open('auth-modal')">Follow</button>`
                  )
              }
            </div>
          </div>

          <!-- Profile info -->
          <div class="sn-profile-info">
            <h2 class="sn-profile-displayname">${escapeHtml(profile.profile?.displayName || profile.username)}</h2>
            <div class="sn-profile-handle-row">
              <span class="sn-profile-handle">@${escapeHtml(profile.username)}</span>
              ${roleBadgeHtml(profile.role)}
            </div>
            ${profile.profile?.bio ? `<p class="sn-profile-bio">${escapeHtml(profile.profile.bio)}</p>` : ''}
            <div class="sn-profile-meta">
              ${profile.profile?.location ? `<span class="sn-meta-item">📍 ${escapeHtml(profile.profile.location)}</span>` : ''}
              ${profile.profile?.website ? `<span class="sn-meta-item">🔗 <a href="${escapeHtml(profile.profile.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(profile.profile.website)}</a></span>` : ''}
              <span class="sn-meta-item">📅 Joined ${formatDate(profile.createdAt)}</span>
            </div>

            <!-- Stats -->
            <div class="sn-profile-stats">
              <button class="sn-stat-btn" onclick="SNProfile.showFollowers('${profile.id}', '${escapeHtml(profile.username)}')">
                <span class="sn-stat-num" id="sn-followers-count">${formatCount(profile.stats?.followersCount || 0)}</span>
                <span class="sn-stat-label">Followers</span>
              </button>
              <button class="sn-stat-btn" onclick="SNProfile.showFollowing('${profile.id}', '${escapeHtml(profile.username)}')">
                <span class="sn-stat-num" id="sn-following-count" style="color:var(--neon-green)">${formatCount(profile.stats?.followingCount || 0)}</span>
                <span class="sn-stat-label">Following</span>
              </button>
              <div class="sn-stat-btn" style="cursor:default">
                <span class="sn-stat-num" style="color:var(--neon-purple)">${formatCount(profile.stats?.postsCount || 0)}</span>
                <span class="sn-stat-label">Posts</span>
              </div>
            </div>
          </div>

          <!-- Tabs -->
          <div class="tabs sn-profile-tabs">
            <button class="tab-btn active" id="sn-tab-posts" onclick="SNProfile.showTab('posts', '${escapeHtml(profile.username)}', this)">POSTS</button>
            <button class="tab-btn" id="sn-tab-media" onclick="SNProfile.showTab('media', '${escapeHtml(profile.username)}', this)">MEDIA</button>
          </div>

          <!-- Tab content -->
          <div id="sn-profile-content">
            <div class="loading-state"><div class="spinner"></div></div>
          </div>
        </div>
      `;

      // Load posts tab by default
      SNProfile.showTab('posts', profile.username);

    } catch (err) {
      console.warn('[AVN] Profile load error:', err);
      const isNetwork = err.message === 'Failed to fetch' || err.message?.includes('NetworkError') || err.message?.includes('net::ERR');
      showError(container, isNetwork ? 'Could not connect. Check your connection and try again.' : 'This profile is temporarily unavailable.', () => navigateTo('profile'));
    }

    return () => {};
  }
});

// ─── SNProfile helpers ───────────────────────────────────────

const SNProfile = {
  async showTab(tab, username, btnEl) {
    // Update active tab button
    document.querySelectorAll('.sn-profile-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    else {
      const btn = document.getElementById(`sn-tab-${tab}`);
      if (btn) btn.classList.add('active');
    }

    const content = document.getElementById('sn-profile-content');
    if (!content) return;

    if (tab === 'media') {
      content.innerHTML = `
        <div class="error-state" style="min-height:20vh">
          <div class="error-icon" style="font-size:2rem">🖼️</div>
          <p style="color:var(--text-muted)">This user hasn't posted any media yet.</p>
        </div>
      `;
      return;
    }

    // Posts tab
    showLoading(content, 'Loading posts…');

    try {
      const data = await LegendAPI.users.posts(username);
      const posts = data.posts || [];

      if (!posts.length) {
        content.innerHTML = `
          <div class="error-state" style="min-height:20vh">
            <div class="error-icon" style="font-size:2rem">🌑</div>
            <h3>This user hasn't posted anything yet.</h3>
          </div>
        `;
        return;
      }

      content.innerHTML = '';
      posts.forEach(post => {
        const el = SNPost.render(post);
        if (el) content.appendChild(el);
      });
    } catch (err) {
      console.warn('[AVN] Profile posts error:', err);
      showError(content, 'Posts could not be loaded. Please try again.', () => SNProfile.showTab('posts', username));
    }
  },

  async toggleFollow(userId, currentlyFollowing) {
    const btn = document.getElementById('sn-follow-btn');
    if (!btn) return;
    if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }

    btn.disabled = true;
    const wasFollowing = btn.dataset.following === 'true' || currentlyFollowing;

    // Optimistic UI
    btn.textContent = wasFollowing ? 'Follow' : 'Unfollow';
    btn.className = wasFollowing ? 'btn btn-primary' : 'btn btn-outline';
    btn.dataset.following = String(!wasFollowing);

    // Update follower count optimistically
    const countEl = document.getElementById('sn-followers-count');
    const prevCount = parseInt(countEl?.textContent?.replace(/[KM]/g, '')) || 0;
    if (countEl) countEl.textContent = formatCount(wasFollowing ? Math.max(0, prevCount - 1) : prevCount + 1);

    try {
      if (wasFollowing) {
        await LegendAPI.users.unfollow(userId);
      } else {
        await LegendAPI.users.follow(userId);
      }
    } catch (err) {
      // Roll back
      btn.textContent = wasFollowing ? 'Unfollow' : 'Follow';
      btn.className = wasFollowing ? 'btn btn-outline' : 'btn btn-primary';
      btn.dataset.following = String(wasFollowing);
      if (countEl) countEl.textContent = formatCount(prevCount);
      console.warn('[AVN] Follow toggle error:', err);
      Toast.error('Something went wrong. Please try again.');
    } finally {
      btn.disabled = false;
    }
  },

  async showFollowers(userId, username) {
    Modal.create({
      id: 'sn-followers-modal',
      title: `Followers of @${username}`,
      body: `<div id="sn-followers-list"><div class="loading-state"><div class="spinner"></div></div></div>`,
      actions: [{ label: 'Close', class: 'btn-ghost', onclick: "Modal.close('sn-followers-modal')" }],
    });
    Modal.open('sn-followers-modal');

    try {
      const data = await LegendAPI.users.followers(userId);
      const listEl = document.getElementById('sn-followers-list');
      if (!listEl) return;
      const users = data.users || [];
      if (!users.length) {
        listEl.innerHTML = '<p style="padding:16px;color:var(--text-muted);text-align:center">No followers yet.</p>';
        return;
      }
      listEl.innerHTML = users.map(u => `
        <a href="#profile/${escapeHtml(u.username)}" class="sn-user-list-item" onclick="Modal.close('sn-followers-modal')">
          ${avatarHtml(u, 'sm')}
          <div>
            <div class="font-bold">${escapeHtml(u.profile?.displayName || u.username)}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">@${escapeHtml(u.username)}</div>
          </div>
          ${roleBadgeHtml(u.role)}
        </a>
      `).join('');
    } catch (err) {
      console.warn('[AVN] Followers load error:', err);
      const listEl = document.getElementById('sn-followers-list');
      if (listEl) listEl.innerHTML = `<p class="sn-inline-error">Could not load followers. Please try again.</p>`;
    }
  },

  async showFollowing(userId, username) {
    Modal.create({
      id: 'sn-following-modal',
      title: `@${username} is following`,
      body: `<div id="sn-following-list"><div class="loading-state"><div class="spinner"></div></div></div>`,
      actions: [{ label: 'Close', class: 'btn-ghost', onclick: "Modal.close('sn-following-modal')" }],
    });
    Modal.open('sn-following-modal');

    try {
      const data = await LegendAPI.users.following(userId);
      const listEl = document.getElementById('sn-following-list');
      if (!listEl) return;
      const users = data.users || [];
      if (!users.length) {
        listEl.innerHTML = '<p style="padding:16px;color:var(--text-muted);text-align:center">Not following anyone yet.</p>';
        return;
      }
      listEl.innerHTML = users.map(u => `
        <a href="#profile/${escapeHtml(u.username)}" class="sn-user-list-item" onclick="Modal.close('sn-following-modal')">
          ${avatarHtml(u, 'sm')}
          <div>
            <div class="font-bold">${escapeHtml(u.profile?.displayName || u.username)}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">@${escapeHtml(u.username)}</div>
          </div>
          ${roleBadgeHtml(u.role)}
        </a>
      `).join('');
    } catch (err) {
      console.warn('[AVN] Following load error:', err);
      const listEl = document.getElementById('sn-following-list');
      if (listEl) listEl.innerHTML = `<p class="sn-inline-error">Could not load following list. Please try again.</p>`;
    }
  },

  openEdit() {
    const user = LegendAPI.auth.getUser();
    if (!user) return;

    Modal.create({
      id: 'sn-edit-profile-modal',
      title: 'Edit Profile',
      body: `
        <div class="form-group">
          <label class="form-label">Display Name</label>
          <input class="form-input" id="ep-displayname" value="${escapeHtml(user.profile?.displayName || '')}" maxlength="60" placeholder="Your display name">
        </div>
        <div class="form-group">
          <label class="form-label">Bio</label>
          <textarea class="form-input" id="ep-bio" rows="3" maxlength="500" placeholder="Tell the Eclipse community about yourself…">${escapeHtml(user.profile?.bio || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Location</label>
          <input class="form-input" id="ep-location" value="${escapeHtml(user.profile?.location || '')}" maxlength="100" placeholder="Where are you based?">
        </div>
        <div class="form-group">
          <label class="form-label">Website</label>
          <input class="form-input" type="url" id="ep-website" value="${escapeHtml(user.profile?.website || '')}" maxlength="200" placeholder="https://...">
        </div>
        <div id="ep-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem;margin-top:8px"></div>
      `,
      actions: [
        { label: 'Cancel', class: 'btn-ghost', onclick: "Modal.close('sn-edit-profile-modal')" },
        { label: 'Save Changes', class: 'btn-primary', onclick: 'SNProfile.saveEdit()' },
      ],
    });
    Modal.open('sn-edit-profile-modal');
  },

  async saveEdit() {
    const displayName = document.getElementById('ep-displayname')?.value?.trim();
    const bio = document.getElementById('ep-bio')?.value?.trim();
    const location = document.getElementById('ep-location')?.value?.trim();
    const website = document.getElementById('ep-website')?.value?.trim();
    const errEl = document.getElementById('ep-error');

    if (errEl) errEl.classList.add('hidden');

    // Validate display name
    if (displayName && displayName.length < 1) {
      if (errEl) { errEl.textContent = 'Display name cannot be empty.'; errEl.classList.remove('hidden'); }
      return;
    }

    try {
      const data = await LegendAPI.users.updateProfile({ displayName, bio, location, website });
      // Update local state
      const user = LegendAPI.auth.getUser();
      if (user) {
        LegendState.set('user', { ...user, profile: data.user.profile });
      }
      Modal.close('sn-edit-profile-modal');
      Toast.success('Profile updated!');
      // Refresh page to show updated info
      navigateTo('profile');
    } catch (err) {
      console.warn('[AVN] Profile save error:', err);
      if (errEl) { errEl.textContent = 'We couldn\'t save your changes. Please try again.'; errEl.classList.remove('hidden'); }
    }
  },

  editAvatar() {
    if (!LegendAPI.auth.isLoggedIn()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { Toast.error('Avatar must be under 10 MB.'); return; }

      const btn = document.querySelector('.sn-avatar-edit-btn');
      if (btn) { btn.disabled = true; btn.textContent = '…'; }

      try {
        if (!window.AvenoraStorage) throw new Error('Storage service not available');
        const result = await window.AvenoraStorage.uploadAvatar(file);
        await LegendAPI.users.updateProfile({ avatarUrl: result.url });
        const user = LegendAPI.auth.getUser();
        if (user) LegendState.set('user', { ...user, profile: { ...user.profile, avatarUrl: result.url } });
        Toast.success('Avatar updated!');
        navigateTo('profile');
      } catch (err) {
        console.warn('[AVN] Avatar upload error:', err);
        Toast.error(err.message || 'Your avatar could not be updated. Please try again.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📷'; }
      }
    };
    input.click();
  },

  editBanner() {
    if (!LegendAPI.auth.isLoggedIn()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { Toast.error('Banner must be under 20 MB.'); return; }
      try {
        if (!window.AvenoraStorage) throw new Error('Storage service not available');
        const result = await window.AvenoraStorage.uploadImage(file);
        await LegendAPI.users.updateProfile({ bannerUrl: result.url });
        Toast.success('Banner updated!');
        navigateTo('profile');
      } catch (err) {
        console.warn('[AVN] Banner upload error:', err);
        Toast.error(err.message || 'Your banner could not be updated. Please try again.');
      }
    };
    input.click();
  },
};
window.SNProfile = SNProfile;
