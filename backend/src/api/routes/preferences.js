/**
 * User Preferences Routes — Firestore-backed
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const { getDb } = require('../../config/firestore');

const DEFAULT_PREFS = {
  theme: 'dark', accentColor: 'gold', textSize: 'normal', gothicIntensity: 'standard',
  highContrast: false, reducedMotion: false, soundEnabled: true, autoplay: true, captions: false,
  notifications: {
    email: true, push: true, level: 'all', likes: true, comments: true, follows: true,
    messages: true, groupMessages: true, chatInvites: true, friendRequests: true,
    liveVideo: true, systemAnnouncements: true,
  },
  homeCards: {
    visibleCards: ['cloudstream','live','social','dj','music','gallery'],
    cardOrder:    ['cloudstream','live','social','dj','music','gallery'],
  },
  startSection: '', continueWatching: true, continueListening: true,
  recentlyVisited: true, savedItems: true, mutedTopics: [],
};

const ALLOWED_ACCENT   = ['gold','emerald','violet','bronze','crimson'];
const ALLOWED_TEXT_SZ  = ['small','normal','large','xlarge'];
const ALLOWED_GOTHIC   = ['subtle','standard','intense'];
const ALLOWED_THEMES   = ['dark','darker','amoled'];
const ALLOWED_NOTIF_LV = ['all','important','none'];
const ALLOWED_CARDS    = ['cloudstream','live','social','dj','music','gallery','admin'];

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

async function _getPrefs(userId) {
  const snap = await getDb().collection('userPreferences').doc(userId).get();
  return snap.exists ? snap.data() : {};
}

// GET /api/preferences
router.get('/', authenticate, async (req, res, next) => {
  try {
    const stored = await _getPrefs(req.user.id);
    const prefs  = deepMerge(DEFAULT_PREFS, stored);
    prefs._founderAccess = ['founder','admin'].includes(req.user.role);
    res.json({ success: true, preferences: prefs });
  } catch (err) { next(err); }
});

// PUT /api/preferences
router.put('/', authenticate, async (req, res, next) => {
  try {
    const incoming = req.body || {};
    const db = getDb();
    const update = {};

    if (ALLOWED_THEMES.includes(incoming.theme))         update.theme          = incoming.theme;
    if (ALLOWED_ACCENT.includes(incoming.accentColor))   update.accentColor    = incoming.accentColor;
    if (ALLOWED_TEXT_SZ.includes(incoming.textSize))     update.textSize       = incoming.textSize;
    if (ALLOWED_GOTHIC.includes(incoming.gothicIntensity)) update.gothicIntensity = incoming.gothicIntensity;
    if (typeof incoming.highContrast === 'boolean')      update.highContrast   = incoming.highContrast;
    if (typeof incoming.reducedMotion === 'boolean')     update.reducedMotion  = incoming.reducedMotion;
    if (typeof incoming.soundEnabled === 'boolean')      update.soundEnabled   = incoming.soundEnabled;
    if (typeof incoming.autoplay === 'boolean')          update.autoplay       = incoming.autoplay;
    if (typeof incoming.captions === 'boolean')          update.captions       = incoming.captions;

    if (incoming.notifications && typeof incoming.notifications === 'object') {
      const n = incoming.notifications;
      const nUpdate = {};
      if (ALLOWED_NOTIF_LV.includes(n.level)) nUpdate.level = n.level;
      ['email','push','likes','comments','follows','messages','groupMessages',
       'chatInvites','friendRequests','liveVideo','systemAnnouncements'].forEach(k => {
        if (typeof n[k] === 'boolean') nUpdate[k] = n[k];
      });
      if (Object.keys(nUpdate).length) update.notifications = nUpdate;
    }

    if (incoming.homeCards && typeof incoming.homeCards === 'object') {
      const hc = incoming.homeCards;
      const isFounder = ['founder','admin'].includes(req.user.role);
      const filterF   = arr => isFounder ? arr : arr.filter(id => id !== 'admin');
      const valid     = arr => Array.isArray(arr) && arr.every(id => ALLOWED_CARDS.includes(id));
      const hcUpdate  = {};
      if (valid(hc.visibleCards)) hcUpdate.visibleCards = filterF(hc.visibleCards);
      if (valid(hc.cardOrder))    hcUpdate.cardOrder    = filterF(hc.cardOrder);
      if (Object.keys(hcUpdate).length) update.homeCards = hcUpdate;
    }

    if (typeof incoming.startSection === 'string')         update.startSection      = incoming.startSection.slice(0, 32);
    if (typeof incoming.continueWatching === 'boolean')    update.continueWatching  = incoming.continueWatching;
    if (typeof incoming.continueListening === 'boolean')   update.continueListening = incoming.continueListening;
    if (typeof incoming.recentlyVisited === 'boolean')     update.recentlyVisited   = incoming.recentlyVisited;
    if (typeof incoming.savedItems === 'boolean')          update.savedItems        = incoming.savedItems;
    if (Array.isArray(incoming.mutedTopics))               update.mutedTopics       = incoming.mutedTopics.slice(0, 50).map(t => String(t).slice(0, 64));

    if (Object.keys(update).length) {
      // Merge nested objects into existing Firestore doc
      const existing = await _getPrefs(req.user.id);
      const merged   = deepMerge(existing, update);
      await db.collection('userPreferences').doc(req.user.id).set(merged);
    }

    const fresh  = await _getPrefs(req.user.id);
    const prefs  = deepMerge(DEFAULT_PREFS, fresh);
    prefs._founderAccess = ['founder','admin'].includes(req.user.role);
    res.json({ success: true, preferences: prefs });
  } catch (err) { next(err); }
});

// POST /api/preferences/reset
router.post('/reset', authenticate, async (req, res, next) => {
  try {
    await getDb().collection('userPreferences').doc(req.user.id).set(DEFAULT_PREFS);
    const prefs = { ...DEFAULT_PREFS, _founderAccess: ['founder','admin'].includes(req.user.role) };
    res.json({ success: true, preferences: prefs });
  } catch (err) { next(err); }
});

module.exports = router;
