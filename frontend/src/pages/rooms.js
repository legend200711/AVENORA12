/**
 * AVENORA — Universe Rooms
 * Community spaces with public/private access control.
 * Separate from the existing chat system — Rooms are social community spaces.
 * Uses Firestore for room data with real permission enforcement.
 */

registerPage('rooms', {
  _unsub: null,

  async render(container) {
    const user = LegendAPI.auth.getUser();

    container.innerHTML = `
      <div class="rooms-page">
        <div class="rooms-header">
          <div>
            <h1 class="univ-page-title">UNIVERSE ROOMS</h1>
            <p class="univ-page-tag">COMMUNITY SPACES</p>
          </div>
          ${user ? `
            <button class="btn btn-primary btn-sm" onclick="RoomsPage.openCreate()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Create Room
            </button>
          ` : ''}
        </div>

        <!-- Filter tabs -->
        <div style="padding:0 var(--space-lg) var(--space-md);display:flex;gap:var(--space-sm);flex-wrap:wrap">
          <button class="discover-filter-btn active" onclick="RoomsPage.filterRooms('all',this)">All Rooms</button>
          <button class="discover-filter-btn" onclick="RoomsPage.filterRooms('public',this)">Public</button>
          ${user ? `<button class="discover-filter-btn" onclick="RoomsPage.filterRooms('mine',this)">My Rooms</button>` : ''}
        </div>

        <!-- Rooms grid -->
        <div class="rooms-grid" id="rooms-grid">
          <div class="loading-state" style="grid-column:1/-1;min-height:200px"><div class="spinner spinner-lg"></div></div>
        </div>
      </div>

      <!-- Create Room Modal -->
      <div id="rooms-create-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="rooms-create-title">
        <div class="modal" style="max-width:480px">
          <div class="modal-header">
            <h3 id="rooms-create-title" style="margin:0;font-family:var(--font-display);letter-spacing:0.12em;font-size:0.95rem">CREATE ROOM</h3>
            <button class="btn btn-ghost btn-sm" onclick="Modal.close('rooms-create-modal')" aria-label="Close">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Room Name</label>
              <input class="form-input" type="text" id="room-create-name" placeholder="My Universe Room" maxlength="60" required>
            </div>
            <div class="form-group">
              <label class="form-label">Description</label>
              <textarea class="form-input" id="room-create-desc" placeholder="What's this room about?" rows="3" maxlength="300"></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Access</label>
              <div style="display:flex;gap:var(--space-sm)">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;padding:var(--space-sm) var(--space-md);border:1px solid var(--univ-border);border-radius:var(--radius-md);background:var(--univ-card)">
                  <input type="radio" name="room-privacy" value="public" checked>
                  <span>
                    <strong style="display:block;font-size:0.85rem">Public</strong>
                    <span style="font-size:0.75rem;color:var(--text-muted)">Anyone can join</span>
                  </span>
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;padding:var(--space-sm) var(--space-md);border:1px solid var(--univ-border);border-radius:var(--radius-md);background:var(--univ-card)">
                  <input type="radio" name="room-privacy" value="private">
                  <span>
                    <strong style="display:block;font-size:0.85rem">Private</strong>
                    <span style="font-size:0.75rem;color:var(--text-muted)">Invite only</span>
                  </span>
                </label>
              </div>
            </div>
            <div id="rooms-create-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem"></div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="Modal.close('rooms-create-modal')">Cancel</button>
            <button class="btn btn-primary" id="rooms-create-btn" onclick="RoomsPage.createRoom()">Create Room</button>
          </div>
        </div>
      </div>

      <!-- Room view modal -->
      <div id="rooms-view-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="rooms-view-title">
        <div class="modal" style="max-width:700px;height:90vh;display:flex;flex-direction:column">
          <div class="modal-header" style="flex-shrink:0">
            <h3 id="rooms-view-title" style="margin:0;font-family:var(--font-display);letter-spacing:0.1em;font-size:0.95rem">ROOM</h3>
            <button class="btn btn-ghost btn-sm" onclick="Modal.close('rooms-view-modal')" aria-label="Close">✕</button>
          </div>
          <div id="rooms-view-body" style="flex:1;overflow-y:auto;padding:var(--space-md)">
          </div>
        </div>
      </div>
    `;

    await RoomsPage.loadRooms('all');

    return () => {
      if (typeof this._unsub === 'function') this._unsub();
    };
  }
});

