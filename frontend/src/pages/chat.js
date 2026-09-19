/**
 * AVENORA CHAT — Full real-time chat system
 *
 * Tabs:
 *   • Public Rooms  — community rooms backed by Firebase RTDB / Socket.io
 *   • Private Rooms — member-only rooms via REST + Socket.io
 *   • Messages      — 1-to-1 DMs via REST + Socket.io
 *   • Inbox         — aggregated conversation list
 *
 * All permission checks are enforced server-side.
 * No fake messages, no fake users, no fake counts.
 */

registerPage('chat', {
  async render(container) {
    // Inject extended stylesheet once
    if (!document.getElementById('chat-ext-css')) {
      const link = document.createElement('link');
      link.id = 'chat-ext-css';
      link.rel = 'stylesheet';
      link.href = 'src/styles/chat-extended.css';
      document.head.appendChild(link);
    }

    container.innerHTML = `
      <!-- Sidebar overlay (mobile) -->
      <div id="chat-sidebar-overlay" class="chat-sidebar-overlay" onclick="ChatUI.closeSidebar()"></div>

      <div class="chat-root">
        <!-- ── Sidebar ─────────────────────────────────── -->
        <div class="chat-sidebar" id="chat-sidebar">
          <div class="chat-sidebar-header">
            <div class="chat-sidebar-title">AVENORA CHAT</div>
            <div class="chat-sidebar-status" id="chat-status">Connecting…</div>
          </div>

          <!-- Tab switcher -->
          <div class="chat-sidebar-tabs" role="tablist">
            <button class="chat-sidebar-tab active" data-tab="public"  onclick="ChatUI.switchTab('public')"  aria-label="Public Rooms">PUBLIC</button>
            <button class="chat-sidebar-tab"        data-tab="private" onclick="ChatUI.switchTab('private')" aria-label="Private Rooms">ROOMS</button>
            <button class="chat-sidebar-tab"        data-tab="inbox"   onclick="ChatUI.switchTab('inbox')"   aria-label="Inbox" id="inbox-tab-btn">
              INBOX
              <span id="inbox-sidebar-badge" class="room-item-badge" style="display:none;margin-left:4px">0</span>
            </button>
          </div>

          <!-- Tab panels -->
          <div class="chat-sidebar-body">
            <!-- Public rooms panel -->
            <div id="tab-panel-public" class="tab-panel">
              <p style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;color:var(--text-muted);text-transform:uppercase;padding:8px 2px 4px">Community Rooms</p>
              <div id="public-room-list"></div>
            </div>

            <!-- Private rooms panel -->
            <div id="tab-panel-private" class="tab-panel" style="display:none">
              <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 2px 4px">
                <p style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;color:var(--text-muted);text-transform:uppercase">My Rooms</p>
                <button class="btn btn-ghost btn-sm" onclick="ChatUI.showCreateRoom()" style="font-size:0.7rem;padding:3px 8px">+ NEW</button>
              </div>
              <div id="private-room-list"></div>
              <div style="margin-top:var(--space-sm)">
                <button class="btn btn-ghost btn-sm w-full" onclick="ChatUI.showDiscoverRooms()" style="font-size:0.75rem">Discover Public Rooms</button>
              </div>
            </div>

            <!-- Inbox panel -->
            <div id="tab-panel-inbox" class="tab-panel" style="display:none">
              <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 2px 4px">
                <p style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;color:var(--text-muted);text-transform:uppercase">Conversations</p>
                <button class="btn btn-ghost btn-sm" onclick="ChatUI.showNewDM()" style="font-size:0.7rem;padding:3px 8px">+ NEW</button>
              </div>
              <div id="inbox-list-panel"></div>
            </div>
          </div>
        </div>

        <!-- ── Main area ──────────────────────────────── -->
        <div class="chat-main">
          <!-- Header -->
          <div class="chat-header">
            <!-- Mobile menu button -->
            <button class="chat-header-btn chat-mobile-menu-btn" id="chat-menu-btn"
                    onclick="ChatUI.openSidebar()" aria-label="Open chat menu" style="margin-right:8px">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>

            <div class="chat-header-info">
              <div class="chat-header-room-icon" id="chat-room-icon">💬</div>
              <div>
                <div class="chat-header-name" id="chat-room-name">SELECT A ROOM</div>
                <div class="chat-header-desc" id="chat-room-desc"></div>
              </div>
            </div>

            <div class="chat-header-actions" id="chat-header-actions"></div>
          </div>

          <!-- Messages -->
          <div class="chat-messages" id="chat-messages">
            <div class="chat-welcome">
              <div class="chat-welcome-icon">⚱️</div>
              <div class="chat-welcome-title">AVENORA SANCTUM</div>
              <p style="font-size:0.85rem">Choose a room or conversation to begin</p>
            </div>
          </div>

          <!-- Typing indicator -->
          <div class="chat-typing" id="chat-typing"></div>

          <!-- Input bar -->
          <div class="chat-input-bar" id="chat-input-bar">
            <!-- Auth prompt (shown when logged out) -->
            <div id="chat-auth-prompt" class="chat-auth-prompt hidden">
              <p style="color:var(--text-muted);margin-bottom:var(--space-sm);font-size:0.9rem">Sign in to send messages</p>
              <button class="btn btn-primary btn-sm" onclick="Modal.open('auth-modal')">Sign In</button>
            </div>
            <!-- Reply strip -->
            <div id="chat-reply-strip" class="chat-reply-strip" style="display:none">
              <span style="color:var(--avenora-bronze)">↩</span>
              <span id="chat-reply-text" class="truncate" style="flex:1;font-size:0.8rem"></span>
              <button class="chat-reply-strip-close" onclick="ChatState.clearReply()" aria-label="Cancel reply">✕</button>
            </div>
            <!-- Input row -->
            <div id="chat-input-area" class="chat-input-row">
              <textarea class="chat-input" id="chat-input" placeholder="Message…" rows="1"
                        maxlength="4000" aria-label="Chat message"
                        oninput="ChatState.handleInputChange(this)"
                        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();ChatState.send();}"></textarea>
              <button class="chat-send-btn" id="chat-send-btn" onclick="ChatState.send()" aria-label="Send">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    await ChatState.init();
    return () => ChatState.cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

const ChatState = {
  // Which "mode" is active: 'public' | 'private_room' | 'dm'
  mode: null,
  // Current room/conversation ID
  currentId: null,
  // Room object for private rooms
  currentRoom: null,
  // Conversation object for DMs
  currentConvo: null,

  // Backend
  useFirebase: false,
  socket: null,
  connected: false,

  // Firebase unsubs
  _unsubMessages: null,
  _unsubTyping: null,

  // Typing debounce
  typingTimeout: null,
  typingUsers: {},

  // Reply state
  replyTo: null,   // { id, preview }

  // Blocked user IDs
  blockedUsers: new Set(),

  // ─── Init ───────────────────────────────────────────────────
  async init() {
    this.useFirebase = !!(window.AvenoraFirebase?.RTDB);

    const user = LegendAPI.auth.getUser();
    if (!user) {
      document.getElementById('chat-auth-prompt')?.classList.remove('hidden');
      document.getElementById('chat-input-area')?.classList.add('hidden');
    }

    // Load blocked users
    if (user) {
      LegendAPI.chat.blocks().then(d => {
        this.blockedUsers = new Set((d.blockedUsers || []).map(id => id.toString()));
      }).catch(() => {});
    }

    // Connect real-time
    if (this.useFirebase) {
      this._updateStatus('Connected');
      this.connected = true;
    } else {
      this._connectSocket();
    }

    // Render all sidebar panels
    await ChatUI.renderPublicRooms();
    if (user) {
      await ChatUI.renderPrivateRooms();
      await ChatUI.renderInbox();
      this._startUnreadPoll();
    }

    // Auto-join first public room
    const firstRoom = document.querySelector('[data-room-btn]');
    if (firstRoom) window.joinPublicRoom(firstRoom.dataset.roomBtn);
  },

  // ─── Socket connection ───────────────────────────────────────
  _connectSocket() {
    const socketUrl = window.LU_CONFIG?.socketUrl || null;
    if (!socketUrl) {
      console.error('[AVENORA] Chat socket URL not configured. Set window.LU_CONFIG.socketUrl in index.html.');
      this._updateStatus('Offline');
      return;
    }
    if (typeof io !== 'undefined') {
      this._setupSocket(socketUrl);
      return;
    }
    const script = document.createElement('script');
    script.src = `${socketUrl}/socket.io/socket.io.js`;
    script.onload = () => this._setupSocket(socketUrl);
    script.onerror = () => {
      this._updateStatus('Offline');
      ChatUI.showSystemMsg('Chat is temporarily unavailable.');
    };
    document.head.appendChild(script);
  },

  _setupSocket(url) {
    const token = LegendAPI.TokenStore.getAccess();
    this.socket = io(url, {
      auth: { token },
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.socket.on('connect', () => {
      this.connected = true;
      this._updateStatus('Connected');
      // Re-join current room/convo
      if (this.mode === 'public' && this.currentId) {
        this.socket.emit('chat:join', { roomId: this.currentId });
      } else if (this.mode === 'private_room' && this.currentId) {
        this.socket.emit('room:join', { roomId: this.currentId });
      } else if (this.mode === 'dm' && this.currentId) {
        this.socket.emit('dm:join', { conversationId: this.currentId });
      }
    });

    this.socket.on('connect_error', () => {
      this.connected = false;
      this._updateStatus('Offline');
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      this._updateStatus('Reconnecting…');
    });

    this.socket.on('reconnect', () => {
      this.connected = true;
      this._updateStatus('Connected');
    });

    // Public room message
    this.socket.on('chat:message', (msg) => {
      if (this.mode === 'public' && msg.roomId === this.currentId) {
        if (!this.blockedUsers.has(msg.author?.id?.toString())) {
          ChatUI.appendMessage(msg, 'public');
          ChatUI.scrollBottom();
        }
      }
    });

    // Private room message
    this.socket.on('room:message', (msg) => {
      if (this.mode === 'private_room' && msg.roomId === this.currentId) {
        if (!this.blockedUsers.has(msg.author?.id?.toString())) {
          ChatUI.appendMessage(msg, 'private_room');
          ChatUI.scrollBottom();
        }
      }
    });

    // DM message
    this.socket.on('dm:message', (msg) => {
      // Update inbox in sidebar regardless of active convo
      ChatUI.renderInbox().catch(() => {});
      if (this.mode === 'dm' && msg.conversationId === this.currentId) {
        const myId = LegendAPI.auth.getUser()?.id;
        if (!this.blockedUsers.has(msg.sender?.id?.toString())) {
          ChatUI.appendDMMessage(msg);
          ChatUI.scrollBottom();
          // Mark as read immediately
          LegendAPI.dm.read(this.currentId).catch(() => {});
        }
      }
    });

    this.socket.on('dm:message_deleted', ({ messageId }) => {
      const el = document.querySelector(`[data-msg-id="${messageId}"]`);
      if (el) {
        el.classList.add('is-deleted');
        el.querySelector('.chat-msg-content').textContent = 'Message deleted.';
        el.querySelectorAll('.chat-msg-action-btn').forEach(b => b.remove());
      }
    });

    // Typing indicators
    this.socket.on('chat:typing', ({ roomId, user: u, isTyping }) => {
      if (this.mode === 'public' && roomId === this.currentId) {
        if (isTyping) this.typingUsers[u.id] = u.username;
        else delete this.typingUsers[u.id];
        ChatUI.updateTyping();
      }
    });

    this.socket.on('room:typing', ({ roomId, user: u, isTyping }) => {
      if (this.mode === 'private_room' && roomId === this.currentId) {
        if (isTyping) this.typingUsers[u.id] = u.username;
        else delete this.typingUsers[u.id];
        ChatUI.updateTyping();
      }
    });

    this.socket.on('dm:typing', ({ conversationId, user: u, isTyping }) => {
      if (this.mode === 'dm' && conversationId === this.currentId) {
        if (isTyping) this.typingUsers[u.id] = u.username;
        else delete this.typingUsers[u.id];
        ChatUI.updateTyping();
      }
    });

    this.socket.on('chat:error', ({ message }) => {
      Toast.error(message || 'Something went wrong in chat.');
    });

    // Real-time notification (room invite, join approved, etc.)
    this.socket.on('notification:new', (notif) => {
      if (['room_invite','room_join_approved','room_join_rejected','dm'].includes(notif.type)) {
        ChatUI.renderInbox().catch(() => {});
        ChatUI.refreshUnreadBadge().catch(() => {});
      }
    });
  },

  // ─── Join public room ────────────────────────────────────────
  async joinPublicRoom(roomId) {
    // Tear down previous
    this._leaveCurrent();
    this.mode = 'public';
    this.currentId = roomId;
    this.typingUsers = {};

    ChatUI.updateRoomHeader({ id: roomId, name: ChatUI.publicRooms.find(r => r.id === roomId)?.name || roomId, type: 'public' });
    ChatUI.showLoading();

    if (this.useFirebase) {
      await this._joinPublicFirebase(roomId);
    } else {
      if (this.socket?.connected) {
        this.socket.emit('chat:join', { roomId });
      }
      // Load history
      try {
        const data = await LegendAPI.chat.history(roomId);
        ChatUI.renderMessages(data.messages || [], 'public');
      } catch {
        ChatUI.showWelcome(roomId, ChatUI.publicRooms.find(r => r.id === roomId)?.name);
      }
    }

    ChatUI.updateActiveRoom(roomId, 'public');
    ChatUI.closeSidebar();
  },

  async _joinPublicFirebase(roomId) {
    const RTDB = window.AvenoraFirebase.RTDB;
    if (this._unsubMessages) { this._unsubMessages(); this._unsubMessages = null; }
    if (this._unsubTyping)   { this._unsubTyping();   this._unsubTyping = null;   }

    const msgArea = document.getElementById('chat-messages');
    let firstLoad = true;

    this._unsubMessages = await RTDB.onMessages(roomId, (messages) => {
      if (!msgArea) return;
      if (firstLoad) {
        firstLoad = false;
        if (!messages.length) {
          ChatUI.showWelcome(roomId, ChatUI.publicRooms.find(r => r.id === roomId)?.name);
        } else {
          ChatUI.renderMessages(messages, 'public');
          ChatUI.scrollBottom();
        }
      } else {
        const last = messages[messages.length - 1];
        if (last && !document.querySelector(`[data-msg-id="${last.id}"]`)) {
          if (!ChatState.blockedUsers.has(last.author?.id?.toString())) {
            const placeholder = msgArea.querySelector('.chat-welcome');
            if (placeholder) placeholder.remove();
            ChatUI.appendMessage(last, 'public');
            ChatUI.scrollBottom();
          }
        }
      }
    });

    const currentUser = LegendAPI.auth.getUser();
    this._unsubTyping = await RTDB.onTyping(roomId, (typists) => {
      this.typingUsers = {};
      Object.entries(typists).forEach(([uid, val]) => {
        if (!currentUser || uid !== currentUser.id) {
          this.typingUsers[uid] = val.username;
        }
      });
      ChatUI.updateTyping();
    });
  },

  // ─── Join private room ───────────────────────────────────────
  async joinPrivateRoom(roomId) {
    if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }

    this._leaveCurrent();
    this.mode = 'private_room';
    this.currentId = roomId;
    this.typingUsers = {};

    ChatUI.showLoading();

    try {
      const data = await LegendAPI.privateRooms.get(roomId);
      this.currentRoom = data.room;
      ChatUI.updateRoomHeader(data.room, 'private_room');
    } catch (err) {
      document.getElementById('chat-messages').innerHTML = `
        <div class="chat-welcome">
          <div class="chat-welcome-icon">🔒</div>
          <p>${escapeHtml(err.message || 'You do not have access to this room.')}</p>
        </div>`;
      return;
    }

    // Socket join
    if (this.socket?.connected) {
      this.socket.emit('room:join', { roomId });
    }

    // Load history
    try {
      const hist = await LegendAPI.privateRooms.history(roomId);
      ChatUI.renderMessages(hist.messages || [], 'private_room');
    } catch {
      ChatUI.showWelcome(roomId, this.currentRoom?.name);
    }

    ChatUI.updateActiveRoom(roomId, 'private');
    ChatUI.updateRoomHeaderActions('private_room');
    ChatUI.closeSidebar();
  },

  // ─── Open DM conversation ────────────────────────────────────
  async openDM(conversationId) {
    if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }

    this._leaveCurrent();
    this.mode = 'dm';
    this.currentId = conversationId;
    this.typingUsers = {};

    ChatUI.showLoading();

    try {
      const data = await LegendAPI.dm.conversation(conversationId);
      this.currentConvo = data.conversation;
      ChatUI.updateDMHeader(data.conversation);
    } catch (err) {
      document.getElementById('chat-messages').innerHTML = `
        <div class="chat-welcome">
          <div class="chat-welcome-icon">🔒</div>
          <p>${escapeHtml('This conversation is unavailable.')}</p>
        </div>`;
      return;
    }

    // Socket join for typing
    if (this.socket?.connected) {
      this.socket.emit('dm:join', { conversationId });
    }

    // Load history
    try {
      const hist = await LegendAPI.dm.messages(conversationId);
      ChatUI.renderDMMessages(hist.messages || []);
    } catch {
      document.getElementById('chat-messages').innerHTML = '<div class="chat-welcome"><p>No messages yet.</p></div>';
    }

    // Mark as read
    LegendAPI.dm.read(conversationId).catch(() => {});
    ChatUI.refreshUnreadBadge().catch(() => {});
    ChatUI.closeSidebar();
  },

  // ─── Leave current context ───────────────────────────────────
  _leaveCurrent() {
    if (this._unsubMessages) { this._unsubMessages(); this._unsubMessages = null; }
    if (this._unsubTyping)   { this._unsubTyping();   this._unsubTyping = null;   }

    if (this.socket?.connected) {
      if (this.mode === 'public' && this.currentId) {
        this.socket.emit('chat:leave', { roomId: this.currentId });
        if (this.useFirebase && this.currentId) {
          window.AvenoraFirebase.RTDB.setTyping(this.currentId, false).catch(() => {});
        } else {
          this.socket.emit('chat:typing', { roomId: this.currentId, isTyping: false });
        }
      } else if (this.mode === 'private_room' && this.currentId) {
        this.socket.emit('room:leave', { roomId: this.currentId });
      } else if (this.mode === 'dm' && this.currentId) {
        this.socket.emit('dm:leave', { conversationId: this.currentId });
      }
    }
    this.typingUsers = {};
    this.replyTo = null;
    document.getElementById('chat-reply-strip').style.display = 'none';
  },

  // ─── Send message ────────────────────────────────────────────
  async send() {
    const input = document.getElementById('chat-input');
    const content = input?.value?.trim();
    if (!content || !this.currentId) return;

    if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }

    input.value = '';
    input.style.height = '';
    this._stopTyping();

    const replyToId = this.replyTo?.id || null;
    this.clearReply();

    if (this.mode === 'public') {
      if (this.useFirebase) {
        try {
          await window.AvenoraFirebase.RTDB.sendMessage(this.currentId, content);
        } catch {
          Toast.error('Your message could not be sent.');
        }
      } else {
        if (!this.socket?.connected) { Toast.error('Your message could not be sent.'); return; }
        this.socket.emit('chat:message', { roomId: this.currentId, content, replyToId });
      }
    } else if (this.mode === 'private_room') {
      if (!this.socket?.connected) { Toast.error('Your message could not be sent.'); return; }
      this.socket.emit('room:message', { roomId: this.currentId, content, replyToId });
    } else if (this.mode === 'dm') {
      try {
        const data = await LegendAPI.dm.send(this.currentId, content, replyToId);
        // REST API already handles persistence & real-time via server-side socket emit
        // Optimistically render our own message immediately
        ChatUI.appendDMMessage(data.message);
        ChatUI.scrollBottom();
      } catch (err) {
        Toast.error(err.message || 'Your message could not be sent.');
      }
    }
  },

  // ─── Reply to a message ──────────────────────────────────────
  setReply(msgId, preview) {
    this.replyTo = { id: msgId, preview };
    const strip = document.getElementById('chat-reply-strip');
    const text  = document.getElementById('chat-reply-text');
    if (strip) strip.style.display = 'flex';
    if (text)  text.textContent = preview;
    document.getElementById('chat-input')?.focus();
  },

  clearReply() {
    this.replyTo = null;
    const strip = document.getElementById('chat-reply-strip');
    if (strip) strip.style.display = 'none';
  },

  // ─── Typing ──────────────────────────────────────────────────
  handleInputChange(el) {
    // Auto-resize textarea
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    this._sendTyping();
  },

  _sendTyping: debounce(function () {
    if (!ChatState.currentId) return;
    const user = LegendAPI.auth.getUser();
    if (!user) return;

    if (ChatState.mode === 'public') {
      if (ChatState.useFirebase) {
        window.AvenoraFirebase.RTDB.setTyping(ChatState.currentId, true).catch(() => {});
      } else {
        ChatState.socket?.emit('chat:typing', { roomId: ChatState.currentId, isTyping: true });
      }
    } else if (ChatState.mode === 'private_room') {
      ChatState.socket?.emit('room:typing', { roomId: ChatState.currentId, isTyping: true });
    } else if (ChatState.mode === 'dm') {
      ChatState.socket?.emit('dm:typing', { conversationId: ChatState.currentId, isTyping: true });
    }

    clearTimeout(ChatState.typingTimeout);
    ChatState.typingTimeout = setTimeout(() => ChatState._stopTyping(), 3000);
  }, 200),

  _stopTyping() {
    clearTimeout(this.typingTimeout);
    if (!this.currentId) return;
    if (this.mode === 'public') {
      if (this.useFirebase) {
        window.AvenoraFirebase.RTDB.setTyping(this.currentId, false).catch(() => {});
      } else {
        this.socket?.emit('chat:typing', { roomId: this.currentId, isTyping: false });
      }
    } else if (this.mode === 'private_room') {
      this.socket?.emit('room:typing', { roomId: this.currentId, isTyping: false });
    } else if (this.mode === 'dm') {
      this.socket?.emit('dm:typing', { conversationId: this.currentId, isTyping: false });
    }
  },

  // ─── Unread badge poll ───────────────────────────────────────
  _unreadPollTimer: null,
  _startUnreadPoll() {
    ChatUI.refreshUnreadBadge().catch(() => {});
    this._unreadPollTimer = setInterval(() => {
      ChatUI.refreshUnreadBadge().catch(() => {});
    }, 30000);
  },

  _updateStatus(text) {
    const el = document.getElementById('chat-status');
    if (el) el.textContent = text;
  },

  // ─── Cleanup ─────────────────────────────────────────────────
  cleanup() {
    this._leaveCurrent();
    clearInterval(this._unreadPollTimer);
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════

const ChatUI = {
  publicRooms: [],
  currentTab: 'public',

  // ─── Tab switching ───────────────────────────────────────────
  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.chat-sidebar-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.style.display = p.id === `tab-panel-${tab}` ? '' : 'none';
    });
    if (tab === 'inbox') this.renderInbox().catch(() => {});
    if (tab === 'private') this.renderPrivateRooms().catch(() => {});
  },

  // ─── Sidebar open/close (mobile) ─────────────────────────────
  openSidebar() {
    document.getElementById('chat-sidebar')?.classList.add('mobile-open');
    document.getElementById('chat-sidebar-overlay')?.classList.add('visible');
  },
  closeSidebar() {
    document.getElementById('chat-sidebar')?.classList.remove('mobile-open');
    document.getElementById('chat-sidebar-overlay')?.classList.remove('visible');
  },

  // ─── Public rooms ────────────────────────────────────────────
  async renderPublicRooms() {
    let rooms = [];
    try {
      const data = await LegendAPI.chat.rooms();
      rooms = data.rooms || [];
    } catch {
      rooms = [
        { id: 'general', name: 'General',       description: 'Main community chat' },
        { id: 'music',   name: 'Music Talk',     description: 'Music discussion'    },
        { id: 'gaming',  name: 'Gaming Lounge',  description: 'Games & Arcade'      },
        { id: 'streams', name: 'Streams Hub',    description: 'Live stream talk'    },
        { id: 'chill',   name: 'Chill Zone',     description: 'Relax and chat'      },
      ];
    }
    this.publicRooms = rooms;

    const list = document.getElementById('public-room-list');
    if (!list) return;
    list.innerHTML = rooms.map(r => `
      <button class="room-item" data-room-btn="${r.id}" data-room-type="public"
              onclick="window.joinPublicRoom('${escapeHtml(r.id)}')" aria-label="Join ${escapeHtml(r.name)}">
        <span class="room-item-icon">#</span>
        <span class="room-item-name">${escapeHtml(r.name)}</span>
      </button>
    `).join('');
  },

  // ─── Private rooms ───────────────────────────────────────────
  async renderPrivateRooms() {
    if (!LegendAPI.auth.isLoggedIn()) {
      document.getElementById('private-room-list').innerHTML =
        '<p style="font-size:0.8rem;color:var(--text-muted);padding:8px">Sign in to see your rooms.</p>';
      return;
    }
    try {
      const data = await LegendAPI.privateRooms.list();
      const list = document.getElementById('private-room-list');
      if (!list) return;
      if (!data.rooms?.length) {
        list.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted);padding:8px 2px">No rooms yet. Create one!</p>';
        return;
      }
      list.innerHTML = data.rooms.map(r => `
        <div class="private-room-card" data-room-btn="${r.id}" data-room-type="private"
             onclick="window.joinPrivateRoom('${r.id}')">
          <div class="private-room-card-icon">
            ${r.iconUrl ? `<img src="${escapeHtml(r.iconUrl)}" alt="${escapeHtml(r.name)}">` : '🔐'}
          </div>
          <div class="private-room-card-info">
            <div class="private-room-card-name">${escapeHtml(r.name)}</div>
            <div class="private-room-card-meta">${r.memberCount} member${r.memberCount !== 1 ? 's' : ''} · ${r.visibility}</div>
          </div>
        </div>
      `).join('');
    } catch {
      document.getElementById('private-room-list').innerHTML =
        '<p style="font-size:0.8rem;color:var(--text-muted);padding:8px">Could not load rooms.</p>';
    }
  },

  // ─── Inbox ───────────────────────────────────────────────────
  async renderInbox() {
    if (!LegendAPI.auth.isLoggedIn()) {
      document.getElementById('inbox-list-panel').innerHTML =
        '<p style="font-size:0.8rem;color:var(--text-muted);padding:8px">Sign in to see messages.</p>';
      return;
    }
    try {
      const data = await LegendAPI.inbox.list();
      const panel = document.getElementById('inbox-list-panel');
      if (!panel) return;

      const items = data.conversations || [];
      const roomNotifs = data.roomNotifications || [];
      const pending = data.pendingJoinRequests || [];

      if (!items.length && !roomNotifs.length && !pending.length) {
        panel.innerHTML = `
          <div style="text-align:center;padding:var(--space-lg);color:var(--text-muted)">
            <p style="font-size:1.5rem;margin-bottom:8px">📭</p>
            <p style="font-size:0.85rem">No messages yet</p>
          </div>`;
        return;
      }

      let html = '<div class="inbox-list">';

      // Pending join requests
      pending.forEach(req => {
        html += `
          <div class="inbox-item" onclick="window.joinPrivateRoom('${req.roomId}');ChatUI.switchTab('private')">
            <div class="inbox-item-avatar" style="background:rgba(184,149,75,0.12);color:var(--avenora-gold)">⚙️</div>
            <div class="inbox-item-info">
              <div class="inbox-item-name">${escapeHtml(req.roomName)}</div>
              <div class="inbox-item-preview">${req.pendingCount} pending join request${req.pendingCount !== 1 ? 's' : ''}</div>
            </div>
          </div>`;
      });

      // Room notifications
      roomNotifs.forEach(n => {
        const icon = n.type === 'room_invite' ? '💌' : n.type === 'room_join_approved' ? '✅' : '❌';
        html += `
          <div class="inbox-item" onclick="${n.room ? `window.joinPrivateRoom('${n.room.id}')` : ''}">
            <div class="inbox-item-avatar" style="background:rgba(184,149,75,0.08)">${icon}</div>
            <div class="inbox-item-info">
              <div class="inbox-item-name">${escapeHtml(n.room?.name || 'Room')}</div>
              <div class="inbox-item-preview">${escapeHtml(n.message || n.type)}</div>
            </div>
            <div class="inbox-item-meta">
              <div class="inbox-item-time">${formatTimeAgo(n.createdAt)}</div>
            </div>
          </div>`;
      });

      // DM conversations
      items.forEach(convo => {
        const name = convo.otherUser?.username || convo.groupName || 'Conversation';
        const avatar = convo.otherUser?.avatarUrl;
        const initials = name[0].toUpperCase();
        const preview = convo.lastMessage?.content || 'No messages yet';
        const unread = convo.unreadCount || 0;

        html += `
          <button class="inbox-item" data-convo-btn="${convo.id}"
                  onclick="ChatState.openDM('${convo.id}')" aria-label="Open conversation with ${escapeHtml(name)}">
            <div class="inbox-item-avatar">
              ${avatar ? `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(name)}">` : initials}
            </div>
            <div class="inbox-item-info">
              <div class="inbox-item-name">${escapeHtml(name)}</div>
              <div class="inbox-item-preview">${escapeHtml(preview.slice(0, 60))}</div>
            </div>
            <div class="inbox-item-meta">
              <div class="inbox-item-time">${convo.lastMessage?.sentAt ? formatTimeAgo(convo.lastMessage.sentAt) : ''}</div>
              ${unread ? `<div class="inbox-item-unread">${unread > 99 ? '99+' : unread}</div>` : ''}
            </div>
          </button>`;
      });

      html += '</div>';
      panel.innerHTML = html;
    } catch {
      document.getElementById('inbox-list-panel').innerHTML =
        '<p style="font-size:0.8rem;color:var(--text-muted);padding:8px">Could not load inbox.</p>';
    }
  },

  // ─── Unread badge ─────────────────────────────────────────────
  async refreshUnreadBadge() {
    if (!LegendAPI.auth.isLoggedIn()) return;
    try {
      const data = await LegendAPI.inbox.unread();
      const count = data.unread || 0;
      // Mobile nav badge
      let badge = document.getElementById('chat-nav-unread-badge');
      if (!badge) {
        const chatNavItem = document.querySelector('.mobile-nav-item[data-page="chat"]');
        if (chatNavItem) {
          badge = document.createElement('span');
          badge.id = 'chat-nav-unread-badge';
          badge.className = 'chat-nav-badge';
          badge.style.display = 'none';
          chatNavItem.appendChild(badge);
        }
      }
      if (badge) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = count > 0 ? '' : 'none';
      }
      // Sidebar inbox tab badge
      const sidebarBadge = document.getElementById('inbox-sidebar-badge');
      if (sidebarBadge) {
        sidebarBadge.textContent = count > 99 ? '99+' : count;
        sidebarBadge.style.display = count > 0 ? '' : 'none';
      }
    } catch {}
  },

  // ─── Room header ─────────────────────────────────────────────
  updateRoomHeader(room, mode) {
    const nameEl = document.getElementById('chat-room-name');
    const descEl = document.getElementById('chat-room-desc');
    const iconEl = document.getElementById('chat-room-icon');
    if (!nameEl) return;

    if (mode === 'public') {
      nameEl.textContent = `# ${room.name || room.id}`;
      descEl.textContent = room.description || '';
      iconEl.textContent = '💬';
    } else if (mode === 'private_room') {
      nameEl.textContent = room.name || 'Room';
      descEl.textContent = room.description || `${room.memberCount || '?'} members · ${room.visibility || ''}`;
      iconEl.innerHTML = room.iconUrl
        ? `<img src="${escapeHtml(room.iconUrl)}" alt="${escapeHtml(room.name)}">`
        : '🔐';
    }
    this.updateRoomHeaderActions(mode);
  },

  updateDMHeader(convo) {
    const nameEl = document.getElementById('chat-room-name');
    const descEl = document.getElementById('chat-room-desc');
    const iconEl = document.getElementById('chat-room-icon');
    if (!nameEl) return;

    const other = convo.otherUser;
    const name = other?.username || convo.groupName || 'Conversation';
    nameEl.textContent = name;
    descEl.textContent = 'Direct Message';
    iconEl.innerHTML = other?.avatarUrl
      ? `<img src="${escapeHtml(other.avatarUrl)}" alt="${escapeHtml(name)}">`
      : `<span>${name[0].toUpperCase()}</span>`;

    this.updateRoomHeaderActions('dm');
  },

  updateRoomHeaderActions(mode) {
    const container = document.getElementById('chat-header-actions');
    if (!container) return;
    const user = LegendAPI.auth.getUser();
    let html = '';

    if (mode === 'private_room' && ChatState.currentRoom) {
      const room = ChatState.currentRoom;
      const role = room.myRole;
      if (['owner','moderator'].includes(role)) {
        html += `<button class="chat-header-btn" onclick="ChatUI.showRoomManage()" title="Manage Room">⚙️</button>`;
      }
      html += `<button class="chat-header-btn" onclick="ChatUI.showRoomMembers()" title="Members">👥</button>`;
      if (role && role !== 'owner') {
        html += `<button class="chat-header-btn" onclick="ChatUI.leaveRoom('${room.id}')" title="Leave Room" style="color:var(--neon-red)">🚪</button>`;
      }
    } else if (mode === 'dm' && ChatState.currentConvo) {
      const convo = ChatState.currentConvo;
      html += `<button class="chat-header-btn" onclick="ChatUI.showDMOptions()" title="Options">⋯</button>`;
    }

    container.innerHTML = html;
  },

  // ─── Update active highlight ──────────────────────────────────
  updateActiveRoom(id, type) {
    document.querySelectorAll('[data-room-btn],[data-convo-btn]').forEach(el => {
      const isMatch = (type === 'public' || type === 'private')
        ? el.dataset.roomBtn === id
        : el.dataset.convoBBtn === id;
      el.classList.toggle('active', el.dataset.roomBtn === id || el.dataset.convoBtn === id);
    });
  },

  // ─── Message rendering ────────────────────────────────────────
  showLoading() {
    document.getElementById('chat-messages').innerHTML =
      '<div class="loading-state" style="min-height:80px"><div class="spinner"></div></div>';
  },

  showWelcome(id, name) {
    document.getElementById('chat-messages').innerHTML = `
      <div class="chat-welcome">
        <div class="chat-welcome-icon">💬</div>
        <div class="chat-welcome-title"># ${escapeHtml(name || id)}</div>
        <p style="font-size:0.85rem">Be the first to send a message!</p>
      </div>`;
  },

  showSystemMsg(text) {
    const area = document.getElementById('chat-messages');
    if (!area) return;
    const el = document.createElement('div');
    el.className = 'chat-system-msg';
    el.textContent = text;
    area.appendChild(el);
  },

  renderMessages(messages, mode) {
    const area = document.getElementById('chat-messages');
    if (!area) return;
    if (!messages.length) {
      area.innerHTML = '';
      return;
    }
    area.innerHTML = '';
    messages.forEach(m => this.appendMessage(m, mode));
    this.scrollBottom();
  },

  appendMessage(msg, mode) {
    const area = document.getElementById('chat-messages');
    if (!area) return;

    // Remove welcome placeholder
    area.querySelector('.chat-welcome')?.remove();

    const currentUser = LegendAPI.auth.getUser();
    const authorId = (msg.author?.id || msg.author?.uid || '').toString();
    const isOwn = currentUser && authorId && (authorId === currentUser.id?.toString());
    const username = msg.author?.username || msg.authorUsername || 'Unknown';
    const avatarUrl = msg.author?.avatarUrl;
    const initials = username[0]?.toUpperCase() || '?';
    const role = msg.author?.role;
    const authorClass = isOwn ? 'is-own' : (role === 'moderator' ? 'is-mod' : (role === 'founder' || role === 'admin' ? 'is-owner' : ''));
    const canDelete = isOwn || ['moderator','founder','admin'].includes(currentUser?.role);
    const msgId = msg.id || msg._id || '';

    const el = document.createElement('div');
    el.className = 'chat-msg';
    el.dataset.msgId = msgId;

    el.innerHTML = `
      <div class="chat-msg-avatar" onclick="ChatUI.showUserMenu(event,'${escapeHtml(authorId)}','${escapeHtml(username)}')"
           title="${escapeHtml(username)}">
        ${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(username)}">` : initials}
      </div>
      <div class="chat-msg-body">
        ${msg.replyTo || msg.replyToId ? `<div class="chat-reply-preview">↩ ${escapeHtml((msg.replyTo?.preview || msg.replyPreview || '').slice(0, 80))}</div>` : ''}
        <div class="chat-msg-meta">
          <span class="chat-msg-author ${authorClass}">${escapeHtml(username)}</span>
          <span class="chat-msg-time">${formatTimeAgo(msg.timestamp || msg.createdAt)}</span>
          <div class="chat-msg-actions">
            <button class="chat-msg-action-btn" onclick="ChatUI.showMsgMenu(event,'${escapeHtml(msgId)}',this)" title="More">⋯</button>
          </div>
        </div>
        <div class="chat-msg-content">${escapeHtml(msg.content || '')}</div>
      </div>
    `;

    area.appendChild(el);
  },

  renderDMMessages(messages) {
    const area = document.getElementById('chat-messages');
    if (!area) return;
    if (!messages.length) {
      area.innerHTML = '<div class="chat-welcome"><p style="font-size:0.85rem">No messages yet. Say hello!</p></div>';
      return;
    }
    area.innerHTML = '';
    messages.forEach(m => this.appendDMMessage(m));
    this.scrollBottom();
  },

  appendDMMessage(msg) {
    const area = document.getElementById('chat-messages');
    if (!area) return;

    area.querySelector('.chat-welcome')?.remove();

    const currentUser = LegendAPI.auth.getUser();
    const senderId = (msg.sender?.id || msg.senderId || '').toString();
    const isOwn = currentUser && senderId && (senderId === currentUser.id?.toString());
    const username = msg.sender?.username || msg.senderUsername || 'Unknown';
    const avatarUrl = msg.sender?.avatarUrl;
    const initials = username[0]?.toUpperCase() || '?';
    const msgId = msg.id || msg._id || '';

    const existing = area.querySelector(`[data-msg-id="${msgId}"]`);
    if (existing) return; // dedupe

    const el = document.createElement('div');
    el.className = 'chat-msg' + (msg.isDeleted ? ' is-deleted' : '');
    el.dataset.msgId = msgId;

    el.innerHTML = `
      <div class="chat-msg-avatar" title="${escapeHtml(username)}">
        ${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(username)}">` : initials}
      </div>
      <div class="chat-msg-body">
        ${msg.replyTo ? `<div class="chat-reply-preview">↩ ${escapeHtml((msg.replyTo.preview || '').slice(0, 80))}</div>` : ''}
        <div class="chat-msg-meta">
          <span class="chat-msg-author ${isOwn ? 'is-own' : ''}">${escapeHtml(username)}</span>
          <span class="chat-msg-time">${formatTimeAgo(msg.createdAt)}</span>
          <div class="chat-msg-actions">
            ${isOwn && !msg.isDeleted ? `<button class="chat-msg-action-btn danger"
              onclick="ChatUI.deleteDMMessage('${escapeHtml(msgId)}')" title="Delete">✕</button>` : ''}
          </div>
        </div>
        <div class="chat-msg-content">${msg.isDeleted ? '<em>Message deleted.</em>' : escapeHtml(msg.content || '')}</div>
      </div>
    `;

    area.appendChild(el);
  },

  // ─── Message context menu ─────────────────────────────────────
  showMsgMenu(event, msgId, btn) {
    event.stopPropagation();
    this._closeContextMenu();

    const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (!msgEl) return;

    const currentUser = LegendAPI.auth.getUser();
    const authorEl = msgEl.querySelector('.chat-msg-author');
    const authorIsOwn = authorEl?.classList.contains('is-own');
    const canDelete = authorIsOwn || ['moderator','founder','admin'].includes(currentUser?.role);
    const content = msgEl.querySelector('.chat-msg-content')?.textContent || '';

    const menu = document.createElement('div');
    menu.id = 'chat-ctx-menu';
    menu.className = 'chat-context-menu';

    menu.innerHTML = `
      <button class="chat-context-item" onclick="ChatState.setReply('${escapeHtml(msgId)}','${escapeHtml(content.slice(0,60))}');ChatUI._closeContextMenu()">↩ Reply</button>
      ${!authorIsOwn ? `<button class="chat-context-item" onclick="ChatUI.reportMsg('${escapeHtml(msgId)}');ChatUI._closeContextMenu()">🚩 Report</button>` : ''}
      ${canDelete ? `<button class="chat-context-item danger" onclick="ChatUI.deleteMsg('${escapeHtml(msgId)}');ChatUI._closeContextMenu()">🗑 Delete</button>` : ''}
    `;

    document.body.appendChild(menu);

    const rect = btn.getBoundingClientRect();
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.style.left = Math.min(rect.left, window.innerWidth - 170) + 'px';

    setTimeout(() => document.addEventListener('click', () => this._closeContextMenu(), { once: true }), 0);
  },

  _closeContextMenu() {
    document.getElementById('chat-ctx-menu')?.remove();
  },

  // ─── User context menu ────────────────────────────────────────
  showUserMenu(event, userId, username) {
    event.stopPropagation();
    this._closeContextMenu();

    const currentUser = LegendAPI.auth.getUser();
    if (!currentUser || userId === currentUser.id?.toString()) return;

    const isBlocked = ChatState.blockedUsers.has(userId);
    const menu = document.createElement('div');
    menu.id = 'chat-ctx-menu';
    menu.className = 'chat-context-menu';
    menu.innerHTML = `
      <div style="padding:6px 16px;font-size:0.75rem;color:var(--text-muted);font-weight:700;letter-spacing:0.06em">${escapeHtml(username)}</div>
      <button class="chat-context-item" onclick="ChatUI.startDMWithUser('${escapeHtml(userId)}','${escapeHtml(username)}');ChatUI._closeContextMenu()">💬 Message</button>
      ${isBlocked
        ? `<button class="chat-context-item" onclick="ChatUI.unblockUser('${escapeHtml(userId)}','${escapeHtml(username)}');ChatUI._closeContextMenu()">🔓 Unblock</button>`
        : `<button class="chat-context-item danger" onclick="ChatUI.blockUser('${escapeHtml(userId)}','${escapeHtml(username)}');ChatUI._closeContextMenu()">🚫 Block</button>`
      }
      <button class="chat-context-item danger" onclick="ChatUI.reportUser('${escapeHtml(userId)}','${escapeHtml(username)}');ChatUI._closeContextMenu()">🚩 Report</button>
    `;
    document.body.appendChild(menu);

    const rect = event.target.getBoundingClientRect();
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.style.left = Math.min(rect.left, window.innerWidth - 170) + 'px';
    setTimeout(() => document.addEventListener('click', () => this._closeContextMenu(), { once: true }), 0);
  },

  // ─── DM options menu ─────────────────────────────────────────
  showDMOptions() {
    const convo = ChatState.currentConvo;
    if (!convo) return;
    const other = convo.otherUser;
    const isBlocked = convo.isBlocked;

    Modal.create({
      id: 'dm-options-modal',
      title: `Options — ${other?.username || 'Conversation'}`,
      body: `
        <div style="display:flex;flex-direction:column;gap:var(--space-sm)">
          <button class="btn btn-outline w-full" onclick="ChatUI.muteConvo();Modal.close('dm-options-modal')">
            ${convo.isMuted ? '🔔 Unmute' : '🔕 Mute'} Notifications
          </button>
          <button class="btn btn-outline w-full" onclick="ChatUI.${isBlocked ? 'unblockConvo' : 'blockConvo'}();Modal.close('dm-options-modal')">
            ${isBlocked ? '🔓 Unblock' : '🚫 Block'} ${escapeHtml(other?.username || 'User')}
          </button>
          <button class="btn btn-danger w-full" onclick="ChatUI.reportConvo();Modal.close('dm-options-modal')">
            🚩 Report
          </button>
        </div>`,
      actions: [],
    });
    Modal.open('dm-options-modal');
  },

  // ─── Block/unblock ────────────────────────────────────────────
  async blockUser(userId, username) {
    try {
      await LegendAPI.chat.block(userId);
      ChatState.blockedUsers.add(userId);
      Toast.success(`${username} blocked.`);
    } catch {
      Toast.error('Could not block user.');
    }
  },

  async unblockUser(userId, username) {
    try {
      await LegendAPI.chat.unblock(userId);
      ChatState.blockedUsers.delete(userId);
      Toast.success(`${username} unblocked.`);
    } catch {
      Toast.error('Could not unblock user.');
    }
  },

  async blockConvo() {
    if (!ChatState.currentId) return;
    try {
      await LegendAPI.dm.block(ChatState.currentId);
      Toast.success('User blocked.');
      ChatState.currentConvo = { ...ChatState.currentConvo, isBlocked: true };
      this.updateRoomHeaderActions('dm');
    } catch {
      Toast.error('Could not block user.');
    }
  },

  async unblockConvo() {
    if (!ChatState.currentId) return;
    try {
      await LegendAPI.dm.unblock(ChatState.currentId);
      Toast.success('User unblocked.');
      ChatState.currentConvo = { ...ChatState.currentConvo, isBlocked: false };
      this.updateRoomHeaderActions('dm');
    } catch {
      Toast.error('Could not unblock user.');
    }
  },

  async muteConvo() {
    if (!ChatState.currentId) return;
    try {
      const convo = ChatState.currentConvo;
      await LegendAPI.dm.mute(ChatState.currentId, !convo?.isMuted);
      Toast.success(convo?.isMuted ? 'Unmuted.' : 'Muted for 24 hours.');
    } catch {
      Toast.error('Could not update mute settings.');
    }
  },

  // ─── Report ───────────────────────────────────────────────────
  async reportMsg(msgId) {
    if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }
    const mode = ChatState.mode;
    try {
      if (mode === 'public' || mode === 'private_room') {
        await LegendAPI.chat.reportMessage(msgId);
      }
      Toast.success('Message reported. Thank you for keeping Avenora safe.');
    } catch {
      Toast.error('Could not submit report.');
    }
  },

  async reportUser(userId, username) {
    if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }
    try {
      await LegendAPI.reports.submit('user', userId, 'other', `Reported from chat: ${username}`);
      Toast.success('User reported.');
    } catch {
      Toast.error('Could not submit report.');
    }
  },

  async reportConvo() {
    await this.reportUser(ChatState.currentConvo?.otherUser?.id, ChatState.currentConvo?.otherUser?.username || 'user');
  },

  // ─── Delete message ───────────────────────────────────────────
  async deleteMsg(msgId) {
    if (!confirm('Delete this message?')) return;
    try {
      const mode = ChatState.mode;
      if (mode === 'public' || mode === 'private_room') {
        if (ChatState.useFirebase && mode === 'public') {
          await window.AvenoraFirebase.RTDB.deleteMessage(ChatState.currentId, msgId);
        } else {
          await LegendAPI.chat.deleteMessage(msgId);
        }
      }
      const el = document.querySelector(`[data-msg-id="${msgId}"]`);
      if (el) {
        el.classList.add('is-deleted');
        el.querySelector('.chat-msg-content').textContent = 'Message deleted.';
        el.querySelectorAll('.chat-msg-action-btn').forEach(b => b.remove());
      }
    } catch {
      Toast.error('This message could not be deleted.');
    }
  },

  async deleteDMMessage(msgId) {
    if (!confirm('Delete this message?')) return;
    try {
      await LegendAPI.dm.deleteMessage(ChatState.currentId, msgId);
      const el = document.querySelector(`[data-msg-id="${msgId}"]`);
      if (el) {
        el.classList.add('is-deleted');
        el.querySelector('.chat-msg-content').innerHTML = '<em>Message deleted.</em>';
        el.querySelectorAll('.chat-msg-action-btn').forEach(b => b.remove());
      }
    } catch {
      Toast.error('Could not delete message.');
    }
  },

  // ─── Start DM with user ───────────────────────────────────────
  async startDMWithUser(userId, username) {
    if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }
    try {
      const data = await LegendAPI.dm.create({ userId });
      await ChatState.openDM(data.conversation.id);
      this.switchTab('inbox');
    } catch (err) {
      Toast.error(err.message || 'Could not open conversation.');
    }
  },

  // ─── New DM dialog ────────────────────────────────────────────
  showNewDM() {
    if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }
    Modal.create({
      id: 'new-dm-modal',
      title: 'New Message',
      body: `
        <div class="form-group">
          <label class="form-label">Username</label>
          <input class="form-input" id="new-dm-username" placeholder="Enter username…" autocomplete="off">
        </div>
        <div id="new-dm-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem;margin-top:8px"></div>`,
      actions: [
        { label: 'Cancel', onclick: `Modal.close('new-dm-modal')`, className: 'btn-ghost' },
        { label: 'Open Conversation', onclick: `ChatUI._submitNewDM()`, className: 'btn-primary' },
      ],
    });
    Modal.open('new-dm-modal');
  },

  async _submitNewDM() {
    const username = document.getElementById('new-dm-username')?.value?.trim();
    const errEl = document.getElementById('new-dm-error');
    if (!username) {
      if (errEl) { errEl.textContent = 'Username required.'; errEl.classList.remove('hidden'); }
      return;
    }
    try {
      const data = await LegendAPI.dm.create({ username });
      Modal.close('new-dm-modal');
      await ChatState.openDM(data.conversation.id);
      this.switchTab('inbox');
    } catch (err) {
      if (errEl) { errEl.textContent = err.message || 'User not found.'; errEl.classList.remove('hidden'); }
    }
  },

  // ─── Create room dialog ───────────────────────────────────────
  showCreateRoom() {
    if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }
    let visibility = 'private';
    Modal.create({
      id: 'create-room-modal',
      title: 'Create Room',
      body: `
        <div class="room-form">
          <div class="form-group">
            <label class="form-label">Room Name</label>
            <input class="form-input" id="cr-name" placeholder="e.g. Horror Film Club" maxlength="80">
          </div>
          <div class="form-group">
            <label class="form-label">Description (optional)</label>
            <textarea class="form-input" id="cr-desc" placeholder="What's this room about?" rows="2" maxlength="500"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Visibility</label>
            <div class="room-vis-options">
              <button class="room-vis-btn" data-vis="public"       onclick="ChatUI._setVis('public')">PUBLIC</button>
              <button class="room-vis-btn active" data-vis="private" onclick="ChatUI._setVis('private')">PRIVATE</button>
              <button class="room-vis-btn" data-vis="invite_only"  onclick="ChatUI._setVis('invite_only')">INVITE ONLY</button>
            </div>
            <small style="color:var(--text-muted);font-size:0.75rem;margin-top:4px;display:block">
              Public = anyone can join · Private = request to join · Invite Only = invite only
            </small>
          </div>
          <div id="cr-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem"></div>
        </div>`,
      actions: [
        { label: 'Cancel', onclick: `Modal.close('create-room-modal')`, className: 'btn-ghost' },
        { label: 'Create Room', onclick: `ChatUI._submitCreateRoom()`, className: 'btn-primary' },
      ],
    });
    Modal.open('create-room-modal');
  },

  _setVis(vis) {
    document.querySelectorAll('.room-vis-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.vis === vis);
    });
    this._pendingVisibility = vis;
  },
  _pendingVisibility: 'private',

  async _submitCreateRoom() {
    const name = document.getElementById('cr-name')?.value?.trim();
    const description = document.getElementById('cr-desc')?.value?.trim();
    const visibility = this._pendingVisibility || 'private';
    const errEl = document.getElementById('cr-error');

    if (!name) {
      if (errEl) { errEl.textContent = 'Room name is required.'; errEl.classList.remove('hidden'); }
      return;
    }
    try {
      const data = await LegendAPI.privateRooms.create({ name, description, visibility });
      Modal.close('create-room-modal');
      Toast.success(`Room "${name}" created!`);
      await this.renderPrivateRooms();
      await window.joinPrivateRoom(data.room.id);
      this.switchTab('private');
    } catch (err) {
      if (errEl) { errEl.textContent = err.message || 'Could not create room.'; errEl.classList.remove('hidden'); }
    }
  },

  // ─── Room members panel ───────────────────────────────────────
  async showRoomMembers() {
    const room = ChatState.currentRoom;
    if (!room) return;
    try {
      const data = await LegendAPI.privateRooms.get(room.id);
      const members = data.room?.members || [];
      const myRole = data.room?.myRole;
      const canManage = ['owner','moderator'].includes(myRole);

      Modal.create({
        id: 'room-members-modal',
        title: `Members — ${room.name}`,
        body: `
          ${canManage ? `
            <div style="margin-bottom:var(--space-md)">
              <div style="display:flex;gap:var(--space-sm)">
                <input class="form-input" id="invite-username" placeholder="Invite by username…" style="flex:1">
                <button class="btn btn-primary btn-sm" onclick="ChatUI._inviteMember('${room.id}')">Invite</button>
              </div>
              <div id="invite-error" class="hidden" style="color:var(--neon-red);font-size:0.8rem;margin-top:4px"></div>
            </div>` : ''}
          <div class="member-list">
            ${members.map(m => `
              <div class="member-row">
                <span class="member-name">${escapeHtml(m.userId?.username || m.userId || 'Unknown')}</span>
                <span class="member-role-badge ${m.role}">${m.role}</span>
                ${canManage && m.role !== 'owner' ? `
                  <button class="btn btn-ghost btn-sm" title="Remove"
                    onclick="ChatUI._removeMember('${room.id}','${m.userId?._id || m.userId}')">✕</button>` : ''}
              </div>`).join('')}
          </div>
          ${data.room?.joinRequests?.length ? `
            <div style="margin-top:var(--space-md)">
              <p style="font-size:0.75rem;font-weight:700;color:var(--text-muted);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px">Join Requests</p>
              ${data.room.joinRequests.map(jr => `
                <div class="member-row">
                  <span class="member-name">${escapeHtml(jr.userId?.username || jr.userId)}</span>
                  <button class="btn btn-green btn-sm" onclick="ChatUI._approveJoin('${room.id}','${jr.userId?._id || jr.userId}')">✓</button>
                  <button class="btn btn-ghost btn-sm" onclick="ChatUI._rejectJoin('${room.id}','${jr.userId?._id || jr.userId}')">✕</button>
                </div>`).join('')}
            </div>` : ''}`,
        actions: [{ label: 'Close', onclick: `Modal.close('room-members-modal')`, className: 'btn-ghost' }],
      });
      Modal.open('room-members-modal');
    } catch (err) {
      Toast.error(err.message || 'Could not load members.');
    }
  },

  async _inviteMember(roomId) {
    const username = document.getElementById('invite-username')?.value?.trim();
    const errEl = document.getElementById('invite-error');
    if (!username) return;
    try {
      await LegendAPI.privateRooms.invite(roomId, username);
      Toast.success(`${username} invited!`);
      if (document.getElementById('invite-username')) document.getElementById('invite-username').value = '';
    } catch (err) {
      if (errEl) { errEl.textContent = err.message || 'Could not invite user.'; errEl.classList.remove('hidden'); }
    }
  },

  async _removeMember(roomId, userId) {
    if (!confirm('Remove this member?')) return;
    try {
      await LegendAPI.privateRooms.removeMember(roomId, userId);
      Toast.success('Member removed.');
      this.showRoomMembers();
    } catch (err) {
      Toast.error(err.message || 'Could not remove member.');
    }
  },

  async _approveJoin(roomId, userId) {
    try {
      await LegendAPI.privateRooms.approveJoin(roomId, userId);
      Toast.success('Join request approved.');
      this.showRoomMembers();
    } catch {
      Toast.error('Could not approve request.');
    }
  },

  async _rejectJoin(roomId, userId) {
    try {
      await LegendAPI.privateRooms.rejectJoin(roomId, userId);
      Toast.success('Join request rejected.');
      this.showRoomMembers();
    } catch {
      Toast.error('Could not reject request.');
    }
  },

  // ─── Room manage panel ────────────────────────────────────────
  showRoomManage() {
    const room = ChatState.currentRoom;
    if (!room) return;
    Modal.create({
      id: 'room-manage-modal',
      title: `Manage — ${room.name}`,
      body: `
        <div class="room-form">
          <div class="form-group">
            <label class="form-label">Room Name</label>
            <input class="form-input" id="rm-name" value="${escapeHtml(room.name)}" maxlength="80">
          </div>
          <div class="form-group">
            <label class="form-label">Description</label>
            <textarea class="form-input" id="rm-desc" rows="2" maxlength="500">${escapeHtml(room.description || '')}</textarea>
          </div>
          <div id="rm-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem"></div>
          ${room.myRole === 'owner' ? `
            <div style="margin-top:var(--space-md);padding-top:var(--space-md);border-top:1px solid var(--border-subtle)">
              <button class="btn btn-danger w-full" onclick="ChatUI.archiveRoom('${room.id}')">Archive Room</button>
            </div>` : ''}
        </div>`,
      actions: [
        { label: 'Cancel', onclick: `Modal.close('room-manage-modal')`, className: 'btn-ghost' },
        { label: 'Save', onclick: `ChatUI._saveRoomSettings('${room.id}')`, className: 'btn-primary' },
      ],
    });
    Modal.open('room-manage-modal');
  },

  async _saveRoomSettings(roomId) {
    const name = document.getElementById('rm-name')?.value?.trim();
    const description = document.getElementById('rm-desc')?.value?.trim();
    const errEl = document.getElementById('rm-error');
    if (!name) { if (errEl) { errEl.textContent = 'Name required.'; errEl.classList.remove('hidden'); } return; }
    try {
      const data = await LegendAPI.privateRooms.update(roomId, { name, description });
      Modal.close('room-manage-modal');
      Toast.success('Room updated.');
      ChatState.currentRoom = data.room;
      this.updateRoomHeader(data.room, 'private_room');
      this.renderPrivateRooms();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message || 'Could not update room.'; errEl.classList.remove('hidden'); }
    }
  },

  async archiveRoom(roomId) {
    if (!confirm('Archive this room? Members will no longer be able to send messages.')) return;
    try {
      await LegendAPI.privateRooms.delete(roomId, 'archive');
      Modal.close('room-manage-modal');
      Toast.success('Room archived.');
      document.getElementById('chat-room-name').textContent = 'SELECT A ROOM';
      document.getElementById('chat-messages').innerHTML = '<div class="chat-welcome"><p>Room archived.</p></div>';
      this.renderPrivateRooms();
    } catch {
      Toast.error('Could not archive room.');
    }
  },

  async leaveRoom(roomId) {
    if (!confirm('Leave this room?')) return;
    try {
      const user = LegendAPI.auth.getUser();
      await LegendAPI.privateRooms.removeMember(roomId, user.id);
      Toast.success('You left the room.');
      document.getElementById('chat-room-name').textContent = 'SELECT A ROOM';
      document.getElementById('chat-messages').innerHTML = '<div class="chat-welcome"><p>Choose a room or conversation to begin.</p></div>';
      this.renderPrivateRooms();
    } catch {
      Toast.error('Could not leave room.');
    }
  },

  // ─── Discover rooms dialog ────────────────────────────────────
  async showDiscoverRooms() {
    Modal.create({
      id: 'discover-rooms-modal',
      title: 'Discover Rooms',
      body: `
        <div style="margin-bottom:var(--space-md)">
          <input class="form-input" id="discover-q" placeholder="Search rooms…" oninput="ChatUI._searchRooms()">
        </div>
        <div id="discover-list" class="private-rooms-list">
          <div class="loading-state" style="min-height:60px"><div class="spinner"></div></div>
        </div>`,
      actions: [{ label: 'Close', onclick: `Modal.close('discover-rooms-modal')`, className: 'btn-ghost' }],
    });
    Modal.open('discover-rooms-modal');
    await this._searchRooms();
  },

  _searchRoomsTimer: null,
  _searchRooms: debounce(async function () {
    const q = document.getElementById('discover-q')?.value?.trim();
    const list = document.getElementById('discover-list');
    if (!list) return;
    try {
      const data = await LegendAPI.privateRooms.discover(q);
      if (!data.rooms?.length) {
        list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:12px">No public rooms found.</p>';
        return;
      }
      list.innerHTML = data.rooms.map(r => `
        <div class="private-room-card">
          <div class="private-room-card-icon">🏛️</div>
          <div class="private-room-card-info">
            <div class="private-room-card-name">${escapeHtml(r.name)}</div>
            <div class="private-room-card-meta">${r.memberCount} member${r.memberCount !== 1 ? 's' : ''}</div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="ChatUI._joinDiscoveredRoom('${r.id}')">Join</button>
        </div>`).join('');
    } catch {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:12px">Could not load rooms.</p>';
    }
  }, 300),

  async _joinDiscoveredRoom(roomId) {
    try {
      await LegendAPI.privateRooms.join(roomId);
      Modal.close('discover-rooms-modal');
      Toast.success('Joined room!');
      await this.renderPrivateRooms();
      await window.joinPrivateRoom(roomId);
      this.switchTab('private');
    } catch (err) {
      Toast.error(err.message || 'Could not join room.');
    }
  },

  // ─── Typing indicator ─────────────────────────────────────────
  updateTyping() {
    const el = document.getElementById('chat-typing');
    if (!el) return;
    const users = Object.values(ChatState.typingUsers);
    if (!users.length) { el.textContent = ''; return; }
    el.textContent = users.length === 1
      ? `${escapeHtml(users[0])} is typing…`
      : `${users.length} people are typing…`;
  },

  // ─── Scroll ───────────────────────────────────────────────────
  scrollBottom() {
    const area = document.getElementById('chat-messages');
    if (area) area.scrollTop = area.scrollHeight;
  },
};

// ─── Global entry points (called from HTML onclick) ──────────────
window.joinPublicRoom = (roomId) => ChatState.joinPublicRoom(roomId);
window.joinPrivateRoom = (roomId) => ChatState.joinPrivateRoom(roomId);

// Legacy compatibility (used by existing onclick="joinRoom(id)")
window.joinRoom = window.joinPublicRoom;

// Legacy send (no-op redirect)
window.sendChatMessage = () => ChatState.send();
window.sendTypingIndicator = (isTyping = true) => {
  if (isTyping) ChatState._sendTyping();
  else ChatState._stopTyping();
};
window.deleteChatMessage = (id) => ChatUI.deleteMsg(id);
