/**
 * AVENORA GALLERY — Visual gallery with grid, lightbox, upload
 * Connected to Firebase Firestore + Supabase Storage.
 * Falls back to localStorage when backend is unavailable.
 */

registerPage('gallery', {
  async render(container) {
    const user = LegendAPI.auth.getUser();

    container.innerHTML = `
    <div style="padding:var(--space-lg)">
      <div class="page-header" style="padding-top:var(--space-xl);padding-bottom:var(--space-lg)">
        <h1 style="font-family:var(--font-display);letter-spacing:0.1em">
          <span style="background:linear-gradient(135deg,#0066ff,#00aaff,#00ff88);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">CREATOR</span> GALLERY
        </h1>
        <p class="tagline">SHOWCASE YOUR CREATIONS · ARTWORK · PHOTOGRAPHY · PROJECTS</p>
      </div>

        <div class="container-lg">
          <!-- Upload + filters -->
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-md);margin-bottom:var(--space-xl)">
            <div class="tabs" style="margin:0;border-bottom:none;gap:var(--space-sm);flex-wrap:wrap">
              ${['All','Artwork','Photography','Design','Writing','Video','Other'].map((c,i) => {
                const val = i === 0 ? 'all' : c.toLowerCase();
                return `<button class="tab-btn ${i===0?'active':''}" onclick="filterGallery('${val}',this)">${c}</button>`;
              }).join('')}
            </div>
            <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap">
              <div class="search-bar" style="width:200px">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="search" placeholder="Search gallery..." id="gallery-search" oninput="gallerySearchDebounced(this.value)" aria-label="Search gallery">
              </div>
              <button class="btn btn-green btn-sm" onclick="openGalleryUpload()" id="gallery-upload-btn-top" ${user ? '' : 'style="display:none"'}>📷 Upload</button>
            </div>
          </div>

          <!-- Gallery grid -->
          <div id="gallery-grid" style="columns:3 200px;gap:12px">
            <div class="loading-state"><div class="spinner"></div></div>
          </div>

          <!-- Load more -->
          <div id="gallery-load-more" class="hidden" style="text-align:center;margin-top:var(--space-xl)">
            <button class="btn btn-outline" onclick="loadMoreGallery()">Load More</button>
          </div>
        </div>

        <!-- ══════════════════════════════════════════════════════
             STEP 1 — Choose upload type: Photo or Video
             ══════════════════════════════════════════════════════ -->
        <div id="gallery-choose-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="gallery-choose-title">
          <div class="modal" style="max-width:380px">
            <div class="modal-header">
              <h3 id="gallery-choose-title" style="margin:0">Upload Creation</h3>
              <button class="btn btn-ghost btn-sm" onclick="Modal.close('gallery-choose-modal')" aria-label="Close">✕</button>
            </div>
            <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--space-md);padding-top:var(--space-lg);padding-bottom:var(--space-lg)">
              <button class="btn btn-outline" style="font-size:1.1rem;padding:var(--space-lg);justify-content:center"
                      onclick="galleryChoosePhoto()">📷 Photo</button>
              <button class="btn btn-outline" style="font-size:1.1rem;padding:var(--space-lg);justify-content:center"
                      onclick="galleryChooseVideo()">🎬 Video</button>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" onclick="Modal.close('gallery-choose-modal')">Cancel</button>
            </div>
          </div>
        </div>

        <!-- PHOTO-only file input — accept="image/*" only -->
        <input type="file" id="gallery-photo-input" accept="image/*" multiple style="display:none"
               onchange="galleryPhotoSelected(this.files)">

        <!-- VIDEO-only file input — accept="video/*" only, no image/* present -->
        <input type="file" id="gallery-video-input" accept="video/*" style="display:none"
               onchange="galleryVideoSelected(this.files)">

        <!-- ══════════════════════════════════════════════════════
             STEP 2A — Photo upload form
             ══════════════════════════════════════════════════════ -->
        <div id="gallery-photo-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="gallery-photo-title">
          <div class="modal" style="max-width:480px">
            <div class="modal-header">
              <h3 id="gallery-photo-title" style="margin:0">📷 Upload Photo</h3>
              <button class="btn btn-ghost btn-sm" onclick="galleryPhotoModalClose()" aria-label="Close">✕</button>
            </div>
            <div class="modal-body">
              <!-- Drop zone — clicking triggers the photo input -->
              <div id="gallery-photo-drop"
                   style="border:2px dashed var(--border-green);border-radius:var(--radius-md);padding:var(--space-2xl);text-align:center;cursor:pointer;transition:border-color 200ms"
                   onclick="document.getElementById('gallery-photo-input').click()"
                   ondragover="event.preventDefault();this.style.borderColor='var(--neon-green)'"
                   ondragleave="this.style.borderColor=''"
                   ondrop="galleryPhotoDrop(event)">
                <p style="font-size:2rem;margin-bottom:var(--space-sm)">📷</p>
                <p style="color:var(--text-secondary)">Click to select photos, or drag &amp; drop</p>
                <p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">JPEG, PNG, WebP, GIF · max 20 MB · up to 10 files</p>
              </div>
              <div id="gallery-photo-preview" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:var(--space-md)"></div>
              <div class="form-group" style="margin-top:var(--space-md)">
                <label class="form-label">Category</label>
                <select class="form-input" id="gallery-photo-category">
                  <option value="artwork">Artwork</option>
                  <option value="photography">Photography</option>
                  <option value="design">Design</option>
                  <option value="writing">Writing</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Title (optional)</label>
                <input class="form-input" id="gallery-photo-title" placeholder="Photo title..." maxlength="200">
              </div>
              <div id="gallery-photo-progress" class="hidden">
                <div class="progress-bar" style="margin-bottom:4px">
                  <div class="progress-fill" id="gallery-photo-progress-fill" style="width:0%;background:var(--neon-green)"></div>
                </div>
                <p id="gallery-photo-progress-text" style="font-size:0.8rem;color:var(--text-muted);text-align:center"></p>
              </div>
              <div id="gallery-photo-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem;margin-top:8px"></div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" onclick="galleryPhotoModalClose()">Cancel</button>
              <button class="btn btn-green" id="gallery-photo-submit" onclick="gallerySubmitPhotos()">Upload</button>
            </div>
          </div>
        </div>

        <!-- ══════════════════════════════════════════════════════
             STEP 2B — Video upload form
             ══════════════════════════════════════════════════════ -->
        <div id="gallery-video-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="gallery-video-title">
          <div class="modal" style="max-width:480px">
            <div class="modal-header">
              <h3 id="gallery-video-title" style="margin:0">🎬 Upload Video</h3>
              <button class="btn btn-ghost btn-sm" onclick="galleryVideoModalClose()" aria-label="Close">✕</button>
            </div>
            <div class="modal-body">
              <!-- Tap-to-select area — clicking triggers the VIDEO input exclusively -->
              <div id="gallery-video-drop"
                   style="border:2px dashed var(--border-green);border-radius:var(--radius-md);padding:var(--space-2xl);text-align:center;cursor:pointer;transition:border-color 200ms"
                   onclick="document.getElementById('gallery-video-input').click()"
                   ondragover="event.preventDefault();this.style.borderColor='var(--neon-green)'"
                   ondragleave="this.style.borderColor=''"
                   ondrop="galleryVideoDrop(event)">
                <p style="font-size:2rem;margin-bottom:var(--space-sm)">🎬</p>
                <p style="color:var(--text-secondary)">Click to select a video, or drag &amp; drop</p>
                <p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">MP4, WebM, MOV, AVI · max 500 MB</p>
              </div>
              <!-- Video preview area — shown after a file is selected -->
              <div id="gallery-video-preview" style="margin-top:var(--space-md);display:none">
                <video id="gallery-video-preview-player"
                       style="width:100%;max-height:240px;border-radius:var(--radius-md);background:#000;display:block"
                       controls playsinline preload="metadata"></video>
                <p id="gallery-video-filename" style="font-size:0.8rem;color:var(--text-muted);margin-top:6px;text-align:center"></p>
              </div>
              <div class="form-group" style="margin-top:var(--space-md)">
                <label class="form-label">Title (optional)</label>
                <input class="form-input" id="gallery-video-title-input" placeholder="Video title..." maxlength="200">
              </div>
              <div class="form-group">
                <label class="form-label">Description (optional)</label>
                <textarea class="form-input" id="gallery-video-desc" placeholder="Describe your video..." maxlength="500" rows="2" style="resize:vertical"></textarea>
              </div>
              <!-- Category is always "video" for video uploads — shown as read-only -->
              <div class="form-group">
                <label class="form-label">Category</label>
                <input class="form-input" value="Video" readonly style="color:var(--text-muted);cursor:default">
              </div>
              <div id="gallery-video-progress" class="hidden">
                <div class="progress-bar" style="margin-bottom:4px">
                  <div class="progress-fill" id="gallery-video-progress-fill" style="width:0%;background:var(--neon-green)"></div>
                </div>
                <p id="gallery-video-progress-text" style="font-size:0.8rem;color:var(--text-muted);text-align:center"></p>
              </div>
              <div id="gallery-video-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem;margin-top:8px"></div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" onclick="galleryVideoModalClose()">Cancel</button>
              <button class="btn btn-green" id="gallery-video-submit" onclick="gallerySubmitVideo()">Upload</button>
            </div>
          </div>
        </div>

        <!-- Delete confirmation modal -->
        <div id="gallery-delete-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="gallery-delete-title">
          <div class="modal" style="max-width:400px">
            <div class="modal-header">
              <h3 id="gallery-delete-title" style="margin:0;font-size:0.95rem;font-family:var(--font-display);letter-spacing:0.1em">DELETE CREATION</h3>
              <button class="btn btn-ghost btn-sm" onclick="Modal.close('gallery-delete-modal')" aria-label="Close">✕</button>
            </div>
            <div class="modal-body">
              <p id="gallery-delete-body" style="color:var(--text-secondary);margin-bottom:0">Delete this creation? This cannot be undone.</p>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" onclick="Modal.close('gallery-delete-modal')">Cancel</button>
              <button class="btn btn-danger" id="gallery-delete-confirm-btn">Delete</button>
            </div>
          </div>
        </div>

      </div>
    `;

    // Update upload button visibility
    LegendState.subscribe('user', (u) => {
      const btn = document.getElementById('gallery-upload-btn-top');
      if (btn) btn.style.display = u ? '' : 'none';
    });

    await loadGallery();
    return () => {};
  }
});