const RoomsPage = {
  _rooms: [],
  _filter: 'all',

  openCreate() {
    const user = LegendAPI.auth.getUser();
    if (!user) { Toast.info('Join AVENORA to create rooms.'); Modal.open('auth-modal'); return; }
    Modal.open('rooms-create-modal');
  },

  filterRooms(filter, btn) {
    this._filter = filter;
    document.querySelectorAll('.rooms-page .discover-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    this.loadRooms(filter);
  },

  async loadRooms(filter) {
    const grid = document.getElementById('rooms-grid');
    if (!grid) return;
    grid.innerHTML = `<div class="loading-state" style="grid-column:1/-1;min-height:200px"><div class="spinner spinner-lg"></div></div>`;

    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) {
        grid.innerHTML = `<div style="grid-column:1/-1;padding:var(--space-xl);text-align:center;color:var(--text-muted)">Rooms unavailable.</div>`;
        return;
      }
      const db = await getFirestore();
      const { collection, query, where, orderBy, limit, getDocs } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      const user = LegendAPI.auth.getUser();
      let constraints = [orderBy('createdAt', 'desc'), limit(40)];
      if (filter === 'public') {
        constraints = [where('privacy', '==', 'public'), ...constraints];
      } else if (filter === 'mine' && user) {
        constraints = [where('ownerId', '==', user.uid || user.id), ...constraints];
      } else {
        // All: show public rooms + owned rooms
        constraints = [where('privacy', '==', 'public'), ...constraints];
      }
      const q = query(collection(db, 'rooms'), ...constraints);
      const snap = await getDocs(q);
      this._rooms = [];
      snap.forEach(doc => this._rooms.push({ id: doc.id, ...doc.data() }));

      if (this._rooms.length === 0) {
        grid.innerHTML = `
          <div style="grid-column:1/-1;padding:var(--space-2xl);text-align:center">
            <div style="font-size:2.5rem;margin-bottom:var(--space-md)">🌌</div>
            <h3 style="font-family:var(--font-display);letter-spacing:0.1em;margin-bottom:8px">No Rooms Yet</h3>
            <p style="color:var(--text-muted);margin-bottom:var(--space-lg)">Be the first to create a room in the universe.</p>
            ${user ? `<button class="btn btn-primary" onclick="RoomsPage.openCreate()">Create First Room</button>` : ''}
          </div>`;
        return;
      }

      grid.innerHTML = this._rooms.map(r => this._renderRoomCard(r)).join('');
    } catch (err) {
      const safeMsg = typeof firebaseUserMsg === 'function'
        ? firebaseUserMsg(err, 'Universe Rooms')
        : 'Could not load rooms. Please try again.';
      grid.innerHTML = `<div style="grid-column:1/-1;padding:var(--space-xl);text-align:center;color:var(--text-muted)">${escapeHtml(safeMsg)}</div>`;
    }
  },

  _renderRoomCard(r) {
    const memberCount = r.memberCount || 0;
    const isPrivate = r.privacy === 'private';
    return `
      <div class="room-card" onclick="RoomsPage.openRoom('${escapeHtml(r.id)}')" role="button" tabindex="0"
           onkeydown="if(event.key==='Enter')RoomsPage.openRoom('${escapeHtml(r.id)}')"
           aria-label="Open room ${escapeHtml(r.name||'Room')}">
        <div class="room-card__cover" style="${r.coverUrl ? `background-image:url(${escapeHtml(r.coverUrl)});background-size:cover;background-position:center` : ''}">
          ${!r.coverUrl ? `<span style="font-size:2.5rem">${r.emoji || '🌌'}</span>` : ''}
          <span class="room-card__badge room-card__badge--${isPrivate ? 'private' : 'public'}">${isPrivate ? '🔒 PRIVATE' : '🌐 PUBLIC'}</span>
        </div>
        <div class="room-card__body">
          <h3 class="room-card__name">${escapeHtml(r.name || 'Room')}</h3>
          ${r.description ? `<p class="room-card__desc">${escapeHtml(r.description)}</p>` : ''}
          <div class="room-card__meta">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            ${memberCount} member${memberCount !== 1 ? 's' : ''}
            <span>·</span>
            <span>${escapeHtml(r.ownerName || 'creator')}</span>
          </div>
        </div>
      </div>`;
  },

  async openRoom(id) {
    const room = this._rooms.find(r => r.id === id);
    if (!room) return;
    const user = LegendAPI.auth.getUser();
    const body = document.getElementById('rooms-view-body');
    const title = document.getElementById('rooms-view-title');
    if (!body) return;
    if (title) title.textContent = (room.name || 'Room').toUpperCase();

    // Permission check for private rooms
    const isPrivate = room.privacy === 'private';
    const isMember = !isPrivate || (user && (room.members || []).includes(user.uid || user.id)) || (user && room.ownerId === (user.uid || user.id));

    if (isPrivate && !user) {
      body.innerHTML = `
        <div style="text-align:center;padding:var(--space-2xl)">
          <div style="font-size:2.5rem;margin-bottom:var(--space-md)">🔒</div>
          <h3 style="margin-bottom:8px">Private Room</h3>
          <p style="color:var(--text-muted);margin-bottom:var(--space-lg)">Join AVENORA to interact with this universe.</p>
          <button class="btn btn-primary" onclick="Modal.close('rooms-view-modal');Modal.open('auth-modal')">Join AVENORA</button>
        </div>`;
      Modal.open('rooms-view-modal');
      return;
    }

    if (isPrivate && !isMember) {
      body.innerHTML = `
        <div style="text-align:center;padding:var(--space-2xl)">
          <div style="font-size:2.5rem;margin-bottom:var(--space-md)">🔒</div>
          <h3 style="margin-bottom:8px">Members Only</h3>
          <p style="color:var(--text-muted);margin-bottom:var(--space-lg)">This room is invite only. You need an invitation to join.</p>
          <button class="btn btn-outline" onclick="Modal.close('rooms-view-modal')">Close</button>
        </div>`;
      Modal.open('rooms-view-modal');
      return;
    }

    body.innerHTML = `
      <div>
        ${room.description ? `<p style="color:var(--text-secondary);margin-bottom:var(--space-lg)">${escapeHtml(room.description)}</p>` : ''}
        <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;margin-bottom:var(--space-lg)">
          ${user && room.ownerId !== (user.uid||user.id) && isMember
            ? `<button class="btn btn-outline btn-sm" onclick="RoomsPage.leaveRoom('${escapeHtml(id)}')">Leave Room</button>`
            : ''}
          ${user && room.ownerId !== (user.uid||user.id) && !isPrivate && !isMember
            ? `<button class="btn btn-primary btn-sm" onclick="RoomsPage.joinRoom('${escapeHtml(id)}')">Join Room</button>`
            : ''}
          ${user && room.ownerId === (user.uid||user.id)
            ? `<span style="font-size:0.78rem;color:var(--univ-blue-electric);padding:4px 10px;border:1px solid var(--univ-border);border-radius:var(--radius-full)">👑 You own this room</span>`
            : ''}
        </div>
        <div id="room-posts-area">
          <div class="loading-state"><div class="spinner"></div></div>
        </div>
      </div>`;
    Modal.open('rooms-view-modal');
    await this.loadRoomPosts(id);
  },

  async loadRoomPosts(roomId) {
    const area = document.getElementById('room-posts-area');
    if (!area) return;
    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) { area.innerHTML = '<p style="color:var(--text-muted)">Posts unavailable.</p>'; return; }
      const db = await getFirestore();
      const { collection, query, where, orderBy, limit, getDocs } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      const q = query(
        collection(db, 'roomPosts'),
        where('roomId', '==', roomId),
        orderBy('createdAt', 'desc'),
        limit(20)
      );
      const snap = await getDocs(q);
      const posts = [];
      snap.forEach(doc => posts.push({ id: doc.id, ...doc.data() }));

      const user = LegendAPI.auth.getUser();
      area.innerHTML = `
        ${user ? `
          <div style="margin-bottom:var(--space-lg)">
            <div style="display:flex;gap:var(--space-sm)">
              <textarea id="room-post-input" class="form-input" placeholder="Post to this room…" rows="2" style="flex:1;resize:none" maxlength="1000"></textarea>
            </div>
            <div style="text-align:right;margin-top:var(--space-sm)">
              <button class="btn btn-primary btn-sm" onclick="RoomsPage.postToRoom('${escapeHtml(roomId)}')">Post</button>
            </div>
          </div>
        ` : ''}
        <div>
          ${posts.length === 0
            ? '<p style="color:var(--text-muted);text-align:center;padding:var(--space-xl) 0">No posts yet. Start the conversation.</p>'
            : posts.map(p => `
                <div style="padding:var(--space-md) 0;border-bottom:1px solid var(--univ-border)">
                  <div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:6px">
                    <span style="font-size:0.85rem;font-weight:600;color:var(--univ-text)">${escapeHtml(p.displayName||p.username||'user')}</span>
                    <span style="font-size:0.72rem;color:var(--text-muted)">${formatTimeAgo(p.createdAt)}</span>
                  </div>
                  <p style="font-size:0.9rem;color:var(--univ-text);line-height:1.55;margin:0">${escapeHtml(p.content||'')}</p>
                </div>`).join('')
          }
        </div>`;
    } catch (err) {
      if (area) area.innerHTML = `<p style="color:var(--text-muted)">Could not load posts.</p>`;
    }
  },

  async postToRoom(roomId) {
    const user = LegendAPI.auth.getUser();
    if (!user) return;
    const input = document.getElementById('room-post-input');
    const content = input?.value?.trim();
    if (!content) { Toast.warning('Post cannot be empty.'); return; }

    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) return;
      const db = await getFirestore();
      const { collection, addDoc, serverTimestamp } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      await addDoc(collection(db, 'roomPosts'), {
        roomId,
        uid: user.uid || user.id,
        username: user.username,
        displayName: user.profile?.displayName || user.username,
        content,
        createdAt: serverTimestamp(),
      });
      if (input) input.value = '';
      Toast.success('Posted!');
      await this.loadRoomPosts(roomId);
    } catch (err) {
      Toast.error('Could not post. Try again.');
    }
  },

  async joinRoom(id) {
    const user = LegendAPI.auth.getUser();
    if (!user) return;
    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) return;
      const db = await getFirestore();
      const { doc, updateDoc, arrayUnion, increment } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      await updateDoc(doc(db, 'rooms', id), {
        members: arrayUnion(user.uid || user.id),
        memberCount: increment(1),
      });
      Toast.success('Joined room!');
      await this.loadRooms(this._filter);
    } catch {
      Toast.error('Could not join room.');
    }
  },

  async leaveRoom(id) {
    const user = LegendAPI.auth.getUser();
    if (!user) return;
    if (!confirm('Leave this room?')) return;
    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) return;
      const db = await getFirestore();
      const { doc, updateDoc, arrayRemove, increment } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      await updateDoc(doc(db, 'rooms', id), {
        members: arrayRemove(user.uid || user.id),
        memberCount: increment(-1),
      });
      Toast.success('Left room.');
      Modal.close('rooms-view-modal');
      await this.loadRooms(this._filter);
    } catch {
      Toast.error('Could not leave room.');
    }
  },

  async createRoom() {
    const user = LegendAPI.auth.getUser();
    if (!user) return;
    const name = document.getElementById('room-create-name')?.value?.trim();
    const desc = document.getElementById('room-create-desc')?.value?.trim();
    const privacy = document.querySelector('input[name="room-privacy"]:checked')?.value || 'public';
    const errEl = document.getElementById('rooms-create-error');
    const btn = document.getElementById('rooms-create-btn');

    if (!name) { if (errEl) { errEl.textContent = 'Room name required.'; errEl.classList.remove('hidden'); } return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
    if (errEl) errEl.classList.add('hidden');

    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) throw new Error('Firebase not available.');
      const db = await getFirestore();
      const { collection, addDoc, serverTimestamp } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      await addDoc(collection(db, 'rooms'), {
        name,
        description: desc || '',
        privacy,
        ownerId: user.uid || user.id,
        ownerName: user.profile?.displayName || user.username,
        members: [user.uid || user.id],
        memberCount: 1,
        createdAt: serverTimestamp(),
      });
      Toast.success('Room created!');
      Modal.close('rooms-create-modal');
      document.getElementById('room-create-name') && (document.getElementById('room-create-name').value = '');
      document.getElementById('room-create-desc') && (document.getElementById('room-create-desc').value = '');
      await this.loadRooms(this._filter);
    } catch (err) {
      const safeMsg = typeof firebaseUserMsg === 'function'
        ? firebaseUserMsg(err, 'Universe Rooms')
        : 'Could not create room. Please try again.';
      if (errEl) { errEl.textContent = safeMsg; errEl.classList.remove('hidden'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Create Room'; }
    }
  },
};

window.RoomsPage = RoomsPage;
