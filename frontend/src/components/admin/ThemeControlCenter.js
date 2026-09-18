/**
 * AVENORA — Founder Theme Control Center
 * Admin panel section: theme editor, presets, live preview,
 * version history, and publishing.
 *
 * Access: founder/admin role only.
 * All writes are verified server-side. This file contains only
 * presentation logic and API calls — never credentials, private
 * emails, or platform secrets.
 */

/* ═══════════════════════════════════════════════════════════
   BUILT-IN PRESETS
   ═══════════════════════════════════════════════════════════ */
const TCC_PRESETS = {
  'gothic-egyptian': {
    name: 'Avenora Gothic Egyptian',
    swatch: 'linear-gradient(135deg,#090807 50%,#b8954b)',
    tokens: {
      colors: {
        bgPrimary: '#090807', bgSecondary: '#171513', bgCard: '#131210', bgElevated: '#1e1b17',
        textPrimary: '#eee4cf', textSecondary: '#b0a08a', textMuted: '#6b5e4e',
        accent: '#b8954b', accentDim: '#76552f', buttonBg: '#b8954b', buttonText: '#090807',
        borderSubtle: 'rgba(184,149,75,0.12)', borderAccent: 'rgba(184,149,75,0.28)',
        textLink: '#b8954b', success: '#4a9e72', warning: '#b87040', error: '#c0394a',
        emerald: '#21483c', violet: '#30213f',
      },
      typography: { fontHeading: "'Cinzel','Rajdhani',serif", fontBody: "-apple-system,'Segoe UI',system-ui,sans-serif", baseFontSize: '15px', lineHeight: '1.6', headingStyle: 'egyptian' },
      atmosphere: { gothicIntensity: 'standard', goldIntensity: 70, starsEnabled: true, starsIntensity: 60, fogEnabled: true, fogIntensity: 30, shadowIntensity: 50, easterEggEnabled: true },
      motion: { animationIntensity: 'normal', transitionSpeed: 'normal', particlesEnabled: true, ambientMovement: true, hoverEffects: true, reducedMotionRespect: true },
    },
  },
  'obsidian-gold': {
    name: 'Obsidian Gold',
    swatch: 'linear-gradient(135deg,#050403 50%,#d4a74a)',
    tokens: {
      colors: {
        bgPrimary: '#050403', bgSecondary: '#0d0b09', bgCard: '#0a0806', bgElevated: '#141210',
        textPrimary: '#f5e8c5', textSecondary: '#c8a860', textMuted: '#7a6a50',
        accent: '#d4a74a', accentDim: '#8a6b28', buttonBg: '#d4a74a', buttonText: '#050403',
        borderSubtle: 'rgba(212,167,74,0.14)', borderAccent: 'rgba(212,167,74,0.32)',
        textLink: '#d4a74a', success: '#4a9e72', warning: '#c07830', error: '#c0394a',
        emerald: '#1a3a2c', violet: '#28194e',
      },
      typography: { fontHeading: "'Cinzel','Rajdhani',serif", fontBody: "-apple-system,'Segoe UI',sans-serif", baseFontSize: '15px', lineHeight: '1.6', headingStyle: 'egyptian' },
      atmosphere: { gothicIntensity: 'intense', goldIntensity: 90, starsEnabled: true, starsIntensity: 80, fogEnabled: false, fogIntensity: 10, shadowIntensity: 70, easterEggEnabled: true },
      motion: { animationIntensity: 'full', transitionSpeed: 'normal', particlesEnabled: true, ambientMovement: true, hoverEffects: true, reducedMotionRespect: true },
    },
  },
  'emerald-night': {
    name: 'Emerald Night',
    swatch: 'linear-gradient(135deg,#061209 50%,#3a9e72)',
    tokens: {
      colors: {
        bgPrimary: '#061209', bgSecondary: '#0d1f14', bgCard: '#0b1a10', bgElevated: '#122018',
        textPrimary: '#d4ede0', textSecondary: '#7fc49a', textMuted: '#3d6650',
        accent: '#3a9e72', accentDim: '#1e6045', buttonBg: '#3a9e72', buttonText: '#061209',
        borderSubtle: 'rgba(58,158,114,0.14)', borderAccent: 'rgba(58,158,114,0.30)',
        textLink: '#3a9e72', success: '#3a9e72', warning: '#b87040', error: '#c0394a',
        emerald: '#1a4030', violet: '#2a1f40',
      },
      typography: { fontHeading: "'Cinzel','Rajdhani',serif", fontBody: "-apple-system,'Segoe UI',sans-serif", baseFontSize: '15px', lineHeight: '1.6', headingStyle: 'egyptian' },
      atmosphere: { gothicIntensity: 'standard', goldIntensity: 20, starsEnabled: true, starsIntensity: 50, fogEnabled: true, fogIntensity: 40, shadowIntensity: 40, easterEggEnabled: true },
      motion: { animationIntensity: 'normal', transitionSpeed: 'normal', particlesEnabled: true, ambientMovement: true, hoverEffects: true, reducedMotionRespect: true },
    },
  },
  'midnight-violet': {
    name: 'Midnight Violet',
    swatch: 'linear-gradient(135deg,#08060f 50%,#8866bb)',
    tokens: {
      colors: {
        bgPrimary: '#08060f', bgSecondary: '#120d1c', bgCard: '#0f0b18', bgElevated: '#1a1428',
        textPrimary: '#e8daf5', textSecondary: '#a888d4', textMuted: '#5a4878',
        accent: '#8866bb', accentDim: '#4a2e88', buttonBg: '#8866bb', buttonText: '#08060f',
        borderSubtle: 'rgba(136,102,187,0.14)', borderAccent: 'rgba(136,102,187,0.30)',
        textLink: '#9977cc', success: '#4a9e72', warning: '#b87040', error: '#c0394a',
        emerald: '#1a2040', violet: '#30214f',
      },
      typography: { fontHeading: "'Cinzel','Rajdhani',serif", fontBody: "-apple-system,'Segoe UI',sans-serif", baseFontSize: '15px', lineHeight: '1.6', headingStyle: 'egyptian' },
      atmosphere: { gothicIntensity: 'intense', goldIntensity: 10, starsEnabled: true, starsIntensity: 90, fogEnabled: true, fogIntensity: 50, shadowIntensity: 60, easterEggEnabled: true },
      motion: { animationIntensity: 'full', transitionSpeed: 'slow', particlesEnabled: true, ambientMovement: true, hoverEffects: true, reducedMotionRespect: true },
    },
  },
  'blood-moon': {
    name: 'Blood Moon',
    swatch: 'linear-gradient(135deg,#0f0507 50%,#c0394a)',
    tokens: {
      colors: {
        bgPrimary: '#0f0507', bgSecondary: '#1a080c', bgCard: '#160609', bgElevated: '#220b10',
        textPrimary: '#f0d8d8', textSecondary: '#c07080', textMuted: '#6a3a42',
        accent: '#c0394a', accentDim: '#7a1828', buttonBg: '#c0394a', buttonText: '#0f0507',
        borderSubtle: 'rgba(192,57,74,0.14)', borderAccent: 'rgba(192,57,74,0.30)',
        textLink: '#d04858', success: '#4a9e72', warning: '#b87040', error: '#c0394a',
        emerald: '#1a1010', violet: '#2a1020',
      },
      typography: { fontHeading: "'Cinzel','Rajdhani',serif", fontBody: "-apple-system,'Segoe UI',sans-serif", baseFontSize: '15px', lineHeight: '1.6', headingStyle: 'egyptian' },
      atmosphere: { gothicIntensity: 'intense', goldIntensity: 5, starsEnabled: true, starsIntensity: 70, fogEnabled: true, fogIntensity: 60, shadowIntensity: 80, easterEggEnabled: true },
      motion: { animationIntensity: 'normal', transitionSpeed: 'slow', particlesEnabled: true, ambientMovement: true, hoverEffects: true, reducedMotionRespect: true },
    },
  },
  'ancient-bronze': {
    name: 'Ancient Bronze',
    swatch: 'linear-gradient(135deg,#0c0905 50%,#a0702a)',
    tokens: {
      colors: {
        bgPrimary: '#0c0905', bgSecondary: '#1a1408', bgCard: '#141008', bgElevated: '#201810',
        textPrimary: '#e8d4a0', textSecondary: '#c09a60', textMuted: '#7a6040',
        accent: '#a0702a', accentDim: '#60401a', buttonBg: '#a0702a', buttonText: '#0c0905',
        borderSubtle: 'rgba(160,112,42,0.14)', borderAccent: 'rgba(160,112,42,0.30)',
        textLink: '#b07830', success: '#4a9e72', warning: '#b87040', error: '#c0394a',
        emerald: '#1c2010', violet: '#20181a',
      },
      typography: { fontHeading: "'Cinzel','Rajdhani',serif", fontBody: "-apple-system,'Segoe UI',sans-serif", baseFontSize: '15px', lineHeight: '1.6', headingStyle: 'egyptian' },
      atmosphere: { gothicIntensity: 'subtle', goldIntensity: 60, starsEnabled: false, starsIntensity: 20, fogEnabled: false, fogIntensity: 10, shadowIntensity: 40, easterEggEnabled: true },
      motion: { animationIntensity: 'reduced', transitionSpeed: 'normal', particlesEnabled: false, ambientMovement: false, hoverEffects: true, reducedMotionRespect: true },
    },
  },
  'minimal-dark': {
    name: 'Minimal Dark',
    swatch: 'linear-gradient(135deg,#111111 50%,#444444)',
    tokens: {
      colors: {
        bgPrimary: '#111111', bgSecondary: '#1a1a1a', bgCard: '#181818', bgElevated: '#222222',
        textPrimary: '#f0f0f0', textSecondary: '#a0a0a0', textMuted: '#606060',
        accent: '#888888', accentDim: '#505050', buttonBg: '#444444', buttonText: '#f0f0f0',
        borderSubtle: 'rgba(255,255,255,0.08)', borderAccent: 'rgba(255,255,255,0.18)',
        textLink: '#aaaaaa', success: '#4a9e72', warning: '#b87040', error: '#c0394a',
        emerald: '#1a2020', violet: '#1a1a22',
      },
      typography: { fontHeading: "-apple-system,'Segoe UI',system-ui,sans-serif", fontBody: "-apple-system,'Segoe UI',system-ui,sans-serif", baseFontSize: '15px', lineHeight: '1.65', headingStyle: 'minimal' },
      atmosphere: { gothicIntensity: 'subtle', goldIntensity: 0, starsEnabled: false, starsIntensity: 0, fogEnabled: false, fogIntensity: 0, shadowIntensity: 20, easterEggEnabled: true },
      motion: { animationIntensity: 'reduced', transitionSpeed: 'fast', particlesEnabled: false, ambientMovement: false, hoverEffects: true, reducedMotionRespect: true },
    },
  },
  'high-contrast': {
    name: 'Accessibility High Contrast',
    swatch: 'linear-gradient(135deg,#000000 50%,#ffffff)',
    tokens: {
      colors: {
        bgPrimary: '#000000', bgSecondary: '#111111', bgCard: '#0a0a0a', bgElevated: '#1a1a1a',
        textPrimary: '#ffffff', textSecondary: '#e8e8e8', textMuted: '#aaaaaa',
        accent: '#ffee00', accentDim: '#ccbb00', buttonBg: '#ffee00', buttonText: '#000000',
        borderSubtle: 'rgba(255,255,255,0.3)', borderAccent: 'rgba(255,238,0,0.6)',
        textLink: '#44aaff', success: '#44ff88', warning: '#ffaa00', error: '#ff4444',
        emerald: '#003300', violet: '#110022',
      },
      typography: { fontHeading: "-apple-system,'Segoe UI',system-ui,sans-serif", fontBody: "-apple-system,'Segoe UI',system-ui,sans-serif", baseFontSize: '16px', lineHeight: '1.7', headingStyle: 'minimal' },
      atmosphere: { gothicIntensity: 'subtle', goldIntensity: 0, starsEnabled: false, starsIntensity: 0, fogEnabled: false, fogIntensity: 0, shadowIntensity: 0, easterEggEnabled: true },
      motion: { animationIntensity: 'none', transitionSpeed: 'fast', particlesEnabled: false, ambientMovement: false, hoverEffects: false, reducedMotionRespect: true },
    },
  },
  'seasonal': {
    name: 'Seasonal Founder Theme',
    swatch: 'linear-gradient(135deg,#0a0c1a 50%,#e8c060)',
    tokens: {
      colors: {
        bgPrimary: '#0a0c1a', bgSecondary: '#131826', bgCard: '#111522', bgElevated: '#1c2235',
        textPrimary: '#f0ead8', textSecondary: '#c0b890', textMuted: '#6a6050',
        accent: '#e8c060', accentDim: '#a88030', buttonBg: '#e8c060', buttonText: '#0a0c1a',
        borderSubtle: 'rgba(232,192,96,0.12)', borderAccent: 'rgba(232,192,96,0.28)',
        textLink: '#e8c060', success: '#4a9e72', warning: '#c07030', error: '#c0394a',
        emerald: '#102040', violet: '#201040',
      },
      typography: { fontHeading: "'Cinzel','Rajdhani',serif", fontBody: "-apple-system,'Segoe UI',sans-serif", baseFontSize: '15px', lineHeight: '1.6', headingStyle: 'egyptian' },
      atmosphere: { gothicIntensity: 'standard', goldIntensity: 80, starsEnabled: true, starsIntensity: 70, fogEnabled: true, fogIntensity: 20, shadowIntensity: 45, easterEggEnabled: true },
      motion: { animationIntensity: 'normal', transitionSpeed: 'normal', particlesEnabled: true, ambientMovement: true, hoverEffects: true, reducedMotionRespect: true },
    },
  },
};