// ─── State ────────────────────────────────────────────────────
const GalleryState = {
  currentPage: 1,
  currentFilter: 'all',
  currentQuery: '',
  hasMore: false,
  localItems: LS.get('lu_gallery_items', []),
  addLocal(item) {
    this.localItems.unshift(item);
    LS.set('lu_gallery_items', this.localItems.slice(0, 200));
  },
};

// Pending files — separate arrays for photos vs video
let _pendingPhotos = [];  // array of File (images)
let _pendingVideo  = null; // single File (video)

// ─── Load gallery ─────────────────────────────────────────────

async function loadGallery(filter = 'all', query = '', page = 1, append = false) {
  GalleryState.currentFilter = filter;
  GalleryState.currentQuery  = query;
  GalleryState.currentPage   = page;

  const grid     = document.getElementById('gallery-grid');
  const loadMore = document.getElementById('gallery-load-more');

  if (!append && grid) {
    grid.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
  }

  try {
    const params = { page, limit: 24 };
    if (filter && filter !== 'all') params.category = filter;
    if (query) params.q = query;

    const data   = await LegendAPI.gallery.list(params);
    const images = data.images || [];
    const total  = data.total  || 0;

    GalleryState.hasMore = page * 24 < total;
    if (loadMore) loadMore.classList.toggle('hidden', !GalleryState.hasMore);

    if (!images.length && !append) {
      const localItems = GalleryState.localItems.filter(i =>
        (filter === 'all' || i.category === filter || (filter === 'video' && i.fileType === 'video')) &&
        (!query || (i.title || '').toLowerCase().includes(query.toLowerCase()))
      );
      renderGalleryGrid(localItems, grid, false);
      return;
    }

    renderGalleryGrid(images.map(img => ({
      id:        img._id,
      url:       img.url,
      title:     img.title,
      category:  img.category,
      fileType:  img.fileType || 'image',
      author:    img.uploader?.username,
      likeCount: img.likeCount  || 0,
      likedByMe: img.likedByMe  || false,
      isOwn:     LegendAPI.auth.getUser()?.id === img.uploader?._id?.toString(),
      createdAt: img.createdAt,
    })), grid, append);

  } catch {
    const localItems = GalleryState.localItems.filter(i =>
      (filter === 'all' || i.category === filter || (filter === 'video' && i.fileType === 'video')) &&
      (!query || (i.title || '').toLowerCase().includes(query.toLowerCase()))
    );
    renderGalleryGrid(localItems, grid, append);
    if (loadMore) loadMore.classList.add('hidden');
  }
}

