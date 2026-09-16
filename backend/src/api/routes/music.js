/**
 * AVENORA MUSIC HUB — Backend API Routes
 *
 * GET  /api/music/tracks              — list public tracks
 * GET  /api/music/tracks/:id          — get single track
 * POST /api/music/tracks/:id/play     — record play + increment plays
 * POST /api/music/tracks/:id/like     — toggle favorite
 * GET  /api/music/albums              — list public albums
 * GET  /api/music/albums/:id          — get album + tracklist
 * GET  /api/music/artists             — list artists
 * GET  /api/music/artists/:id         — get artist + albums + top tracks
 * GET  /api/music/playlists           — list caller's playlists (auth required)
 * POST /api/music/playlists           — create playlist (auth required)
 * GET  /api/music/playlists/:id       — get playlist
 * PUT  /api/music/playlists/:id       — rename playlist
 * POST /api/music/playlists/:id/tracks       — add track to playlist
 * DELETE /api/music/playlists/:id/tracks/:tid — remove track from playlist
 * PUT  /api/music/playlists/:id/reorder      — reorder playlist tracks
 * DELETE /api/music/playlists/:id            — delete playlist
 * GET  /api/music/favorites           — get favorites (auth required)
 * GET  /api/music/recently-played     — recently played (auth required)
 * GET  /api/music/search              — search across all entities
 * POST /api/music/upload              — upload track (auth, Supabase Storage required)
 * GET  /api/music/genres              — list available genres
 *
 * Audio files are stored in Supabase Storage (music bucket).
 * Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const musicSvc   = require('../../services/music/musicLibraryService');

// ─── Genres ─────────────────────────────────────────────────
const GENRES = [
  'Hip-Hop', 'R&B', 'Trap', 'Drill', 'Afrobeats',
  'Pop', 'Rock', 'Electronic', 'House', 'Techno',
  'Drum & Bass', 'Reggae', 'Gospel', 'Jazz', 'Soul',
  'Indie', 'Alternative', 'Lo-Fi', 'Ambient', 'Cinematic',
  'Spoken Word', 'Podcast', 'Other',
];

router.get('/genres', (req, res) => {
  res.json({ success: true, genres: GENRES });
});

// ─── Tracks ──────────────────────────────────────────────────

router.get('/tracks', optionalAuth, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, genre, artist, album, sort } = req.query;
    const data = await musicSvc.listTracks({
      page: Math.max(1, parseInt(page) || 1),
      limit: Math.min(50, Math.max(1, parseInt(limit) || 20)),
      genre, artist, album, sort,
    });
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

router.get('/tracks/:id', optionalAuth, async (req, res, next) => {
  try {
    const track = await musicSvc.getTrack(req.params.id);
    if (!track) return res.status(404).json({ success: false, message: 'Track not found' });
    res.json({ success: true, track });
  } catch (err) { next(err); }
});

// Record play — fire-and-forget style, always returns 200
router.post('/tracks/:id/play', optionalAuth, async (req, res) => {
  const userId = req.user?.id || null;
  await musicSvc.recordPlay(req.params.id, userId);
  res.json({ success: true });
});

router.post('/tracks/:id/like', authenticate, async (req, res, next) => {
  try {
    const result = await musicSvc.toggleFavorite(req.user.id, req.params.id);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ─── Albums ──────────────────────────────────────────────────

router.get('/albums', optionalAuth, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, genre, artist } = req.query;
    const data = await musicSvc.listAlbums({
      page: Math.max(1, parseInt(page) || 1),
      limit: Math.min(50, parseInt(limit) || 20),
      genre, artist,
    });
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

router.get('/albums/:id', optionalAuth, async (req, res, next) => {
  try {
    const album = await musicSvc.getAlbum(req.params.id);
    if (!album) return res.status(404).json({ success: false, message: 'Album not found' });
    res.json({ success: true, album });
  } catch (err) { next(err); }
});

// ─── Artists ─────────────────────────────────────────────────

router.get('/artists', optionalAuth, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const data = await musicSvc.listArtists({
      page: Math.max(1, parseInt(page) || 1),
      limit: Math.min(50, parseInt(limit) || 20),
    });
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

router.get('/artists/:id', optionalAuth, async (req, res, next) => {
  try {
    const artist = await musicSvc.getArtist(req.params.id);
    if (!artist) return res.status(404).json({ success: false, message: 'Artist not found' });
    res.json({ success: true, artist });
  } catch (err) { next(err); }
});

// ─── Playlists ───────────────────────────────────────────────

router.get('/playlists', authenticate, async (req, res, next) => {
  try {
    const playlists = await musicSvc.listPlaylists(req.user.id);
    res.json({ success: true, playlists });
  } catch (err) { next(err); }
});

router.post('/playlists', authenticate, async (req, res, next) => {
  try {
    const { name, description = '', visibility = 'private' } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Playlist name is required' });
    }
    const playlist = await musicSvc.createPlaylist(req.user.id, {
      name: name.trim().slice(0, 200),
      description: (description || '').slice(0, 1000),
      visibility: visibility === 'public' ? 'public' : 'private',
    });
    res.status(201).json({ success: true, playlist });
  } catch (err) { next(err); }
});

router.get('/playlists/:id', optionalAuth, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const playlist = await musicSvc.getPlaylist(req.params.id, userId);
    if (!playlist) return res.status(404).json({ success: false, message: 'Playlist not found' });
    res.json({ success: true, playlist });
  } catch (err) { next(err); }
});

router.put('/playlists/:id', authenticate, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    const playlist = await musicSvc.renamePlaylist(req.params.id, req.user.id, name.trim().slice(0, 200));
    if (!playlist) return res.status(404).json({ success: false, message: 'Playlist not found' });
    res.json({ success: true, playlist });
  } catch (err) { next(err); }
});

router.delete('/playlists/:id', authenticate, async (req, res, next) => {
  try {
    await musicSvc.deletePlaylist(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/playlists/:id/tracks', authenticate, async (req, res, next) => {
  try {
    const { trackId } = req.body;
    if (!trackId) return res.status(400).json({ success: false, message: 'trackId is required' });
    const playlist = await musicSvc.addTrackToPlaylist(req.params.id, req.user.id, trackId);
    if (!playlist) return res.status(404).json({ success: false, message: 'Playlist not found' });
    res.json({ success: true, playlist });
  } catch (err) { next(err); }
});

router.delete('/playlists/:id/tracks/:trackId', authenticate, async (req, res, next) => {
  try {
    const playlist = await musicSvc.removeTrackFromPlaylist(
      req.params.id, req.user.id, req.params.trackId
    );
    if (!playlist) return res.status(404).json({ success: false, message: 'Playlist not found' });
    res.json({ success: true, playlist });
  } catch (err) { next(err); }
});

router.put('/playlists/:id/reorder', authenticate, async (req, res, next) => {
  try {
    const { trackIds } = req.body;
    if (!Array.isArray(trackIds)) {
      return res.status(400).json({ success: false, message: 'trackIds must be an array' });
    }
    const playlist = await musicSvc.reorderPlaylistTracks(req.params.id, req.user.id, trackIds);
    if (!playlist) return res.status(404).json({ success: false, message: 'Playlist not found' });
    res.json({ success: true, playlist });
  } catch (err) { next(err); }
});

// ─── Favorites ───────────────────────────────────────────────

router.get('/favorites', authenticate, async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const data = await musicSvc.getFavorites(req.user.id, {
      page: parseInt(page) || 1,
      limit: Math.min(100, parseInt(limit) || 50),
    });
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// ─── History ─────────────────────────────────────────────────

router.get('/recently-played', authenticate, async (req, res, next) => {
  try {
    const { limit = 20 } = req.query;
    const tracks = await musicSvc.getRecentlyPlayed(req.user.id, Math.min(50, parseInt(limit) || 20));
    res.json({ success: true, tracks });
  } catch (err) { next(err); }
});

// ─── Search ──────────────────────────────────────────────────

router.get('/search', optionalAuth, async (req, res, next) => {
  try {
    const { q, limit = 20 } = req.query;
    if (!q || !q.trim()) {
      return res.json({ success: true, tracks: [], albums: [], artists: [], playlists: [] });
    }
    const results = await musicSvc.search(q, { limit: Math.min(50, parseInt(limit) || 20) });
    res.json({ success: true, ...results });
  } catch (err) { next(err); }
});

// ─── Upload ──────────────────────────────────────────────────
/**
 * Music upload — stores audio files in Supabase Storage (music bucket).
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
 */

