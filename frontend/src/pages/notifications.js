/**
 * AVENORA — Universe Notifications Center
 * Unified notification stream: reactions, comments, follows, mentions,
 * messages, room invitations, challenge activity, gallery interactions.
 */

registerPage('notifications', {
  _unsub: null,

  async render(container) {
    const user = LegendAPI.auth.getUser();

    if (!user) {
      container.innerHTML = `
        <div class="notif-page">
          <div class="notif-header">
            <h1 class="univ-page-title">NOTIFICATIONS</h1>
          </div>
          <div style="text-align:center;padding:var(--space-2xl)">
            <div style="font-size:2.5rem;margin-bottom:var(--space-md)">🔔</div>
            <h3 style="margin-bottom:8px">Sign In for Notifications</h3>
            <p style="color:var(--text-muted);margin-bottom:var(--space-lg)">Join AVENORA to interact with this universe.</p>
            <button class="btn btn-primary" onclick="Modal.open('auth-modal')">Join AVENORA</button>
          </div>
        </div>`;
      return () => {};
    }

    container.innerHTML = `
      <div class="notif-page">
        <div class="notif-header">
          <div>
            <h1 class="univ-page-title">NOTIFICATIONS</h1>
            <p class="univ-page-tag">UNIVERSE ACTIVITY</p>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="NotificationsPage.markAllRead()">Mark All Read</button>
        </div>

        <!-- Filter tabs -->
        <div style="padding:0 var(--space-lg) var(--space-md);display:flex;gap:var(--space-sm);flex-wrap:wrap;overflow-x:auto;scrollbar-width:none">
          <button class="discover-filter-btn active" onclick="NotificationsPage.filter('all',this)">All</button>
          <button class="discover-filter-btn" onclick="NotificationsPage.filter('social',this)">Social</button>
          <button class="discover-filter-btn" onclick="NotificationsPage.filter('messages',this)">Messages</button>
          <button class="discover-filter-btn" onclick="NotificationsPage.filter('rooms',this)">Rooms</button>
          <button class="discover-filter-btn" onclick="NotificationsPage.filter('challenges',this)">Challenges</button>
        </div>

        <div class="notif-list" id="notif-page-list">
          <div class="loading-state"><div class="spinner spinner-lg"></div><span>Loading notifications…</span></div>
        </div>
      </div>
    `;

    await NotificationsPage.load('all');
    return () => {
      if (typeof this._unsub === 'function') this._unsub();
    };
  }
});

