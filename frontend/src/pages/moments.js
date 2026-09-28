/**
 * AVENORA — Moments
 * Temporary 24-hour posts: photos, short videos, text, quotes, updates.
 * Displayed as glowing cosmic orbs, not Instagram-style circles.
 */

registerPage('moments', {
  _unsub: null,

  async render(container) {
    const user = LegendAPI.auth.getUser();

    container.innerHTML = `
      <div class="moments-page">
        <div class="moments-header">
          <div>
            <h1 class="moments-title">MOMENTS</h1>
            <p class="univ-page-tag">AVENORA · YOUR DIGITAL UNIVERSE</p>
          </div>
          ${user ? `
            <button class="btn btn-primary btn-sm" onclick="MomentsPage.openCreate()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New Moment
            </button>
          ` : ''}
        </div>

        <!-- Orbs bar -->
        <div class="moments-orbs-bar">
          <div class="moments-orbs-row" id="moments-orbs-row">
            <div class="loading-state" style="min-height:80px"><div class="spinner"></div></div>
          </div>
        </div>

        <!-- Moments feed -->
        <div class="moments-feed" id="moments-feed">
          <div class="loading-state"><div class="spinner spinner-lg"></div><span>Loading Moments…</span></div>
        </div>
      </div>

      <!-- Create Moment modal -->
      <div id="moments-create-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="moments-create-title">
        <div class="modal" style="max-width:500px">
          <div class="modal-header">
            <h3 id="moments-create-title" style="margin:0;font-family:var(--font-display);letter-spacing:0.12em;font-size:0.95rem">NEW MOMENT</h3>
            <button class="btn btn-ghost btn-sm" onclick="Modal.close('moments-create-modal')" aria-label="Close">✕</button>
          </div>
          <div class="modal-body">
            <div style="margin-bottom:var(--space-md)">
              <div class="tabs" style="margin:0 0 var(--space-md)">
                ${['text','photo','quote','update'].map((t,i) =>
                  `<button class="tab-btn ${i===0?'active':''}" onclick="MomentsPage.setType('${t}',this)" data-type="${t}">${t.toUpperCase()}</button>`
                ).join('')}
              </div>
            </div>

            <div id="moment-type-text">
              <div class="form-group">
                <textarea class="form-input" id="moment-text-input" placeholder="Share a moment with your universe…" rows="4" maxlength="500" style="resize:vertical"></textarea>
                <small style="color:var(--text-muted);font-size:0.75rem">Max 500 characters</small>
              </div>
            </div>

            <div id="moment-type-photo" style="display:none">
              <div style="border:2px dashed var(--univ-border);border-radius:var(--radius-md);padding:var(--space-xl);text-align:center;cursor:pointer"
                   onclick="document.getElementById('moment-photo-input').click()">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--univ-text-muted)" stroke-width="1.5" style="margin:0 auto var(--space-sm);display:block"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <p style="color:var(--text-muted);font-size:0.85rem">Click to select a photo</p>
                <input type="file" id="moment-photo-input" accept="image/*" style="display:none" onchange="MomentsPage.photoSelected(this)">
              </div>
              <div id="moment-photo-preview" style="margin-top:var(--space-md)"></div>
              <div class="form-group" style="margin-top:var(--space-md)">
                <textarea class="form-input" id="moment-photo-caption" placeholder="Add a caption…" rows="2" maxlength="280"></textarea>
              </div>
            </div>

            <div id="moment-type-quote" style="display:none">
              <div class="form-group">
                <textarea class="form-input" id="moment-quote-text" placeholder="Share a quote or thought…" rows="3" maxlength="280"></textarea>
              </div>
              <div class="form-group">
                <input class="form-input" type="text" id="moment-quote-attr" placeholder="— Attribution (optional)" maxlength="100">
              </div>
            </div>

            <div id="moment-type-update" style="display:none">
              <div class="form-group">
                <textarea class="form-input" id="moment-update-text" placeholder="What's your update?" rows="3" maxlength="500"></textarea>
              </div>
            </div>

            <div id="moments-create-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem;margin-bottom:var(--space-sm)"></div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="Modal.close('moments-create-modal')">Cancel</button>
            <button class="btn btn-primary" id="moment-submit-btn" onclick="MomentsPage.submit()">Share Moment</button>
          </div>
        </div>
      </div>

      <!-- View Moment modal -->
      <div id="moments-view-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="moments-view-title">
        <div class="modal" style="max-width:500px">
          <div class="modal-header">
            <h3 id="moments-view-title" style="margin:0;font-family:var(--font-display);letter-spacing:0.12em;font-size:0.9rem">MOMENT</h3>
            <button class="btn btn-ghost btn-sm" onclick="Modal.close('moments-view-modal')" aria-label="Close">✕</button>
          </div>
          <div class="modal-body" id="moments-view-body">
          </div>
        </div>
      </div>
    `;

    await MomentsPage.loadOrbs();
    await MomentsPage.loadFeed();

    return () => {
      if (typeof this._unsub === 'function') this._unsub();
    };
  }
});