function renderGalleryGrid(items, grid, append = false) {
  if (!grid) return;

  if (!items?.length && !append) {
    const user = LegendAPI.auth.getUser();
    grid.innerHTML = `
      <div class="error-state">
        <div class="error-icon">🖼️</div>
        <h3>Gallery is empty</h3>
        <p>Be the first to upload artwork, wallpapers, or community images.</p>
        ${user
          ? `<button class="btn btn-green" onclick="openGalleryUpload()">📷 Upload Now</button>`
          : `<button class="btn btn-primary" onclick="Modal.open('auth-modal')">Sign In to Upload</button>`}
      </div>
    `;
    return;
  }

  const html = items.map(item => {
    const isVideo = item.fileType === 'video';
    const mediaThumbnail = isVideo
      ? `<video src="${escapeHtml(item.url)}"
               style="width:100%;display:block;max-height:320px;object-fit:cover;cursor:pointer"
               controls
               playsinline
               preload="metadata"
               onclick="event.stopPropagation();openVideoLightbox('${escapeHtml(item.url)}','${escapeHtml(item.title||'')}','${escapeHtml(item.author||'')}','${item.id||''}')"
               aria-label="${escapeHtml(item.title || 'Gallery video')}">
           Your browser does not support the video element.
         </video>`
      : `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.title || 'Gallery image')}"
              style="width:100%;display:block;transition:transform var(--transition-slow)"
              onclick="openLightbox('${escapeHtml(item.url)}','${escapeHtml(item.title||'')}','${escapeHtml(item.author||'')}','${item.id||''}')"
              loading="lazy"
              onerror="this.parentElement.innerHTML='<div style=padding:40px;text-align:center;color:var(--text-muted)>Failed to load</div>'">`;
    return `
    <div style="break-inside:avoid;margin-bottom:12px;cursor:pointer;position:relative" data-gallery-id="${item.id || ''}" data-file-type="${isVideo ? 'video' : 'image'}">
      <div style="position:relative;border-radius:var(--radius-md);overflow:hidden;background:var(--bg-secondary)">
        ${mediaThumbnail}
        <div class="gallery-overlay" style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,0.75));padding:10px 8px 7px;opacity:0;transition:opacity 200ms"
             onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0">
          <p style="font-weight:600;font-size:0.82rem;color:#fff;margin:0 0 2px" class="truncate">${escapeHtml(item.title || 'Untitled')}</p>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <p style="font-size:0.72rem;color:rgba(255,255,255,0.65);margin:0">by ${escapeHtml(item.author || 'Unknown')}</p>
            <div style="display:flex;gap:6px;align-items:center">
              ${item.id ? `<button onclick="event.stopPropagation();galleryLike('${item.id}',this)" style="background:none;border:none;color:${item.likedByMe?'var(--neon-red)':'rgba(255,255,255,0.7)'};font-size:0.8rem;cursor:pointer" aria-label="Like">♥ ${formatCount(item.likeCount||0)}</button>` : ''}
              ${item.isOwn && item.id ? `<button onclick="event.stopPropagation();galleryDelete('${item.id}',this.closest('[data-gallery-id]'))" style="background:none;border:none;color:rgba(255,100,100,0.8);font-size:0.8rem;cursor:pointer" aria-label="Delete">✕</button>` : ''}
            </div>
          </div>
        </div>
        <span class="badge badge-blue" style="position:absolute;top:8px;right:8px;font-size:0.6rem">${escapeHtml(item.category || 'art')}</span>
        ${isVideo ? `<span style="position:absolute;top:8px;left:8px;background:rgba(0,0,0,0.6);border-radius:4px;padding:2px 6px;font-size:0.6rem;color:#fff;letter-spacing:0.06em">▶ VIDEO</span>` : ''}
      </div>
    </div>`;
  }).join('');

  if (append && grid.innerHTML.includes('loading-state')) {
    grid.innerHTML = html;
  } else if (append) {
    grid.insertAdjacentHTML('beforeend', html);
  } else {
    grid.innerHTML = html;
  }
}

