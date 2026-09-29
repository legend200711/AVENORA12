/**
 * AVENORA GALLERY — Visual gallery with grid, lightbox, upload
 * Connected to the real backend gallery API.
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

        <!-- Upload modal -->
        <div id="gallery-upload-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="gallery-upload-title">
          <div class="modal" style="max-width:480px">
            <div class="modal-header">
              <h3 id="gallery-upload-title" style="margin:0">Upload to Gallery</h3>
              <button class="btn btn-ghost btn-sm" onclick="Modal.close('gallery-upload-modal')" aria-label="Close">✕</button>
            </div>
            <div class="modal-body">
              <div id="gallery-drop-zone"
                   style="border:2px dashed var(--border-green);border-radius:var(--radius-md);padding:var(--space-2xl);text-align:center;cursor:pointer;transition:border-color 200ms"
                   onclick="triggerGalleryFileInput()"
                   ondragover="event.preventDefault();this.style.borderColor='var(--neon-green)'"
                   ondragleave="this.style.borderColor=''"
                   ondrop="galleryHandleDrop(event)">
                 <p style="font-size:2rem;margin-bottom:var(--space-sm)">📷🎬</p>
                 <p style="color:var(--text-secondary)">Click to select images or videos, or drag &amp; drop</p>
                 <p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">Images: JPEG, PNG, WebP, GIF · max 20 MB · Videos: MP4, WebM · max 500 MB · up to 10 files</p>
               </div>
               <input type="file" id="gallery-file-input" accept="image/*,video/mp4,video/webm,video/ogg,video/quicktime,video/*" multiple style="display:none"
                      onchange="galleryFilesSelected(this.files)">
              <div id="gallery-upload-preview" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:var(--space-md)"></div>
              <div class="form-group" style="margin-top:var(--space-md)">
                <label class="form-label">Category</label>
                <select class="form-input" id="gallery-category">
                  <option value="artwork">Artwork</option>
                  <option value="photography">Photography</option>
                  <option value="design">Design</option>
                  <option value="writing">Writing</option>
                  <option value="video">Video</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Title (optional)</label>
                <input class="form-input" id="gallery-title-input" placeholder="Image title..." maxlength="200">
              </div>
              <div id="gallery-upload-progress" class="hidden">
                <div class="progress-bar" style="margin-bottom:4px">
                  <div class="progress-fill" id="gallery-progress-fill" style="width:0%;background:var(--neon-green)"></div>
                </div>
                <p id="gallery-progress-text" style="font-size:0.8rem;color:var(--text-muted);text-align:center"></p>
              </div>
              <div id="gallery-upload-error" class="hidden" style="color:var(--neon-red);font-size:0.85rem;margin-top:8px"></div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" onclick="Modal.close('gallery-upload-modal')">Cancel</button>
              <button class="btn btn-green" id="gallery-submit-btn" onclick="submitGalleryUpload()">Upload</button>
            </div>
          </div>
        </div>

        <!-- Delete confirmation modal — shown instead of browser confirm() -->
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
  // local fallback store
  localItems: LS.get('lu_gallery_items', []),
  addLocal(item) {
    this.localItems.unshift(item);
    LS.set('lu_gallery_items', this.localItems.slice(0, 200));
  },
};

// Pending upload files
let _pendingFiles = [];

// ─── Load gallery ─────────────────────────────────────────────

async function loadGallery(filter = 'all', query = '', page = 1, append = false) {
  GalleryState.currentFilter = filter;
  GalleryState.currentQuery = query;
  GalleryState.currentPage = page;

  const grid = document.getElementById('gallery-grid');
  const loadMore = document.getElementById('gallery-load-more');

  if (!append && grid) {
    grid.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
  }

  try {
    const params = { page, limit: 24 };
    if (filter && filter !== 'all') params.category = filter;
    if (query) params.q = query;

    const data = await LegendAPI.gallery.list(params);
    const images = data.images || [];
    const total = data.total || 0;

    GalleryState.hasMore = page * 24 < total;
    if (loadMore) loadMore.classList.toggle('hidden', !GalleryState.hasMore);

    if (!images.length && !append) {
      // Try local fallback
      const localItems = GalleryState.localItems.filter(i =>
        (filter === 'all' || i.category === filter) &&
        (!query || (i.title || '').toLowerCase().includes(query.toLowerCase()))
      );
      renderGalleryGrid(localItems, grid, false);
      return;
    }

    renderGalleryGrid(images.map(img => ({
      id: img._id,
      url: img.url,
      title: img.title,
      category: img.category,
      fileType: img.fileType || 'image',
      author: img.uploader?.username,
      likeCount: img.likeCount || 0,
      likedByMe: img.likedByMe || false,
      isOwn: LegendAPI.auth.getUser()?.id === img.uploader?._id?.toString(),
      createdAt: img.createdAt,
    })), grid, append);

  } catch {
    // Backend unavailable — use local store
    const localItems = GalleryState.localItems.filter(i =>
      (filter === 'all' || i.category === filter) &&
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
    // Grid thumbnail: video gets a <video> element with controls; image stays as <img>
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
        <!-- Hover overlay -->
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

// Video lightbox — full-screen HTML5 video player with native controls.
// No autoplay. Works on Android, iPhone (via playsinline + controls), and desktop.
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
  // Show the custom delete confirmation modal instead of browser confirm().
  const bodyEl   = document.getElementById('gallery-delete-body');
  const confirmBtn = document.getElementById('gallery-delete-confirm-btn');
  if (!confirmBtn) {
    // Fallback in case the modal HTML hasn't rendered yet (should not happen)
    _galleryDoDelete(id, container);
    return;
  }
  if (bodyEl) bodyEl.textContent = 'Delete this creation? This cannot be undone.';
  // Clear any previous click handler and attach a fresh one
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
    // result.storageDeleted tells us whether the Supabase file was also removed
    if (result && result.storageDeleted === false && result.reason !== 'not-found') {
      // Old upload without storagePath — Firestore doc deleted but storage file remains
      console.warn('[AVN] Gallery delete: Firestore doc deleted but Supabase file could not be removed (old upload — no storagePath stored).');
    }
    Toast.success('Creation deleted');
    if (container) {
      container.style.transition = 'opacity 300ms';
      container.style.opacity = '0';
      setTimeout(() => container.remove(), 300);
    }
  } catch (err) {
    // Full error logged to console; only a clean message shown to user
    console.error('[AVN] Gallery delete error:', {
      id,
      code:    err?.code,
      message: err?.message,
      error:   err,
    });
    // Use a fixed, clean message for delete failures — never expose raw Firebase errors
    Toast.error("We couldn\u2019t delete this creation. Please try again.");
  }
}

// ─── Upload ───────────────────────────────────────────────────

window.openGalleryUpload = function () {
  if (!LegendAPI.auth.isLoggedIn()) { Modal.open('auth-modal'); return; }
  _pendingFiles = [];
  const preview = document.getElementById('gallery-upload-preview');
  if (preview) preview.innerHTML = '';
  const errEl = document.getElementById('gallery-upload-error');
  if (errEl) errEl.classList.add('hidden');
  Modal.open('gallery-upload-modal');
};

window.triggerGalleryFileInput = function () {
  document.getElementById('gallery-file-input')?.click();
};

window.galleryFilesSelected = function (fileList) {
  const files = Array.from(fileList || []);
  addPendingFiles(files);
};

window.galleryHandleDrop = function (e) {
  e.preventDefault();
  const zone = document.getElementById('gallery-drop-zone');
  if (zone) zone.style.borderColor = '';
  // Accept both images and videos from drag-and-drop
  const files = Array.from(e.dataTransfer?.files || []).filter(
    f => f.type.startsWith('image/') || f.type.startsWith('video/')
  );
  addPendingFiles(files);
};

function addPendingFiles(files) {
  const errEl = document.getElementById('gallery-upload-error');
  const tooLarge = [];
  const unsupported = [];
  const valid = [];

  for (const f of files) {
    const isImage = f.type.startsWith('image/');
    const isVideo = f.type.startsWith('video/');
    if (!isImage && !isVideo) {
      unsupported.push(f.name);
      continue;
    }
    const maxBytes = isVideo ? 500 * 1024 * 1024 : 20 * 1024 * 1024;
    if (f.size > maxBytes) {
      tooLarge.push({ name: f.name, isVideo });
      continue;
    }
    valid.push(f);
  }

  if (unsupported.length) {
    Toast.warning(`${unsupported.length} file(s) skipped — only images and videos are supported.`);
  }
  if (tooLarge.length) {
    const msgs = tooLarge.map(t => `"${t.name}" is too large (max ${t.isVideo ? '500 MB' : '20 MB'})`);
    const msg = msgs.join('; ');
    Toast.warning(msg);
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
  } else if (errEl) {
    errEl.classList.add('hidden');
  }

  _pendingFiles.push(...valid);
  // Max 10 files
  if (_pendingFiles.length > 10) {
    _pendingFiles = _pendingFiles.slice(0, 10);
    Toast.info('Maximum 10 files per upload');
  }

  renderUploadPreviews();
}

function renderUploadPreviews() {
  const preview = document.getElementById('gallery-upload-preview');
  if (!preview) return;
  preview.innerHTML = _pendingFiles.map((f, i) => {
    const url = URL.createObjectURL(f);
    const isVideo = f.type.startsWith('video/');
    const thumb = isVideo
      // Video preview: small muted video element so user can confirm their selection
      ? `<video src="${url}" style="height:72px;width:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border-subtle)" muted playsinline preload="metadata"></video>`
      : `<img src="${url}" style="height:72px;width:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border-subtle)" alt="">`;
    return `
      <div style="position:relative" data-file-idx="${i}">
        ${thumb}
        <button onclick="removePendingFile(${i})" style="position:absolute;top:-4px;right:-4px;background:var(--bg-secondary);border:1px solid var(--border-subtle);color:var(--text-muted);width:16px;height:16px;border-radius:50%;font-size:10px;padding:0;line-height:1;cursor:pointer" aria-label="Remove">✕</button>
        <p style="font-size:0.6rem;color:var(--text-muted);text-align:center;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.name)}</p>
      </div>
    `;
  }).join('');
}

window.removePendingFile = function (idx) {
  // Revoke the object URL from either the img or video thumbnail element
  const el = document.querySelector(`[data-file-idx="${idx}"] img, [data-file-idx="${idx}"] video`);
  if (el?.src) URL.revokeObjectURL(el.src);
  _pendingFiles.splice(idx, 1);
  renderUploadPreviews();
};

window.submitGalleryUpload = async function () {
  if (!_pendingFiles.length) { Toast.error('Select at least one image or video first'); return; }

  const category = document.getElementById('gallery-category')?.value || 'artwork';
  const title = document.getElementById('gallery-title-input')?.value?.trim() || 'Untitled';
  const submitBtn = document.getElementById('gallery-submit-btn');
  const progressDiv = document.getElementById('gallery-upload-progress');
  const progressFill = document.getElementById('gallery-progress-fill');
  const progressText = document.getElementById('gallery-progress-text');
  const errEl = document.getElementById('gallery-upload-error');

  if (errEl) errEl.classList.add('hidden');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Uploading...'; }
  if (progressDiv) progressDiv.classList.remove('hidden');

  let uploaded = 0;

  for (let i = 0; i < _pendingFiles.length; i++) {
    const file = _pendingFiles[i];
    const pct = Math.round(((i) / _pendingFiles.length) * 100);
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressText) progressText.textContent = `Uploading ${i + 1} of ${_pendingFiles.length}...`;

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', category);
      formData.append('title', title);
      formData.append('caption', '');

      const data = await LegendAPI.gallery.upload(formData);
      const images = data.images || [];
      images.forEach(img => {
        GalleryState.addLocal({
          id: img._id,
          url: img.url,
          title: img.title || title,
          category: img.category || category,
          // Preserve fileType so local-store renders the correct element type
          fileType: img.fileType || (_pendingFiles[i]?.type?.startsWith('video/') ? 'video' : 'image'),
          author: img.uploader?.username || LegendAPI.auth.getUser()?.username || 'Unknown',
          likeCount: 0,
          likedByMe: false,
          isOwn: true,
          createdAt: img.createdAt,
        });
      });
      uploaded++;
    } catch (err) {
      console.warn('[AVN] Gallery upload error:', err);
      if (errEl) {
        errEl.textContent = 'Your upload could not be completed. Please try again.';
        errEl.classList.remove('hidden');
      }
    }
  }

  if (progressFill) progressFill.style.width = '100%';
  if (progressText) progressText.textContent = 'Done!';

  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Upload'; }

  if (uploaded > 0) {
    setTimeout(() => {
      if (progressDiv) progressDiv.classList.add('hidden');
      Modal.close('gallery-upload-modal');
      const noun = _pendingFiles.some(f => f.type?.startsWith('video/')) ? 'item' : 'image';
      Toast.success(`${uploaded} ${noun}${uploaded > 1 ? 's' : ''} uploaded!`);
      _pendingFiles = [];
      loadGallery(GalleryState.currentFilter, GalleryState.currentQuery);
    }, 500);
  } else {
    if (progressDiv) progressDiv.classList.add('hidden');
  }
};
