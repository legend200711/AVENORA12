/**
 * PROFILE PAGE — Avenora
 * Full profile with follow/unfollow, profile editing,
 * avatar upload, user posts, followers/following lists.
 */

registerPage('profile', {
  async render(container) {
    // ── Step 1: Wait for Firebase auth to resolve ─────────────────────────
    // Never treat a temporary auth.currentUser === null (during startup) as
    // "not logged in" — wait for the first onAuthStateChanged to fire.
    const authLoading = LegendState.get('authLoading');
    if (authLoading) {
      await new Promise(resolve => {
        // Already resolved → fire immediately; otherwise wait up to 8 s.
        const unsub = LegendState.subscribe('authLoading', (val) => {
          if (!val) { unsub(); resolve(); }
        });
        setTimeout(() => { unsub(); resolve(); }, 8000);
      });
    }

    // ── Step 2: Resolve viewed profile UID ────────────────────────────────
    // currentUser is the authenticated user (may be null = not signed in).
    // viewedUid is WHO we're looking at (own profile or another user).
    //
    // URL: #profile          → own profile (need to be signed in)
    //      #profile/USERNAME  → another user's profile (username in URL)
    //      #profile/UID       → another user's profile (UID in URL)
    const currentUser = LegendAPI.auth.getUser();

    // Derive the Firebase auth currentUser directly for the most reliable UID.
    let authenticatedUid = currentUser?.uid || currentUser?.id || null;

    // Try to get the UID directly from Firebase Auth in case LegendState
    // is still catching up after an account switch.
    if (!authenticatedUid && window.AvenoraFirebase?.getFirebaseAuth) {
      try {
        const fbAuth = await window.AvenoraFirebase.getFirebaseAuth();
        if (fbAuth?.currentUser) {
          authenticatedUid = fbAuth.currentUser.uid;
        }
      } catch (_) {}
    }

    const hashParts = location.hash.replace('#', '').split('/');
    const routeParam = hashParts[1] ? decodeURIComponent(hashParts[1]) : null;

    // Determine the viewed UID:
    //   • No route param → own profile (requires sign-in)
    //   • Route param looks like a Firebase UID (≥20 alphanumeric chars) → use as UID
    //   • Route param looks like a username → resolve via Firestore lookup
    let viewedUid = null;

    if (!routeParam) {
      // Own profile
      if (!authenticatedUid) {
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
      viewedUid = authenticatedUid;
    } else {
      // Another user, or own profile navigated to by username/uid
      viewedUid = routeParam;
    }

    showLoading(container, 'Loading profile…');

    // ── Inner load function so "Try Again" can re-run the full flow ───────
    const _doLoad = async () => {
    try {
      // Always use loadProfile(uid) when we have a UID.
      // Fall back to profile(username) for old-style username URLs.
      let data;
      const looksLikeUid = /^[A-Za-z0-9]{20,}$/.test(String(viewedUid || ''));
      if (looksLikeUid && window.AvenoraFirebase?.Firestore) {
        data = await LegendAPI.users.loadProfile(viewedUid);
      } else {
        data = await LegendAPI.users.profile(viewedUid);
      }
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
                ${(function() {
                  const _avatarUrl = (typeof resolveAvatarUrl === 'function')
                    ? resolveAvatarUrl(profile)
                    : (profile.profile?.avatarUrl || null);
                  const _initials = (profile.username || '?')[0].toUpperCase();
                  if (_avatarUrl) {
                    return `<img class="sn-profile-avatar-img" src="${escapeHtml(_avatarUrl)}" alt="${escapeHtml(profile.username)}" data-initials="${escapeHtml(_initials)}" data-size="lg" onerror="_onAvatarError(this)">`;
                  }
                  return `<div class="sn-profile-avatar-placeholder">${_initials}</div>`;
                })()}
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
            <button class="tab-btn active" id="sn-tab-posts" onclick="SNProfile.showTab('posts', '${escapeHtml(profile.id || profile.uid)}', this)">POSTS</button>
            <button class="tab-btn" id="sn-tab-media" onclick="SNProfile.showTab('media', '${escapeHtml(profile.id || profile.uid)}', this)">MEDIA</button>
          </div>

          <!-- Tab content -->
          <div id="sn-profile-content">
            <div class="loading-state"><div class="spinner"></div></div>
          </div>
        </div>
      `;

      // Load posts tab by default — always pass the UID so post queries are
      // UID-based and can never cross-contaminate between users with similar names.
      SNProfile.showTab('posts', profile.id || profile.uid);

    } catch (err) {
      // ── Diagnostic log: always log the real error during development ─────
      // Production shows a friendly message; DevTools preserves the real cause.
      const isNotFound        = err.code === 'PROFILE_NOT_FOUND';
      const isPermissionDenied = err.code === 'permission-denied'
        || err.code === 'PERMISSION_DENIED'
        || err.message?.includes('permission');
      const isNetwork         = err.message === 'Failed to fetch'
        || err.message?.includes('NetworkError')
        || err.message?.includes('net::ERR')
        || err.code === 'unavailable';
      const isAuthProblem     = err.code === 'unauthenticated'
        || err.code === 'UNAUTHENTICATED';
      const isApiUnconfigured = err.code === 'API_NOT_CONFIGURED'
        || err.code === 'FIREBASE_NOT_READY';

      console.error('[AVN] PROFILE LOAD FAILED', {
        authenticatedUid:  authenticatedUid || '(not signed in)',
        routeIdentifier:   routeParam       || '(none — own profile)',
        viewedUid:         viewedUid        || '(none)',
        documentPath:      viewedUid ? `users/${viewedUid}` : '(unknown)',
        firebaseCode:      err.code         || '(none)',
        message:           err.message,
        isNotFound,
        isPermissionDenied,
        isNetwork,
        isAuthProblem,
        isApiUnconfigured,
      });

      // Only show "does not exist" when the lookup genuinely found nothing.
      // Every other condition is a transient or configuration error — show a
      // recovery message so the user can try again rather than thinking the
      // account is gone.
      let friendlyMsg = 'This profile is temporarily unavailable. Please try again.';
      if (isNotFound)          friendlyMsg = 'This profile does not exist.';
      if (isNetwork)           friendlyMsg = 'Could not connect. Check your connection and try again.';
      if (isPermissionDenied)  friendlyMsg = 'You need to be signed in to view this profile.';
      if (isAuthProblem)       friendlyMsg = 'Your session has expired. Please sign in again.';
      if (isApiUnconfigured)   friendlyMsg = 'Service not configured. Check your internet connection and try again.';

      // "Try Again" re-runs the full load — not just a cached promise.
      showError(container, friendlyMsg, () => _doLoad());
    }
    }; // end _doLoad

    await _doLoad();
    return () => {};
  }
});

// ─── SNProfile helpers ───────────────────────────────────────

const SNProfile = {
  async showTab(tab, profileUid, btnEl) {
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

    // Posts tab — always query by UID so we never show another user's posts
    showLoading(content, 'Loading posts…');

    try {
      const data = await LegendAPI.users.postsByUid(profileUid);
      const posts = data.posts || [];

      // Update the post count stat to reflect the live query result
      const postsCountEl = document.querySelector('.sn-profile-stats .sn-stat-btn:last-child .sn-stat-num');
      if (postsCountEl) postsCountEl.textContent = formatCount(posts.length);

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
      console.error('[AVN] Profile posts error:', { profileUid, code: err.code, message: err.message });
      showError(content, 'Posts could not be loaded. Please try again.', () => SNProfile.showTab('posts', profileUid));
    }
  },

  async toggleFollow(userId, currentlyFollowing) {
    const btn = document.getElementById('sn-follow-btn');
    if (!btn) return;
    if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }

    // Validate targetUid before attempting a Firestore write.
    // profile.id (= userId here) must be a Firebase UID, never a username.
    const _isUid = (v) => typeof v === 'string' && /^[A-Za-z0-9]{20,}$/.test(v);
    if (!_isUid(userId)) {
      console.error('[AVN] toggleFollow — INVALID TARGET UID (not a Firebase UID):', userId,
        '— this is likely a username being passed instead of a UID. ' +
        'Check that profile.id is set from the Firestore document ID, not from profile.username.');
      Toast.error('Cannot follow: profile identity could not be resolved. Try refreshing the page.');
      return;
    }

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
      // Roll back optimistic UI
      btn.textContent = wasFollowing ? 'Unfollow' : 'Follow';
      btn.className = wasFollowing ? 'btn btn-outline' : 'btn btn-primary';
      btn.dataset.following = String(wasFollowing);
      if (countEl) countEl.textContent = formatCount(prevCount);

      // Log full diagnostics — never log auth tokens
      const currentUser = LegendAPI.auth.getUser();
      console.error('[AVN] toggleFollow FAILED', {
        targetProfileId:   userId,
        currentUserUid:    currentUser?.uid || currentUser?.id || '(none)',
        currentUsername:   currentUser?.username || '(none)',
        targetUidValid:    _isUid(userId),
        operation:         wasFollowing ? 'unfollow' : 'follow',
        firestorePaths:    {
          followers: 'followers/' + userId + '/users/{currentUid}',
          following: 'following/{currentUid}/users/' + userId,
        },
        firebaseErrorCode: err.code    || '(none)',
        errorMessage:      err.message || '(unknown)',
      });

      // Show a specific error message for known failure modes
      if (err.code === 'permission-denied') {
        Toast.error('Follow failed: permission denied. Are you signed in?');
      } else if (err.code === 'INVALID_UID') {
        Toast.error('Follow failed: could not identify the target account. Try refreshing the page.');
      } else if (err.code === 'unauthenticated') {
        Toast.error('Follow failed: you are not signed in.');
        Modal.open('auth-modal');
      } else {
        Toast.error('Follow failed. Check the browser console for details and try again.');
      }
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
      listEl.innerHTML = users.map(u => {
        // Navigate by UID so the profile page can always resolve the user.
        const pid = encodeURIComponent(u.uid || u.id || u.username || '');
        return `
        <a href="#profile/${pid}" class="sn-user-list-item" onclick="Modal.close('sn-followers-modal')">
          ${avatarHtml(u, 'sm')}
          <div>
            <div class="font-bold">${escapeHtml(u.profile?.displayName || u.username)}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">@${escapeHtml(u.username)}</div>
          </div>
          ${roleBadgeHtml(u.role)}
        </a>
      `}).join('');
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
      listEl.innerHTML = users.map(u => {
        const pid = encodeURIComponent(u.uid || u.id || u.username || '');
        return `
        <a href="#profile/${pid}" class="sn-user-list-item" onclick="Modal.close('sn-following-modal')">
          ${avatarHtml(u, 'sm')}
          <div>
            <div class="font-bold">${escapeHtml(u.profile?.displayName || u.username)}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">@${escapeHtml(u.username)}</div>
          </div>
          ${roleBadgeHtml(u.role)}
        </a>
      `}).join('');
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

        // Upload to Supabase — result.url is the public HTTPS URL
        const result = await window.AvenoraStorage.uploadAvatar(file);

        // Verify the upload actually returned a resolvable HTTPS URL
        if (!result || !result.url || !result.url.startsWith('https://')) {
          throw new Error(
            'Upload succeeded but did not return a valid URL. ' +
            'Check that the Supabase "avatars" bucket is set to PUBLIC and has ' +
            'an anon INSERT policy. See SUPABASE_SETUP.md for details.'
          );
        }

        // uploadAvatar uses a stable path (uid/avatar.jpg). Add a version timestamp
        // to the stored URL so every device (and every browser cache) fetches the
        // new image rather than the previously-cached one.
        const versionedUrl = `${result.url}?v=${Date.now()}`;

        // Save the versioned URL to Firestore (and REST backend if configured).
        // Storing the version in the URL means all devices see the updated picture.
        await LegendAPI.users.updateProfile({ avatarUrl: versionedUrl });

        // Update in-memory state immediately
        const user = LegendAPI.auth.getUser();
        if (user) LegendState.set('user', { ...user, profile: { ...user.profile, avatarUrl: versionedUrl } });

        console.info('[AVN] Avatar uploaded successfully:', {
          supabasePath: result.storagePath,
          bucket: result.bucket,
          publicUrl: result.url,
        });

        Toast.success('Avatar updated!');
        navigateTo('profile');
      } catch (err) {
        console.error('[AVN] Avatar upload error:', {
          message: err.message,
          hint: 'If "403" or "network error": check avatars bucket is PUBLIC with anon INSERT policy in Supabase.',
        });
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