// ─── Lightbox ─────────────────────────────────────────────────

window.openLightbox = function (url, title, author, id) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.96);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <img src="${escapeHtml(url)}" style="max-width:90vw;max-height:80vh;object-fit:contain;border-radius:8px" alt="${escapeHtml(title)}" onerror="this.alt='Image failed to load'">
    <div style="margin-top:12px;text-align:center">
      <p style="font-weight:600;color:#fff;margin:0 0 2px">${escapeHtml(title || 'Untitled')}</p>
      ${author ? `<p style="color:rgba(255,255,255,0.55);font-size:0.85rem;margin:0">by ${escapeHtml(author)}</p>` : ''}
    </div>
    <button style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.12);border:none;color:#fff;width:36px;height:36px;border-radius:50%;font-size:1.1rem;cursor:pointer"
            aria-label="Close lightbox"
            onclick="this.parentElement.remove()">✕</button>
  `;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); } });
  document.body.appendChild(overlay);
};

// Video lightbox — full-screen HTML5 video player, no autoplay.
window.openVideoLightbox = function (url, title, author, id) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.96);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <video src="${escapeHtml(url)}"
           style="max-width:90vw;max-height:80vh;border-radius:8px;outline:none"
           controls
           playsinline
           preload="metadata"
           aria-label="${escapeHtml(title || 'Gallery video')}">
      Your browser does not support the video element.
    </video>
    <div style="margin-top:12px;text-align:center">
      <p style="font-weight:600;color:#fff;margin:0 0 2px">${escapeHtml(title || 'Untitled')}</p>
      ${author ? `<p style="color:rgba(255,255,255,0.55);font-size:0.85rem;margin:0">by ${escapeHtml(author)}</p>` : ''}
    </div>
    <button style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.12);border:none;color:#fff;width:36px;height:36px;border-radius:50%;font-size:1.1rem;cursor:pointer"
            aria-label="Close video lightbox"
            onclick="this.closest('[style*=z-index]').querySelector('video')?.pause();this.parentElement.remove()">✕</button>
  `;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.querySelector('video')?.pause();
      overlay.remove();
    }
  });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') {
      overlay.querySelector('video')?.pause();
      overlay.remove();
      document.removeEventListener('keydown', esc);
    }
  });
  document.body.appendChild(overlay);
};

