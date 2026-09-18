/**
 * Admin Theme Routes — Firestore-backed
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, requireFounder, requireFounderEmail } = require('../middleware/auth');
const { getDb } = require('../../config/firestore');
const logger  = require('../../utils/logger');

router.use(authenticate, requireFounder, requireFounderEmail);

const HEX_RE  = /^#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const RGBA_RE = /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(\s*,\s*[\d.]+)?\s*\)$/;
const COLOR_FIELDS = ['bgPrimary','bgSecondary','bgCard','bgElevated','textPrimary','textSecondary','textMuted','accent','accentDim','buttonBg','buttonText','textLink','success','warning','error','emerald','violet','borderSubtle','borderAccent'];

function isValidColor(v) {
  if (typeof v !== 'string') return false;
  return HEX_RE.test(v.trim()) || RGBA_RE.test(v.trim());
}

function validateTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return 'tokens must be an object';
  const { colors, typography } = tokens;
  if (colors && typeof colors === 'object') {
    for (const field of COLOR_FIELDS) {
      if (colors[field] !== undefined && !isValidColor(colors[field])) return `colors.${field} is not a valid CSS color`;
    }
  }
  if (typography) {
    if (typography.headingStyle && !['egyptian','modern','serif','minimal'].includes(typography.headingStyle)) return 'typography.headingStyle is invalid';
    if (typography.baseFontSize) {
      const px = parseFloat(typography.baseFontSize);
      if (isNaN(px) || px < 10 || px > 24) return 'typography.baseFontSize must be 10–24px';
    }
  }
  return null;
}

function _deepMerge(target, source) {
  const out = Object.assign({}, target);
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = _deepMerge(target[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      out[key] = source[key];
    }
  }
  return out;
}

// GET /api/admin/themes
router.get('/', async (req, res, next) => {
  try {
    const snap   = await getDb().collection('founderThemes').orderBy('updatedAt', 'desc').get();
    const themes = snap.docs.map(d => { const { tokens, ...rest } = d.data(); return { id: d.id, ...rest }; });
    res.json({ success: true, themes });
  } catch (err) { next(err); }
});

// GET /api/admin/themes/published
router.get('/published', async (req, res, next) => {
  try {
    const snap  = await getDb().collection('founderThemes').where('status', '==', 'published').orderBy('publishedAt', 'desc').limit(1).get();
    res.json({ success: true, theme: snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() } });
  } catch (err) { next(err); }
});

// GET /api/admin/themes/published/tokens
router.get('/published/tokens', async (req, res, next) => {
  try {
    const snap = await getDb().collection('founderThemes').where('status', '==', 'published').orderBy('publishedAt', 'desc').limit(1).get();
    if (snap.empty) return res.json({ success: true, theme: null });
    const d = snap.docs[0].data();
    res.json({ success: true, theme: { name: d.name, tokens: d.tokens, publishedAt: d.publishedAt } });
  } catch (err) { next(err); }
});

// GET /api/admin/themes/history
router.get('/history', async (req, res, next) => {
  try {
    const snap = await getDb().collection('founderThemes')
      .where('status', 'in', ['published','archived']).orderBy('publishedAt', 'desc').limit(50).get();
    const history = snap.docs.map(d => {
      const { tokens, ...rest } = d.data();
      return { id: d.id, ...rest };
    });
    res.json({ success: true, history });
  } catch (err) { next(err); }
});

// GET /api/admin/themes/:id
router.get('/:id', async (req, res, next) => {
  try {
    const snap = await getDb().collection('founderThemes').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: true, message: 'Theme not found' });
    res.json({ success: true, theme: { id: snap.id, ...snap.data() } });
  } catch (err) { next(err); }
});

// POST /api/admin/themes
router.post('/', async (req, res, next) => {
  try {
    const { name, tokens, presetKey, notes } = req.body;
    if (!name?.trim()) return res.status(422).json({ error: true, message: 'Theme name is required' });
    const tokenError = validateTokens(tokens || {});
    if (tokenError) return res.status(422).json({ error: true, message: tokenError });

    const db  = getDb();
    const ref = db.collection('founderThemes').doc();
    const now = new Date().toISOString();
    const theme = {
      id: ref.id, name: name.trim().slice(0, 80), tokens: tokens || {}, presetKey: presetKey || null,
      notes: (notes || '').slice(0, 500), status: 'draft',
      createdBy: { uid: req.user.id, username: req.user.username },
      publishedBy: null, publishedAt: null, previousPublishedId: null,
      createdAt: now, updatedAt: now,
    };
    await ref.set(theme);
    logger.info(`[Theme] ${req.user.username} created "${theme.name}" (${ref.id})`);
    res.status(201).json({ success: true, theme });
  } catch (err) { next(err); }
});

// PUT /api/admin/themes/:id
router.put('/:id', async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('founderThemes').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: true, message: 'Theme not found' });
    const existing = snap.data();
    const update   = { updatedAt: new Date().toISOString() };
    const { name, tokens, notes } = req.body;

    if (name !== undefined) {
      if (!name?.trim()) return res.status(422).json({ error: true, message: 'Theme name cannot be empty' });
      update.name = name.trim().slice(0, 80);
    }
    if (tokens !== undefined) {
      const tokenError = validateTokens(tokens);
      if (tokenError) return res.status(422).json({ error: true, message: tokenError });
      update.tokens = _deepMerge(existing.tokens || {}, tokens);
    }
    if (notes !== undefined) update.notes = (notes || '').slice(0, 500);

    await db.collection('founderThemes').doc(snap.id).update(update);
    logger.info(`[Theme] ${req.user.username} updated "${existing.name}" (${snap.id})`);
    const fresh = await db.collection('founderThemes').doc(snap.id).get();
    res.json({ success: true, theme: { id: fresh.id, ...fresh.data() } });
  } catch (err) { next(err); }
});

// POST /api/admin/themes/:id/publish
router.post('/:id/publish', async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('founderThemes').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: true, message: 'Theme not found' });

    // Archive current live theme
    const liveSnap = await db.collection('founderThemes').where('status', '==', 'published').orderBy('publishedAt', 'desc').limit(1).get();
    const batch = db.batch();
    if (!liveSnap.empty && liveSnap.docs[0].id !== snap.id) {
      batch.update(liveSnap.docs[0].ref, { status: 'archived', updatedAt: new Date().toISOString() });
    }
    const now = new Date().toISOString();
    batch.update(snap.ref, {
      status: 'published', publishedAt: now,
      publishedBy: { uid: req.user.id, username: req.user.username },
      previousPublishedId: liveSnap.empty ? null : liveSnap.docs[0].id,
      updatedAt: now,
    });
    await batch.commit();

    logger.info(`[Theme] ${req.user.username} PUBLISHED "${snap.data().name}" (${snap.id})`);
    const fresh = await db.collection('founderThemes').doc(snap.id).get();
    res.json({ success: true, theme: { id: fresh.id, ...fresh.data() } });
  } catch (err) { next(err); }
});

// POST /api/admin/themes/:id/rollback
router.post('/:id/rollback', async (req, res, next) => {
  try {
    const db     = getDb();
    const target = await db.collection('founderThemes').doc(req.params.id).get();
    if (!target.exists) return res.status(404).json({ error: true, message: 'Theme not found' });

    const liveSnap = await db.collection('founderThemes').where('status', '==', 'published').orderBy('publishedAt', 'desc').limit(1).get();
    const batch = db.batch();
    if (!liveSnap.empty && liveSnap.docs[0].id !== target.id) {
      batch.update(liveSnap.docs[0].ref, { status: 'archived', updatedAt: new Date().toISOString() });
    }
    const now = new Date().toISOString();
    batch.update(target.ref, {
      status: 'published', publishedAt: now,
      publishedBy: { uid: req.user.id, username: req.user.username },
      updatedAt: now,
    });
    await batch.commit();

    logger.info(`[Theme] ${req.user.username} ROLLED BACK to "${target.data().name}" (${target.id})`);
    const fresh = await db.collection('founderThemes').doc(target.id).get();
    res.json({ success: true, theme: { id: fresh.id, ...fresh.data() } });
  } catch (err) { next(err); }
});

// DELETE /api/admin/themes/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const db   = getDb();
    const snap = await db.collection('founderThemes').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: true, message: 'Theme not found' });
    if (snap.data().status === 'published') return res.status(409).json({ error: true, message: 'Cannot delete the currently published theme.' });
    await db.collection('founderThemes').doc(snap.id).delete();
    logger.info(`[Theme] ${req.user.username} deleted "${snap.data().name}" (${snap.id})`);
    res.json({ success: true, message: 'Theme deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