/* ═══════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════ */
let _tcc = {
  themes: [],          // list from server
  editingId: null,     // ID of the theme being edited (null = new)
  draft: null,         // working copy of tokens
  draftName: '',
  draftNotes: '',
  selectedPresetKey: null,
  activeTab: 'colors', // colors | typography | atmosphere | motion | components
  previewTab: 'homepage',
  saving: false,
  publishing: false,
  statusMsg: null,
  statusType: 'info',
};

function _tccReset() {
  _tcc = {
    themes: [], editingId: null, draft: null, draftName: '', draftNotes: '',
    selectedPresetKey: null, activeTab: 'colors', previewTab: 'homepage',
    saving: false, publishing: false, statusMsg: null, statusType: 'info',
  };
}


/* ═══════════════════════════════════════════════════════════
   DEEP MERGE & DEFAULTS
   ═══════════════════════════════════════════════════════════ */
function _tccMerge(base, over) {
  const out = Object.assign({}, base);
  for (const k of Object.keys(over || {})) {
    if (over[k] !== null && typeof over[k] === 'object' && !Array.isArray(over[k])) {
      out[k] = _tccMerge(base[k] || {}, over[k]);
    } else if (over[k] !== undefined) {
      out[k] = over[k];
    }
  }
  return out;
}

function _tccDefaultTokens() {
  return JSON.parse(JSON.stringify(TCC_PRESETS['gothic-egyptian'].tokens));
}

/* ═══════════════════════════════════════════════════════════
   MAIN RENDER ENTRY
   ═══════════════════════════════════════════════════════════ */
/**
 * Called from admin.js adminSection('theme').
 * Renders the Theme Control Center into `container`.
 * Returns a cleanup function.
 */
async function renderThemeControlCenter(container) {
  container.innerHTML = `
    <div class="tcc-root">
      <div class="tcc-header">
        <h2>🎨 THEME CONTROL CENTER</h2>
        <p class="tcc-subtitle">Founder Visual Design System — changes apply site-wide on publish</p>
      </div>
      <div id="tcc-status-bar" class="tcc-status-bar" role="status" aria-live="polite"></div>
      <div id="tcc-body">
        <div class="loading-state"><div class="spinner"></div><span>Loading themes...</span></div>
      </div>
    </div>
  `;

  try {
    const [listRes, publishedRes] = await Promise.all([
      LegendAPI.founderTheme.list(),
      LegendAPI.founderTheme.published(),
    ]);
    _tcc.themes = listRes.themes || [];
    const published = publishedRes.theme;

    // Start with the published theme (if any), else Gothic Egyptian preset
    if (published) {
      _tcc.editingId = published._id;
      _tcc.draft = _tccMerge(_tccDefaultTokens(), published.tokens || {});
      _tcc.draftName = published.name;
      _tcc.draftNotes = published.notes || '';
      _tcc.selectedPresetKey = published.presetKey || null;
    } else {
      _tcc.editingId = null;
      _tcc.draft = _tccDefaultTokens();
      _tcc.draftName = 'My First Theme';
      _tcc.selectedPresetKey = 'gothic-egyptian';
    }

    _tccRenderEditor();
  } catch (err) {
    // Log the real error code for diagnostics
    console.error('[TCC] Load error — Firestore code:', err.code, '| message:', err.message, '| full error:', err);
    const isPermission = err.code === 'permission-denied' || err.code === 'PERMISSION_DENIED';
    const isIndex = err.message && err.message.includes('index');
    const detail = isPermission
      ? 'Permission denied. Ensure your account has the "founder" or "admin" role in the users collection.'
      : isIndex
      ? 'Firestore index is still building. Please wait a minute and try again.'
      : `Firebase error: ${err.code || ''} — ${err.message || 'Unknown error'}`;
    document.getElementById('tcc-body').innerHTML = `
      <div class="error-state">
        <div class="error-icon">⚠\uFE0F</div>
        <h3>Could not load Theme Control Center</h3>
        <p>${_tccEscape(detail)}</p>
        <button class="btn btn-outline" onclick="renderThemeControlCenter(document.getElementById('admin-content'))">Retry</button>
      </div>
    `;
  }
}