// ─── Filter / search ──────────────────────────────────────────

window.filterGallery = function (category, clickedBtn) {
  document.querySelectorAll('#gallery-grid ~ * .tab-btn, .tab-btn').forEach(btn => btn.classList.remove('active'));
  if (clickedBtn) clickedBtn.classList.add('active');
  loadGallery(category, GalleryState.currentQuery);
};

const gallerySearchDebounced = debounce(function (query) {
  loadGallery(GalleryState.currentFilter, query);
}, 350);
window.gallerySearchDebounced = gallerySearchDebounced;

window.loadMoreGallery = function () {
  loadGallery(GalleryState.currentFilter, GalleryState.currentQuery, GalleryState.currentPage + 1, true);
};

// ─── Like / delete ────────────────────────────────────────────

window.galleryLike = async function (id, btn) {
  if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }
  try {
    const data = await LegendAPI.gallery.like(id);
    if (btn) {
      btn.style.color = data.liked ? 'var(--neon-red)' : 'rgba(255,255,255,0.7)';
      btn.textContent = `♥ ${formatCount(data.likeCount || 0)}`;
    }
  } catch (err) {
    console.warn('[AVN] Gallery like error:', err);
    Toast.error('Something went wrong. Please try again.');
  }
};

window.galleryDelete = function (id, container) {
  const bodyEl     = document.getElementById('gallery-delete-body');
  const confirmBtn = document.getElementById('gallery-delete-confirm-btn');
  if (!confirmBtn) { _galleryDoDelete(id, container); return; }
  if (bodyEl) bodyEl.textContent = 'Delete this creation? This cannot be undone.';
  const fresh = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(fresh, confirmBtn);
  fresh.addEventListener('click', function handleConfirm() {
    Modal.close('gallery-delete-modal');
    _galleryDoDelete(id, container);
  });
  Modal.open('gallery-delete-modal');
};

async function _galleryDoDelete(id, container) {
  try {
    const result = await LegendAPI.gallery.delete(id);
    if (result && result.storageDeleted === false && result.reason !== 'not-found') {
      console.warn('[AVN] Gallery delete: Firestore doc deleted but storage file could not be removed.');
    }
    Toast.success('Creation deleted');
    if (container) {
      container.style.transition = 'opacity 300ms';
      container.style.opacity = '0';
      setTimeout(() => container.remove(), 300);
    }
  } catch (err) {
    console.error('[AVN] Gallery delete error:', { id, code: err?.code, message: err?.message, error: err });
    Toast.error("We couldn\u2019t delete this creation. Please try again.");
  }
}

