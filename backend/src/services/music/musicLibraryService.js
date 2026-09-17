/**
 * MusicLibraryService — Avenora Music Hub
 *
 * Reusable service layer shared by:
 *   - Avenora Music Hub (browsing, playback, playlists)
 *   - Avenora DJ System (deck loading, cue points)
 *   - Shadow Mix / Avenora Hits
 *   - 24-Hour Cloud Stream
 *
 * All methods return plain objects or arrays — no Express/HTTP coupling.
 * Audio files are stored in Supabase Storage (music bucket).
 * Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
 * For private tracks, refresh the signed URL via GET /api/music/tracks/:id/url.
 */

'use strict';

const Track          = require('../../models/Track');
const Album          = require('../../models/Album');
const Artist         = require('../../models/Artist');
const Playlist       = require('../../models/Playlist');
const MusicFavorite  = require('../../models/MusicFavorite');
const MusicPlayHistory = require('../../models/MusicPlayHistory');

// ─── Track helpers ──────────────────────────────────────────

/**
 * Serialize a Track document to a safe public object.
 * fileUrl is included because it is the CDN URL, not a secret.
 */
function serializeTrack(doc) {
  if (!doc) return null;
  const t = doc.toObject ? doc.toObject() : doc;
  return {
    id:          t._id,
    title:       t.title,
    artist:      t.artist,
    artistName:  t.artistName || null,
    album:       t.album,
    albumTitle:  t.albumTitle || null,
    coverUrl:    t.coverUrl || null,
    fileUrl:     t.fileUrl || null,
    duration:    t.duration || null,
    waveformData:t.waveformData || [],
    genre:       t.genre || null,
    releaseDate: t.releaseDate || null,
    trackNumber: t.trackNumber || null,
    bpm:         t.bpm || null,
    key:         t.key || null,
    tags:        t.tags || [],
    plays:       t.plays || 0,
    likeCount:   (t.likedBy || []).length,
    visibility:  t.visibility,
    isPublished: t.isPublished,
    createdAt:   t.createdAt,
    uploader:    t.uploader,
  };
}

function serializeAlbum(doc) {
  if (!doc) return null;
  const a = doc.toObject ? doc.toObject() : doc;
  return {
    id:          a._id,
    title:       a.title,
    artist:      a.artist,
    artistName:  a.artistName || null,
    coverUrl:    a.coverUrl || null,
    releaseDate: a.releaseDate || null,
    genre:       a.genre || null,
    description: a.description || null,
    totalTracks: a.totalTracks || 0,
    visibility:  a.visibility,
    isPublished: a.isPublished,
    createdAt:   a.createdAt,
    uploader:    a.uploader,
  };
}

function serializeArtist(doc) {
  if (!doc) return null;
  const a = doc.toObject ? doc.toObject() : doc;
  return {
    id:              a._id,
    name:            a.name,
    slug:            a.slug || null,
    biography:       a.biography || null,
    avatarUrl:       a.avatarUrl || null,
    bannerUrl:       a.bannerUrl || null,
    genres:          a.genres || [],
    isVerified:      a.isVerified || false,
    spotifyUrl:      a.spotifyUrl || null,
    appleMusicUrl:   a.appleMusicUrl || null,
    youtubeMusicUrl: a.youtubeMusicUrl || null,
    amazonMusicUrl:  a.amazonMusicUrl || null,
    createdAt:       a.createdAt,
  };
}

function serializePlaylist(doc, includeTracks = false) {
  if (!doc) return null;
  const p = doc.toObject ? doc.toObject() : doc;
  const base = {
    id:          p._id,
    name:        p.name,
    description: p.description || null,
    owner:       p.owner,
    coverUrl:    p.coverUrl || null,
    visibility:  p.visibility,
    trackCount:  (p.tracks || []).length,
    createdAt:   p.createdAt,
    updatedAt:   p.updatedAt,
  };
  if (includeTracks) {
    base.tracks = (p.tracks || []).map(t =>
      t && t.title ? serializeTrack(t) : t   // populated or plain id
    );
  }
  return base;
}

// ─── Track queries ──────────────────────────────────────────

/**
 * List public published tracks with pagination and optional filters.
 * @param {object} opts
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 * @param {string} [opts.genre]
 * @param {string} [opts.artist]  - artist ObjectId string
 * @param {string} [opts.album]   - album ObjectId string
 * @param {string} [opts.sort]    - 'newest'|'popular'|'alpha'
 */
async function listTracks({ page = 1, limit = 20, genre, artist, album, sort = 'newest' } = {}) {
  const filter = { isDeleted: false, isPublished: true, visibility: 'public' };
  if (genre)  filter.genre  = genre;
  if (artist) filter.artist = artist;
  if (album)  filter.album  = album;

  const sortMap = {
    newest:  { createdAt: -1 },
    popular: { plays: -1 },
    alpha:   { title: 1 },
  };
  const sortOpt = sortMap[sort] || sortMap.newest;

  const skip  = (page - 1) * limit;
  const total = await Track.countDocuments(filter);
  const docs  = await Track.find(filter).sort(sortOpt).skip(skip).limit(limit).lean();

  return { tracks: docs.map(serializeTrack), total, page, limit };
}

