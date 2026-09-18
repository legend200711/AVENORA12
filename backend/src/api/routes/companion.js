/**
 * Companion Routes — Firestore-backed
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { ValidationError, NotFoundError } = require('../middleware/errorHandler');
const { getDb } = require('../../config/firestore');

router.use(authenticate);

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return next(new ValidationError('Validation failed', errors.array()));
  next();
}

const DEFAULT_DAILY_TASKS = [
  { key: 'visit',     label: 'Visit Avenora',        enabled: true, completedToday: false, lastCompleted: null },
  { key: 'post',      label: 'Share something',       enabled: true, completedToday: false, lastCompleted: null },
  { key: 'listen',    label: 'Listen to music',       enabled: true, completedToday: false, lastCompleted: null },
  { key: 'watch',     label: 'Watch a video',         enabled: true, completedToday: false, lastCompleted: null },
  { key: 'social',    label: 'Connect with someone',  enabled: true, completedToday: false, lastCompleted: null },
];

async function loadOrCreate(userId) {
  const db   = getDb();
  const snap = await db.collection('companions').doc(userId).get();
  if (snap.exists) {
    const data = snap.data();
    // Reset daily tasks if new day
    const today = new Date().toDateString();
    const reset = data.tasksResetAt !== today;
    if (reset) {
      const tasks = (data.dailyTasks || DEFAULT_DAILY_TASKS).map(t => ({ ...t, completedToday: false }));
      await db.collection('companions').doc(userId).update({ dailyTasks: tasks, tasksResetAt: today });
      return { ...data, dailyTasks: tasks, tasksResetAt: today };
    }
    return data;
  }
  // First access — create default record
  const companion = {
    userId, discovered: false, discoveredAt: null,
    name: null, appearance: 'scarab', personality: 'calm',
    care: { hunger: 70, water: 70, happiness: 70, energy: 70, lastFed: null, lastWatered: null, lastPlayed: null },
    dailyTasks: DEFAULT_DAILY_TASKS, tasksResetAt: new Date().toDateString(),
    miniGame: { highScore: 0, gamesPlayed: 0 },
    unlockedAppearances: ['scarab'], widgetVisible: true, disabled: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await db.collection('companions').doc(userId).set(companion);
  return companion;
}

// GET /api/companion/me
router.get('/me', async (req, res, next) => {
  try {
    const companion = await loadOrCreate(req.user.id);
    res.json({ success: true, companion });
  } catch (err) { next(err); }
});

// POST /api/companion/discover
router.post('/discover', async (req, res, next) => {
  try {
    const db  = getDb();
    const c   = await loadOrCreate(req.user.id);
    if (!c.discovered) {
      await db.collection('companions').doc(req.user.id).update({ discovered: true, discoveredAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      c.discovered = true;
    }
    res.json({ success: true, companion: c });
  } catch (err) { next(err); }
});

// PATCH /api/companion/setup
router.patch('/setup',
  [
    body('name').optional().trim().isLength({ min: 1, max: 32 }),
    body('appearance').optional().isIn(['scarab','anubis','ibis','cat','falcon']),
    body('personality').optional().isIn(['calm','curious','cheerful','wise','playful']),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const c = await loadOrCreate(req.user.id);
      if (!c.discovered) return next(new NotFoundError('Companion'));
      const update = { updatedAt: new Date().toISOString() };
      if (req.body.name        !== undefined) update.name        = req.body.name;
      if (req.body.appearance  !== undefined) update.appearance  = req.body.appearance;
      if (req.body.personality !== undefined) update.personality = req.body.personality;
      await getDb().collection('companions').doc(req.user.id).update(update);
      res.json({ success: true, companion: { ...c, ...update } });
    } catch (err) { next(err); }
  }
);

// POST /api/companion/care/:action
router.post('/care/:action', async (req, res, next) => {
  const VALID = ['feed','water','play','encourage'];
  try {
    const { action } = req.params;
    if (!VALID.includes(action)) return res.status(400).json({ error: true, message: 'Unknown care action' });
    const c = await loadOrCreate(req.user.id);
    if (!c.discovered) return next(new NotFoundError('Companion'));

    const care = { ...c.care };
    const cap  = v => Math.min(100, v);
    const now  = new Date().toISOString();
    if (action === 'feed')     { care.hunger = cap(care.hunger + 25); care.lastFed = now; }
    if (action === 'water')    { care.water  = cap(care.water  + 25); care.lastWatered = now; }
    if (action === 'play')     { care.happiness = cap(care.happiness + 20); care.energy = Math.max(0, care.energy - 10); care.lastPlayed = now; }
    if (action === 'encourage'){ care.happiness = cap(care.happiness + 15); }

    await getDb().collection('companions').doc(req.user.id).update({ care, updatedAt: now });
    const responses = {
      feed:      { calm:'Thank you. I feel nourished.', curious:'Mmm! What is this?', cheerful:'Yes! Food!', wise:'A body well-fed.', playful:'Nom nom!' },
      water:     { calm:'Refreshing. Thank you.', curious:'Water from the Nile?', cheerful:'So refreshing!', wise:'Water sustains all life.', playful:'Splash!' },
      play:      { calm:'A pleasant game.', curious:'How fascinating!', cheerful:'Best day ever!', wise:'Play is the work of the spirit.', playful:'Wheee!' },
      encourage: { calm:'Your words mean a great deal.', curious:'New questions!', cheerful:'You\'re amazing!', wise:'Kind words echo.', playful:'You\'re my favorite!' },
    };
    const msg = responses[action]?.[c.personality] || 'Thank you.';
    res.json({ success: true, care, message: msg });
  } catch (err) { next(err); }
});

// PATCH /api/companion/tasks/:key
router.patch('/tasks/:key', [body('action').isIn(['complete','skip','toggle_enabled'])], handleValidation, async (req, res, next) => {
  try {
    const c = await loadOrCreate(req.user.id);
    if (!c.discovered) return next(new NotFoundError('Companion'));
    const tasks = c.dailyTasks || DEFAULT_DAILY_TASKS;
    const task  = tasks.find(t => t.key === req.params.key);
    if (!task) return res.status(404).json({ error: true, message: 'Task not found' });
    if (req.body.action === 'complete')       { task.completedToday = true; task.lastCompleted = new Date().toISOString(); }
    if (req.body.action === 'toggle_enabled') { task.enabled = !task.enabled; }
    await getDb().collection('companions').doc(req.user.id).update({ dailyTasks: tasks, updatedAt: new Date().toISOString() });
    res.json({ success: true, task });
  } catch (err) { next(err); }
});

// POST /api/companion/minigame/score
router.post('/minigame/score', [body('score').isInt({ min: 0, max: 99999 })], handleValidation, async (req, res, next) => {
  try {
    const c = await loadOrCreate(req.user.id);
    if (!c.discovered) return next(new NotFoundError('Companion'));
    const { score } = req.body;
    const miniGame  = { gamesPlayed: (c.miniGame?.gamesPlayed || 0) + 1, highScore: Math.max(c.miniGame?.highScore || 0, score) };
    const care      = { ...c.care, happiness: Math.min(100, (c.care?.happiness || 0) + 10), lastPlayed: new Date().toISOString() };
    await getDb().collection('companions').doc(req.user.id).update({ miniGame, care, updatedAt: new Date().toISOString() });
    res.json({ success: true, isHighScore: score > (c.miniGame?.highScore || 0), miniGame });
  } catch (err) { next(err); }
});

// PATCH /api/companion/widget
router.patch('/widget',
  [body('widgetVisible').optional().isBoolean(), body('disabled').optional().isBoolean()],
  handleValidation,
  async (req, res, next) => {
    try {
      const update = { updatedAt: new Date().toISOString() };
      if (req.body.widgetVisible !== undefined) update.widgetVisible = req.body.widgetVisible;
      if (req.body.disabled      !== undefined) update.disabled      = req.body.disabled;
      await getDb().collection('companions').doc(req.user.id).update(update);
      res.json({ success: true, ...update });
    } catch (err) { next(err); }
  }
);

module.exports = router;