// ══════════════════════════════════════════════════════════════
// UPLOAD — Step 1: choose type
// ══════════════════════════════════════════════════════════════

window.openGalleryUpload = function () {
  if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }
  Modal.open('gallery-choose-modal');
};

// ── Step 1 → Photo ────────────────────────────────────────────
window.galleryChoosePhoto = function () {
  Modal.close('gallery-choose-modal');
  // Reset photo state
  _pendingPhotos = [];
  const preview = document.getElementById('gallery-photo-preview');
  if (preview) preview.innerHTML = '';
  const errEl = document.getElementById('gallery-photo-error');
  if (errEl) errEl.classList.add('hidden');
  const progress = document.getElementById('gallery-photo-progress');
  if (progress) progress.classList.add('hidden');
  const fill = document.getElementById('gallery-photo-progress-fill');
  if (fill) fill.style.width = '0%';
  const titleInput = document.getElementById('gallery-photo-title');
  if (titleInput) titleInput.value = '';
  const submitBtn = document.getElementById('gallery-photo-submit');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Upload'; }
  Modal.open('gallery-photo-modal');
};

window.galleryPhotoModalClose = function () {
  Modal.close('gallery-photo-modal');
  _pendingPhotos = [];
};

// Photo file selected via <input type="file" accept="image/*">
window.galleryPhotoSelected = function (fileList) {
  const files = Array.from(fileList || []);
  _addPendingPhotos(files);
  // Reset the input so re-selecting the same file fires onchange again
  const inp = document.getElementById('gallery-photo-input');
  if (inp) inp.value = '';
};

// Photo drag-and-drop
window.galleryPhotoDrop = function (e) {
  e.preventDefault();
  const zone = document.getElementById('gallery-photo-drop');
  if (zone) zone.style.borderColor = '';
  const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
  _addPendingPhotos(files);
};

function _addPendingPhotos(files) {
  const errEl    = document.getElementById('gallery-photo-error');
  const tooLarge = [];
  const bad      = [];
  const valid    = [];

  for (const f of files) {
    if (!f.type.startsWith('image/')) { bad.push(f.name); continue; }
    if (f.size > 20 * 1024 * 1024)   { tooLarge.push(f.name); continue; }
    valid.push(f);
  }
  if (bad.length)      Toast.warning(`${bad.length} file(s) skipped — photos only here.`);
  if (tooLarge.length) Toast.warning(`${tooLarge.length} file(s) skipped — max 20 MB per photo.`);
  if (errEl) errEl.classList.add('hidden');

  _pendingPhotos.push(...valid);
  if (_pendingPhotos.length > 10) {
    _pendingPhotos = _pendingPhotos.slice(0, 10);
    Toast.info('Maximum 10 photos per upload');
  }
  _renderPhotoPreviews();
}

function _renderPhotoPreviews() {
  const preview = document.getElementById('gallery-photo-preview');
  if (!preview) return;
  preview.innerHTML = _pendingPhotos.map((f, i) => {
    const url = URL.createObjectURL(f);
    return `
      <div style="position:relative" data-photo-idx="${i}">
        <img src="${url}" style="height:72px;width:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border-subtle)" alt="">
        <button onclick="galleryRemovePhoto(${i})" style="position:absolute;top:-4px;right:-4px;background:var(--bg-secondary);border:1px solid var(--border-subtle);color:var(--text-muted);width:16px;height:16px;border-radius:50%;font-size:10px;padding:0;line-height:1;cursor:pointer" aria-label="Remove">✕</button>
        <p style="font-size:0.6rem;color:var(--text-muted);text-align:center;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.name)}</p>
      </div>`;
  }).join('');
}

window.galleryRemovePhoto = function (idx) {
  const el = document.querySelector(`[data-photo-idx="${idx}"] img`);
  if (el?.src) URL.revokeObjectURL(el.src);
  _pendingPhotos.splice(idx, 1);
  _renderPhotoPreviews();
};

