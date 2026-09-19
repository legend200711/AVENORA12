/**
 * AVENORA - Shared UI Utilities
 * Toast notifications, modal manager, input sanitization, formatting
 */

(function (global) {
  'use strict';

  // ─── Toast ────────────────────────────────────────────────
  function initToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  const Toast = {
    show(message, type = 'info', duration = 4000) {
      const container = initToastContainer();
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.textContent = message;
      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 300ms';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    },
    success: (msg, d) => Toast.show(msg, 'success', d),
    error: (msg, d) => Toast.show(msg, 'error', d),
    info: (msg, d) => Toast.show(msg, 'info', d),
    warning: (msg, d) => Toast.show(msg, 'warning', d),
  };

  // ─── Modal ────────────────────────────────────────────────
  const Modal = {
    activeStack: [],

    open(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('hidden');
      this.activeStack.push(id);
      document.body.style.overflow = 'hidden';
    },

    close(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.add('hidden');
      this.activeStack = this.activeStack.filter(i => i !== id);
      if (this.activeStack.length === 0) document.body.style.overflow = '';
    },

    closeAll() {
      [...this.activeStack].forEach(id => this.close(id));
    },

    // Create modal dynamically
    create({ id, title, body, actions = [] }) {
      let el = document.getElementById(id);
      if (el) el.remove();

      el = document.createElement('div');
      el.id = id;
      el.className = 'modal-backdrop hidden';
      el.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
          <div class="modal-header">
            <h3 id="${id}-title" style="margin:0"></h3>
            <button class="btn btn-ghost btn-sm" onclick="Modal.close('${id}')" aria-label="Close">✕</button>
          </div>
          <div class="modal-body">${body}</div>
          ${actions.length ? `<div class="modal-footer">${actions.map(a =>
            `<button class="btn ${a.class || 'btn-outline'}" onclick="${a.onclick}">${escapeHtml(a.label)}</button>`
          ).join('')}</div>` : ''}
        </div>
      `;
      // Set title safely via textContent — prevents XSS and also fixes the
      // double-encoding issue where callers pass already-escaped strings that
      // then get re-escaped and rendered as literal entity text (e.g. &#x27;).
      const titleEl = el.querySelector(`#${id}-title`);
      if (titleEl) titleEl.textContent = title;

      // Close on backdrop click
      el.addEventListener('click', (e) => {
        if (e.target === el) this.close(id);
      });

      document.body.appendChild(el);
      return el;
    },
  };

  // ─── Input sanitization ───────────────────────────────────
  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  function sanitizeText(str, maxLen = 1000) {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>]/g, '').slice(0, maxLen).trim();
  }

  // ─── Formatting ───────────────────────────────────────────
  function formatCount(n) {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n || 0);
  }

  function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /**
   * Normalise a date value that may be:
   *  - a Firestore Timestamp object  { seconds, nanoseconds }
   *  - a plain JS Date
   *  - an ISO/RFC date string
   *  - a numeric Unix timestamp (ms)
   * Returns a JS Date, or null if unparseable.
   */
  function _toDate(val) {
    if (!val) return null;
    // Firestore Timestamp (has .toDate() method)
    if (typeof val === 'object' && typeof val.toDate === 'function') {
      const d = val.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    }
    // Plain object with seconds (Firestore Timestamp serialised to POJO)
    if (typeof val === 'object' && typeof val.seconds === 'number') {
      const d = new Date(val.seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    // Numeric Unix timestamp (ms or s)
    if (typeof val === 'number') {
      // If the number looks like seconds (< year 3000 in ms), treat as ms
      const d = new Date(val > 1e12 ? val : val * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof val === 'string' && val) {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  function formatTimeAgo(dateVal) {
    if (!dateVal) return '';
    const date = _toDate(dateVal);
    if (!date) return '';
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 0)    return 'just now';          // clock skew guard
    if (diff < 60)   return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    try { return date.toLocaleDateString(); } catch { return ''; }
  }

  function formatDate(dateVal) {
    if (!dateVal) return '';
    const date = _toDate(dateVal);
    if (!date) return '';
    try {
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return ''; }
  }

  // ─── Avatar ───────────────────────────────────────────────
  function avatarHtml(user, size = 'md') {
    if (!user) return `<div class="avatar-placeholder avatar-${size}">?</div>`;
    const initials = (user.profile?.displayName || user.username || '?')[0].toUpperCase();
    if (user.profile?.avatarUrl) {
      return `<img class="avatar avatar-${size}" src="${escapeHtml(user.profile.avatarUrl)}" alt="${escapeHtml(user.username)}" loading="lazy">`;
    }
    return `<div class="avatar-placeholder avatar-${size}" style="font-size:${size === 'sm' ? '12px' : size === 'lg' ? '24px' : '16px'}">${initials}</div>`;
  }

  // ─── Role badge ───────────────────────────────────────────
  function roleBadgeHtml(role) {
    const map = {
      moderator: '<span class="badge badge-mod">MOD</span>',
      founder: '<span class="badge badge-founder">FOUNDER</span>',
      admin: '<span class="badge badge-founder">ADMIN</span>',
    };
    return map[role] || '';
  }

  // ─── Error display ────────────────────────────────────────
  function showError(container, message, onRetry) {
    container.innerHTML = `
      <div class="error-state">
        <div class="error-icon">⚠️</div>
        <h3>Something went wrong</h3>
        <p>${escapeHtml(message)}</p>
        ${onRetry ? `<button class="btn btn-outline" onclick="(${onRetry.toString()})()">Try Again</button>` : ''}
      </div>
    `;
  }

  function showLoading(container, text = 'Loading...') {
    container.innerHTML = `
      <div class="loading-state">
        <div class="spinner spinner-lg"></div>
        <span>${escapeHtml(text)}</span>
      </div>
    `;
  }

  // ─── Debounce / throttle ──────────────────────────────────
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function throttle(fn, ms) {
    let last = 0;
    return (...args) => {
      const now = Date.now();
      if (now - last >= ms) { last = now; fn(...args); }
    };
  }

  // ─── Local storage helpers ────────────────────────────────
  const LS = {
    get(key, def = null) {
      try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : def; } catch { return def; }
    },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
    remove(key) { try { localStorage.removeItem(key); } catch {} },
  };

  // ─── Exports ──────────────────────────────────────────────
  global.Toast = Toast;
  global.Modal = Modal;
  global.escapeHtml = escapeHtml;
  global.sanitizeText = sanitizeText;
  global.formatCount = formatCount;
  global.formatDuration = formatDuration;
  global.formatTimeAgo = formatTimeAgo;
  global.formatDate = formatDate;
  global.avatarHtml = avatarHtml;
  global.roleBadgeHtml = roleBadgeHtml;
  global.showError = showError;
  global.showLoading = showLoading;
  global.debounce = debounce;
  global.throttle = throttle;
  global.LS = LS;

})(window);
