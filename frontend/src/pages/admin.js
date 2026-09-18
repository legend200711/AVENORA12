/**
 * FOUNDER CONTROL CENTER — Admin Dashboard
 * Only accessible to founder/admin roles.
 * Frontend role check is UI-only — real authorization is enforced server-side.
 */

registerPage('admin', {
  async render(container) {
    const user = LegendAPI.auth.getUser();

    // Frontend gate (UI only — server enforces real authorization)
    if (!user) {
      container.innerHTML = `<div class="error-state" style="min-height:80vh"><div class="error-icon">🛡️</div><h3>Access Denied</h3><p>You must be signed in to access the Control Center.</p><button class="btn btn-primary" onclick="Modal.open('auth-modal')">Sign In</button></div>`;
      return;
    }

    if (!['founder', 'admin'].includes(user.role)) {
      container.innerHTML = `<div class="error-state" style="min-height:80vh"><div class="error-icon">🚫</div><h3>Access Denied</h3><p>This area requires Founder or Admin privileges.</p><button class="btn btn-outline" onclick="navigateTo('hub')">Return to Hub</button></div>`;
      return;
    }

    container.innerHTML = `
      <!-- Mobile admin nav (tabs) -->
      <div class="mobile-only" style="background:var(--bg-card);border-bottom:1px solid var(--border-subtle);padding:var(--space-sm);overflow-x:auto">
        <div style="display:flex;gap:var(--space-sm);min-width:max-content">
          ${[
            { id: 'dashboard',   label: '📊 Dashboard' },
            { id: 'users',       label: '👥 Users' },
            { id: 'moderation',  label: '🛡️ Mod' },
            { id: 'videos',      label: '🎬 Videos' },
            { id: 'cloudstream', label: '☁️ Stream' },
            { id: 'system',      label: '⚙️ System' },
            { id: 'logs',        label: '📋 Logs' },
            { id: 'theme',       label: '🎨 Theme' },
          ].map(item => `
            <button class="btn btn-ghost btn-sm" onclick="adminSection('${item.id}')" id="admin-mob-nav-${item.id}"
              style="white-space:nowrap;font-size:0.8rem">${item.label}</button>
          `).join('')}
        </div>
      </div>
      <div style="display:flex;min-height:calc(100vh - 60px)">
        <!-- Admin sidebar -->
        <div style="width:220px;background:var(--bg-card);border-right:1px solid var(--border-subtle);padding:var(--space-md);flex-shrink:0" class="desktop-only admin-sidebar-desktop">
          <div style="margin-bottom:var(--space-lg)">
            <h3 style="font-family:var(--font-display);color:var(--neon-blue);letter-spacing:0.1em;font-size:0.9rem">FOUNDER CONTROL</h3>
            <p style="font-size:0.75rem;color:var(--text-muted)">Avenora Admin</p>
          </div>
          <nav>
            ${[
              { id: 'dashboard',   label: '📊 Dashboard' },
              { id: 'users',       label: '👥 Users' },
              { id: 'moderation',  label: '🛡️ Moderation' },
              { id: 'videos',      label: '🎬 Avenora Video' },
              { id: 'cloudstream', label: '☁️ Cloud Stream' },
              { id: 'system',      label: '⚙️ System Status' },
              { id: 'logs',        label: '📋 Logs' },
              { id: 'theme',       label: '🎨 Theme Control' },
            ].map(item => `
              <button class="btn btn-ghost" onclick="adminSection('${item.id}')" id="admin-nav-${item.id}"
                style="width:100%;text-align:left;justify-content:flex-start;margin-bottom:2px;font-size:0.85rem">
                ${item.label}
              </button>
            `).join('')}
          </nav>
        </div>

        <!-- Admin content -->
        <div style="flex:1;padding:var(--space-lg);overflow-y:auto" id="admin-content">
          <div class="loading-state"><div class="spinner"></div></div>
        </div>
      </div>
    `;

    await adminSection('dashboard');
    return () => {};
  }
});

window.adminSection = async function (section) {
  const content = document.getElementById('admin-content');
  if (!content) return;

  // Update nav (desktop sidebar + mobile tabs)
  document.querySelectorAll('[id^="admin-nav-"], [id^="admin-mob-nav-"]').forEach(btn => {
    const isActive = btn.id === `admin-nav-${section}` || btn.id === `admin-mob-nav-${section}`;
    btn.classList.toggle('active', isActive);
    btn.style.color = isActive ? 'var(--neon-blue)' : '';
  });

  showLoading(content, `Loading ${section}...`);

  try {
    switch (section) {
      case 'dashboard':   await renderAdminDashboard(content);    break;
      case 'users':       await renderAdminUsers(content);        break;
      case 'moderation':  await renderAdminModeration(content);   break;
      case 'videos':      await renderAdminVideos(content);       break;
      case 'cloudstream': await renderAdminCloudStream(content);  break;
      case 'system':      await renderAdminSystem(content);       break;
      case 'logs':        renderAdminLogs(content);               break;
      case 'theme':       await renderThemeControlCenter(content); break;
      default: content.innerHTML = `<p style="color:var(--text-muted)">Section "${section}" coming soon.</p>`;
    }
  } catch (err) {
    console.error(`[AVN] Admin section error [${section}]:`, err);
    showError(content, 'This section could not be loaded. Check your connection and try again.', () => adminSection(section));
  }
};

// ─── Firestore admin helpers ──────────────────────────────
// All admin data reads go directly to Firestore / Supabase — no backend needed.

async function _fsCount(collectionName) {
  try {
    const db = await window.AvenoraFirebase.getFirestore();
    const { collection, getCountFromServer } = await import(
      `https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`
    );
    const snap = await getCountFromServer(collection(db, collectionName));
    return snap.data().count;
  } catch {
    // getCountFromServer may not be available in older SDK bundles — fall back to getDocs
    try {
      const db = await window.AvenoraFirebase.getFirestore();
      const { collection, getDocs } = await import(
        `https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`
      );
      const snap = await getDocs(collection(db, collectionName));
      return snap.size;
    } catch { return '—'; }
  }
}