window.gallerySubmitPhotos = async function () {
  if (!_pendingPhotos.length) { Toast.error('Select at least one photo first'); return; }

  const category    = document.getElementById('gallery-photo-category')?.value || 'artwork';
  const title       = document.getElementById('gallery-photo-title')?.value?.trim() || 'Untitled';
  const submitBtn   = document.getElementById('gallery-photo-submit');
  const progressDiv = document.getElementById('gallery-photo-progress');
  const fill        = document.getElementById('gallery-photo-progress-fill');
  const progressTxt = document.getElementById('gallery-photo-progress-text');
  const errEl       = document.getElementById('gallery-photo-error');

  if (errEl) errEl.classList.add('hidden');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Uploading...'; }
  if (progressDiv) progressDiv.classList.remove('hidden');

  let uploaded = 0;

  for (let i = 0; i < _pendingPhotos.length; i++) {
    const file = _pendingPhotos[i];
    if (fill)        fill.style.width = `${Math.round((i / _pendingPhotos.length) * 100)}%`;
    if (progressTxt) progressTxt.textContent = `Uploading ${i + 1} of ${_pendingPhotos.length}...`;

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', category);
      fd.append('title', title);
      fd.append('caption', '');

      const data = await LegendAPI.gallery.upload(fd);
      (data.images || []).forEach(img => {
        GalleryState.addLocal({
          id: img._id, url: img.url, title: img.title || title,
          category: img.category || category, fileType: 'image',
          author: img.uploader?.username || LegendAPI.auth.getUser()?.username || 'Unknown',
          likeCount: 0, likedByMe: false, isOwn: true, createdAt: img.createdAt,
        });
      });
      uploaded++;
    } catch (err) {
      console.warn('[AVN] Gallery photo upload error:', err);
      if (errEl) { errEl.textContent = 'Upload failed. Please try again.'; errEl.classList.remove('hidden'); }
    }
  }

  if (fill)        fill.style.width = '100%';
  if (progressTxt) progressTxt.textContent = 'Done!';
  if (submitBtn)   { submitBtn.disabled = false; submitBtn.textContent = 'Upload'; }

  if (uploaded > 0) {
    setTimeout(() => {
      if (progressDiv) progressDiv.classList.add('hidden');
      Modal.close('gallery-photo-modal');
      Toast.success(`${uploaded} photo${uploaded > 1 ? 's' : ''} uploaded!`);
      _pendingPhotos = [];
      loadGallery(GalleryState.currentFilter, GalleryState.currentQuery);
    }, 500);
  } else {
    if (progressDiv) progressDiv.classList.add('hidden');
  }
};

// ── Step 1 → Video ────────────────────────────────────────────
window.galleryChooseVideo = function () {
  Modal.close('gallery-choose-modal');
  // Reset video state
  _pendingVideo = null;
  const previewArea = document.getElementById('gallery-video-preview');
  if (previewArea) previewArea.style.display = 'none';
  const player = document.getElementById('gallery-video-preview-player');
  if (player) { player.pause(); player.src = ''; }
  const filenameTxt = document.getElementById('gallery-video-filename');
  if (filenameTxt) filenameTxt.textContent = '';
  const errEl = document.getElementById('gallery-video-error');
  if (errEl) errEl.classList.add('hidden');
  const progress = document.getElementById('gallery-video-progress');
  if (progress) progress.classList.add('hidden');
  const fill = document.getElementById('gallery-video-progress-fill');
  if (fill) fill.style.width = '0%';
  const titleInput = document.getElementById('gallery-video-title-input');
  if (titleInput) titleInput.value = '';
  const desc = document.getElementById('gallery-video-desc');
  if (desc) desc.value = '';
  const submitBtn = document.getElementById('gallery-video-submit');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Upload'; }
  Modal.open('gallery-video-modal');
};

window.galleryVideoModalClose = function () {
  // Pause and release the object URL before closing
  const player = document.getElementById('gallery-video-preview-player');
  if (player) {
    player.pause();
    if (player.src && player.src.startsWith('blob:')) URL.revokeObjectURL(player.src);
    player.src = '';
  }
  Modal.close('gallery-video-modal');
  _pendingVideo = null;
};

// Video file selected via <input type="file" accept="video/*">
window.galleryVideoSelected = function (fileList) {
  const file = fileList && fileList[0];
  if (!file) return;
  _setVideoFile(file);
  // Reset the input so re-selecting the same file fires onchange again
  const inp = document.getElementById('gallery-video-input');
  if (inp) inp.value = '';
};

