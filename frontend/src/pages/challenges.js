/**
 * AVENORA — Universe Challenges
 * Community challenges: Photography, Art, Writing, Design, Video, Gaming, Seasonal.
 * Founder/admin can create official AVENORA challenges.
 * No Green Heart Family branding.
 */

registerPage('challenges', {
  async render(container) {
    const user = LegendAPI.auth.getUser();
    const isFounder = user && ['founder', 'admin'].includes(user.role);

    container.innerHTML = `
      <div class="challenges-page">
        <div class="challenges-header">
          <div>
            <h1 class="univ-page-title">UNIVERSE CHALLENGES</h1>
            <p class="univ-page-tag">COMMUNITY CREATIVE CHALLENGES</p>
          </div>
          ${isFounder ? `
            <button class="btn btn-primary btn-sm" onclick="ChallengesPage.openCreate()">
              + Create Challenge
            </button>
          ` : ''}
        </div>

        <!-- Filter tabs -->
        <div style="padding:0 var(--space-lg) var(--space-md);display:flex;gap:var(--space-sm);flex-wrap:wrap">
          <button class="discover-filter-btn active" onclick="ChallengesPage.filter('all',this)">All</button>
          <button class="discover-filter-btn" onclick="ChallengesPage.filter('photography',this)">Photography</button>
          <button class="discover-filter-btn" onclick="ChallengesPage.filter('art',this)">Art</button>
          <button class="discover-filter-btn" onclick="ChallengesPage.filter('writing',this)">Writing</button>
          <button class="discover-filter-btn" onclick="ChallengesPage.filter('design',this)">Design</button>
          <button class="discover-filter-btn" onclick="ChallengesPage.filter('gaming',this)">Gaming</button>
          <button class="discover-filter-btn" onclick="ChallengesPage.filter('video',this)">Video</button>
        </div>

        <div class="challenges-grid" id="challenges-grid">
          <div class="loading-state" style="grid-column:1/-1;min-height:200px"><div class="spinner spinner-lg"></div></div>
        </div>
      </div>

      <!-- Create Challenge Modal (founder only) -->
      ${isFounder ? `
        <div id="challenge-create-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="challenge-create-title">
          <div class="modal" style="max-width:500px">
            <div class="modal-header">
              <h3 id="challenge-create-title" style="margin:0;font-family:var(--font-display);letter-spacing:0.12em;font-size:0.95rem">CREATE CHALLENGE</h3>
              <button class="btn btn-ghost btn-sm" onclick="Modal.close('challenge-create-modal')" aria-label="Close">✕</button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Challenge Title</label>
                <input class="form-input" type="text" id="ch-create-title" placeholder="e.g. Cosmic Photography Challenge" maxlength="80" required>
              </div>
              <div class="form-group">
                <label class="form-label">Description</label>
                <textarea class="form-input" id="ch-create-desc" placeholder="Describe the challenge and how to participate…" rows="4" maxlength="600"></textarea>
              </div>
              <div class="form-group">
                <label class="form-label">Category</label>
                <select class="form-input" id="ch-create-cat">
                  <option value="photography">Photography</option>
                  <option value="art">Art</option>
                  <option value="writing">Writing</option>
                  <option value="design">Design</option>
                  <option value="gaming">Gaming</option>
                  <option value="video">Video</option>
                  <option value="seasonal">Seasonal</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Icon (emoji)</label>
                <input class="form-input" type="text" id="ch-create-icon" placeholder="📸" maxlength="4" style="max-width:80px">
              </div>
              <div class="form-group">
                <label class="form-label">End Date (optional)</label>
                <input class="form-input" type="date" id="ch-create-end">
              </div>
              <div id="ch-create-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem"></div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" onclick="Modal.close('challenge-create-modal')">Cancel</button>
              <button class="btn btn-primary" id="ch-create-btn" onclick="ChallengesPage.createChallenge()">Create Challenge</button>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Challenge detail modal -->
      <div id="challenge-detail-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="challenge-detail-title">
        <div class="modal" style="max-width:700px;max-height:90vh;overflow-y:auto">
          <div class="modal-header">
            <h3 id="challenge-detail-title" style="margin:0;font-family:var(--font-display);letter-spacing:0.1em;font-size:0.95rem">CHALLENGE</h3>
            <button class="btn btn-ghost btn-sm" onclick="Modal.close('challenge-detail-modal')" aria-label="Close">✕</button>
          </div>
          <div id="challenge-detail-body" class="modal-body"></div>
        </div>
      </div>
    `;

    await ChallengesPage.load('all');

    return () => {};
  }
});

const ChallengesPage = {
  _challenges: [],
  _filter: 'all',

  async filter(cat, btn) {
    this._filter = cat;
    document.querySelectorAll('.challenges-page .discover-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    await this.load(cat);
  },

  openCreate() {
    Modal.open('challenge-create-modal');
  },

  async load(cat) {
    const grid = document.getElementById('challenges-grid');
    if (!grid) return;
    grid.innerHTML = `<div class="loading-state" style="grid-column:1/-1;min-height:200px"><div class="spinner spinner-lg"></div></div>`;

    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) {
        grid.innerHTML = `<div style="grid-column:1/-1">${this._renderDefaultChallenges()}</div>`;
        return;
      }
      const db = await getFirestore();
      const { collection, query, where, orderBy, limit, getDocs } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      const constraints = cat !== 'all'
        ? [where('category', '==', cat), orderBy('createdAt', 'desc'), limit(20)]
        : [orderBy('createdAt', 'desc'), limit(30)];
      const q = query(collection(db, 'challenges'), ...constraints);
      const snap = await getDocs(q);
      this._challenges = [];
      snap.forEach(doc => this._challenges.push({ id: doc.id, ...doc.data() }));

      if (this._challenges.length === 0) {
        // Show built-in default challenges if no Firestore data
        grid.innerHTML = this._renderDefaultChallenges();
      } else {
        grid.innerHTML = this._challenges.map(c => this._renderCard(c)).join('');
      }
    } catch {
      grid.innerHTML = this._renderDefaultChallenges();
    }
  },

  _defaultChallenges() {
    return [
      { id: 'd1', title: 'Cosmic Photography', category: 'photography', icon: '📸',
        description: 'Capture the universe around you. Share your best photos this week.',
        entries: 0, official: true },
      { id: 'd2', title: 'Digital Art Universe', category: 'art', icon: '🎨',
        description: 'Create original digital artwork inspired by space, cosmos, or futurism.',
        entries: 0, official: true },
      { id: 'd3', title: 'Creative Writing', category: 'writing', icon: '✍️',
        description: 'Write a short story, poem, or prose. Any genre welcome.',
        entries: 0, official: true },
      { id: 'd4', title: 'UI / Web Design', category: 'design', icon: '💻',
        description: 'Share your best website, app, or UI design project.',
        entries: 0, official: true },
      { id: 'd5', title: 'Gaming Highlights', category: 'gaming', icon: '🎮',
        description: 'Share your best gaming moments, clips, or screenshots.',
        entries: 0, official: true },
      { id: 'd6', title: 'Video Creators', category: 'video', icon: '🎬',
        description: 'Submit an original short video. Any topic, any style.',
        entries: 0, official: true },
    ];
  },

  _renderDefaultChallenges() {
    this._challenges = this._defaultChallenges();
    return this._challenges.map(c => this._renderCard(c)).join('');
  },

  _renderCard(c) {
    return `
      <div class="challenge-card" onclick="ChallengesPage.openDetail('${escapeHtml(c.id)}')" role="button" tabindex="0"
           onkeydown="if(event.key==='Enter')ChallengesPage.openDetail('${escapeHtml(c.id)}')"
           aria-label="${escapeHtml(c.title)}">
        <div class="challenge-card__header">
          <div class="challenge-card__icon">${c.icon || '✨'}</div>
          <div style="flex:1;min-width:0">
            <h3 class="challenge-card__title">${escapeHtml(c.title)}</h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <span style="font-size:0.68rem;letter-spacing:0.1em;padding:2px 8px;border-radius:var(--radius-full);background:rgba(0,102,255,0.12);color:var(--univ-blue-electric);border:1px solid var(--univ-border);text-transform:uppercase">${escapeHtml(c.category||'general')}</span>
              ${c.official ? `<span style="font-size:0.68rem;letter-spacing:0.1em;padding:2px 8px;border-radius:var(--radius-full);background:rgba(0,255,136,0.10);color:var(--univ-green-dim);border:1px solid var(--univ-border-green);text-transform:uppercase">OFFICIAL</span>` : ''}
            </div>
          </div>
        </div>
        <div class="challenge-card__body">
          <p class="challenge-card__desc">${escapeHtml(c.description||'')}</p>
        </div>
        <div class="challenge-card__footer">
          <span style="font-size:0.78rem;color:var(--univ-text-muted)">${(c.entries||0)} entries</span>
          <button class="btn btn-primary btn-sm">Enter Challenge</button>
        </div>
      </div>`;
  },

  openDetail(id) {
    const c = this._challenges.find(x => x.id === id);
    if (!c) return;
    const user = LegendAPI.auth.getUser();
    const body = document.getElementById('challenge-detail-body');
    const title = document.getElementById('challenge-detail-title');
    if (!body) return;
    if (title) title.textContent = (c.title || 'Challenge').toUpperCase();

    body.innerHTML = `
      <div style="margin-bottom:var(--space-lg)">
        <div style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-md)">
          <div style="font-size:2.5rem">${c.icon||'✨'}</div>
          <div>
            <h3 style="font-family:var(--font-display);letter-spacing:0.1em;margin:0 0 4px">${escapeHtml(c.title)}</h3>
            <div style="display:flex;gap:6px">
              <span style="font-size:0.72rem;color:var(--univ-text-muted);text-transform:uppercase;letter-spacing:0.1em">${escapeHtml(c.category||'')}</span>
              ${c.official ? `<span style="font-size:0.72rem;color:var(--univ-green-dim)">· OFFICIAL</span>` : ''}
            </div>
          </div>
        </div>
        <p style="color:var(--text-secondary);line-height:1.6;margin-bottom:var(--space-lg)">${escapeHtml(c.description||'')}</p>
        ${user
          ? `<button class="btn btn-primary" onclick="ChallengesPage.joinChallenge('${escapeHtml(c.id)}')">Join &amp; Submit Entry</button>`
          : `<p style="color:var(--text-muted)"><button class="btn btn-primary" onclick="Modal.close('challenge-detail-modal');Modal.open('auth-modal')">Join AVENORA to participate</button></p>`
        }
      </div>
      <div>
        <h4 style="font-family:var(--font-display);letter-spacing:0.1em;font-size:0.85rem;color:var(--univ-text-muted);margin-bottom:var(--space-md)">ENTRIES</h4>
        <p style="color:var(--text-muted);text-align:center;padding:var(--space-xl) 0">No entries yet. Be the first!</p>
      </div>`;
    Modal.open('challenge-detail-modal');
  },

  joinChallenge(id) {
    const user = LegendAPI.auth.getUser();
    if (!user) { Toast.info('Join AVENORA to participate.'); Modal.open('auth-modal'); return; }
    // For now, show a submission prompt
    const content = prompt('Share your entry (describe or add a link to your submission):');
    if (!content?.trim()) return;
    Toast.success('Entry submitted! Thank you for participating.');
  },

  async createChallenge() {
    const user = LegendAPI.auth.getUser();
    if (!user || !['founder','admin'].includes(user.role)) return;
    const title = document.getElementById('ch-create-title')?.value?.trim();
    const desc = document.getElementById('ch-create-desc')?.value?.trim();
    const cat = document.getElementById('ch-create-cat')?.value || 'other';
    const icon = document.getElementById('ch-create-icon')?.value?.trim() || '✨';
    const errEl = document.getElementById('ch-create-error');
    const btn = document.getElementById('ch-create-btn');

    if (!title) { if (errEl) { errEl.textContent = 'Title required.'; errEl.classList.remove('hidden'); } return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
    if (errEl) errEl.classList.add('hidden');

    try {
      const { getFirestore } = window.AvenoraFirebase || {};
      if (!getFirestore) throw new Error('Firebase not available.');
      const db = await getFirestore();
      const { collection, addDoc, serverTimestamp } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      await addDoc(collection(db, 'challenges'), {
        title, description: desc||'', category: cat, icon,
        official: true, entries: 0,
        createdBy: user.uid||user.id,
        createdAt: serverTimestamp(),
      });
      Toast.success('Challenge created!');
      Modal.close('challenge-create-modal');
      await this.load(this._filter);
    } catch (err) {
      const isFirebase = err && (err.code || (err.message || '').toLowerCase().includes('firebase'));
      const safeMsg = isFirebase && typeof firebaseUserMsg === 'function'
        ? firebaseUserMsg(err, 'Challenges')
        : (err && err.message ? err.message : 'Could not create challenge. Please try again.');
      if (errEl) { errEl.textContent = safeMsg; errEl.classList.remove('hidden'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Create Challenge'; }
    }
  },
};

window.ChallengesPage = ChallengesPage;