async function _fsUsers(limitCount = 50, search = '') {
  const db = await window.AvenoraFirebase.getFirestore();
  const { collection, query, orderBy, limit, getDocs, where } = await import(
    `https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`
  );
  let q;
  if (search) {
    // Firestore doesn't support full-text search; do prefix match on username
    const end = search + '\uf8ff';
    q = query(collection(db, 'users'), orderBy('username'), where('username', '>=', search), where('username', '<=', end), limit(limitCount));
  } else {
    q = query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(limitCount));
  }
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ _id: d.id, id: d.id, ...d.data() }));
}

async function renderAdminDashboard(container) {
  try {
    // Pull counts from Firestore directly — no backend required
    const [userCount, postCount, videoCount] = await Promise.all([
      _fsCount('users'),
      _fsCount('posts'),
      // Videos live in Supabase music_library (mime_type LIKE 'video/%')
      (async () => {
        try {
          const SUPABASE_URL  = 'https://licuiqxkkfboqezzmsqu.supabase.co';
          const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpY3VpcXhra2Zib3Flenptc3F1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNTYxMDQsImV4cCI6MjEwNDkzMjEwNH0.tsYOyCI7skF6Otz2W0oNYhxM63-0551lrqIDCO8NoJo';
          const r = await fetch(`${SUPABASE_URL}/rest/v1/music_library?mime_type=like.video/*&select=id`, {
            headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, Prefer: 'count=exact', Range: '0-0' },
          });
          const count = r.headers.get('content-range')?.split('/')[1];
          return count ? parseInt(count) : '—';
        } catch { return '—'; }
      })(),
    ]);

    container.innerHTML = `
      <h2 style="font-family:var(--font-display);letter-spacing:0.1em;margin-bottom:var(--space-xl);color:var(--neon-blue)">DASHBOARD</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-md);margin-bottom:var(--space-xl)">
        ${[
          { label: 'Users',  value: typeof userCount  === 'number' ? formatCount(userCount)  : userCount,  color: 'var(--neon-blue)',   icon: '👥' },
          { label: 'Posts',  value: typeof postCount  === 'number' ? formatCount(postCount)  : postCount,  color: 'var(--neon-green)',  icon: '📝' },
          { label: 'Videos', value: typeof videoCount === 'number' ? formatCount(videoCount) : videoCount, color: 'var(--neon-purple)', icon: '🎬' },
        ].map(stat => `
          <div class="card" style="text-align:center;border-color:rgba(255,255,255,0.07)">
            <div style="font-size:2rem;margin-bottom:var(--space-sm)">${stat.icon}</div>
            <div style="font-family:var(--font-display);font-size:1.8rem;font-weight:700;color:${stat.color}">${stat.value}</div>
            <div style="color:var(--text-muted);font-size:0.8rem;text-transform:uppercase;letter-spacing:0.1em">${stat.label}</div>
          </div>
        `).join('')}
      </div>
      <div class="card" style="padding:var(--space-md)">
        <h4 style="margin-bottom:var(--space-sm);font-family:var(--font-display);letter-spacing:0.05em">DATA SOURCES</h4>
        <div style="display:flex;flex-direction:column;gap:6px;font-size:0.85rem">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:8px;height:8px;border-radius:50%;background:var(--neon-green);display:inline-block"></span>
            Firebase Firestore — users, posts, gallery, stories
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:8px;height:8px;border-radius:50%;background:var(--neon-green);display:inline-block"></span>
            Supabase Storage — videos, music, images
          </div>
        </div>
        <p style="color:var(--text-muted);font-size:0.75rem;margin-top:8px">Last refreshed: ${new Date().toLocaleTimeString()}</p>
      </div>
    `;
  } catch (err) {
    console.error('[AVN] Admin dashboard error:', err);
    showError(container, 'Dashboard could not be loaded. Check your connection and try again.', () => renderAdminDashboard(container));
  }
}