// Video drag-and-drop
window.galleryVideoDrop = function (e) {
  e.preventDefault();
  const zone = document.getElementById('gallery-video-drop');
  if (zone) zone.style.borderColor = '';
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('video/')) {
    Toast.warning('Please drop a video file (MP4, WebM, MOV, AVI).');
    return;
  }
  _setVideoFile(file);
};

function _setVideoFile(file) {
  const errEl = document.getElementById('gallery-video-error');
  if (!file.type.startsWith('video/')) {
    if (errEl) { errEl.textContent = 'Please select a video file (MP4, WebM, MOV, AVI).'; errEl.classList.remove('hidden'); }
    return;
  }
  if (file.size > 500 * 1024 * 1024) {
    if (errEl) { errEl.textContent = `"${file.name}" is too large — maximum video size is 500 MB.`; errEl.classList.remove('hidden'); }
    return;
  }
  if (errEl) errEl.classList.add('hidden');

  _pendingVideo = file;

  // Show the preview player
  const previewArea = document.getElementById('gallery-video-preview');
  const player      = document.getElementById('gallery-video-preview-player');
  const filenameTxt = document.getElementById('gallery-video-filename');
  if (player) {
    if (player.src && player.src.startsWith('blob:')) URL.revokeObjectURL(player.src);
    player.src = URL.createObjectURL(file);
  }
  if (filenameTxt) filenameTxt.textContent = file.name + ' (' + (file.size / (1024 * 1024)).toFixed(1) + ' MB)';
  if (previewArea)  previewArea.style.display = 'block';

  // Pre-fill title from filename (strip extension)
  const titleInput = document.getElementById('gallery-video-title-input');
  if (titleInput && !titleInput.value) {
    titleInput.value = file.name.replace(/\.[^.]+$/, '');
  }
}

window.gallerySubmitVideo = async function () {
  if (!_pendingVideo) { Toast.error('Select a video file first'); return; }

  const title       = document.getElementById('gallery-video-title-input')?.value?.trim() || _pendingVideo.name.replace(/\.[^.]+$/, '');
  const submitBtn   = document.getElementById('gallery-video-submit');
  const progressDiv = document.getElementById('gallery-video-progress');
  const fill        = document.getElementById('gallery-video-progress-fill');
  const progressTxt = document.getElementById('gallery-video-progress-text');
  const errEl       = document.getElementById('gallery-video-error');

  if (errEl) errEl.classList.add('hidden');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Uploading...'; }
  if (progressDiv) progressDiv.classList.remove('hidden');
  if (fill)        fill.style.width = '10%';
  if (progressTxt) progressTxt.textContent = 'Uploading video…';

  try {
    const fd = new FormData();
    fd.append('file', _pendingVideo);
    fd.append('category', 'video');
    fd.append('title', title);
    fd.append('caption', document.getElementById('gallery-video-desc')?.value?.trim() || '');

    const data = await LegendAPI.gallery.upload(fd);
    if (fill)        fill.style.width = '100%';
    if (progressTxt) progressTxt.textContent = 'Done!';

    (data.images || []).forEach(img => {
      GalleryState.addLocal({
        id: img._id, url: img.url, title: img.title || title,
        category: 'video', fileType: 'video',
        author: img.uploader?.username || LegendAPI.auth.getUser()?.username || 'Unknown',
        likeCount: 0, likedByMe: false, isOwn: true, createdAt: img.createdAt,
      });
    });

    setTimeout(() => {
      if (progressDiv) progressDiv.classList.add('hidden');
      // Release object URL before closing
      const player = document.getElementById('gallery-video-preview-player');
      if (player) {
        player.pause();
        if (player.src && player.src.startsWith('blob:')) URL.revokeObjectURL(player.src);
        player.src = '';
      }
      Modal.close('gallery-video-modal');
      Toast.success('Video uploaded!');
      _pendingVideo = null;
      loadGallery(GalleryState.currentFilter, GalleryState.currentQuery);
    }, 500);

  } catch (err) {
    console.error('[AVN] Gallery video upload error:', err);
    if (fill)        fill.style.width = '0%';
    if (progressDiv) progressDiv.classList.add('hidden');
    if (submitBtn)   { submitBtn.disabled = false; submitBtn.textContent = 'Upload'; }
    const msg = err?.message || 'Upload failed. Please try again.';
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
  }
};