/**
 * Get a single track by ID.
 */
async function getTrack(id) {
  const doc = await Track.findOne({ _id: id, isDeleted: false }).lean();
  return serializeTrack(doc);
}

/**
 * Increment play count for a track. Fire-and-forget — does not throw.
 */
async function recordPlay(trackId, userId) {
  try {
    await Track.updateOne({ _id: trackId }, { $inc: { plays: 1 } });
    if (userId) {
      await MusicPlayHistory.create({ user: userId, track: trackId });
    }
  } catch { /* non-critical */ }
}

// ─── Album queries ──────────────────────────────────────────

async function listAlbums({ page = 1, limit = 20, genre, artist } = {}) {
  const filter = { isDeleted: false, isPublished: true, visibility: 'public' };
  if (genre)  filter.genre  = genre;
  if (artist) filter.artist = artist;

  const skip  = (page - 1) * limit;
  const total = await Album.countDocuments(filter);
  const docs  = await Album.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();

  return { albums: docs.map(serializeAlbum), total, page, limit };
}

async function getAlbum(id) {
  const album = await Album.findOne({ _id: id, isDeleted: false }).lean();
  if (!album) return null;
  const tracks = await Track.find({ album: id, isDeleted: false, isPublished: true })
    .sort({ trackNumber: 1, createdAt: 1 })
    .lean();
  return { ...serializeAlbum(album), tracks: tracks.map(serializeTrack) };
}

// ─── Artist queries ──────────────────────────────────────────

async function listArtists({ page = 1, limit = 20 } = {}) {
  const filter = { isDeleted: false };
  const skip   = (page - 1) * limit;
  const total  = await Artist.countDocuments(filter);
  const docs   = await Artist.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean();
  return { artists: docs.map(serializeArtist), total, page, limit };
}

async function getArtist(id) {
  const doc = await Artist.findOne({ _id: id, isDeleted: false }).lean();
  if (!doc) return null;
  const albums = await Album.find({ artist: id, isDeleted: false, isPublished: true })
    .sort({ releaseDate: -1 })
    .lean();
  const topTracks = await Track.find({ artist: id, isDeleted: false, isPublished: true })
    .sort({ plays: -1 })
    .limit(10)
    .lean();
  return {
    ...serializeArtist(doc),
    albums:    albums.map(serializeAlbum),
    topTracks: topTracks.map(serializeTrack),
  };
}

// ─── Playlist operations ─────────────────────────────────────

async function listPlaylists(userId) {
  const docs = await Playlist.find({ owner: userId, isDeleted: false }).sort({ updatedAt: -1 }).lean();
  return docs.map(p => serializePlaylist(p, false));
}

async function getPlaylist(id, userId) {
  const doc = await Playlist.findOne({ _id: id, isDeleted: false })
    .populate({ path: 'tracks', match: { isDeleted: false }, select: '-waveformData' })
    .lean();
  if (!doc) return null;
  // Only owner can see private playlists
  if (doc.visibility === 'private' && String(doc.owner) !== String(userId)) return null;
  return serializePlaylist(doc, true);
}

async function createPlaylist(userId, { name, description = '', visibility = 'private' } = {}) {
  const doc = await Playlist.create({ name, description, visibility, owner: userId, tracks: [] });
  return serializePlaylist(doc);
}

async function renamePlaylist(id, userId, name) {
  const doc = await Playlist.findOneAndUpdate(
    { _id: id, owner: userId, isDeleted: false },
    { name },
    { new: true }
  ).lean();
  return serializePlaylist(doc);
}

async function addTrackToPlaylist(playlistId, userId, trackId) {
  const doc = await Playlist.findOneAndUpdate(
    { _id: playlistId, owner: userId, isDeleted: false },
    { $addToSet: { tracks: trackId } },
    { new: true }
  ).lean();
  return serializePlaylist(doc);
}

async function removeTrackFromPlaylist(playlistId, userId, trackId) {
  const doc = await Playlist.findOneAndUpdate(
    { _id: playlistId, owner: userId, isDeleted: false },
    { $pull: { tracks: trackId } },
    { new: true }
  ).lean();
  return serializePlaylist(doc);
}

async function reorderPlaylistTracks(playlistId, userId, orderedTrackIds) {
  // Replace tracks array with the caller-provided order (only include ids already in the playlist)
  const existing = await Playlist.findOne({ _id: playlistId, owner: userId, isDeleted: false }).lean();
  if (!existing) return null;
  const setIds  = new Set(existing.tracks.map(String));
  const cleaned = orderedTrackIds.filter(id => setIds.has(String(id)));
  const doc = await Playlist.findByIdAndUpdate(
    playlistId,
    { tracks: cleaned },
    { new: true }
  ).lean();
  return serializePlaylist(doc);
}