const NotificationsPage = {
  _filter: 'all',
  _notifications: [],

  _typeIcon(type) {
    const map = {
      like: '❤️', reaction: '❤️', comment: '💬', reply: '↩️',
      follow: '👤', mention: '@ ', message: '✉️',
      room_invite: '🚪', room_post: '🏠',
      challenge: '🏆', gallery: '🖼️',
      system: '📢',
    };
    return map[type] || '🔔';
  },

  async filter(f, btn) {
    this._filter = f;
    document.querySelectorAll('.notif-page .discover-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    await this.load(f);
  },

  async load(filter) {
    const list = document.getElementById('notif-page-list');
    if (!list) return;
    list.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;

    try {
      // Try the existing LegendAPI notifications endpoint first
      let items = [];
      try {
        const data = await LegendAPI.notifications.get(1, 50);
        items = data.notifications || data.items || [];
      } catch {
        // Fall back to Firestore
        items = await this._loadFromFirestore(filter);
      }

      this._notifications = items;

      // Apply filter
      if (filter !== 'all') {
        const filterMap = {
          social: ['like','reaction','comment','reply','follow','mention'],
          messages: ['message'],
          rooms: ['room_invite','room_post'],
          challenges: ['challenge'],
        };
        const allowed = filterMap[filter] || [];
        items = items.filter(n => allowed.includes(n.type));
      }

      if (items.length === 0) {
        list.innerHTML = `
          <div class="error-state" style="min-height:200px">
            <div class="error-icon">🔔</div>
            <h3>All Caught Up</h3>
            <p>No notifications to show.</p>
          </div>`;
        return;
      }

      list.innerHTML = items.map(n => this._renderItem(n)).join('');
    } catch {
      list.innerHTML = `<div class="error-state" style="min-height:200px"><p>Could not load notifications.</p></div>`;
    }
  },

  async _loadFromFirestore(filter) {
    try {
      const user = LegendAPI.auth.getUser();
      if (!user) return [];
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) return [];
      const db = await getFirestore();
      const { collection, query, where, orderBy, limit, getDocs } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      const q = query(
        collection(db, 'notifications'),
        where('toUid', '==', user.uid || user.id),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
      const snap = await getDocs(q);
      const items = [];
      snap.forEach(doc => items.push({ id: doc.id, ...doc.data(), _source: 'firestore' }));
      return items;
    } catch {
      return [];
    }
  },

  _renderItem(n) {
    const isUnread = !n.read && !n.readAt;
    const icon = this._typeIcon(n.type);
    const actor = n.fromUsername || n.actorName || n.fromUser || 'Someone';
    const body = n.body || n.message || n.content || this._defaultBody(n, actor);
    const time = formatTimeAgo(n.createdAt);

    return `
      <div class="notif-item ${isUnread ? 'notif-item--unread' : ''}"
           onclick="NotificationsPage.openItem('${escapeHtml(n.id||'')}')"
           aria-label="${isUnread ? 'Unread: ' : ''}${escapeHtml(body)}">
        <div class="notif-item__icon">${icon}</div>
        <div class="notif-item__body">
          <p class="notif-item__text">${escapeHtml(body)}</p>
          <p class="notif-item__time">${escapeHtml(time)}</p>
        </div>
        ${isUnread ? `<div style="width:8px;height:8px;border-radius:50%;background:var(--univ-blue-electric);flex-shrink:0;margin-top:6px"></div>` : ''}
      </div>`;
  },

  _defaultBody(n, actor) {
    const map = {
      like: `${actor} liked your post`,
      reaction: `${actor} reacted to your post`,
      comment: `${actor} commented on your post`,
      reply: `${actor} replied to your comment`,
      follow: `${actor} started following you`,
      mention: `${actor} mentioned you`,
      message: `${actor} sent you a message`,
      room_invite: `${actor} invited you to a room`,
      room_post: `New post in a room you're in`,
      challenge: `New activity on a challenge`,
      gallery: `${actor} reacted to your gallery item`,
      system: n.title || 'System notification',
    };
    return map[n.type] || 'New notification';
  },

  async openItem(id) {
    const n = this._notifications.find(x => (x.id || x._id) === id);
    if (!n) return;
    // Mark as read
    await this.markRead(id);
    // Navigate to related content
    if (n.type === 'message') { navigateTo('chat'); return; }
    if (n.type?.startsWith('room')) { navigateTo('rooms'); return; }
    if (n.type === 'follow') { n.fromUid ? navigateTo(`profile/${n.fromUid}`) : navigateTo('discover'); return; }
    if (n.type === 'challenge') { navigateTo('challenges'); return; }
    if (n.type === 'gallery') { navigateTo('gallery'); return; }
    if (n.postId) { navigateTo('social'); return; }
  },

  async markRead(id) {
    try {
      await LegendAPI.notifications.markRead(id);
    } catch {
      // Firestore fallback
      try {
        const { getFirestore } = window.AvenoraFirebase || {};
        if (!getFirestore) return;
        const db = await getFirestore();
        const { doc, updateDoc } = await import(
          'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
        );
        await updateDoc(doc(db, 'notifications', id), { read: true, readAt: new Date() });
      } catch {}
    }
    // Update local state
    const n = this._notifications.find(x => (x.id || x._id) === id);
    if (n) n.read = true;
  },

  async markAllRead() {
    try {
      await LegendAPI.notifications.markAllRead();
      Toast.success('All notifications marked as read.');
      await this.load(this._filter);
    } catch {
      Toast.error('Could not mark all as read.');
    }
  },
};

window.NotificationsPage = NotificationsPage;
