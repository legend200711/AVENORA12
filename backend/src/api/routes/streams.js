/**
 * Legacy /api/streams routes (Firestore edition)
 *
 * These routes remain for backward compatibility.
 * New live sessions use /api/live.
 *
 * Collection: streams/{streamId}
 */

const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const { getDb } = require('../../config/firestore');
const { NotFoundError } = require('../middleware/errorHandler');

// GET /api/streams
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { category, status = 'live' } = req.query;
    const db = getDb();
    let q = db.collection('streams')
      .where('status', '==', status)
      .where('isBanned', '==', false)
      .orderBy('viewerCount', 'desc')
      .limit(50);

    const snap    = await q.get();
    let streams   = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (category) streams = streams.filter(s => s.category === category);

    // Strip sensitive liveSession field
    streams = streams.map(s => { const c = { ...s }; delete c.liveSession; return c; });

    res.json({ success: true, streams });
  } catch (err) { next(err); }
});

// GET /api/streams/:id
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const db  = getDb();
    const doc = await db.collection('streams').doc(req.params.id).get();
    if (!doc.exists) return next(new NotFoundError('Stream'));
    const stream = { id: doc.id, ...doc.data() };
    delete stream.liveSession;
    res.json({ success: true, stream });
  } catch (err) { next(err); }
});

module.exports = router;