const MomentsPage = {
  _currentType: 'text',
  _moments: [],
  _photoFile: null,

  setType(type, btn) {
    this._currentType = type;
    document.querySelectorAll('#moments-create-modal .tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    ['text','photo','quote','update'].forEach(t => {
      const el = document.getElementById(`moment-type-${t}`);
      if (el) el.style.display = (t === type) ? '' : 'none';
    });
  },

  openCreate() {
    const user = LegendAPI.auth.getUser();
    if (!user) {
      Toast.info('Join AVENORA to interact with this universe.');
      Modal.open('auth-modal');
      return;
    }
    Modal.open('moments-create-modal');
  },

  photoSelected(input) {
    const file = input.files[0];
    if (!file) return;
    this._photoFile = file;
    const url = URL.createObjectURL(file);
    const preview = document.getElementById('moment-photo-preview');
    if (preview) {
      preview.innerHTML = `<img src="${url}" style="width:100%;border-radius:var(--radius-md);max-height:260px;object-fit:cover" alt="Preview">`;
    }
  },

  async submit() {
    const user = LegendAPI.auth.getUser();
    if (!user) return;

    const btn = document.getElementById('moment-submit-btn');
    const errEl = document.getElementById('moments-create-error');
    if (btn) { btn.disabled = true; btn.textContent = 'Sharing…'; }
    if (errEl) errEl.classList.add('hidden');

    try {
      let content = '';
      let mediaUrl = null;
      let extra = {};

      if (this._currentType === 'text') {
        content = (document.getElementById('moment-text-input')?.value || '').trim();
        if (!content) throw new Error('Please write something.');
      } else if (this._currentType === 'photo') {
        content = (document.getElementById('moment-photo-caption')?.value || '').trim();
        if (!this._photoFile) throw new Error('Please select a photo.');
        // Upload via Supabase storage if available
        try {
          const uploaded = await AvenoraFirebase.Storage.upload(this._photoFile, `moments/${user.uid}/${Date.now()}_${this._photoFile.name}`);
          mediaUrl = uploaded.url;
        } catch {
          throw new Error('Photo upload failed. Try again.');
        }
      } else if (this._currentType === 'quote') {
        content = (document.getElementById('moment-quote-text')?.value || '').trim();
        const attr = (document.getElementById('moment-quote-attr')?.value || '').trim();
        if (!content) throw new Error('Please enter a quote.');
        extra = { attribution: attr };
      } else if (this._currentType === 'update') {
        content = (document.getElementById('moment-update-text')?.value || '').trim();
        if (!content) throw new Error('Please write your update.');
      }

      // Write to Firestore
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) throw new Error('Firebase not available.');
      const db = await getFirestore();
      const { collection, addDoc, serverTimestamp } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await addDoc(collection(db, 'moments'), {
        uid: user.uid || user.id,
        username: user.username,
        displayName: user.profile?.displayName || user.username,
        avatarUrl: user.profile?.avatarUrl || null,
        type: this._currentType,
        content: content || '',
        mediaUrl: mediaUrl || null,
        extra,
        createdAt: serverTimestamp(),
        expiresAt,
        reactions: {},
        replyCount: 0,
      });

      Toast.success('Moment shared!');
      Modal.close('moments-create-modal');
      this._photoFile = null;
      // Reset form
      ['moment-text-input','moment-photo-caption','moment-quote-text','moment-quote-attr','moment-update-text'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      document.getElementById('moment-photo-preview') && (document.getElementById('moment-photo-preview').innerHTML = '');
      await this.loadOrbs();
      await this.loadFeed();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Share Moment'; }
    }
  },

  async loadOrbs() {
    const orbsRow = document.getElementById('moments-orbs-row');
    if (!orbsRow) return;
    const user = LegendAPI.auth.getUser();

    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) { orbsRow.innerHTML = ''; return; }
      const db = await getFirestore();
      const { collection, query, where, orderBy, limit, getDocs } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      const now = new Date();
      const q = query(
        collection(db, 'moments'),
        where('expiresAt', '>', now),
        orderBy('expiresAt', 'desc'),
        limit(20)
      );
      const snap = await getDocs(q);
      // Deduplicate by uid for orbs
      const seen = new Set();
      const orbs = [];
      snap.forEach(doc => {
        const d = { id: doc.id, ...doc.data() };
        if (!seen.has(d.uid)) {
          seen.add(d.uid);
          orbs.push(d);
        }
      });

      let html = user
        ? `<div class="moment-orb moment-orb-add" onclick="MomentsPage.openCreate()" title="Add moment">
             <div class="moment-orb-ring">
               <div class="moment-orb-inner">+</div>
             </div>
             <span class="moment-orb-name">Your Moment</span>
           </div>`
        : '';

      if (orbs.length === 0 && !user) {
        orbsRow.innerHTML = `<p style="color:var(--univ-text-muted);font-size:0.82rem;padding:var(--space-md) 0">No active moments.</p>`;
        return;
      }

      orbs.forEach(m => {
        const initial = (m.displayName || m.username || '?')[0].toUpperCase();
        const avatarStyle = m.avatarUrl
          ? `background-image:url(${escapeHtml(m.avatarUrl)});background-size:cover;background-position:center`
          : '';
        html += `
          <div class="moment-orb" onclick="MomentsPage.viewMoment('${escapeHtml(m.id)}')" title="${escapeHtml(m.displayName||m.username)}'s moment">
            <div class="moment-orb-ring">
              <div class="moment-orb-inner" style="${avatarStyle}">${avatarStyle ? '' : escapeHtml(initial)}</div>
            </div>
            <span class="moment-orb-name">${escapeHtml(m.displayName || m.username)}</span>
          </div>`;
      });

      orbsRow.innerHTML = html;
    } catch {
      orbsRow.innerHTML = user
        ? `<div class="moment-orb moment-orb-add" onclick="MomentsPage.openCreate()" title="Add moment">
             <div class="moment-orb-ring"><div class="moment-orb-inner">+</div></div>
             <span class="moment-orb-name">Your Moment</span>
           </div>`
        : '';
    }
  },

  async loadFeed() {
    const feed = document.getElementById('moments-feed');
    if (!feed) return;

    feed.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;

    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) {
        feed.innerHTML = `<div class="error-state" style="min-height:200px"><p>Firebase not available.</p></div>`;
        return;
      }
      const db = await getFirestore();
      const { collection, query, where, orderBy, limit, getDocs } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      const now = new Date();
      const q = query(
        collection(db, 'moments'),
        where('expiresAt', '>', now),
        orderBy('expiresAt', 'desc'),
        limit(30)
      );
      const snap = await getDocs(q);
      this._moments = [];
      snap.forEach(doc => this._moments.push({ id: doc.id, ...doc.data() }));

      if (this._moments.length === 0) {
        feed.innerHTML = `
          <div class="error-state" style="min-height:200px">
            <div class="error-icon" style="font-size:2rem">✨</div>
            <h3>No Active Moments</h3>
            <p>Be the first to share a moment in the universe.</p>
          </div>`;
        return;
      }

      feed.innerHTML = this._moments.map(m => this._renderMomentCard(m)).join('');
    } catch (err) {
      feed.innerHTML = `<div class="error-state" style="min-height:200px"><p>Could not load moments. ${escapeHtml(err.message)}</p></div>`;
    }
  },

  _renderMomentCard(m) {
    const user = LegendAPI.auth.getUser();
    const isOwn = user && (user.uid || user.id) === m.uid;
    const initial = (m.displayName || m.username || '?')[0].toUpperCase();
    const avatarStyle = m.avatarUrl
      ? `background-image:url(${escapeHtml(m.avatarUrl)});background-size:cover;background-position:center`
      : '';
    const expDate = m.expiresAt?.toDate ? m.expiresAt.toDate() : (m.expiresAt?.seconds ? new Date(m.expiresAt.seconds * 1000) : null);
    const expStr = expDate ? `Expires ${formatTimeAgo(expDate)}` : '24h moment';

    let body = '';
    if (m.type === 'photo' && m.mediaUrl) {
      body = `<img src="${escapeHtml(m.mediaUrl)}" class="moment-card__image" alt="Moment photo" loading="lazy">
              ${m.content ? `<p class="moment-card__text" style="padding-top:var(--space-sm)">${escapeHtml(m.content)}</p>` : ''}`;
    } else if (m.type === 'quote') {
      const attr = m.extra?.attribution;
      body = `<blockquote style="border-left:3px solid var(--univ-blue-electric);padding-left:var(--space-md);margin:0">
                <p class="moment-card__text" style="font-style:italic">"${escapeHtml(m.content)}"</p>
                ${attr ? `<footer style="font-size:0.78rem;color:var(--univ-text-muted);margin-top:4px">${escapeHtml(attr)}</footer>` : ''}
              </blockquote>`;
    } else {
      body = m.content ? `<p class="moment-card__text">${escapeHtml(m.content)}</p>` : '';
    }

    return `
      <div class="moment-card" data-id="${escapeHtml(m.id)}">
        <div class="moment-card__author">
          <div style="width:36px;height:36px;border-radius:50%;background:var(--univ-card);border:1px solid var(--univ-border);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;${avatarStyle}">${avatarStyle?'':escapeHtml(initial)}</div>
          <div style="flex:1;min-width:0">
            <span style="font-size:0.85rem;font-weight:600;color:var(--univ-text)">${escapeHtml(m.displayName||m.username)}</span>
            <span style="font-size:0.72rem;color:var(--univ-text-muted);margin-left:6px">@${escapeHtml(m.username)}</span>
          </div>
          <span style="font-size:0.62rem;letter-spacing:0.1em;padding:2px 8px;border-radius:var(--radius-full);background:rgba(0,102,255,0.10);color:var(--univ-blue-electric);border:1px solid var(--univ-border);text-transform:uppercase">${escapeHtml(m.type||'text')}</span>
        </div>
        <div class="moment-card__body">${body}</div>
        <div class="moment-card__actions">
          <button class="btn btn-ghost btn-sm" onclick="MomentsPage.react('${escapeHtml(m.id)}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            React
          </button>
          <button class="btn btn-ghost btn-sm" onclick="MomentsPage.viewMoment('${escapeHtml(m.id)}')">Reply</button>
          <span style="margin-left:auto;font-size:0.7rem;color:var(--univ-text-muted)">${escapeHtml(expStr)}</span>
          ${isOwn ? `<button class="btn btn-ghost btn-sm" style="color:var(--neon-red)" onclick="MomentsPage.deleteMoment('${escapeHtml(m.id)}')">Delete</button>` : ''}
        </div>
      </div>`;
  },

  async viewMoment(id) {
    const m = this._moments.find(x => x.id === id);
    if (!m) return;
    const body = document.getElementById('moments-view-body');
    if (!body) return;
    body.innerHTML = this._renderMomentCard(m);
    Modal.open('moments-view-modal');
  },

  async react(id) {
    const user = LegendAPI.auth.getUser();
    if (!user) { Toast.info('Join AVENORA to react.'); Modal.open('auth-modal'); return; }
    Toast.success('Reaction sent!');
  },

  async deleteMoment(id) {
    const user = LegendAPI.auth.getUser();
    if (!user) return;
    if (!confirm('Delete this moment?')) return;
    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) return;
      const db = await getFirestore();
      const { doc, deleteDoc } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      await deleteDoc(doc(db, 'moments', id));
      Toast.success('Moment deleted.');
      await this.loadOrbs();
      await this.loadFeed();
    } catch (err) {
      Toast.error('Could not delete moment.');
    }
  },
};

window.MomentsPage = MomentsPage;
