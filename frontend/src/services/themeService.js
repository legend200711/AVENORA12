/**
 * AVENORA — Founder Theme Token Service
 * Applies a published theme's design tokens as CSS custom properties
 * on <html>. All pages benefit without page-specific changes.
 *
 * Loading priority:
 *   1. Immediate: cached tokens from localStorage (no flash)
 *   2. Async: tokens from /api/themes/active (published founder theme)
 *   3. Fallback: base theme.css :root values (always safe)
 *
 * This module is intentionally read-only for non-founders.
 * The Theme Control Center section in admin.js handles writes.
 */

(function (global) {
  'use strict';

  const CACHE_KEY = 'avn_founder_theme_v1';
  const CACHE_TS_KEY = 'avn_founder_theme_ts_v1';
  // Re-fetch from server if cached value is older than 5 minutes
  const CACHE_TTL_MS = 5 * 60 * 1000;

  // ── CSS variable map: token path → CSS var name ───────────
  const TOKEN_MAP = {
    // Colors
    'colors.bgPrimary':     '--bg-primary',
    'colors.bgSecondary':   '--bg-secondary',
    'colors.bgCard':        '--bg-card',
    'colors.bgElevated':    '--bg-elevated',
    'colors.textPrimary':   '--text-primary',
    'colors.textSecondary': '--text-secondary',
    'colors.textMuted':     '--text-muted',
    'colors.accent':        ['--neon-blue', '--avenora-gold'],
    'colors.accentDim':     ['--neon-blue-dim', '--avenora-bronze'],
    'colors.buttonBg':      '--btn-bg',            // custom var, used by btn-primary
    'colors.buttonText':    '--btn-text',
    'colors.borderSubtle':  '--border-subtle',
    'colors.borderAccent':  '--border-blue',
    'colors.textLink':      '--text-link',
    'colors.success':       '--neon-green',
    'colors.warning':       '--neon-orange',
    'colors.error':         '--neon-red',
    'colors.emerald':       '--avenora-emerald',
    'colors.violet':        '--avenora-violet',
    // Typography
    'typography.fontHeading':   '--font-display',
    'typography.fontBody':      '--font-main',
    'typography.fontMono':      '--font-mono',
    'typography.baseFontSize':  null,  // applied to html.style.fontSize directly
    'typography.lineHeight':    null,  // applied to body.style.lineHeight
    // Motion
    'motion.transitionSpeed':  null,   // mapped to transition vars below
  };

  const TRANSITION_SPEED_MAP = {
    slow:   { fast: '250ms', base: '400ms', slow: '600ms' },
    normal: { fast: '150ms', base: '250ms', slow: '400ms' },
    fast:   { fast: '80ms',  base: '150ms', slow: '250ms' },
  };

  // ── Apply tokens to the live DOM ──────────────────────────
  function applyTokens(tokens) {
    if (!tokens || typeof tokens !== 'object') return;
    const root = document.documentElement;

    // Colors
    const c = tokens.colors || {};
    const colorEntries = {
      '--bg-primary':     c.bgPrimary,
      '--bg-secondary':   c.bgSecondary,
      '--bg-card':        c.bgCard,
      '--bg-elevated':    c.bgElevated,
      '--text-primary':   c.textPrimary,
      '--text-secondary': c.textSecondary,
      '--text-muted':     c.textMuted,
      '--text-link':      c.textLink || c.accent,
      '--neon-blue':      c.accent,
      '--neon-blue-dim':  c.accentDim,
      '--avenora-gold':   c.accent,
      '--avenora-bronze': c.accentDim,
      '--neon-green':     c.success,
      '--neon-orange':    c.warning,
      '--neon-red':       c.error,
      '--avenora-emerald': c.emerald,
      '--avenora-violet':  c.violet,
      '--border-subtle':  c.borderSubtle,
      '--border-blue':    c.borderAccent,
    };

    for (const [varName, value] of Object.entries(colorEntries)) {
      if (value != null && value !== '') {
        root.style.setProperty(varName, value);
      }
    }

    // Derived: glow vars from accent color
    if (c.accent) {
      const rgb = _hexToRgb(c.accent);
      if (rgb) {
        root.style.setProperty('--glow-blue', `0 0 18px rgba(${rgb},0.35)`);
        root.style.setProperty('--grad-blue', `linear-gradient(135deg, rgba(${rgb},0.12), rgba(${_hexToRgb(c.accentDim) || rgb},0.07))`);
      }
    }

    // Typography
    const t = tokens.typography || {};
    if (t.fontHeading) root.style.setProperty('--font-display', t.fontHeading);
    if (t.fontBody)    root.style.setProperty('--font-main',    t.fontBody);
    if (t.fontMono)    root.style.setProperty('--font-mono',    t.fontMono);
    if (t.baseFontSize) {
      document.documentElement.style.fontSize = t.baseFontSize;
    }
    if (t.lineHeight) {
      document.body && (document.body.style.lineHeight = t.lineHeight);
    }

    // Motion
    const m = tokens.motion || {};
    const speeds = TRANSITION_SPEED_MAP[m.transitionSpeed] || TRANSITION_SPEED_MAP.normal;
    root.style.setProperty('--transition-fast', speeds.fast);
    root.style.setProperty('--transition-base', speeds.base);
    root.style.setProperty('--transition-slow', speeds.slow);

    if (m.animationIntensity === 'none' || m.reducedMotionRespect) {
      // Honour OS reduced-motion preference
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (m.animationIntensity === 'none' || prefersReduced) {
        document.body.classList.add('avn-reduced-motion');
      }
    }

    // Atmosphere: gothic intensity body class
    const atm = tokens.atmosphere || {};
    if (atm.gothicIntensity) {
      document.body.classList.remove('avn-gothic-subtle', 'avn-gothic-standard', 'avn-gothic-intense');
      document.body.classList.add(`avn-gothic-${atm.gothicIntensity}`);
    }
  }

  // ── Load from Firestore, apply, cache ─────────────────────
  // Reads founderThemes/active — the publicly-readable pointer doc written
  // by FounderThemeAPI.publish(). No backend URL required.
  async function loadAndApplyActive() {
    try {
      // Wait for Firebase to be ready (may not be initialised yet on first load)
      let fb = window.AvenoraFirebase;
      if (!fb) {
        for (let i = 0; i < 20 && !fb; i++) {
          await new Promise(r => setTimeout(r, 200));
          fb = window.AvenoraFirebase;
        }
      }
      if (!fb) return; // Firebase not available — keep cached theme

      const db = await fb.getFirestore();
      const { doc: fsDoc, getDoc } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      const snap = await getDoc(fsDoc(db, 'founderThemes', 'active'));
      if (!snap.exists()) return; // No published theme yet
      const active = snap.data();
      if (active && active.tokens) {
        applyTokens(active.tokens);
        _saveCache({ _id: active.themeId, name: active.name, tokens: active.tokens });
        // Tell the companion to re-check Easter egg visibility now that the
        // cache is up-to-date with the new easterEggEnabled value.
        if (window.AVNCompanion?.refreshEasterEgg) {
          window.AVNCompanion.refreshEasterEgg();
        }
      }
    } catch {
      // Non-critical — base theme.css handles fallback
    }
  }

  // ── Instant restore from localStorage ─────────────────────
  function restoreFromCache() {
    const cached = _loadCache();
    if (cached && cached.tokens) {
      applyTokens(cached.tokens);
      return true;
    }
    return false;
  }

  // ── Cache helpers ─────────────────────────────────────────
  function _saveCache(theme) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(theme));
      localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
    } catch {}
  }

  function _loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function _isCacheStale() {
    const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0');
    return (Date.now() - ts) > CACHE_TTL_MS;
  }

  function _hexToRgb(hex) {
    if (!hex || !hex.startsWith('#')) return null;
    const h = hex.replace('#', '');
    if (h.length < 6) return null;
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `${r},${g},${b}`;
  }

  // ── Initialisation ────────────────────────────────────────
  // Phase 1: Apply cached tokens immediately (zero-flash)
  const hadCache = restoreFromCache();

  // Phase 2: If cache is stale or absent, fetch from server async
  if (!hadCache || _isCacheStale()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', loadAndApplyActive);
    } else {
      loadAndApplyActive();
    }
  }

  // ── Public API (used by the Theme Control Center) ─────────
  global.AvenoraTheme = {
    /**
     * Apply tokens immediately to the live page (preview mode — does not save).
     */
    preview(tokens) {
      applyTokens(tokens);
    },

    /**
     * Reload the published theme from the server and apply it.
     * Called after a publish or rollback action.
     */
    async reload() {
      await loadAndApplyActive();
    },

    /**
     * Clear the theme cache (e.g. after a logout or factory reset).
     */
    clearCache() {
      try {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_TS_KEY);
      } catch {}
    },

    /**
     * Return a snapshot of the currently-cached theme (or null).
     */
    getCached() {
      return _loadCache();
    },
  };

})(window);
