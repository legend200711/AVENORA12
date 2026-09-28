/**
 * AVENORA — Collections
 * Users can save content into named private collections.
 * Saved content references are stored in Firestore — originals are NOT duplicated.
 */

registerPage('collections', {
  async render(container) {
    const user = LegendAPI.auth.getUser();

    if (!user) {
      container.innerHTML = `
        <div class="collections-page" style="padding:var(--space-lg)">
          <div class="univ-page-header">
            <h1 class="univ-page-title">COLLECTIONS</h1>
            <p class="univ-page-tag">YOUR SAVED CONTENT</p>
          </div>
          <div style="text-align:center;padding:var(--space-2xl) var(--space-lg)">
            <div style="font-size:2.5rem;margin-bottom:var(--space-md)">🔖</div>
            <h3 style="margin-bottom:8px">Sign In to Access Collections</h3>
            <p style="color:var(--text-muted);margin-bottom:var(--space-lg)">Join AVENORA to save content to your collections.</p>
            <button class="btn btn-primary" onclick="Modal.open('auth-modal')">Join AVENORA</button>
          </div>
        </div>`;
      return () => {};
    }

    container.innerHTML = `
      <div class="collections-page">
        <div class="univ-page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-md);padding:var(--space-xl) var(--space-lg) var(--space-md)">
          <div>
            <h1 class="univ-page-title">COLLECTIONS</h1>
            <p class="univ-page-tag">YOUR SAVED CONTENT</p>
          </div>
          <button class="btn btn-primary btn-sm" onclick="CollectionsPage.openCreate()">+ New Collection</button>
        </div>

        <div class="collections-grid" id="collections-grid">
          <div class="loading-state" style="grid-column:1/-1;min-height:200px"><div class="spinner spinner-lg"></div></div>
        </div>

        <!-- Collection items view -->
        <div id="collection-items-view" style="display:none;padding:0 var(--space-lg) var(--space-2xl)">
          <div style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-lg)">
            <button class="btn btn-ghost btn-sm" onclick="CollectionsPage.showGrid()">← Collections</button>
            <h3 id="collection-items-title" style="margin:0;font-family:var(--font-display);letter-spacing:0.1em;font-size:0.95rem"></h3>
          </div>
          <div id="collection-items-list">
            <div class="loading-state"><div class="spinner"></div></div>
          </div>
        </div>
      </div>

      <!-- Create Collection Modal -->
      <div id="collections-create-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="collections-create-title">
        <div class="modal" style="max-width:420px">
          <div class="modal-header">
            <h3 id="collections-create-title" style="margin:0;font-family:var(--font-display);letter-spacing:0.12em;font-size:0.95rem">NEW COLLECTION</h3>
            <button class="btn btn-ghost btn-sm" onclick="Modal.close('collections-create-modal')" aria-label="Close">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Collection Name</label>
              <input class="form-input" type="text" id="coll-create-name" placeholder="e.g. Favorites, Inspiration, Watch Later" maxlength="60" required>
            </div>
            <div class="form-group">
              <label class="form-label">Icon (emoji, optional)</label>
              <input class="form-input" type="text" id="coll-create-icon" placeholder="⭐" maxlength="4" style="max-width:80px">
            </div>
            <div id="coll-create-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem"></div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="Modal.close('collections-create-modal')">Cancel</button>
            <button class="btn btn-primary" id="coll-create-btn" onclick="CollectionsPage.createCollection()">Create</button>
          </div>
        </div>
      </div>
    `;

    await CollectionsPage.loadCollections();
    return () => {};
  }
});