async function deletePlaylist(id, userId) {
  await Playlist.findOneAndUpdate(
    { _id: id, owner: userId },
    { isDeleted: true }
  );
}

// ─── Favorites ───────────────────────────────────────────────

async function getFavorites(userId, { page = 1, limit = 50 } = {}) {
  const skip  = (page - 1) * limit;
  const total = await MusicFavorite.countDocuments({ user: userId });
  const docs  = await MusicFavorite.find({ user: userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate({ path: 'track', match: { isDeleted: false }, select: '-waveformData' })
    .lean();
  const tracks = docs.map(d => d.track ? serializeTrack(d.track) : null).filter(Boolean);
  return { tracks, total, page, limit };
}

async function toggleFavorite(userId, trackId) {
  const existing = await MusicFavorite.findOne({ user: userId, track: trackId });
  if (existing) {
    await MusicFavorite.deleteOne({ _id: existing._id });
    return { liked: false };
  }
  await MusicFavorite.create({ user: userId, track: trackId });
  // Also increment track like count
  await Track.updateOne({ _id: trackId }, { $addToSet: { likedBy: userId } });
  return { liked: true };
}

async function isFavorite(userId, trackId) {
  const doc = await MusicFavorite.findOne({ user: userId, track: trackId }).lean();
  return !!doc;
}

// ─── History ─────────────────────────────────────────────────

async function getRecentlyPlayed(userId, limit = 20) {
  const docs = await MusicPlayHistory.find({ user: userId })
    .sort({ playedAt: -1 })
    .limit(limit * 2)                        // pull extra to dedupe
    .populate({ path: 'track', match: { isDeleted: false }, select: '-waveformData' })
    .lean();

  // Dedupe by track id — keep most recent play only
  const seen   = new Set();
  const result = [];
  for (const d of docs) {
    if (!d.track) continue;
    const tid = String(d.track._id);
    if (seen.has(tid)) continue;
    seen.add(tid);
    result.push({ ...serializeTrack(d.track), playedAt: d.playedAt });
    if (result.length >= limit) break;
  }
  return result;
}

// ─── Search ──────────────────────────────────────────────────

/**
 * Global music search across tracks, albums, artists, playlists.
 * Uses MongoDB text index — audio files served from Supabase Storage;
 * metadata search works independently.
 */
async function search(query, { limit = 20 } = {}) {
  const q = query.trim();
  if (!q) return { tracks: [], albums: [], artists: [], playlists: [] };

  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const [tracks, albums, artists] = await Promise.all([
    Track.find({
      isDeleted: false, isPublished: true, visibility: 'public',
      $or: [{ title: regex }, { artistName: regex }, { albumTitle: regex }, { genre: regex }],
    }).limit(limit).lean(),
    Album.find({
      isDeleted: false, isPublished: true, visibility: 'public',
      $or: [{ title: regex }, { artistName: regex }],
    }).limit(Math.ceil(limit / 2)).lean(),
    Artist.find({
      isDeleted: false,
      $or: [{ name: regex }, { biography: regex }],
    }).limit(Math.ceil(limit / 2)).lean(),
  ]);

  return {
    tracks:   tracks.map(serializeTrack),
    albums:   albums.map(serializeAlbum),
    artists:  artists.map(serializeArtist),
    playlists:[],   // playlist search requires auth — handled at route level
  };
}

// ─── Track creation ──────────────────────────────────────────

/**
 * Create a new Track record (used by music upload endpoint).
 * Does NOT handle file storage — caller is responsible for getting a fileUrl first.
 */
async function createTrack({ title, artistName, albumTitle, genre, fileUrl, storagePath, mimeType, fileSize, uploader, visibility = 'public', isPublished = true }) {
  const doc = await Track.create({
    title,
    artistName:  artistName  || null,
    albumTitle:  albumTitle  || null,
    genre:       genre       || 'Other',
    fileUrl,
    storagePath: storagePath || null,
    mimeType:    mimeType    || null,
    fileSize:    fileSize    || null,
    uploader,
    visibility,
    isPublished,
    isDeleted: false,
  });
  return serializeTrack(doc);
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
  // Serializers (used by DJ system, cloud stream, etc.)
  serializeTrack,
  serializeAlbum,
  serializeArtist,
  serializePlaylist,

  // Tracks
  listTracks,
  getTrack,
  recordPlay,
  createTrack,

  // Albums
  listAlbums,
  getAlbum,

  // Artists
  listArtists,
  getArtist,

  // Playlists
  listPlaylists,
  getPlaylist,
  createPlaylist,
  renamePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
  deletePlaylist,

  // Favorites
  getFavorites,
  toggleFavorite,
  isFavorite,

  // History
  getRecentlyPlayed,

  // Search
  search,
};
