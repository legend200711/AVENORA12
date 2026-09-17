/**
 * User Preferences Routes — Avenora
 * GET  /api/preferences        — fetch own preferences
 * PUT  /api/preferences        — replace own preferences (full or partial merge)
 * POST /api/preferences/reset  — restore factory defaults
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../../models/User');

// ─── Default preference set ──────────────────────────────────
const DEFAULT_PREFS = {
  theme:          'dark',
  accentColor:    'gold',
  textSize:       'normal',
  gothicIntensity:'standard',
  highContrast:   false,
  reducedMotion:  false,
  soundEnabled:   true,
  autoplay:       true,
  captions:       false,
  notifications: {
    email:               true,
    push:                true,
    level:               'all',
    likes:               true,
    comments:            true,
    follows:             true,
    messages:            true,
    groupMessages:       true,
    chatInvites:         true,
    friendRequests:      true,
    liveVideo:           true,
    systemAnnouncements: true,
  },
  homeCards: {
    visibleCards: ['cloudstream','live','social','dj','music','gallery'],
    cardOrder:    ['cloudstream','live','social','dj','music','gallery'],
  },
  startSection:      '',
  continueWatching:  true,
  continueListening: true,
  recentlyVisited:   true,
  savedItems:        true,
  mutedTopics:       [],
};

// ─── Allowed accent colours (validated server-side) ──────────
const ALLOWED_ACCENT   = ['gold','emerald','violet','bronze','crimson'];
const ALLOWED_TEXT_SZ  = ['small','normal','large','xlarge'];
const ALLOWED_GOTHIC   = ['subtle','standard','intense'];
const ALLOWED_THEMES   = ['dark','darker','amoled'];
const ALLOWED_NOTIF_LV = ['all','important','none'];
const ALLOWED_CARDS    = ['cloudstream','live','social','dj','music','gallery','admin'];

// ─── Helper: find MongoDB user by Firebase UID or email ──────
async function _findMongoUser(req, select) {
  const mongoose = require('mongoose');
  const id = req.user.id;
  if (mongoose.Types.ObjectId.isValid(id) && id.length === 24) {
    return User.findById(id).select(select).lean ? User.findById(id).select(select).lean() : User.findById(id).select(select);
  }
  if (req.user.email) {
    return User.findOne({ email: req.user.email.toLowerCase() }).select(select);
  }
  return null;
}

// ─── GET /api/preferences ────────────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const user = await _findMongoUser(req, 'preferences role');
    // Firebase-only users won't have a MongoDB record — return defaults with role from token
    if (!user) {
      const prefs = { ...DEFAULT_PREFS, _founderAccess: ['founder','admin'].includes(req.user.role) };
      return res.json({ success: true, preferences: prefs });
    }

    // Merge stored prefs over defaults so clients always receive a complete object
    const prefs = deepMerge(DEFAULT_PREFS, (user.preferences || {}));

    // Inject whether this user may see the founder card — resolved server-side
    prefs._founderAccess = ['founder','admin'].includes(user.role || req.user.role);

    res.json({ success: true, preferences: prefs });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/preferences ────────────────────────────────────
router.put('/', authenticate, async (req, res, next) => {
  try {
    const user = await _findMongoUser(req, 'preferences role');
    if (!user) {
      // Firebase-only user: no MongoDB record to update — return current defaults
      return res.json({ success: true, preferences: DEFAULT_PREFS, note: 'Firebase users: preferences are stored in Firestore.' });
    }

    const incoming = req.body || {};
    const current  = user.preferences || {};

    // Build validated update — only accept known, safe fields
    const update = {};

    if (ALLOWED_THEMES.includes(incoming.theme))         update['preferences.theme']          = incoming.theme;
    if (ALLOWED_ACCENT.includes(incoming.accentColor))   update['preferences.accentColor']     = incoming.accentColor;
    if (ALLOWED_TEXT_SZ.includes(incoming.textSize))     update['preferences.textSize']        = incoming.textSize;
    if (ALLOWED_GOTHIC.includes(incoming.gothicIntensity)) update['preferences.gothicIntensity'] = incoming.gothicIntensity;
    if (typeof incoming.highContrast === 'boolean')      update['preferences.highContrast']    = incoming.highContrast;
    if (typeof incoming.reducedMotion === 'boolean')     update['preferences.reducedMotion']   = incoming.reducedMotion;
    if (typeof incoming.soundEnabled === 'boolean')      update['preferences.soundEnabled']    = incoming.soundEnabled;
    if (typeof incoming.autoplay === 'boolean')          update['preferences.autoplay']        = incoming.autoplay;
    if (typeof incoming.captions === 'boolean')          update['preferences.captions']        = incoming.captions;

    // Notifications (individual toggles)
    if (incoming.notifications && typeof incoming.notifications === 'object') {
      const n = incoming.notifications;
      if (ALLOWED_NOTIF_LV.includes(n.level))              update['preferences.notifications.level']               = n.level;
      ['email','push','likes','comments','follows','messages','groupMessages',
       'chatInvites','friendRequests','liveVideo','systemAnnouncements'].forEach(k => {
        if (typeof n[k] === 'boolean') update[`preferences.notifications.${k}`] = n[k];
      });
    }

    // Home cards
    if (incoming.homeCards && typeof incoming.homeCards === 'object') {
      const hc = incoming.homeCards;
      const isValidCardList = (arr) => Array.isArray(arr) && arr.every(id => ALLOWED_CARDS.includes(id));

      // Strip founder card for non-founders silently
      const isFounder = ['founder','admin'].includes(user.role);
      const filterFounder = (arr) => isFounder ? arr : arr.filter(id => id !== 'admin');

      if (isValidCardList(hc.visibleCards)) update['preferences.homeCards.visibleCards'] = filterFounder(hc.visibleCards);
      if (isValidCardList(hc.cardOrder))    update['preferences.homeCards.cardOrder']    = filterFounder(hc.cardOrder);
    }

    // Personalization
    if (typeof incoming.startSection === 'string') update['preferences.startSection'] = incoming.startSection.slice(0, 32);
    if (typeof incoming.continueWatching === 'boolean')  update['preferences.continueWatching']  = incoming.continueWatching;
    if (typeof incoming.continueListening === 'boolean') update['preferences.continueListening'] = incoming.continueListening;
    if (typeof incoming.recentlyVisited === 'boolean')   update['preferences.recentlyVisited']   = incoming.recentlyVisited;
    if (typeof incoming.savedItems === 'boolean')        update['preferences.savedItems']        = incoming.savedItems;
    if (Array.isArray(incoming.mutedTopics))             update['preferences.mutedTopics']       = incoming.mutedTopics.slice(0, 50).map(t => String(t).slice(0, 64));

    const mongoose = require('mongoose');
    const isMongoId = (id) => mongoose.Types.ObjectId.isValid(id) && id.length === 24;
    if (isMongoId(req.user.id)) {
      await User.findByIdAndUpdate(req.user.id, { $set: update });
    } else if (req.user.email) {
      await User.findOneAndUpdate({ email: req.user.email.toLowerCase() }, { $set: update });
    }

    const fresh = await _findMongoUser(req, 'preferences role');
    const merged = deepMerge(DEFAULT_PREFS, fresh?.preferences || {});
    merged._founderAccess = ['founder','admin'].includes(fresh?.role || req.user.role);

    res.json({ success: true, preferences: merged });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/preferences/reset ────────────────────────────
router.post('/reset', authenticate, async (req, res, next) => {
  try {
    const mongoose2 = require('mongoose');
    const isMongoId2 = (id) => mongoose2.Types.ObjectId.isValid(id) && id.length === 24;
    if (isMongoId2(req.user.id)) {
      await User.findByIdAndUpdate(req.user.id, { $set: { preferences: DEFAULT_PREFS } });
    } else if (req.user.email) {
      await User.findOneAndUpdate({ email: req.user.email.toLowerCase() }, { $set: { preferences: DEFAULT_PREFS } });
    }
    const user = await _findMongoUser(req, 'role');
    const prefs = { ...DEFAULT_PREFS, _founderAccess: ['founder','admin'].includes(user?.role) };
    res.json({ success: true, preferences: prefs });
  } catch (err) {
    next(err);
  }
});

// ─── Helpers ─────────────────────────────────────────────────
function deepMerge(target, source) {
  const out = Object.assign({}, target);
  for (const key of Object.keys(source || {})) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = deepMerge(target[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      out[key] = source[key];
    }
  }
  return out;
}

module.exports = router;