const CollectionsPage = {
  _collections: [],
  _activeCollection: null,

  _defaultCollections(uid) {
    return [
      { id: `fav_${uid}`, name: 'Favorites', icon: '⭐', itemCount: 0, isDefault: true },
      { id: `insp_${uid}`, name: 'Inspiration', icon: '💡', itemCount: 0, isDefault: true },
      { id: `later_${uid}`, name: 'Watch Later', icon: '⏰', itemCount: 0, isDefault: true },
      { id: `proj_${uid}`, name: 'Projects', icon: '🗂️', itemCount: 0, isDefault: true },
    ];
  },

  openCreate() {
    Modal.open('collections-create-modal');
  },

  showGrid() {
    document.getElementById('collection-items-view').style.display = 'none';
    document.getElementById('collections-grid').style.display = '';
  },

  async loadCollections() {
    const grid = document.getElementById('collections-grid');
    if (!grid) return;
    const user = LegendAPI.auth.getUser();
    if (!user) return;

    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) {
        this._collections = this._defaultCollections(user.uid || user.id);
        grid.innerHTML = this._renderGrid();
        return;
      }
      const db = await getFirestore();
      const { collection, query, where, orderBy, getDocs } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      const q = query(
        collection(db, 'collections'),
        where('uid', '==', user.uid || user.id),
        orderBy('createdAt', 'asc')
      );
      const snap = await getDocs(q);
      const fromFirestore = [];
      snap.forEach(doc => fromFirestore.push({ id: doc.id, ...doc.data() }));
      this._collections = fromFirestore.length ? fromFirestore : this._defaultCollections(user.uid || user.id);
      grid.innerHTML = this._renderGrid();
    } catch {
      const user2 = LegendAPI.auth.getUser();
      this._collections = this._defaultCollections(user2?.uid || user2?.id || 'guest');
      grid.innerHTML = this._renderGrid();
    }
  },

  _renderGrid() {
    if (this._collections.length === 0) {
      return `<div style="grid-column:1/-1;padding:var(--space-2xl);text-align:center">
        <p style="color:var(--text-muted)">No collections yet.</p></div>`;
    }
    return this._collections.map(c => `
      <div class="collection-card" onclick="CollectionsPage.openCollection('${escapeHtml(c.id)}')" role="button" tabindex="0"
           onkeydown="if(event.key==='Enter')CollectionsPage.openCollection('${escapeHtml(c.id)}')"
           aria-label="${escapeHtml(c.name)}">
        <div class="collection-card__icon">${c.icon || '🗂️'}</div>
        <h3 class="collection-card__name">${escapeHtml(c.name)}</h3>
        <p class="collection-card__count">${c.itemCount || 0} saved item${(c.itemCount||0) !== 1 ? 's' : ''}</p>
      </div>`).join('');
  },

  async openCollection(id) {
    const coll = this._collections.find(c => c.id === id);
    if (!coll) return;
    this._activeCollection = coll;

    document.getElementById('collections-grid').style.display = 'none';
    const view = document.getElementById('collection-items-view');
    const title = document.getElementById('collection-items-title');
    const list = document.getElementById('collection-items-list');
    if (!view || !title || !list) return;
    title.textContent = `${coll.icon || '🗂️'} ${coll.name.toUpperCase()}`;
    view.style.display = '';

    list.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;

    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) { list.innerHTML = '<p style="color:var(--text-muted)">Items unavailable.</p>'; return; }
      const user = LegendAPI.auth.getUser();
      const db = await getFirestore();
      const { collection, query, where, orderBy, getDocs } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      const q = query(
        collection(db, 'collectionItems'),
        where('collectionId', '==', id),
        where('uid', '==', user?.uid || user?.id || ''),
        orderBy('savedAt', 'desc')
      );
      const snap = await getDocs(q);
      const items = [];
      snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));

      if (items.length === 0) {
        list.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:var(--space-xl) 0">This collection is empty.<br>Save content from the feed, gallery, or videos to add items here.</p>`;
        return;
      }
      list.innerHTML = items.map(item => `
        <div style="display:flex;align-items:flex-start;gap:var(--space-md);padding:var(--space-md) 0;border-bottom:1px solid var(--univ-border)">
          ${item.thumbnailUrl ? `<img src="${escapeHtml(item.thumbnailUrl)}" style="width:60px;height:60px;object-fit:cover;border-radius:var(--radius-sm);flex-shrink:0" alt="${escapeHtml(item.title||'')}">` : `<div style="width:60px;height:60px;background:var(--univ-card);border:1px solid var(--univ-border);border-radius:var(--radius-sm);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.5rem">${item.typeIcon||'📄'}</div>`}
          <div style="flex:1;min-width:0">
            <p style="font-size:0.88rem;font-weight:600;color:var(--univ-text);margin:0 0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.title||'Saved item')}</p>
            <p style="font-size:0.75rem;color:var(--text-muted);margin:0">${escapeHtml(item.type||'')} · ${formatTimeAgo(item.savedAt)}</p>
          </div>
          <button class="btn btn-ghost btn-sm" style="color:var(--neon-red);flex-shrink:0" onclick="CollectionsPage.removeItem('${escapeHtml(item.id)}','${escapeHtml(id)}')">Remove</button>
        </div>`).join('');
    } catch {
      list.innerHTML = '<p style="color:var(--text-muted)">Could not load items.</p>';
    }
  },

  async removeItem(itemId, collId) {
    if (!confirm('Remove from collection?')) return;
    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) return;
      const db = await getFirestore();
      const { doc, deleteDoc } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      await deleteDoc(doc(db, 'collectionItems', itemId));
      Toast.success('Removed from collection.');
      await this.openCollection(collId);
    } catch {
      Toast.error('Could not remove item.');
    }
  },

  /**
   * Save any content item to a user's collection.
   * Called from feed, gallery, video pages: CollectionsPage.saveItem(item, collectionId)
   */
  async saveItem(item, collectionId) {
    const user = LegendAPI.auth.getUser();
    if (!user) { Toast.info('Join AVENORA to save items.'); Modal.open('auth-modal'); return; }
    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) { Toast.error('Firebase not available.'); return; }
      const db = await getFirestore();
      const { collection, addDoc, serverTimestamp } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      await addDoc(collection(db, 'collectionItems'), {
        collectionId,
        uid: user.uid || user.id,
        type: item.type || 'content',
        typeIcon: item.typeIcon || '📄',
        title: item.title || 'Saved item',
        thumbnailUrl: item.thumbnailUrl || null,
        sourceId: item.id || null,
        sourcePage: item.sourcePage || null,
        savedAt: serverTimestamp(),
      });
      Toast.success(`Saved to collection!`);
    } catch {
      Toast.error('Could not save item.');
    }
  },

  async createCollection() {
    const user = LegendAPI.auth.getUser();
    if (!user) return;
    const name = document.getElementById('coll-create-name')?.value?.trim();
    const icon = document.getElementById('coll-create-icon')?.value?.trim() || '🗂️';
    const errEl = document.getElementById('coll-create-error');
    const btn = document.getElementById('coll-create-btn');
    if (!name) { if (errEl) { errEl.textContent = 'Name required.'; errEl.classList.remove('hidden'); } return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
    if (errEl) errEl.classList.add('hidden');
    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) throw new Error('Firebase unavailable.');
      const db = await getFirestore();
      const { collection, addDoc, serverTimestamp } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      await addDoc(collection(db, 'collections'), {
        uid: user.uid || user.id,
        name, icon, itemCount: 0,
        createdAt: serverTimestamp(),
      });
      Toast.success('Collection created!');
      Modal.close('collections-create-modal');
      document.getElementById('coll-create-name') && (document.getElementById('coll-create-name').value = '');
      await this.loadCollections();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Create'; }
    }
  },
};

window.CollectionsPage = CollectionsPage;
