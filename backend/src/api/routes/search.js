/**
 * Search Route — Firestore-backed
 * Basic text search using client-side filtering (Firestore has no native full-text search).
 * For production-scale search, integrate Algolia or Typesense.
 */
'use strict';

const express = require('express');
const router  = express.Router();
const { optionalAuth } = require('../middleware/auth');
const { getDb } = require('../../config/firestore');

// GET /api/search
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { q, type, page = 1, limit = 20 } = req.query;
    if (!q || q.trim().length < 2) return res.status(422).json({ error: true, message: 'Search query must be at least 2 characters' });

    const searchTerm = q.trim().slice(0, 100).toLowerCase();
    const limitN     = Math.min(50, parseInt(limit) || 20);
    const db         = getDb();
    const results    = {};

    // Firestore does not support full-text search — we fetch a limited set and filter client-side.
    // For scale, replace with Algolia/Typesense.

    if (!type || type === 'users') {
      const snap = await db.collection('users').where('status.isActive', '==', true).limit(200).get();
      results.users = snap.docs
        .map(d => { const data = d.data(); return { id: d.id, username: data.username, profile: data.profile }; })
        .filter(u => u.username?.toLowerCase().includes(searchTerm) || u.profile?.displayName?.toLowerCase().includes(searchTerm))
        .slice(0, limitN);
    }

    if (!type || type === 'posts') {
      const snap = await db.collection('posts').where('isDeleted', '==', false).where('visibility', '==', 'public').orderBy('createdAt', 'desc').limit(500).get();
      results.posts = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => p.content?.toLowerCase().includes(searchTerm))
        .slice(0, limitN);
    }

    if (!type || type === 'videos') {
      const snap = await db.collection('videos').where('isDeleted', '==', false).where('isPublished', '==', true).where('visibility', '==', 'public').orderBy('views', 'desc').limit(300).get();
      results.videos = snap.docs
        .map(d => ({ id: d.id, ...d.data(), videoUrl: d.data().hlsUrl || d.data().originalFileUrl || null }))
        .filter(v => v.title?.toLowerCase().includes(searchTerm) || v.description?.toLowerCase().includes(searchTerm) || (v.tags || []).some(t => t.toLowerCase().includes(searchTerm)))
        .slice(0, limitN);
    }

    if (!type || type === 'channels') {
      const snap = await db.collection('channels').where('isSuspended', '==', false).limit(200).get();
      results.channels = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => c.name?.toLowerCase().includes(searchTerm) || c.description?.toLowerCase().includes(searchTerm))
        .slice(0, limitN);
    }

    res.json({ success: true, query: searchTerm, results });
  } catch (err) { next(err); }
});

module.exports = router;