const multerMusicMemory = (() => {
  const multer = require('multer');
  const ALLOWED_AUDIO = new Set([
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
    'audio/ogg', 'audio/flac', 'audio/x-flac', 'audio/aac', 'audio/x-m4a',
    'audio/mp4', 'audio/opus', 'audio/webm',
  ]);
  const MAX_AUDIO_MB = parseInt(process.env.MUSIC_MAX_FILE_MB) || 100;
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AUDIO_MB * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_AUDIO.has(file.mimetype)) {
        return cb(new Error(`Unsupported audio type: ${file.mimetype}`));
      }
      cb(null, true);
    },
  });
})();

router.post('/upload', authenticate, (req, res, next) => {
  multerMusicMemory.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, message: `Audio file too large (max ${process.env.MUSIC_MAX_FILE_MB || 100} MB)` });
      }
      return res.status(400).json({ success: false, message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No audio file provided' });
    }

    try {
      const path   = require('path');
      const storageSvc = require('../../services/storage/supabaseStorage');
      const { title, artistName, albumTitle, genre } = req.body;

      const storagePath = storageSvc.uploadFilePath('music', req.user.id, req.file.originalname);
      const result = await storageSvc.uploadBuffer({
        bucket:      'music',
        storagePath,
        buffer:      req.file.buffer,
        mimetype:    req.file.mimetype,
      });

      // Use signed URL for private bucket — refresh on playback via GET /api/music/tracks/:id/url
      const fileUrl = result.signedUrl || result.publicUrl;

      const track = await musicSvc.createTrack({
        title:      (title || path.basename(req.file.originalname, path.extname(req.file.originalname))).slice(0, 200),
        artistName: (artistName || '').slice(0, 200),
        albumTitle: (albumTitle || '').slice(0, 200),
        genre:      (genre || 'Other').slice(0, 100),
        fileUrl,
        storagePath,
        fileSize:   req.file.size,
        uploader:   req.user.id,
        visibility: 'public',
        isPublished: true,
      });

      res.status(201).json({ success: true, track });
    } catch (err2) {
      next(err2);
    }
  });
});

// GET /api/music/tracks/:id/url — refresh signed URL for private audio
router.get('/tracks/:id/url', authenticate, async (req, res, next) => {
  try {
    const track = await musicSvc.getTrack(req.params.id);
    if (!track) return res.status(404).json({ success: false, message: 'Track not found' });
    if (!track.storagePath) return res.json({ success: true, url: track.fileUrl });

    const storageSvc = require('../../services/storage/supabaseStorage');
    const signedUrl = await storageSvc.getSignedUrl('music', track.storagePath, 3600);
    res.json({ success: true, url: signedUrl });
  } catch (err) { next(err); }
});

// ─── DJ System bridge ─────────────────────────────────────────
/**
 * GET /api/music/dj/library
 * Returns a compact track list suitable for loading into DJ System decks.
 * Same data as /tracks but limited fields and always includes waveformData.
 */
router.get('/dj/library', optionalAuth, async (req, res, next) => {
  try {
    const { page = 1, limit = 100, genre } = req.query;
    const data = await musicSvc.listTracks({
      page: Math.max(1, parseInt(page) || 1),
      limit: Math.min(200, parseInt(limit) || 100),
      genre,
      sort: 'newest',
    });
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

module.exports = router;