async function renderAdminUsers(container) {
  try {
    const users = await _fsUsers(50);
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-xl)">
        <h2 style="font-family:var(--font-display);letter-spacing:0.1em;color:var(--neon-blue)">USERS (${users.length})</h2>
        <div class="search-bar" style="width:240px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="search" placeholder="Search users..." id="admin-user-search" oninput="adminSearchUsers(this.value)">
        </div>
      </div>
      <div id="admin-users-table">
        ${renderUsersTable(users)}
      </div>
    `;
  } catch (err) {
    console.error('[AVN] Admin users error:', err);
    showError(container, 'User data could not be loaded. Please try again.', () => renderAdminUsers(container));
  }
}

function renderUsersTable(users) {
  if (!users.length) return `<p style="color:var(--text-muted);text-align:center;padding:var(--space-xl)">No users found</p>`;
  return `
    <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
      <thead>
        <tr style="border-bottom:1px solid var(--border-subtle)">
          <th style="text-align:left;padding:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.06em;font-size:0.75rem">User</th>
          <th style="text-align:left;padding:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.06em;font-size:0.75rem">Role</th>
          <th style="text-align:left;padding:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.06em;font-size:0.75rem">Status</th>
          <th style="text-align:left;padding:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.06em;font-size:0.75rem">Joined</th>
          <th style="text-align:left;padding:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.06em;font-size:0.75rem">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${users.map(u => `
          <tr style="border-bottom:1px solid var(--border-subtle)" id="admin-user-row-${u._id}">
            <td style="padding:10px">
              <div style="font-weight:600">${escapeHtml(u.username)}</div>
              <div style="color:var(--text-muted);font-size:0.8rem">${escapeHtml(u.email)}</div>
            </td>
            <td style="padding:10px">
              <select style="background:var(--bg-secondary);border:1px solid var(--border-subtle);border-radius:4px;color:var(--text-primary);padding:4px 6px;font-size:0.8rem" 
                      onchange="adminSetRole('${u._id}', this.value)">
                ${['user','moderator','founder','admin'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
              </select>
            </td>
            <td style="padding:10px">
              <span class="${u.status?.isSuspended ? 'badge badge-live' : 'badge badge-green'}" style="font-size:0.7rem">
                ${u.status?.isSuspended ? 'SUSPENDED' : 'ACTIVE'}
              </span>
            </td>
            <td style="padding:10px;color:var(--text-muted)">${formatDate(u.createdAt)}</td>
            <td style="padding:10px">
              <div style="display:flex;gap:4px">
                ${u.status?.isSuspended
                  ? `<button class="btn btn-outline btn-sm" onclick="adminUnsuspend('${u._id}')">Restore</button>`
                  : `<button class="btn btn-ghost btn-sm" onclick="adminSuspend('${u._id}')">Suspend</button>`
                }
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

window.adminSearchUsers = debounce(async function (query) {
  try {
    const users = await _fsUsers(50, query);
    const el = document.getElementById('admin-users-table');
    if (el) el.innerHTML = renderUsersTable(users);
  } catch (err) { console.warn('[AVN] Admin user search error:', err); Toast.error('User search failed. Please try again.'); }
}, 400);

window.adminSetRole = async function (userId, role) {
  // Update role directly in Firestore (no backend needed)
  try {
    const db = await window.AvenoraFirebase.getFirestore();
    const { doc, updateDoc } = await import(
      `https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`
    );
    await updateDoc(doc(db, 'users', userId), { role });
    Toast.success(`Role updated to ${role}`);
  } catch (err) { console.warn('[AVN] Admin set role error:', err); Toast.error('Could not update role. Please try again.'); }
};

window.adminSuspend = async function (userId) {
  const reason = prompt('Suspension reason:');
  if (reason === null) return;
  try {
    const db = await window.AvenoraFirebase.getFirestore();
    const { doc, updateDoc } = await import(`https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`);
    await updateDoc(doc(db, 'users', userId), { 'status.isSuspended': true, 'status.suspendedReason': reason || 'Policy violation' });
    Toast.success('User suspended');
    adminSection('users');
  } catch (err) { console.warn('[AVN] Admin suspend error:', err); Toast.error('Could not suspend user. Please try again.'); }
};

window.adminUnsuspend = async function (userId) {
  try {
    const db = await window.AvenoraFirebase.getFirestore();
    const { doc, updateDoc } = await import(`https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`);
    await updateDoc(doc(db, 'users', userId), { 'status.isSuspended': false, 'status.suspendedReason': null });
    Toast.success('User unsuspended');
    adminSection('users');
  } catch (err) { console.warn('[AVN] Admin unsuspend error:', err); Toast.error('Could not restore user. Please try again.'); }
};

async function renderAdminModeration(container) {
  // Query Firestore posts collection for flagged posts
  try {
    const db = await window.AvenoraFirebase.getFirestore();
    const { collection, query, where, orderBy, limit, getDocs } = await import(
      `https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`
    );
    const q = query(collection(db, 'posts'), where('isFlagged', '==', true), orderBy('createdAt', 'desc'), limit(50));
    const snap = await getDocs(q);
    const posts = snap.docs.map(d => ({ _id: d.id, id: d.id, ...d.data() }));

    container.innerHTML = `
      <h2 style="font-family:var(--font-display);letter-spacing:0.1em;margin-bottom:var(--space-xl);color:var(--neon-blue)">MODERATION QUEUE</h2>
      ${!posts.length ? `<div class="error-state"><div class="error-icon">✅</div><h3>Queue is clear</h3><p>No flagged content awaiting moderation.</p></div>` :
        posts.map(post => `
          <div class="card" style="margin-bottom:var(--space-md)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-sm)">
              <div>
                <strong>@${escapeHtml(post.author?.username || 'unknown')}</strong>
                <span style="color:var(--text-muted);font-size:0.8rem;margin-left:8px">${formatTimeAgo(post.createdAt?.toDate?.() || post.createdAt)}</span>
              </div>
              <div style="display:flex;gap:var(--space-sm)">
                <button class="btn btn-ghost btn-sm" onclick="adminClearFlag('${post._id}')">✓ Clear</button>
                <button class="btn btn-danger btn-sm" onclick="adminDeletePost('${post._id}')">Delete</button>
              </div>
            </div>
            <p style="color:var(--text-secondary);font-size:0.9rem;word-break:break-word">${escapeHtml(post.content || '(media post)')}</p>
          </div>
        `).join('')
      }
    `;
  } catch (err) {
    console.error('[AVN] Admin moderation error:', err);
    showError(container, 'Moderation queue could not be loaded. Please try again.', () => renderAdminModeration(container));
  }
}

window.adminClearFlag = async function (postId) {
  try {
    const db = await window.AvenoraFirebase.getFirestore();
    const { doc, updateDoc } = await import(`https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`);
    await updateDoc(doc(db, 'posts', postId), { isFlagged: false });
    Toast.success('Flag cleared');
    adminSection('moderation');
  } catch (err) { console.warn('[AVN] Admin clear flag error:', err); Toast.error('Could not clear flag.'); }
};

window.adminDeletePost = async function (postId) {
  if (!confirm('Delete this post permanently?')) return;
  try {
    // Delete from Firestore directly
    const db = await window.AvenoraFirebase.getFirestore();
    const { doc, deleteDoc } = await import(`https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`);
    await deleteDoc(doc(db, 'posts', postId));
    Toast.success('Post deleted');
    adminSection('moderation');
  } catch (err) { console.warn('[AVN] Admin delete post error:', err); Toast.error('Post could not be deleted. Please try again.'); }
};

async function renderAdminSystem(container) {
  // System info sourced from the browser — no backend required
  const user = LegendAPI.auth.getUser();
  container.innerHTML = `
    <h2 style="font-family:var(--font-display);letter-spacing:0.1em;margin-bottom:var(--space-xl);color:var(--neon-blue)">SYSTEM STATUS</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:var(--space-md)">
      <div class="card">
        <h4 style="color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:var(--space-sm)">Firebase</h4>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="width:8px;height:8px;border-radius:50%;background:${user ? 'var(--neon-green)' : 'var(--text-muted)'}"></span>
          ${user ? 'Authenticated' : 'Not signed in'}
        </div>
      </div>
      <div class="card">
        <h4 style="color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:var(--space-sm)">Supabase</h4>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--neon-green)"></span>
          Connected (anon key)
        </div>
      </div>
      <div class="card">
        <h4 style="color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:var(--space-sm)">App Version</h4>
        <p>${escapeHtml(window.AVENORA_BUILD?.version || '—')}</p>
      </div>
      <div class="card">
        <h4 style="color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:var(--space-sm)">Environment</h4>
        <p>${window.LU_CONFIG?.isLocalhost ? 'Development (localhost)' : 'Production (GitHub Pages)'}</p>
      </div>
      <div class="card">
        <h4 style="color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:var(--space-sm)">Firebase Project</h4>
        <p style="font-size:0.85rem">${escapeHtml(window.AVENORA_BUILD?.firebaseProject || 'avenora-6e147')}</p>
      </div>
      <div class="card">
        <h4 style="color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:var(--space-sm)">Build</h4>
        <p style="font-size:0.82rem">${escapeHtml(window.AVENORA_BUILD?.buildTimestamp || '—')}</p>
      </div>
    </div>
  `;
}

function renderAdminLogs(container) {
  container.innerHTML = `
    <h2 style="font-family:var(--font-display);letter-spacing:0.1em;margin-bottom:var(--space-xl);color:var(--neon-blue)">LOGS</h2>
    <div class="card">
      <p style="color:var(--text-secondary);margin-bottom:var(--space-md)">Detailed system logs are available on the server and in your monitoring dashboard. Only authorized administrators may access raw logs.</p>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-top:var(--space-md)">For real-time log monitoring, connect your preferred log aggregation service from the server configuration.</p>
    </div>
  `;
}

/* ─── Avenora Video Admin Section ────────────────────────── */
async function renderAdminVideos(container) {
  let videos = [], channels = [], reports = [], error = null;
  try {
    const [vRes, cRes] = await Promise.all([
      LegendAPI.videos.list({ limit: 24, sort: 'new' }),
      LegendAPI.videos.channels({ limit: 24 }),
    ]);
    videos   = vRes.videos   || [];
    channels = cRes.channels || [];
  } catch (err) { error = err.message; }

  container.innerHTML = `
    <h2 style="font-family:var(--font-display);letter-spacing:0.1em;margin-bottom:var(--space-xl);color:var(--neon-blue)">
      🎬 AVENORA VIDEO — Video Management
    </h2>

    ${error ? `
      <div style="background:rgba(255,51,68,0.08);border:1px solid rgba(255,51,68,0.2);border-radius:10px;padding:16px;margin-bottom:var(--space-lg)">
        <strong style="color:var(--neon-red)">Video data unavailable.</strong> Check your connection or server status.
      </div>
    ` : ''}

    <!-- Stats -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--space-md);margin-bottom:var(--space-xl)">
      <div class="card" style="text-align:center">
        <div style="font-family:var(--font-display);font-size:1.8rem;font-weight:700;color:var(--neon-blue)">${formatCount(videos.length)}</div>
        <div style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted)">Videos</div>
      </div>
      <div class="card" style="text-align:center">
        <div style="font-family:var(--font-display);font-size:1.8rem;font-weight:700;color:var(--neon-green)">${formatCount(channels.length)}</div>
        <div style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted)">Channels</div>
      </div>
    </div>

    <!-- Videos Table -->
    <div style="margin-bottom:var(--space-xl)">
      <h3 style="font-family:var(--font-display);font-size:1rem;letter-spacing:0.08em;margin-bottom:var(--space-md)">RECENT UPLOADS</h3>
      ${videos.length === 0 ? `
        <p style="color:var(--text-muted);text-align:center;padding:var(--space-xl)">No videos uploaded yet.</p>
      ` : `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
            <thead>
              <tr style="border-bottom:1px solid var(--border-subtle)">
                <th style="text-align:left;padding:10px;color:var(--text-muted);font-size:0.73rem;text-transform:uppercase;letter-spacing:0.06em">Title</th>
                <th style="text-align:left;padding:10px;color:var(--text-muted);font-size:0.73rem;text-transform:uppercase;letter-spacing:0.06em">Uploader</th>
                <th style="text-align:left;padding:10px;color:var(--text-muted);font-size:0.73rem;text-transform:uppercase;letter-spacing:0.06em">Category</th>
                <th style="text-align:left;padding:10px;color:var(--text-muted);font-size:0.73rem;text-transform:uppercase;letter-spacing:0.06em">Views</th>
                <th style="text-align:left;padding:10px;color:var(--text-muted);font-size:0.73rem;text-transform:uppercase;letter-spacing:0.06em">Status</th>
                <th style="text-align:left;padding:10px;color:var(--text-muted);font-size:0.73rem;text-transform:uppercase;letter-spacing:0.06em">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${videos.map(v => {
                const id = v._id || v.id;
                return `
                  <tr style="border-bottom:1px solid var(--border-subtle)" id="admin-vid-row-${id}">
                    <td style="padding:10px">
                      <div style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(v.title)}</div>
                      <div style="color:var(--text-muted);font-size:0.75rem">${formatDate(v.createdAt)}</div>
                    </td>
                    <td style="padding:10px;color:var(--text-secondary)">${escapeHtml(v.uploader?.username || '—')}</td>
                    <td style="padding:10px;color:var(--text-secondary);text-transform:capitalize">${escapeHtml(v.category || '—')}</td>
                    <td style="padding:10px;color:var(--text-secondary)">${formatCount(v.views || 0)}</td>
                    <td style="padding:10px">
                      <span class="${v.isFlagged ? 'badge badge-live' : 'badge badge-green'}" style="font-size:0.7rem">
                        ${v.isFlagged ? '⚑ FLAGGED' : '✓ OK'}
                      </span>
                    </td>
                    <td style="padding:10px">
                      <div style="display:flex;gap:4px;flex-wrap:wrap">
                        <button class="btn btn-ghost btn-sm" onclick="adminFeatureVideo('${id}')">★ Feature</button>
                        <button class="btn btn-ghost btn-sm" style="color:var(--neon-red)" onclick="adminDeleteVideo('${id}')">Delete</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>

    <!-- Channels Table -->
    <div>
      <h3 style="font-family:var(--font-display);font-size:1rem;letter-spacing:0.08em;margin-bottom:var(--space-md)">CHANNELS</h3>
      ${channels.length === 0 ? `
        <p style="color:var(--text-muted);text-align:center;padding:var(--space-xl)">No channels yet. Channels are created automatically on first upload.</p>
      ` : `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
            <thead>
              <tr style="border-bottom:1px solid var(--border-subtle)">
                <th style="text-align:left;padding:10px;color:var(--text-muted);font-size:0.73rem;text-transform:uppercase;letter-spacing:0.06em">Channel</th>
                <th style="text-align:left;padding:10px;color:var(--text-muted);font-size:0.73rem;text-transform:uppercase;letter-spacing:0.06em">Owner</th>
                <th style="text-align:left;padding:10px;color:var(--text-muted);font-size:0.73rem;text-transform:uppercase;letter-spacing:0.06em">Videos</th>
                <th style="text-align:left;padding:10px;color:var(--text-muted);font-size:0.73rem;text-transform:uppercase;letter-spacing:0.06em">Subscribers</th>
                <th style="text-align:left;padding:10px;color:var(--text-muted);font-size:0.73rem;text-transform:uppercase;letter-spacing:0.06em">Status</th>
                <th style="text-align:left;padding:10px;color:var(--text-muted);font-size:0.73rem;text-transform:uppercase;letter-spacing:0.06em">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${channels.map(c => {
                const id = c._id || c.id;
                return `
                  <tr style="border-bottom:1px solid var(--border-subtle)">
                    <td style="padding:10px;font-weight:600">${escapeHtml(c.name || '—')}</td>
                    <td style="padding:10px;color:var(--text-secondary)">${escapeHtml(c.owner?.username || '—')}</td>
                    <td style="padding:10px;color:var(--text-secondary)">${formatCount(c.videoCount || 0)}</td>
                    <td style="padding:10px;color:var(--text-secondary)">${formatCount(c.subscriberCount || 0)}</td>
                    <td style="padding:10px">
                      <span class="${c.isSuspended ? 'badge badge-live' : 'badge badge-green'}" style="font-size:0.7rem">
                        ${c.isSuspended ? 'SUSPENDED' : 'ACTIVE'}
                      </span>
                    </td>
                    <td style="padding:10px">
                      ${c.isSuspended
                        ? `<button class="btn btn-outline btn-sm" onclick="adminUnsuspendChannel('${id}')">Restore</button>`
                        : `<button class="btn btn-ghost btn-sm" style="color:var(--neon-red)" onclick="adminSuspendChannel('${id}')">Suspend</button>`
                      }
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>

  `;
}

window.adminDeleteVideo = async function(videoId) {
  if (!confirm('Delete this video? This cannot be easily undone.')) return;
  try {
    await LegendAPI.videos.deleteVideo(videoId);
    Toast.success('Video deleted.');
    document.getElementById(`admin-vid-row-${videoId}`)?.remove();
  } catch (err) { console.warn('[AVN] Admin delete video error:', err); Toast.error('Video could not be deleted. Please try again.'); }
};

window.adminFeatureVideo = async function(videoId) {
  try {
    await LegendAPI.videos.featureVideo(videoId, true);
    Toast.success('Video marked as featured.');
  } catch (err) { console.warn('[AVN] Admin feature video error:', err); Toast.error('Could not update video. Please try again.'); }
};

window.adminSuspendChannel = async function(channelId) {
  const reason = prompt('Reason for suspension:');
  if (reason === null) return;
  try {
    await LegendAPI.videos.suspendChannel(channelId, reason || 'Policy violation');
    Toast.success('Channel suspended.');
    adminSection('videos');
  } catch (err) { console.warn('[AVN] Admin suspend channel error:', err); Toast.error('Could not suspend channel. Please try again.'); }
};

window.adminUnsuspendChannel = async function(channelId) {
  try {
    await LegendAPI.videos.unsuspendChannel(channelId);
    Toast.success('Channel restored.');
    adminSection('videos');
  } catch (err) { console.warn('[AVN] Admin unsuspend channel error:', err); Toast.error('Could not restore channel. Please try again.'); }
};

/* ─── 24-Hour Cloud Stream Admin Section ───────────────── */

/**
 * Renders the Cloud Stream control panel.
 * Polls for live status every 5 seconds while the section is visible.
 */
async function renderAdminCloudStream(container) {
  // Initial render with loading state
  container.innerHTML = `
    <h2 style="font-family:var(--font-display);letter-spacing:0.1em;margin-bottom:var(--space-xl);color:var(--neon-green)">
      ☁️ 24-HOUR CLOUD STREAM
    </h2>
    <div class="loading-state"><div class="spinner"></div></div>
  `;

  let pollInterval = null;

  async function loadAndRender() {
    let status = null, queue = [], mediaFiles = [], error = null;

    try {
      [{ status }, { queue }, { files: mediaFiles }] = await Promise.all([
        LegendAPI.cloudStream.status(),
        LegendAPI.cloudStream.queue(),
        LegendAPI.cloudStream.media(),
      ]);
    } catch (err) {
      error = err;
    }

    if (error) {
      console.error('[AVN] Cloud stream admin error:', error);
      container.innerHTML = `
        <h2 style="font-family:var(--font-display);letter-spacing:0.1em;margin-bottom:var(--space-xl);color:var(--neon-green)">
          ☁️ 24-HOUR CLOUD STREAM
        </h2>
        <div class="error-state">
          <div class="error-icon">⚠️</div>
          <h3>Service Unavailable</h3>
          <p>Cloud Stream data could not be loaded. Check your connection and try again.</p>
          <button class="btn btn-outline" onclick="adminSection('cloudstream')">Retry</button>
        </div>
      `;
      return;
    }

    renderCloudStreamPanel(container, status, queue, mediaFiles);

    // Start polling every 5 s
    clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      // Stop polling if the user navigated away
      if (!document.getElementById('cs-admin-status-state')) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const { status: s } = await LegendAPI.cloudStream.status();
        updateCloudStreamStatusUI(s);
      } catch { /* ignore poll errors */ }
    }, 5000);
  }

  await loadAndRender();

  // Expose cleanup so adminSection can clear the interval on navigation
  container._csCleanup = () => clearInterval(pollInterval);
}

// ─── Render the full panel ────────────────────────────────
function renderCloudStreamPanel(container, status, queue, mediaFiles) {
  const s = status;
  const stateLabel = csStateLabel(s.state);
  const stateBadgeClass = csStateBadgeClass(s.state);

  container.innerHTML = `
    <h2 style="font-family:var(--font-display);letter-spacing:0.1em;margin-bottom:var(--space-xl);color:var(--neon-green)">
      ☁️ 24-HOUR CLOUD STREAM
    </h2>

    ${!s.ffmpeg?.available ? `
      <div style="background:rgba(255,51,68,0.08);border:1px solid rgba(255,51,68,0.3);border-radius:10px;padding:16px;margin-bottom:var(--space-lg)">
        <strong style="color:var(--neon-red)">⚠ Encoding service not available</strong><br>
        <span style="color:var(--text-secondary);font-size:0.875rem">The media encoding service is not running. Contact your system administrator.</span>
      </div>
    ` : ''}

    ${!s.rtmpConfigured ? `
      <div style="background:rgba(255,165,0,0.07);border:1px solid rgba(255,165,0,0.25);border-radius:10px;padding:16px;margin-bottom:var(--space-lg)">
        <strong style="color:var(--neon-orange)">ℹ Stream output not configured</strong><br>
        <span style="color:var(--text-secondary);font-size:0.875rem">
          No broadcast destination is configured. Configure stream targets in the server settings to broadcast to external services.
          Without a target, stream runs in local mode only.
        </span>
      </div>
    ` : ''}

    <!-- Status row -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--space-md);margin-bottom:var(--space-xl)">
      <div class="card" style="text-align:center">
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:6px">STATE</div>
        <span id="cs-admin-status-state" class="badge ${stateBadgeClass}" style="font-size:0.85rem;padding:6px 12px">${escapeHtml(stateLabel)}</span>
      </div>
      <div class="card" style="text-align:center">
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:4px">NOW PLAYING</div>
        <div id="cs-admin-current" style="font-size:0.85rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;margin:0 auto" title="${escapeHtml(s.currentTrack || '—')}">
          ${escapeHtml(s.currentTrack || '—')}
        </div>
      </div>
      <div class="card" style="text-align:center">
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:4px">UP NEXT</div>
        <div id="cs-admin-next" style="font-size:0.85rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;margin:0 auto" title="${escapeHtml(s.nextTrack || '—')}">
          ${escapeHtml(s.nextTrack || '—')}
        </div>
      </div>
      <div class="card" style="text-align:center">
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:4px">QUEUE SIZE</div>
        <div id="cs-admin-qsize" style="font-family:var(--font-display);font-size:1.4rem;font-weight:700;color:var(--neon-green)">${s.queueSize}</div>
      </div>
      <div class="card" style="text-align:center">
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:4px">ERRORS</div>
        <div id="cs-admin-errors" style="font-family:var(--font-display);font-size:1.4rem;font-weight:700;color:${s.consecutiveErrors > 0 ? 'var(--neon-red)' : 'var(--neon-green)'}">
          ${s.consecutiveErrors}
        </div>
      </div>
      <div class="card" style="text-align:center">
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:4px">LAST ACTIVITY</div>
        <div id="cs-admin-last" style="font-size:0.8rem;color:var(--text-secondary)">${s.lastActivity ? formatTimeAgo(s.lastActivity) : '—'}</div>
      </div>
    </div>

    <!-- Main controls -->
    <div class="card" style="margin-bottom:var(--space-lg)">
      <h4 style="font-family:var(--font-display);letter-spacing:0.08em;margin-bottom:var(--space-md)">STREAM CONTROLS</h4>
      <div style="display:flex;flex-wrap:wrap;gap:var(--space-sm);align-items:center">
        <button class="btn btn-green" id="cs-btn-start"  onclick="csAdminStart()"  ${s.running ? 'disabled' : ''}>▶ Start</button>
        <button class="btn btn-danger" id="cs-btn-stop"  onclick="csAdminStop()"   ${!s.running ? 'disabled' : ''}>■ Stop</button>
        <button class="btn btn-outline" id="cs-btn-pause"  onclick="csAdminPause()"  ${!s.running || s.paused ? 'disabled' : ''}>⏸ Pause</button>
        <button class="btn btn-outline" id="cs-btn-resume" onclick="csAdminResume()" ${!s.running || !s.paused ? 'disabled' : ''}>▶ Resume</button>
        <button class="btn btn-ghost"   id="cs-btn-skip"   onclick="csAdminSkip()"   ${!s.running || s.paused ? 'disabled' : ''}>⏭ Skip</button>
        <button class="btn btn-ghost"   onclick="csAdminRefresh()">🔄 Rescan Media</button>
      </div>
    </div>

    <!-- Settings -->
    <div class="card" style="margin-bottom:var(--space-lg)">
      <h4 style="font-family:var(--font-display);letter-spacing:0.08em;margin-bottom:var(--space-md)">SETTINGS</h4>
      <div style="display:flex;flex-wrap:wrap;gap:var(--space-xl);align-items:center">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none">
          <input type="checkbox" id="cs-setting-shuffle" ${s.shuffle ? 'checked' : ''} onchange="csAdminSetSetting('shuffle', this.checked)"
            style="accent-color:var(--neon-green);width:16px;height:16px">
          <span style="font-size:0.9rem">Shuffle</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none">
          <input type="checkbox" id="cs-setting-repeat" ${s.repeat ? 'checked' : ''} onchange="csAdminSetSetting('repeat', this.checked)"
            style="accent-color:var(--neon-green);width:16px;height:16px">
          <span style="font-size:0.9rem">Repeat</span>
        </label>
        <div style="font-size:0.8rem;color:var(--text-muted)">
          RTMP: ${s.rtmpConfigured ? `<span style="color:var(--neon-green)">${s.rtmpTargetCount} target${s.rtmpTargetCount !== 1 ? 's' : ''} configured</span>` : '<span style="color:var(--neon-orange)">simulation mode</span>'}
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted)">
          FFmpeg: ${s.ffmpeg.available ? '<span style="color:var(--neon-green)">available</span>' : '<span style="color:var(--neon-red)">not found</span>'}
        </div>
      </div>
    </div>

    <!-- Queue -->
    <div style="display:grid;grid-template-columns:1fr 320px;gap:var(--space-lg);margin-bottom:var(--space-lg)">
      <!-- Current queue -->
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md)">
          <h4 style="font-family:var(--font-display);letter-spacing:0.08em">QUEUE</h4>
          <div style="display:flex;gap:var(--space-sm)">
            <span id="cs-admin-queue-count" style="font-size:0.8rem;color:var(--text-muted)">${queue.length} items</span>
            <button class="btn btn-ghost btn-sm" onclick="csAdminClearQueue()" ${!queue.length ? 'disabled' : ''}>Clear</button>
          </div>
        </div>
        <div id="cs-admin-queue-list" style="max-height:340px;overflow-y:auto">
          ${renderCsAdminQueueList(queue)}
        </div>
      </div>

      <!-- Add from media library -->
      <div class="card">
        <h4 style="font-family:var(--font-display);letter-spacing:0.08em;margin-bottom:var(--space-md)">MEDIA LIBRARY</h4>
        <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:var(--space-sm)">
          Dir: <code style="font-size:0.75rem">${escapeHtml(s.mediaDir)}</code>
        </p>
        ${mediaFiles.length === 0 ? `
          <p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:var(--space-lg) 0">
            No media files found in the configured directory.
          </p>
        ` : `
          <div style="max-height:280px;overflow-y:auto" id="cs-media-list">
            ${mediaFiles.map(f => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-subtle)">
                <span style="font-size:0.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
                <button class="btn btn-ghost btn-sm" onclick="csAdminAddFile('${escapeHtml(f.name)}')" style="flex-shrink:0">+ Add</button>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>

    <!-- Recent errors -->
    ${s.recentErrors.length ? `
      <div class="card" style="border-color:rgba(255,51,68,0.2)">
        <h4 style="font-family:var(--font-display);letter-spacing:0.08em;margin-bottom:var(--space-sm);color:var(--neon-red)">RECENT ERRORS</h4>
        <div style="font-family:var(--font-mono);font-size:0.78rem;max-height:160px;overflow-y:auto">
          ${s.recentErrors.slice().reverse().map(e => `
            <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-subtle)">
              <span style="color:var(--text-muted)">${escapeHtml(formatTimeAgo(e.time))}</span>
              <span style="color:var(--neon-red);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.error)}</span>
              <span style="color:var(--text-muted)">${escapeHtml(e.track)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <!-- Infrastructure info -->
    <div style="background:rgba(0,168,255,0.04);border:1px solid rgba(0,168,255,0.12);border-radius:10px;padding:16px;margin-top:var(--space-lg)">
      <strong style="color:var(--neon-blue)">Infrastructure Required</strong><br>
      <small style="color:var(--text-secondary)">
        1. <strong>FFmpeg</strong> must be installed on the server — <code>apt install ffmpeg</code> or see ffmpeg.org.<br>
        2. Set <code>CLOUD_STREAM_MEDIA_DIR</code> to the directory containing your media files.<br>
        3. Set <code>CLOUD_STREAM_RTMP_TARGETS</code> to your RTMP ingest URL(s) to broadcast. Leave blank for simulation.
      </small>
    </div>
  `;
}

// ─── Status UI helpers ────────────────────────────────────

function csStateLabel(state) {
  const map = {
    stopped:      'STOPPED',
    running:      'RUNNING',
    paused:       'PAUSED',
    reconnecting: 'RECONNECTING',
    no_media:     'NO MEDIA',
  };
  return map[state] || state?.toUpperCase() || 'UNKNOWN';
}

function csStateBadgeClass(state) {
  if (state === 'running')      return 'badge-live';
  if (state === 'paused')       return 'badge-blue';
  if (state === 'reconnecting') return 'badge-mod';
  if (state === 'no_media')     return 'badge-live';
  return 'badge-blue';
}

function updateCloudStreamStatusUI(s) {
  const setState = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setClass = (id, cls) => { const el = document.getElementById(id); if (el) el.className = `badge ${cls}`; };

  setClass('cs-admin-status-state', csStateBadgeClass(s.state));
  setState('cs-admin-status-state', csStateLabel(s.state));
  setState('cs-admin-current', s.currentTrack || '—');
  setState('cs-admin-next', s.nextTrack || '—');
  setState('cs-admin-qsize', s.queueSize);
  setState('cs-admin-last', s.lastActivity ? formatTimeAgo(s.lastActivity) : '—');

  const errEl = document.getElementById('cs-admin-errors');
  if (errEl) {
    errEl.textContent = s.consecutiveErrors;
    errEl.style.color = s.consecutiveErrors > 0 ? 'var(--neon-red)' : 'var(--neon-green)';
  }

  // Enable/disable control buttons
  const setDisabled = (id, disabled) => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  };
  setDisabled('cs-btn-start',  s.running);
  setDisabled('cs-btn-stop',   !s.running);
  setDisabled('cs-btn-pause',  !s.running || s.paused);
  setDisabled('cs-btn-resume', !s.running || !s.paused);
  setDisabled('cs-btn-skip',   !s.running || s.paused);
}

function renderCsAdminQueueList(queue) {
  if (!queue.length) {
    return `<p style="text-align:center;color:var(--text-muted);padding:var(--space-lg);font-size:0.85rem">
      Queue is empty. Add files from the media library or rescan.<br>
      When empty, the service plays from the scanned playlist.
    </p>`;
  }
  return queue.map((item, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-subtle);${item.active ? 'background:rgba(0,255,136,0.04);border-radius:4px;' : ''}">
      <span style="color:var(--text-muted);font-size:0.75rem;min-width:20px;text-align:right">${i + 1}</span>
      ${item.active ? '<span style="color:var(--neon-green);font-size:0.75rem">▶</span>' : '<span style="min-width:12px"></span>'}
      <span style="flex:1;font-size:0.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <div style="display:flex;gap:2px;flex-shrink:0">
        ${i > 0 ? `<button class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:0.7rem" onclick="csAdminMoveUp(${i})" title="Move up">↑</button>` : ''}
        ${i < queue.length - 1 ? `<button class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:0.7rem" onclick="csAdminMoveDown(${i})" title="Move down">↓</button>` : ''}
        <button class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:0.7rem;color:var(--neon-red)" onclick="csAdminRemove(${i})" title="Remove">✕</button>
      </div>
    </div>
  `).join('');
}

// ─── Admin action handlers ────────────────────────────────

window.csAdminStart = async function () {
  const btn = document.getElementById('cs-btn-start');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
  try {
    await LegendAPI.cloudStream.start();
    Toast.success('Stream started');
    adminSection('cloudstream');
  } catch (err) {
    console.warn('[AVN] Stream start error:', err);
    Toast.error('Could not start the stream. Please try again.');
    if (btn) { btn.disabled = false; btn.textContent = '▶ Start'; }
  }
};

window.csAdminStop = async function () {
  if (!confirm('Stop the cloud stream? The current broadcast will end.')) return;
  const btn = document.getElementById('cs-btn-stop');
  if (btn) { btn.disabled = true; btn.textContent = 'Stopping…'; }
  try {
    await LegendAPI.cloudStream.stop();
    Toast.success('Stream stopped');
    adminSection('cloudstream');
  } catch (err) {
    console.warn('[AVN] Stream stop error:', err);
    Toast.error('Could not stop the stream. Please try again.');
    if (btn) { btn.disabled = false; btn.textContent = '■ Stop'; }
  }
};

window.csAdminPause = async function () {
  try {
    await LegendAPI.cloudStream.pause();
    Toast.success('Stream paused');
    const { status } = await LegendAPI.cloudStream.status();
    updateCloudStreamStatusUI(status);
  } catch (err) { console.warn('[AVN] Stream pause error:', err); Toast.error('Could not pause the stream. Please try again.'); }
};

window.csAdminResume = async function () {
  try {
    await LegendAPI.cloudStream.resume();
    Toast.success('Stream resumed');
    const { status } = await LegendAPI.cloudStream.status();
    updateCloudStreamStatusUI(status);
  } catch (err) { console.warn('[AVN] Stream resume error:', err); Toast.error('Could not resume the stream. Please try again.'); }
};

window.csAdminSkip = async function () {
  try {
    await LegendAPI.cloudStream.skip();
    Toast.info('Track skipped');
    setTimeout(async () => {
      try {
        const { status } = await LegendAPI.cloudStream.status();
        updateCloudStreamStatusUI(status);
      } catch {}
    }, 1200);
  } catch (err) { console.warn('[AVN] Stream skip error:', err); Toast.error('Could not skip track. Please try again.'); }
};

window.csAdminRefresh = async function () {
  try {
    const { playlistSize } = await LegendAPI.cloudStream.refresh();
    Toast.success(`Playlist refreshed — ${playlistSize} file${playlistSize !== 1 ? 's' : ''} found`);
    adminSection('cloudstream');
  } catch (err) { console.warn('[AVN] Stream refresh error:', err); Toast.error('Could not refresh playlist. Please try again.'); }
};

window.csAdminAddFile = async function (filename) {
  try {
    const { added } = await LegendAPI.cloudStream.addToQueue([filename]);
    if (!added.length) {
      Toast.error('File not found or not supported.');
      return;
    }
    Toast.success(`Added to queue: ${added[0]}`);
    // Refresh queue list
    const { queue } = await LegendAPI.cloudStream.queue();
    const listEl = document.getElementById('cs-admin-queue-list');
    const countEl = document.getElementById('cs-admin-queue-count');
    if (listEl) listEl.innerHTML = renderCsAdminQueueList(queue);
    if (countEl) countEl.textContent = `${queue.length} items`;
  } catch (err) { console.warn('[AVN] Queue add error:', err); Toast.error('Could not add to queue. Please try again.'); }
};

window.csAdminRemove = async function (index) {
  try {
    await LegendAPI.cloudStream.removeFromQueue(index);
    const { queue } = await LegendAPI.cloudStream.queue();
    const listEl = document.getElementById('cs-admin-queue-list');
    const countEl = document.getElementById('cs-admin-queue-count');
    if (listEl) listEl.innerHTML = renderCsAdminQueueList(queue);
    if (countEl) countEl.textContent = `${queue.length} items`;
    Toast.info('Track removed from queue');
  } catch (err) { console.warn('[AVN] Queue remove error:', err); Toast.error('Could not remove track. Please try again.'); }
};

window.csAdminMoveUp = async function (index) {
  if (index === 0) return;
  try {
    await LegendAPI.cloudStream.reorderQueue(index, index - 1);
    const { queue } = await LegendAPI.cloudStream.queue();
    const listEl = document.getElementById('cs-admin-queue-list');
    if (listEl) listEl.innerHTML = renderCsAdminQueueList(queue);
  } catch (err) { console.warn('[AVN] Queue reorder error:', err); Toast.error('Could not reorder queue. Please try again.'); }
};

window.csAdminMoveDown = async function (index) {
  try {
    await LegendAPI.cloudStream.reorderQueue(index, index + 1);
    const { queue } = await LegendAPI.cloudStream.queue();
    const listEl = document.getElementById('cs-admin-queue-list');
    if (listEl) listEl.innerHTML = renderCsAdminQueueList(queue);
  } catch (err) { console.warn('[AVN] Queue reorder error:', err); Toast.error('Could not reorder queue. Please try again.'); }
};

window.csAdminClearQueue = async function () {
  if (!confirm('Clear the entire managed queue? The stream will revert to the scanned playlist.')) return;
  try {
    await LegendAPI.cloudStream.clearQueue();
    Toast.success('Queue cleared');
    const listEl = document.getElementById('cs-admin-queue-list');
    const countEl = document.getElementById('cs-admin-queue-count');
    if (listEl) listEl.innerHTML = renderCsAdminQueueList([]);
    if (countEl) countEl.textContent = '0 items';
  } catch (err) { console.warn('[AVN] Queue clear error:', err); Toast.error('Could not clear queue. Please try again.'); }
};

window.csAdminSetSetting = async function (setting, value) {
  try {
    const body = {};
    body[setting] = value;
    if (setting === 'shuffle') {
      await LegendAPI.cloudStream.setSettings(value, undefined);
    } else {
      await LegendAPI.cloudStream.setSettings(undefined, value);
    }
    Toast.info(`${setting.charAt(0).toUpperCase() + setting.slice(1)}: ${value ? 'ON' : 'OFF'}`);
  } catch (err) {
    console.warn('[AVN] Stream setting error:', err);
    Toast.error('Could not update setting. Please try again.');
    // Revert checkbox
    const el = document.getElementById(`cs-setting-${setting}`);
    if (el) el.checked = !value;
  }
};