window.renderThemeControlCenter = renderThemeControlCenter;

/* ═══════════════════════════════════════════════════════════
   EDITOR RENDER
   ═══════════════════════════════════════════════════════════ */
function _tccRenderEditor() {
  const body = document.getElementById('tcc-body');
  if (!body) return;

  body.innerHTML = `
    <!-- Action bar -->
    <div class="tcc-actions" role="toolbar" aria-label="Theme actions">
      <div style="display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap;flex:1">
        <label class="tcc-label" for="tcc-theme-name" style="white-space:nowrap;margin:0">Theme Name:</label>
        <input class="tcc-input" id="tcc-theme-name" type="text" maxlength="80"
          value="${_tccEscape(_tcc.draftName)}" placeholder="My Theme"
          style="max-width:280px"
          oninput="tccSetName(this.value)"
          aria-label="Theme name">
        ${_tcc.editingId ? `<span class="tcc-status-pill ${_tccGetStatusClass()}" id="tcc-status-pill">${_tccGetStatusLabel()}</span>` : ''}
      </div>
      <div class="tcc-actions-right">
        <button class="btn btn-ghost btn-sm" onclick="tccPreviewActive()" title="Preview current settings on the live page">
          👁 Preview
        </button>
        <button class="btn btn-outline btn-sm" onclick="tccSaveDraft()" id="tcc-btn-save" aria-label="Save as draft">
          💾 Save Draft
        </button>
        <button class="btn btn-primary btn-sm" onclick="tccPublish()" id="tcc-btn-publish" aria-label="Publish theme to all pages">
          🚀 Publish
        </button>
        <button class="btn btn-ghost btn-sm" onclick="tccCancelChanges()" aria-label="Cancel changes">
          ✕ Cancel
        </button>
        <button class="btn btn-ghost btn-sm" onclick="tccRestoreDefaults()" aria-label="Restore defaults" title="Reset to Gothic Egyptian defaults">
          ↺ Defaults
        </button>
      </div>
    </div>

    <!-- Two-column layout -->
    <div class="tcc-layout">
      <!-- Left: Editor tabs -->
      <div>
        <!-- Preset selector -->
        <div class="tcc-section">
          <div class="tcc-section-title">Start from a preset</div>
          <div class="tcc-presets" role="list">
            ${Object.entries(TCC_PRESETS).map(([key, p]) => `
              <button class="tcc-preset-btn ${_tcc.selectedPresetKey === key ? 'active' : ''}"
                onclick="tccApplyPreset('${key}')"
                role="listitem"
                aria-pressed="${_tcc.selectedPresetKey === key}"
                aria-label="Apply ${p.name} preset">
                <span class="tcc-preset-swatch" style="background:${p.swatch}" aria-hidden="true"></span>
                ${_tccEscape(p.name)}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Main tabs -->
        <div class="tcc-tabs" role="tablist" aria-label="Theme editor sections">
          ${[
            ['colors',     '🎨 Colors'],
            ['typography', '✍️ Typography'],
            ['atmosphere', '🌌 Atmosphere'],
            ['motion',     '✨ Motion'],
            ['history',    '📜 History'],
          ].map(([id, label]) => `
            <button class="tcc-tab-btn ${_tcc.activeTab === id ? 'active' : ''}"
              role="tab" aria-selected="${_tcc.activeTab === id}"
              id="tcc-editor-tab-${id}"
              aria-controls="tcc-editor-panel-${id}"
              onclick="tccSetTab('${id}')">
              ${label}
            </button>
          `).join('')}
        </div>

        <!-- Tab panels -->
        <div id="tcc-editor-panel-colors" class="tcc-tab-panel ${_tcc.activeTab === 'colors' ? 'active' : ''}" role="tabpanel" aria-labelledby="tcc-editor-tab-colors">
          ${_tccRenderColorsPanel()}
        </div>
        <div id="tcc-editor-panel-typography" class="tcc-tab-panel ${_tcc.activeTab === 'typography' ? 'active' : ''}" role="tabpanel" aria-labelledby="tcc-editor-tab-typography">
          ${_tccRenderTypographyPanel()}
        </div>
        <div id="tcc-editor-panel-atmosphere" class="tcc-tab-panel ${_tcc.activeTab === 'atmosphere' ? 'active' : ''}" role="tabpanel" aria-labelledby="tcc-editor-tab-atmosphere">
          ${_tccRenderAtmospherePanel()}
        </div>
        <div id="tcc-editor-panel-motion" class="tcc-tab-panel ${_tcc.activeTab === 'motion' ? 'active' : ''}" role="tabpanel" aria-labelledby="tcc-editor-tab-motion">
          ${_tccRenderMotionPanel()}
        </div>
        <div id="tcc-editor-panel-history" class="tcc-tab-panel ${_tcc.activeTab === 'history' ? 'active' : ''}" role="tabpanel" aria-labelledby="tcc-editor-tab-history">
          ${_tccRenderHistoryPanel()}
        </div>

        <!-- Notes -->
        <div class="tcc-section">
          <div class="tcc-section-title">Founder Notes</div>
          <textarea class="tcc-input" rows="2" maxlength="500" placeholder="Optional notes about this theme..."
            oninput="tccSetNotes(this.value)"
            aria-label="Theme notes"
            style="resize:vertical">${_tccEscape(_tcc.draftNotes)}</textarea>
        </div>
      </div>

      <!-- Right: Live preview -->
      ${_tccRenderPreviewPanel()}
    </div>

    <!-- All saved themes list -->
    <div class="tcc-section" style="margin-top:var(--space-lg)">
      <div class="tcc-section-title">Saved Themes</div>
      ${_tccRenderThemeList()}
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   COLORS PANEL
   ═══════════════════════════════════════════════════════════ */
function _tccRenderColorsPanel() {
  const c = _tcc.draft.colors || {};

  const colorDefs = [
    { key: 'bgPrimary',     label: 'Primary Background',     desc: 'Main page background color' },
    { key: 'bgSecondary',   label: 'Secondary Background',   desc: 'Nav and secondary surfaces' },
    { key: 'bgCard',        label: 'Card Background',        desc: 'Post cards, panels, and tiles' },
    { key: 'bgElevated',    label: 'Elevated Surface',       desc: 'Inputs, raised elements, tooltips' },
    { key: 'textPrimary',   label: 'Primary Text',           desc: 'Headings and main body text' },
    { key: 'textSecondary', label: 'Secondary Text',         desc: 'Sub-headings and descriptions' },
    { key: 'textMuted',     label: 'Muted Text',             desc: 'Timestamps, placeholders' },
    { key: 'accent',        label: 'Accent Color',           desc: 'Buttons, highlights, active states' },
    { key: 'accentDim',     label: 'Accent Dim',             desc: 'Hover states and dimmer accents' },
    { key: 'buttonBg',      label: 'Primary Button',         desc: 'Main call-to-action button color' },
    { key: 'buttonText',    label: 'Button Text',            desc: 'Text on primary buttons' },
    { key: 'textLink',      label: 'Link Color',             desc: 'Hyperlinks and clickable text' },
    { key: 'success',       label: 'Success',                desc: 'Success states and indicators' },
    { key: 'warning',       label: 'Warning',                desc: 'Warning and caution states' },
    { key: 'error',         label: 'Error / Danger',         desc: 'Error messages and delete actions' },
    { key: 'emerald',       label: 'Egyptian Emerald',       desc: 'Emerald accent layer color' },
    { key: 'violet',        label: 'Midnight Violet',        desc: 'Violet accent layer color' },
  ];

  // rgba border values — use text input only
  const borderDefs = [
    { key: 'borderSubtle', label: 'Border Subtle',  desc: 'Faint dividers and card borders' },
    { key: 'borderAccent', label: 'Border Accent',  desc: 'Highlighted borders, focused elements' },
  ];

  return `
    <div class="tcc-section">
      <div class="tcc-section-title">Color Palette</div>
      <div class="tcc-grid">
        ${colorDefs.map(({ key, label, desc }) => `
          <div class="tcc-control">
            <label class="tcc-label" for="tcc-color-${key}">${label}</label>
            <p class="tcc-desc">${desc}</p>
            <div class="tcc-color-row">
              <label class="tcc-color-swatch" aria-label="${label} color picker" style="background:${_tccEscape(c[key] || '#090807')}">
                <input type="color" id="tcc-color-${key}"
                  value="${_tccHexForPicker(c[key] || '#090807')}"
                  oninput="tccColorInput('${key}',this.value)"
                  aria-label="${label} color">
              </label>
              <input class="tcc-color-hex" type="text" maxlength="9"
                value="${_tccEscape(c[key] || '#090807')}"
                id="tcc-color-hex-${key}"
                onchange="tccColorHexChange('${key}',this.value)"
                aria-label="${label} hex value"
                autocomplete="off">
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="tcc-section">
      <div class="tcc-section-title">Border Colors (CSS rgba values)</div>
      <div class="tcc-grid">
        ${borderDefs.map(({ key, label, desc }) => `
          <div class="tcc-control">
            <label class="tcc-label" for="tcc-border-${key}">${label}</label>
            <p class="tcc-desc">${desc}</p>
            <input class="tcc-input" type="text" id="tcc-border-${key}"
              value="${_tccEscape(c[key] || '')}"
              placeholder="rgba(184,149,75,0.12)"
              onchange="tccColorHexChange('${key}',this.value)"
              aria-label="${label} value"
              style="font-family:var(--font-mono);font-size:0.8rem">
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   TYPOGRAPHY PANEL
   ═══════════════════════════════════════════════════════════ */
function _tccRenderTypographyPanel() {
  const t = _tcc.draft.typography || {};
  return `
    <div class="tcc-section">
      <div class="tcc-section-title">Fonts &amp; Type</div>
      <div class="tcc-grid">
        <div class="tcc-control tcc-grid-wide">
          <label class="tcc-label" for="tcc-font-heading">Heading Font</label>
          <p class="tcc-desc">Used for display text, titles, and navigation. Cinzel gives the Egyptian aesthetic.</p>
          <input class="tcc-input" id="tcc-font-heading" type="text"
            value="${_tccEscape(t.fontHeading || "'Cinzel','Rajdhani',serif")}"
            onchange="tccTypoChange('fontHeading',this.value)"
            aria-label="Heading font stack"
            placeholder="'Cinzel','Rajdhani',serif">
        </div>
        <div class="tcc-control tcc-grid-wide">
          <label class="tcc-label" for="tcc-font-body">Body Font</label>
          <p class="tcc-desc">Used for post content, descriptions, and interface text.</p>
          <input class="tcc-input" id="tcc-font-body" type="text"
            value="${_tccEscape(t.fontBody || "-apple-system,'Segoe UI',sans-serif")}"
            onchange="tccTypoChange('fontBody',this.value)"
            aria-label="Body font stack"
            placeholder="-apple-system,'Segoe UI',sans-serif">
        </div>
        <div class="tcc-control">
          <label class="tcc-label" for="tcc-font-size">Base Font Size</label>
          <p class="tcc-desc">Base text size (10–24px). Affects all relative sizes.</p>
          <select class="tcc-select" id="tcc-font-size"
            onchange="tccTypoChange('baseFontSize',this.value)"
            aria-label="Base font size">
            ${['12px','13px','14px','15px','16px','17px','18px','19px','20px'].map(s =>
              `<option value="${s}" ${t.baseFontSize === s ? 'selected' : ''}>${s}</option>`
            ).join('')}
          </select>
        </div>
        <div class="tcc-control">
          <label class="tcc-label" for="tcc-line-height">Line Height</label>
          <p class="tcc-desc">Affects text readability. 1.5–1.8 recommended.</p>
          <select class="tcc-select" id="tcc-line-height"
            onchange="tccTypoChange('lineHeight',this.value)"
            aria-label="Line height">
            ${['1.4','1.5','1.6','1.65','1.7','1.8'].map(s =>
              `<option value="${s}" ${t.lineHeight === s ? 'selected' : ''}>${s}</option>`
            ).join('')}
          </select>
        </div>
        <div class="tcc-control">
          <label class="tcc-label" for="tcc-heading-weight">Heading Weight</label>
          <p class="tcc-desc">Font weight for headings.</p>
          <select class="tcc-select" id="tcc-heading-weight"
            onchange="tccTypoChange('headingWeight',this.value)"
            aria-label="Heading font weight">
            ${['400','500','600','700','800','900'].map(w =>
              `<option value="${w}" ${t.headingWeight === w ? 'selected' : ''}>${w}</option>`
            ).join('')}
          </select>
        </div>
        <div class="tcc-control">
          <label class="tcc-label" for="tcc-heading-style">Heading Style</label>
          <p class="tcc-desc">Visual style applied to headings.</p>
          <select class="tcc-select" id="tcc-heading-style"
            onchange="tccTypoChange('headingStyle',this.value)"
            aria-label="Heading style">
            ${[['egyptian','Egyptian / Display'],['modern','Modern Sans'],['serif','Classic Serif'],['minimal','Minimal']].map(([v,l]) =>
              `<option value="${v}" ${t.headingStyle === v ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
        </div>
        <div class="tcc-control">
          <label class="tcc-label" for="tcc-letter-spacing">Letter Spacing</label>
          <p class="tcc-desc">Heading letter spacing.</p>
          <select class="tcc-select" id="tcc-letter-spacing"
            onchange="tccTypoChange('letterSpacing',this.value)"
            aria-label="Letter spacing">
            ${[['normal','Normal'],['0.05em','Wide'],['0.1em','Wider'],['0.15em','Widest']].map(([v,l]) =>
              `<option value="${v}" ${t.letterSpacing === v ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
        </div>
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   ATMOSPHERE PANEL
   ═══════════════════════════════════════════════════════════ */
function _tccRenderAtmospherePanel() {
  const a = _tcc.draft.atmosphere || {};
  return `
    <div class="tcc-section">
      <div class="tcc-section-title">Gothic Egyptian Intensity</div>
      <div class="tcc-grid">
        <div class="tcc-control">
          <label class="tcc-label" for="tcc-gothic-intensity">Gothic Intensity</label>
          <p class="tcc-desc">Controls hieroglyphic motifs, border ornaments, and decoration density.</p>
          <select class="tcc-select" id="tcc-gothic-intensity"
            onchange="tccAtmChange('gothicIntensity',this.value)"
            aria-label="Gothic Egyptian intensity">
            ${[['subtle','Subtle'],['standard','Standard'],['intense','Intense']].map(([v,l]) =>
              `<option value="${v}" ${a.gothicIntensity === v ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
        </div>
        <div class="tcc-control">
          <label class="tcc-label" for="tcc-gold-intensity">Gold Intensity <span id="tcc-gold-val">${a.goldIntensity ?? 50}%</span></label>
          <p class="tcc-desc">Egyptian gold and bronze accent presence.</p>
          <div class="tcc-range-row">
            <input class="tcc-range" type="range" id="tcc-gold-intensity"
              min="0" max="100" value="${a.goldIntensity ?? 50}"
              oninput="tccAtmRange('goldIntensity',this.value,'tcc-gold-val')"
              aria-label="Gold intensity percentage"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="${a.goldIntensity ?? 50}">
          </div>
        </div>
        <div class="tcc-control">
          <label class="tcc-label" for="tcc-shadow-intensity">Shadow Intensity <span id="tcc-shadow-val">${a.shadowIntensity ?? 50}%</span></label>
          <p class="tcc-desc">Depth and darkness of shadows on cards and elements.</p>
          <div class="tcc-range-row">
            <input class="tcc-range" type="range" id="tcc-shadow-intensity"
              min="0" max="100" value="${a.shadowIntensity ?? 50}"
              oninput="tccAtmRange('shadowIntensity',this.value,'tcc-shadow-val')"
              aria-label="Shadow intensity"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="${a.shadowIntensity ?? 50}">
          </div>
        </div>
        <div class="tcc-control">
          <label class="tcc-label" for="tcc-border-style">Border Style</label>
          <p class="tcc-desc">Style applied to card and panel borders.</p>
          <select class="tcc-select" id="tcc-border-style"
            onchange="tccAtmChange('borderStyle',this.value)"
            aria-label="Border style">
            ${[['none','None'],['subtle','Subtle'],['gold','Gold Accent'],['ornate','Ornate Egyptian']].map(([v,l]) =>
              `<option value="${v}" ${a.borderStyle === v ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
        </div>
      </div>
    </div>

    <div class="tcc-section">
      <div class="tcc-section-title">Background &amp; Environment</div>
      <div class="tcc-grid">
        <div class="tcc-control">
          <label class="tcc-label" for="tcc-bg-texture">Background Texture</label>
          <p class="tcc-desc">Subtle texture overlay on the main background.</p>
          <select class="tcc-select" id="tcc-bg-texture"
            onchange="tccAtmChange('bgTexture',this.value)"
            aria-label="Background texture">
            ${[['none','None'],['subtle-grain','Subtle Grain'],['stone','Stone'],['papyrus','Papyrus']].map(([v,l]) =>
              `<option value="${v}" ${a.bgTexture === v ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
        </div>
        <div class="tcc-control">
          <label class="tcc-label" for="tcc-stars-intensity">Stars &amp; Particles <span id="tcc-stars-val">${a.starsIntensity ?? 60}%</span></label>
          <p class="tcc-desc">Starfield and particle effect density.</p>
          <div class="tcc-range-row">
            <input class="tcc-range" type="range" id="tcc-stars-intensity"
              min="0" max="100" value="${a.starsIntensity ?? 60}"
              oninput="tccAtmRange('starsIntensity',this.value,'tcc-stars-val')"
              aria-label="Stars and particles intensity"
              aria-valuemin="0" aria-valuemax="100">
          </div>
        </div>
        <div class="tcc-control">
          <label class="tcc-label" for="tcc-fog-intensity">Fog &amp; Dust <span id="tcc-fog-val">${a.fogIntensity ?? 30}%</span></label>
          <p class="tcc-desc">Ambient fog and dust particle density.</p>
          <div class="tcc-range-row">
            <input class="tcc-range" type="range" id="tcc-fog-intensity"
              min="0" max="100" value="${a.fogIntensity ?? 30}"
              oninput="tccAtmRange('fogIntensity',this.value,'tcc-fog-val')"
              aria-label="Fog and dust intensity"
              aria-valuemin="0" aria-valuemax="100">
          </div>
        </div>
      </div>
    </div>

    <div class="tcc-section">
      <div class="tcc-section-title">Egyptian Decorations</div>
      <div>
        ${[
          ['starsEnabled',    'Stars Enabled',          'Show animated starfield background'],
          ['fogEnabled',      'Fog / Mist Enabled',     'Show ambient fog and dust layer'],
          ['pyramidDecor',    'Pyramid Motifs',         'Pyramid silhouette decorative elements'],
          ['scarabDecor',     'Scarab Symbols',         'Scarab beetle decorative accents'],
          ['ankhDecor',       'Ankh Symbols',           'Ankh life symbol decorative accents'],
          ['eyeOfHorusDecor', 'Eye of Horus',           'Eye of Horus decorative elements'],
          ['emeraldAccent',   'Emerald Accent Layer',   'Dark emerald green atmospheric accent'],
          ['violetAccent',    'Violet Accent Layer',    'Midnight violet atmospheric accent'],
        ].map(([key, label, desc]) => `
          <div class="tcc-toggle-row">
            <div class="tcc-toggle-info">
              <div class="tcc-label">${label}</div>
              <div class="tcc-desc">${desc}</div>
            </div>
            <label class="tcc-toggle" aria-label="${label}">
              <input type="checkbox" role="switch" ${a[key] ? 'checked' : ''}
                onchange="tccAtmBool('${key}',this.checked)"
                aria-checked="${!!a[key]}">
              <span class="tcc-toggle-track" aria-hidden="true"></span>
            </label>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="tcc-section">
      <div class="tcc-section-title">Hidden Companion Easter Egg</div>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:var(--space-sm)">
        Controls the secret black-cat discovery trigger. Only the authorized founder account
        may change this setting — verification is enforced server-side on publish.
      </p>
      <div class="tcc-toggle-row">
        <div class="tcc-toggle-info">
          <div class="tcc-label">Hidden Companion Easter Egg</div>
          <div class="tcc-desc">
            When enabled, a hidden black-cat silhouette appears across all pages. Selecting it
            begins the Avenora Companion discovery flow. Default: Enabled.
          </div>
        </div>
        <label class="tcc-toggle" aria-label="Hidden Companion Easter Egg">
          <input type="checkbox" role="switch"
            ${a.easterEggEnabled !== false ? 'checked' : ''}
            onchange="tccAtmBool('easterEggEnabled',this.checked)"
            aria-checked="${a.easterEggEnabled !== false}">
          <span class="tcc-toggle-track" aria-hidden="true"></span>
        </label>
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   MOTION PANEL
   ═══════════════════════════════════════════════════════════ */
function _tccRenderMotionPanel() {
  const m = _tcc.draft.motion || {};
  return `
    <div class="tcc-section">
      <div class="tcc-section-title">Animation &amp; Transitions</div>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:var(--space-md)">
        No flashing, strobe, or seizure-triggering effects are ever applied.
        Reduced-motion compatibility is always respected.
      </p>
      <div class="tcc-grid">
        <div class="tcc-control">
          <label class="tcc-label" for="tcc-anim-intensity">Animation Intensity</label>
          <p class="tcc-desc">How much movement appears in the interface.</p>
          <select class="tcc-select" id="tcc-anim-intensity"
            onchange="tccMotionChange('animationIntensity',this.value)"
            aria-label="Animation intensity">
            ${[['none','None (No animations)'],['reduced','Reduced'],['normal','Normal'],['full','Full']].map(([v,l]) =>
              `<option value="${v}" ${m.animationIntensity === v ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
        </div>
        <div class="tcc-control">
          <label class="tcc-label" for="tcc-transition-speed">Transition Speed</label>
          <p class="tcc-desc">Speed of UI transitions and animations.</p>
          <select class="tcc-select" id="tcc-transition-speed"
            onchange="tccMotionChange('transitionSpeed',this.value)"
            aria-label="Transition speed">
            ${[['slow','Slow'],['normal','Normal'],['fast','Fast']].map(([v,l]) =>
              `<option value="${v}" ${m.transitionSpeed === v ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
        </div>
      </div>
    </div>
    <div class="tcc-section">
      <div class="tcc-section-title">Effect Toggles</div>
      <div>
        ${[
          ['particlesEnabled',       'Particle Effects',               'Animated particle system (stars, dust, rain)'],
          ['ambientMovement',        'Ambient Movement',               'Slow background pulse and ambient animations'],
          ['hoverEffects',           'Hover Effects',                  'Glow and scale effects on interactive elements'],
          ['reducedMotionRespect',   'Respect Reduced Motion (OS)',    'Always honour the OS reduced-motion preference \u2014 recommended'],
        ].map(([key, label, desc]) => `
          <div class="tcc-toggle-row">
            <div class="tcc-toggle-info">
              <div class="tcc-label">${label}</div>
              <div class="tcc-desc">${desc}</div>
            </div>
            <label class="tcc-toggle" aria-label="${label}">
              <input type="checkbox" role="switch" ${m[key] !== false ? 'checked' : ''}
                onchange="tccMotionBool('${key}',this.checked)"
                aria-checked="${m[key] !== false}">
              <span class="tcc-toggle-track" aria-hidden="true"></span>
            </label>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   HISTORY PANEL
   ═══════════════════════════════════════════════════════════ */
function _tccRenderHistoryPanel() {
  if (!_tcc.themes || _tcc.themes.length === 0) {
    return `
      <div class="tcc-section">
        <div class="tcc-section-title">Version History</div>
        <p style="color:var(--text-muted);font-size:0.85rem">No saved themes yet. Save your first draft above.</p>
      </div>
    `;
  }

  return `
    <div class="tcc-section">
      <div class="tcc-section-title">Version History</div>
      <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:var(--space-md)">
        Restore any previously published theme. Only the founder can publish or roll back themes.
      </p>
      <div>
        ${_tcc.themes.map(theme => `
          <div class="tcc-history-row">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:0.88rem;color:var(--text-primary)">${_tccEscape(theme.name)}</div>
              <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px">
                ${theme.publishedAt ? `Published ${_tccFormatDate(theme.publishedAt)}` : `Created ${_tccFormatDate(theme.createdAt)}`}
                ${theme.publishedBy?.username ? ` · by ${_tccEscape(theme.publishedBy.username)}` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:var(--space-sm);flex-shrink:0">
              <span class="tcc-status-pill ${theme.status}">${theme.status}</span>
              <button class="btn btn-ghost btn-sm" onclick="tccLoadTheme('${theme._id}')" aria-label="Load ${_tccEscape(theme.name)}">
                Load
              </button>
              ${theme.status !== 'published' ? `
                <button class="btn btn-outline btn-sm" onclick="tccRollback('${theme._id}')"
                  aria-label="Restore ${_tccEscape(theme.name)} as live theme">
                  Restore
                </button>
              ` : ''}
              ${theme.status !== 'published' ? `
                <button class="btn btn-ghost btn-sm" style="color:var(--neon-red)" onclick="tccDeleteTheme('${theme._id}','${_tccEscape(theme.name)}')"
                  aria-label="Delete ${_tccEscape(theme.name)}">
                  Delete
                </button>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   PREVIEW PANEL
   ═══════════════════════════════════════════════════════════ */
function _tccRenderPreviewPanel() {
  return `
    <div class="tcc-preview-panel" role="region" aria-label="Live preview">
      <div class="tcc-preview-header">Live Preview</div>
      <div class="tcc-preview-tabs" role="tablist" aria-label="Preview sections">
        ${[
          ['homepage','Home'],['feed','Feed'],['video','Video'],
          ['arcade','Arcade'],['chat','Chat'],['cards','Cards'],['forms','Forms'],
        ].map(([id, label]) => `
          <button class="tcc-preview-tab ${_tcc.previewTab === id ? 'active' : ''}"
            role="tab" aria-selected="${_tcc.previewTab === id}"
            onclick="tccSetPreviewTab('${id}')"
            aria-label="Preview ${label}">${label}</button>
        `).join('')}
      </div>
      <div class="tcc-preview-content" id="tcc-preview-content" style="background:${(_tcc.draft.colors || {}).bgPrimary || '#090807'}">
        ${_tccRenderPreview(_tcc.previewTab)}
      </div>
    </div>
  `;
}

function _tccRenderPreview(tab) {
  const c = _tcc.draft.colors || {};
  const t = _tcc.draft.typography || {};

  const bg   = c.bgPrimary    || '#090807';
  const bg2  = c.bgCard       || '#131210';
  const bgEl = c.bgElevated   || '#1e1b17';
  const txt  = c.textPrimary  || '#eee4cf';
  const txt2 = c.textSecondary|| '#b0a08a';
  const muted= c.textMuted    || '#6b5e4e';
  const acc  = c.accent       || '#b8954b';
  const bdr  = c.borderSubtle || 'rgba(184,149,75,0.12)';
  const bdrA = c.borderAccent || 'rgba(184,149,75,0.28)';
  const fnt  = t.fontHeading  || "'Cinzel',serif";
  const fntB = t.fontBody     || "system-ui,sans-serif";

  const previewStyle = `color:${txt};font-family:${fntB};font-size:13px`;

  const navHtml = `
    <div style="background:${bg2};border-bottom:1px solid ${bdr};padding:10px 12px;display:flex;align-items:center;justify-content:space-between;border-radius:var(--radius-sm) var(--radius-sm) 0 0;margin-bottom:8px">
      <span style="font-family:${fnt};color:${acc};font-size:0.75rem;font-weight:700;letter-spacing:0.15em">AVENORA</span>
      <div style="display:flex;gap:8px">
        ${['Home','Feed','Video','Arcade','Chat'].map((n,i) => `<span style="font-size:0.65rem;font-weight:700;letter-spacing:0.08em;color:${i===0?acc:muted}">${n}</span>`).join('')}
      </div>
    </div>
  `;

  const cardHtml = (title, sub) => `
    <div style="background:${bg2};border:1px solid ${bdr};border-radius:8px;padding:10px;margin-bottom:6px">
      <div style="font-family:${fnt};font-size:0.75rem;font-weight:700;color:${txt};letter-spacing:0.06em;margin-bottom:3px">${title}</div>
      <div style="font-size:0.7rem;color:${txt2}">${sub}</div>
    </div>
  `;

  const btnHtml = `
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
      <button style="background:${acc};color:${bg};border:none;border-radius:6px;padding:5px 12px;font-size:0.72rem;font-weight:700;cursor:default" aria-label="Sample primary button">Primary</button>
      <button style="background:transparent;color:${txt};border:1px solid ${bdrA};border-radius:6px;padding:5px 12px;font-size:0.72rem;font-weight:600;cursor:default" aria-label="Sample outline button">Outline</button>
      <span style="background:rgba(184,149,75,0.12);color:${acc};border:1px solid ${bdrA};border-radius:999px;padding:2px 8px;font-size:0.65rem;font-weight:700">BADGE</span>
    </div>
  `;

  const previews = {
    homepage: `
      <div style="${previewStyle}">
        ${navHtml}
        <div style="padding:12px 0">
          <div style="font-family:${fnt};color:${acc};font-size:1rem;font-weight:700;letter-spacing:0.12em;margin-bottom:4px">AVENORA</div>
          <div style="font-size:0.72rem;color:${muted};margin-bottom:12px">A place where everyone belongs</div>
          ${cardHtml('Welcome Back', 'Your home feed, activity, and recent content')}
          ${cardHtml('Latest from Feed', '12 new posts since your last visit')}
          ${btnHtml}
        </div>
      </div>
    `,
    feed: `
      <div style="${previewStyle}">
        ${navHtml}
        ${[['@username','Just finished building something amazing! 🌅','5m'],['@another','Loving the new Avenora design — it feels magical','12m']].map(([u,msg,time]) => `
          <div style="background:${bg2};border:1px solid ${bdr};border-radius:8px;padding:10px;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <div style="width:24px;height:24px;border-radius:50%;background:${bgEl};display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:${acc};font-weight:700">${u[1].toUpperCase()}</div>
              <div>
                <div style="font-size:0.72rem;font-weight:700;color:${txt}">${u}</div>
                <div style="font-size:0.62rem;color:${muted}">${time} ago</div>
              </div>
            </div>
            <div style="font-size:0.75rem;color:${txt2}">${msg}</div>
          </div>
        `).join('')}
      </div>
    `,
    video: `
      <div style="${previewStyle}">
        ${navHtml}
        ${['Ancient Mysteries Explored','Avenora Video Premiere','Community Highlights'].map(t => `
          <div style="background:${bg2};border:1px solid ${bdr};border-radius:8px;overflow:hidden;margin-bottom:6px;display:flex;gap:8px;align-items:center">
            <div style="width:72px;height:48px;background:${bgEl};flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.2rem">▶</div>
            <div style="padding:6px">
              <div style="font-size:0.72rem;font-weight:700;color:${txt};margin-bottom:2px">${t}</div>
              <div style="font-size:0.62rem;color:${muted}">1.2k views · 3h ago</div>
            </div>
          </div>
        `).join('')}
      </div>
    `,
    arcade: `
      <div style="${previewStyle}">
        ${navHtml}
        <div style="font-family:${fnt};font-size:0.75rem;font-weight:700;color:${acc};letter-spacing:0.12em;margin-bottom:8px">ARCADE</div>
        ${['Pyramid Solitaire','Desert Runner','Scarab Match'].map(g => `
          <div style="background:${bg2};border:1px solid ${bdrA};border-radius:8px;padding:8px;margin-bottom:5px;display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:0.72rem;font-weight:600;color:${txt}">${g}</span>
            <button style="background:${acc};color:${bg};border:none;border-radius:5px;padding:3px 8px;font-size:0.65rem;font-weight:700;cursor:default">PLAY</button>
          </div>
        `).join('')}
      </div>
    `,
    chat: `
      <div style="${previewStyle}">
        ${navHtml}
        <div style="display:flex;flex-direction:column;gap:5px">
          <div style="background:${bgEl};border:1px solid ${bdr};border-radius:12px 12px 12px 2px;padding:7px 10px;max-width:80%;font-size:0.75rem;color:${txt}">Hello from the chat room! 👋</div>
          <div style="background:rgba(184,149,75,0.1);border:1px solid ${bdrA};border-radius:12px 12px 2px 12px;padding:7px 10px;max-width:80%;margin-left:auto;font-size:0.75rem;color:${txt}">Welcome to Avenora! ✨</div>
          <div style="background:${bgEl};border:1px solid ${bdr};border-radius:12px 12px 12px 2px;padding:7px 10px;max-width:80%;font-size:0.75rem;color:${txt}">This theme looks incredible.</div>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <input style="flex:1;background:${bgEl};border:1px solid ${bdr};border-radius:20px;padding:5px 12px;color:${txt};font-size:0.72rem" placeholder="Type a message..." readonly>
          <button style="background:${acc};color:${bg};border:none;border-radius:50%;width:28px;height:28px;cursor:default;font-weight:700">→</button>
        </div>
      </div>
    `,
    cards: `
      <div style="${previewStyle}">
        ${cardHtml('Card Title','Sub-description text below the heading')}
        ${cardHtml('Another Card','Different content with muted text below')}
        <div style="display:flex;gap:5px;margin-top:4px">
          <span style="background:rgba(184,149,75,0.12);color:${acc};border:1px solid ${bdrA};border-radius:4px;padding:2px 8px;font-size:0.65rem;font-weight:700">GOLD</span>
          <span style="background:rgba(74,158,114,0.1);color:${c.success||'#4a9e72'};border:1px solid rgba(74,158,114,0.3);border-radius:4px;padding:2px 8px;font-size:0.65rem;font-weight:700">LIVE</span>
          <span style="background:rgba(136,102,187,0.1);color:#a888d4;border:1px solid rgba(136,102,187,0.3);border-radius:4px;padding:2px 8px;font-size:0.65rem;font-weight:700">MOD</span>
        </div>
        ${btnHtml}
      </div>
    `,
    forms: `
      <div style="${previewStyle}">
        ${navHtml}
        <div style="background:${bg2};border:1px solid ${bdr};border-radius:8px;padding:12px">
          <div style="font-family:${fnt};font-size:0.78rem;font-weight:700;color:${acc};letter-spacing:0.1em;margin-bottom:8px">SIGN IN</div>
          <label style="font-size:0.65rem;font-weight:700;color:${txt2};letter-spacing:0.07em;text-transform:uppercase">Email</label>
          <div style="background:${bgEl};border:1px solid ${bdr};border-radius:5px;padding:6px 10px;margin:3px 0 8px;font-size:0.72rem;color:${muted}">your@email.com</div>
          <label style="font-size:0.65rem;font-weight:700;color:${txt2};letter-spacing:0.07em;text-transform:uppercase">Password</label>
          <div style="background:${bgEl};border:1px solid ${bdrA};border-radius:5px;padding:6px 10px;margin:3px 0 10px;font-size:0.72rem;color:${muted}">••••••••</div>
          <button style="width:100%;background:${acc};color:${bg};border:none;border-radius:6px;padding:7px;font-size:0.72rem;font-weight:700;cursor:default;letter-spacing:0.08em">SIGN IN</button>
        </div>
      </div>
    `,
  };

  return previews[tab] || previews.homepage;
}

/* ═══════════════════════════════════════════════════════════
   SAVED THEME LIST
   ═══════════════════════════════════════════════════════════ */
function _tccRenderThemeList() {
  if (!_tcc.themes.length) {
    return `<p style="color:var(--text-muted);font-size:0.85rem">No saved themes. Use "Save Draft" to save your current work.</p>`;
  }
  return _tcc.themes.map(theme => `
    <div class="tcc-theme-row ${_tcc.editingId === theme._id ? 'active' : ''}">
      <div class="tcc-theme-row-info">
        <div class="tcc-theme-row-name">${_tccEscape(theme.name)}</div>
        <div class="tcc-theme-row-meta">
          <span class="tcc-status-pill ${theme.status}">${theme.status}</span>
          · ${theme.publishedAt ? `Published ${_tccFormatDate(theme.publishedAt)}` : `Updated ${_tccFormatDate(theme.updatedAt)}`}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost btn-sm" onclick="tccLoadTheme('${theme._id}')" aria-label="Load theme ${_tccEscape(theme.name)} into editor">
          Load
        </button>
        ${theme.status !== 'published' ? `
          <button class="btn btn-outline btn-sm" onclick="tccRollback('${theme._id}')"
            aria-label="Restore ${_tccEscape(theme.name)} as the live theme">
            Restore
          </button>
          <button class="btn btn-ghost btn-sm" style="color:var(--neon-red)"
            onclick="tccDeleteTheme('${theme._id}','${_tccEscape(theme.name)}')"
            aria-label="Delete theme ${_tccEscape(theme.name)}">
            Delete
          </button>
        ` : '<span style="font-size:0.72rem;color:var(--avenora-gold);font-weight:700">● LIVE</span>'}
      </div>
    </div>
  `).join('');
}


/* ═══════════════════════════════════════════════════════════
   EVENT HANDLERS (window-exposed for inline HTML handlers)
   ═══════════════════════════════════════════════════════════ */

window.tccSetTab = function(tab) {
  _tcc.activeTab = tab;
  document.querySelectorAll('.tcc-tab-btn').forEach(btn => {
    const isActive = btn.id === `tcc-editor-tab-${tab}`;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  document.querySelectorAll('.tcc-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tcc-editor-panel-${tab}`);
  });
};

window.tccSetPreviewTab = function(tab) {
  _tcc.previewTab = tab;
  document.querySelectorAll('.tcc-preview-tab').forEach(btn => {
    const isActive = btn.getAttribute('onclick').includes(`'${tab}'`);
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  const content = document.getElementById('tcc-preview-content');
  if (content) {
    content.style.background = (_tcc.draft.colors || {}).bgPrimary || '#090807';
    content.innerHTML = _tccRenderPreview(tab);
  }
};

window.tccSetName = function(v) { _tcc.draftName = v; };
window.tccSetNotes = function(v) { _tcc.draftNotes = v; };

window.tccColorInput = function(key, value) {
  if (!_tcc.draft.colors) _tcc.draft.colors = {};
  _tcc.draft.colors[key] = value;
  const hexEl = document.getElementById(`tcc-color-hex-${key}`);
  if (hexEl) hexEl.value = value;
  const swatchEl = document.querySelector(`label[aria-label="${key} color picker"]`);
  if (swatchEl) swatchEl.style.background = value;
  _tccRefreshPreview();
};

window.tccColorHexChange = function(key, value) {
  const trimmed = value.trim();
  if (!_tcc.draft.colors) _tcc.draft.colors = {};
  _tcc.draft.colors[key] = trimmed;
  // Keep color picker in sync if it's a plain hex color
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
    const picker = document.getElementById(`tcc-color-${key}`);
    if (picker) picker.value = trimmed;
    const swatchEl = document.querySelector(`label[for="tcc-color-${key}"]`);
    if (swatchEl) swatchEl.style.background = trimmed;
  }
  _tccRefreshPreview();
};

window.tccTypoChange = function(key, value) {
  if (!_tcc.draft.typography) _tcc.draft.typography = {};
  _tcc.draft.typography[key] = value;
  _tccRefreshPreview();
};

window.tccAtmChange = function(key, value) {
  if (!_tcc.draft.atmosphere) _tcc.draft.atmosphere = {};
  _tcc.draft.atmosphere[key] = value;
};

window.tccAtmBool = function(key, checked) {
  if (!_tcc.draft.atmosphere) _tcc.draft.atmosphere = {};
  _tcc.draft.atmosphere[key] = checked;
};

window.tccAtmRange = function(key, value, labelId) {
  if (!_tcc.draft.atmosphere) _tcc.draft.atmosphere = {};
  _tcc.draft.atmosphere[key] = parseInt(value);
  const label = document.getElementById(labelId);
  if (label) label.textContent = `${value}%`;
};

window.tccMotionChange = function(key, value) {
  if (!_tcc.draft.motion) _tcc.draft.motion = {};
  _tcc.draft.motion[key] = value;
};

window.tccMotionBool = function(key, checked) {
  if (!_tcc.draft.motion) _tcc.draft.motion = {};
  _tcc.draft.motion[key] = checked;
};

window.tccApplyPreset = function(key) {
  const preset = TCC_PRESETS[key];
  if (!preset) return;
  _tcc.draft = JSON.parse(JSON.stringify(preset.tokens));
  _tcc.draftName = preset.name;
  _tcc.selectedPresetKey = key;
  _tccRenderEditor();
  _tccShowStatus(`Preset "${preset.name}" loaded. Customize it and save a draft.`, 'info');
};

window.tccPreviewActive = function() {
  // Apply draft tokens to the live page as a non-persistent preview
  if (window.AvenoraTheme) {
    window.AvenoraTheme.preview(_tcc.draft);
    _tccShowStatus('Preview applied to the live page. This is not saved or published.', 'info');
  } else {
    _tccShowStatus('Theme preview service not available. Refresh the page and try again.', 'error');
  }
};

window.tccSaveDraft = async function() {
  if (_tcc.saving) return;
  const name = (_tcc.draftName || '').trim();
  if (!name) { _tccShowStatus('Please enter a theme name before saving.', 'error'); return; }

  _tcc.saving = true;
  _tccSetBtnLoading('tcc-btn-save', true, 'Saving...');

  try {
    let result;
    if (_tcc.editingId) {
      result = await LegendAPI.founderTheme.update(_tcc.editingId, {
        name,
        tokens: _tcc.draft,
        notes: _tcc.draftNotes,
      });
    } else {
      result = await LegendAPI.founderTheme.create({
        name,
        tokens: _tcc.draft,
        notes: _tcc.draftNotes,
        presetKey: _tcc.selectedPresetKey,
      });
      _tcc.editingId = result.theme._id;
    }
    _tcc.themes = (await LegendAPI.founderTheme.list()).themes || [];
    _tccShowStatus(`Draft "${name}" saved successfully.`, 'success');
    _tccRenderEditor();
  } catch (err) {
    console.error('[TCC] Save error:', err);
    const msg = err.message?.includes('validation') || err.message?.includes('valid')
      ? err.message : 'Draft could not be saved. Please try again.';
    _tccShowStatus(msg, 'error');
  } finally {
    _tcc.saving = false;
    _tccSetBtnLoading('tcc-btn-save', false, '💾 Save Draft');
  }
};

window.tccPublish = async function() {
  if (_tcc.publishing) return;
  const name = (_tcc.draftName || '').trim();
  if (!name) { _tccShowStatus('Please enter a theme name before publishing.', 'error'); return; }

  if (!confirm(`Publish "${name}" as the live Avenora theme?\n\nThis will apply your chosen colors, fonts, and styles to all pages immediately.`)) return;

  _tcc.publishing = true;
  _tccSetBtnLoading('tcc-btn-publish', true, 'Publishing...');

  try {
    // Save latest changes first, then publish
    let themeId = _tcc.editingId;
    if (!themeId) {
      const createRes = await LegendAPI.founderTheme.create({
        name, tokens: _tcc.draft, notes: _tcc.draftNotes, presetKey: _tcc.selectedPresetKey,
      });
      themeId = createRes.theme._id;
      _tcc.editingId = themeId;
    } else {
      await LegendAPI.founderTheme.update(themeId, { name, tokens: _tcc.draft, notes: _tcc.draftNotes });
    }

    await LegendAPI.founderTheme.publish(themeId);

    // Apply to live page immediately
    if (window.AvenoraTheme) {
      await window.AvenoraTheme.reload();
    }

    _tcc.themes = (await LegendAPI.founderTheme.list()).themes || [];
    _tccShowStatus(`✅ Theme "${name}" is now live across all Avenora pages!`, 'success');
    _tccRenderEditor();
  } catch (err) {
    console.error('[TCC] Publish error:', err);
    _tccShowStatus('Theme could not be published. The current live theme is unchanged. Check your connection and try again.', 'error');
  } finally {
    _tcc.publishing = false;
    _tccSetBtnLoading('tcc-btn-publish', false, '🚀 Publish');
  }
};

window.tccCancelChanges = async function() {
  if (_tcc.editingId) {
    // Reload from server
    try {
      const res = await LegendAPI.founderTheme.get(_tcc.editingId);
      _tcc.draft = _tccMerge(_tccDefaultTokens(), res.theme.tokens || {});
      _tcc.draftName = res.theme.name;
      _tcc.draftNotes = res.theme.notes || '';
    } catch {
      _tcc.draft = _tccDefaultTokens();
    }
  } else {
    _tcc.draft = _tccDefaultTokens();
    _tcc.draftName = 'My Theme';
  }
  _tccRenderEditor();
  _tccShowStatus('Changes discarded.', 'info');
};

window.tccRestoreDefaults = function() {
  if (!confirm('Reset all settings to the Avenora Gothic Egyptian defaults? This will not affect the currently published theme until you save and publish.')) return;
  _tcc.draft = _tccDefaultTokens();
  _tcc.selectedPresetKey = 'gothic-egyptian';
  _tccRenderEditor();
  _tccShowStatus('Settings reset to Gothic Egyptian defaults.', 'info');
};

window.tccLoadTheme = async function(id) {
  try {
    const res = await LegendAPI.founderTheme.get(id);
    const theme = res.theme;
    _tcc.editingId = theme._id;
    _tcc.draft = _tccMerge(_tccDefaultTokens(), theme.tokens || {});
    _tcc.draftName = theme.name;
    _tcc.draftNotes = theme.notes || '';
    _tcc.selectedPresetKey = theme.presetKey || null;
    _tccRenderEditor();
    _tccShowStatus(`Loaded theme "${theme.name}" into the editor.`, 'info');
  } catch (err) {
    _tccShowStatus('Could not load theme. Please try again.', 'error');
  }
};

window.tccRollback = async function(id) {
  const theme = _tcc.themes.find(t => t._id === id);
  const name = theme?.name || 'this theme';
  if (!confirm(`Restore "${name}" as the live theme?\n\nThe current live theme will be archived.`)) return;
  try {
    await LegendAPI.founderTheme.rollback(id);
    if (window.AvenoraTheme) await window.AvenoraTheme.reload();
    _tcc.themes = (await LegendAPI.founderTheme.list()).themes || [];
    _tccShowStatus(`✅ Rolled back to "${name}". It is now the live theme.`, 'success');
    _tccRenderEditor();
  } catch (err) {
    _tccShowStatus('Rollback failed. The current live theme is unchanged. Please try again.', 'error');
  }
};

window.tccDeleteTheme = async function(id, name) {
  if (!confirm(`Delete theme "${name}"?\n\nThis cannot be undone.`)) return;
  try {
    await LegendAPI.founderTheme.delete(id);
    if (_tcc.editingId === id) {
      _tcc.editingId = null;
      _tcc.draft = _tccDefaultTokens();
      _tcc.draftName = 'My Theme';
    }
    _tcc.themes = (await LegendAPI.founderTheme.list()).themes || [];
    _tccShowStatus(`Theme "${name}" deleted.`, 'info');
    _tccRenderEditor();
  } catch (err) {
    const msg = err.message?.includes('published') ? err.message : 'Could not delete theme. Please try again.';
    _tccShowStatus(msg, 'error');
  }
};

/* ═══════════════════════════════════════════════════════════
   INTERNAL HELPERS
   ═══════════════════════════════════════════════════════════ */

function _tccRefreshPreview() {
  const content = document.getElementById('tcc-preview-content');
  if (!content) return;
  content.style.background = (_tcc.draft.colors || {}).bgPrimary || '#090807';
  content.innerHTML = _tccRenderPreview(_tcc.previewTab);
}

function _tccShowStatus(msg, type = 'info') {
  _tcc.statusMsg = msg;
  _tcc.statusType = type;
  const bar = document.getElementById('tcc-status-bar');
  if (!bar) return;
  bar.className = `tcc-status-bar visible ${type}`;
  bar.textContent = msg;
  if (type !== 'error') {
    setTimeout(() => {
      if (bar.textContent === msg) {
        bar.className = 'tcc-status-bar';
        bar.textContent = '';
      }
    }, 5000);
  }
}

function _tccSetBtnLoading(id, loading, label) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = label;
}

function _tccGetStatusClass() {
  const theme = _tcc.themes.find(t => t._id === _tcc.editingId);
  return theme ? theme.status : 'draft';
}

function _tccGetStatusLabel() {
  const theme = _tcc.themes.find(t => t._id === _tcc.editingId);
  return theme ? theme.status : 'new';
}

function _tccEscape(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _tccHexForPicker(val) {
  // Color picker requires exactly #RRGGBB — fall back gracefully
  if (!val) return '#090807';
  if (/^#[0-9A-Fa-f]{6}$/.test(val)) return val;
  // Try to extract hex from rgba/rgb
  const match = val.match(/#([0-9A-Fa-f]{6})/);
  return match ? `#${match[1]}` : '#090807';
}

function _tccFormatDate(isoString) {
  if (!isoString) return '—';
  try {
    return new Date(isoString).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return isoString; }
}
