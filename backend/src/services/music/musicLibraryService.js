/**
 * MusicLibraryService — Avenora Music Hub (Firestore edition)
 *
 * Collections used:
 *   tracks/{trackId}
 *   albums/{albumId}
 *   artists/{artistId}
 *   playlists/{playlistId}
 *   musicFavorites/{userId_trackId}   — deterministic id for O(1) lookups
 *   musicPlayHistory/{autoId}
 *
 * Audio files are stored in Supabase Storage (music bucket).
 */

'use strict';

const { getDb, newId, now, FieldValue } = require('../../config/firestore');

// ─── Serialisers ────────────────────────────────────────────

function serializeTrack(doc) {
  if (!doc) return null;
  return {
    id:           doc.id,
    title:        doc.title,
    artist:       doc.artist       || null,
    artistName:   doc.artistName   || null,
    album:        doc.album        || null,
    albumTitle:   doc.albumTitle   || null,
    coverUrl:     doc.coverUrl     || null,
    fileUrl:      doc.fileUrl      || null,
    storagePath:  doc.storagePath  || null,
    duration:     doc.duration     || null,
    waveformData: doc.waveformData || [],
    genre:        doc.genre        || null,
    releaseDate:  doc.releaseDate  || null,
    trackNumber:  doc.trackNumber  || null,
    bpm:          doc.bpm          || null,
    key:          doc.key          || null,
    tags:         doc.tags         || [],
    plays:        doc.plays        || 0,
    likeCount:    doc.likeCount    || 0,
    visibility:   doc.visibility,
    isPublished:  doc.isPublished,
    createdAt:    doc.createdAt,
    uploader:     doc.uploader     || null,
  };
}

function serializeAlbum(doc) {
  if (!doc) return null;
  return {
    id:          doc.id,
    title:       doc.title,
    artist:      doc.artist        || null,
    artistName:  doc.artistName    || null,
    coverUrl:    doc.coverUrl      || null,
    releaseDate: doc.releaseDate   || null,
    genre:       doc.genre         || null,
    description: doc.description   || null,
    totalTracks: doc.totalTracks   || 0,
    visibility:  doc.visibility,
    isPublished: doc.isPublished,
    createdAt:   doc.createdAt,
    uploader:    doc.uploader      || null,
  };
}

function serializeArtist(doc) {
  if (!doc) return null;
  return {
    id:              doc.id,
    name:            doc.name,
    slug:            doc.slug            || null,
    biography:       doc.biography       || null,
    avatarUrl:       doc.avatarUrl       || null,
    bannerUrl:       doc.bannerUrl       || null,
    genres:          doc.genres          || [],
    isVerified:      doc.isVerified      || false,
    spotifyUrl:      doc.spotifyUrl      || null,
    appleMusicUrl:   doc.appleMusicUrl   || null,
    youtubeMusicUrl: doc.youtubeMusicUrl || null,
    amazonMusicUrl:  doc.amazonMusicUrl  || null,
    createdAt:       doc.createdAt,
  };
}

function serializePlaylist(doc, includeTracks = false) {
  if (!doc) return null;
  const base = {
    id:          doc.id,
    name:        doc.name,
    description: doc.description || null,
    owner:       doc.owner,
    coverUrl:    doc.coverUrl    || null,
    visibility:  doc.visibility,
    trackCount:  (doc.tracks || []).length,
    createdAt:   doc.createdAt,
    updatedAt:   doc.updatedAt,
  };
  if (includeTracks) {
    base.tracks = doc.tracks || [];
  }
  return base;
}

// ─── Firestore helpers ──────────────────────────────────────

function _snapshotToArray(snap) {
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Track queries ──────────────────────────────────────────

async function listTracks({ page = 1, limit = 20, genre, artist, album, sort = 'newest' } = {}) {
  const db = getDb();
  let q = db.collection('tracks')
    .where('isDeleted', '==', false)
    .where('isPublished', '==', true)
    .where('visibility', '==', 'public');

  if (genre)  q = q.where('genre',  '==', genre);
  if (artist) q = q.where('artist', '==', artist);
  if (album)  q = q.where('album',  '==', album);

  const sortField = sort === 'popular' ? 'plays' : sort === 'alpha' ? 'title' : 'createdAt';
  const sortDir   = sort === 'alpha' ? 'asc' : 'desc';
  q = q.orderBy(sortField, sortDir);

  const totalSnap = await q.get();
  const total     = totalSnap.size;

  const skip = (page - 1) * limit;
  // Firestore offset is acceptable for moderate datasets
  const snap = await q.offset(skip).limit(limit).get();
  const tracks = _snapshotToArray(snap).map(serializeTrack);

  return { tracks, total, page, limit };
}

async function getTrack(id) {
  const db  = getDb();
  const doc = await db.collection('tracks').doc(id).get();
  if (!doc.exists) return null;
  const data = { id: doc.id, ...doc.data() };
  if (data.isDeleted) return null;
  return serializeTrack(data);
}

async function recordPlay(trackId, userId) {
  try {
    const db = getDb();
    await db.collection('tracks').doc(trackId).update({ plays: FieldValue.increment(1) });
    if (userId) {
      await db.collection('musicPlayHistory').add({
        user:     userId,
        track:    trackId,
        playedAt: now(),
      });
    }
  } catch { /* non-critical */ }
}

// ─── Album queries ──────────────────────────────────────────

async function listAlbums({ page = 1, limit = 20, genre, artist } = {}) {
  const db = getDb();
  let q = db.collection('albums')
    .where('isDeleted', '==', false)
    .where('isPublished', '==', true)
    .where('visibility', '==', 'public')
    .orderBy('createdAt', 'desc');

  if (genre)  q = q.where('genre',  '==', genre);
  if (artist) q = q.where('artist', '==', artist);

  const totalSnap = await q.get();
  const total     = totalSnap.size;
  const skip      = (page - 1) * limit;
  const snap      = await q.offset(skip).limit(limit).get();
  const albums    = _snapshotToArray(snap).map(serializeAlbum);
  return { albums, total, page, limit };
}

async function getAlbum(id) {
  const db      = getDb();
  const doc     = await db.collection('albums').doc(id).get();
  if (!doc.exists) return null;
  const album   = { id: doc.id, ...doc.data() };
  if (album.isDeleted) return null;

  const tracksSnap = await db.collection('tracks')
    .where('album', '==', id)
    .where('isDeleted', '==', false)
    .where('isPublished', '==', true)
    .orderBy('trackNumber', 'asc')
    .get();
  const tracks = _snapshotToArray(tracksSnap).map(serializeTrack);
  return { ...serializeAlbum(album), tracks };
}

// ─── Artist queries ──────────────────────────────────────────

async function listArtists({ page = 1, limit = 20 } = {}) {
  const db    = getDb();
  const q     = db.collection('artists').where('isDeleted', '==', false).orderBy('name', 'asc');
  const total = (await q.get()).size;
  const snap  = await q.offset((page - 1) * limit).limit(limit).get();
  return { artists: _snapshotToArray(snap).map(serializeArtist), total, page, limit };
}

async function getArtist(id) {
  const db  = getDb();
  const doc = await db.collection('artists').doc(id).get();
  if (!doc.exists) return null;
  const artist = { id: doc.id, ...doc.data() };
  if (artist.isDeleted) return null;

  const [albumsSnap, topTracksSnap] = await Promise.all([
    db.collection('albums')
      .where('artist', '==', id)
      .where('isDeleted', '==', false)
      .where('isPublished', '==', true)
      .orderBy('releaseDate', 'desc')
      .get(),
    db.collection('tracks')
      .where('artist', '==', id)
      .where('isDeleted', '==', false)
      .where('isPublished', '==', true)
      .orderBy('plays', 'desc')
      .limit(10)
      .get(),
  ]);

  return {
    ...serializeArtist(artist),
    albums:    _snapshotToArray(albumsSnap).map(serializeAlbum),
    topTracks: _snapshotToArray(topTracksSnap).map(serializeTrack),
  };
}

// ─── Playlist operations ─────────────────────────────────────

async function listPlaylists(userId) {
  const db   = getDb();
  const snap = await db.collection('playlists')
    .where('owner', '==', userId)
    .where('isDeleted', '==', false)
    .orderBy('updatedAt', 'desc')
    .get();
  return _snapshotToArray(snap).map(p => serializePlaylist(p, false));
}

async function getPlaylist(id, userId) {
  const db  = getDb();
  const doc = await db.collection('playlists').doc(id).get();
  if (!doc.exists) return null;
  const playlist = { id: doc.id, ...doc.data() };
  if (playlist.isDeleted) return null;
  if (playlist.visibility === 'private' && playlist.owner !== userId) return null;

  // Hydrate tracks — fetch each by ID
  const trackIds = playlist.tracks || [];
  let hydratedTracks = [];
  if (trackIds.length > 0) {
    // Firestore 'in' queries support up to 30 items; batch if needed
    const chunks = [];
    for (let i = 0; i < trackIds.length; i += 30) chunks.push(trackIds.slice(i, i + 30));
    const fetched = [];
    for (const chunk of chunks) {
      const snap = await db.collection('tracks')
        .where('__name__', 'in', chunk)
        .where('isDeleted', '==', false)
        .get();
      fetched.push(..._snapshotToArray(snap));
    }
    // Preserve playlist order
    const byId = Object.fromEntries(fetched.map(t => [t.id, t]));
    hydratedTracks = trackIds.map(tid => byId[tid]).filter(Boolean).map(serializeTrack);
  }

  return { ...serializePlaylist(playlist, false), trackCount: hydratedTracks.length, tracks: hydratedTracks };
}

async function createPlaylist(userId, { name, description = '', visibility = 'private' } = {}) {
  const db  = getDb();
  const id  = newId();
  const ts  = now();
  const data = { name, description, visibility, owner: userId, tracks: [], isDeleted: false, createdAt: ts, updatedAt: ts };
  await db.collection('playlists').doc(id).set(data);
  return serializePlaylist({ id, ...data, tracks: [] });
}

async function renamePlaylist(id, userId, name) {
  const db  = getDb();
  const doc = await db.collection('playlists').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data();
  if (data.owner !== userId || data.isDeleted) return null;
  await db.collection('playlists').doc(id).update({ name, updatedAt: now() });
  return serializePlaylist({ id, ...data, name });
}

async function addTrackToPlaylist(playlistId, userId, trackId) {
  const db  = getDb();
  const doc = await db.collection('playlists').doc(playlistId).get();
  if (!doc.exists) return null;
  const data = doc.data();
  if (data.owner !== userId || data.isDeleted) return null;
  const tracks = data.tracks || [];
  if (!tracks.includes(trackId)) {
    tracks.push(trackId);
    await db.collection('playlists').doc(playlistId).update({ tracks, updatedAt: now() });
  }
  return serializePlaylist({ id: playlistId, ...data, tracks });
}

async function removeTrackFromPlaylist(playlistId, userId, trackId) {
  const db  = getDb();
  const doc = await db.collection('playlists').doc(playlistId).get();
  if (!doc.exists) return null;
  const data = doc.data();
  if (data.owner !== userId || data.isDeleted) return null;
  const tracks = (data.tracks || []).filter(t => t !== trackId);
  await db.collection('playlists').doc(playlistId).update({ tracks, updatedAt: now() });
  return serializePlaylist({ id: playlistId, ...data, tracks });
}

async function reorderPlaylistTracks(playlistId, userId, orderedTrackIds) {
  const db  = getDb();
  const doc = await db.collection('playlists').doc(playlistId).get();
  if (!doc.exists) return null;
  const data = doc.data();
  if (data.owner !== userId || data.isDeleted) return null;
  const existing = new Set(data.tracks || []);
  const cleaned  = orderedTrackIds.filter(id => existing.has(id));
  await db.collection('playlists').doc(playlistId).update({ tracks: cleaned, updatedAt: now() });
  return serializePlaylist({ id: playlistId, ...data, tracks: cleaned });
}

async function deletePlaylist(id, userId) {
  const db  = getDb();
  const doc = await db.collection('playlists').doc(id).get();
  if (!doc.exists) return;
  if (doc.data().owner !== userId) return;
  await db.collection('playlists').doc(id).update({ isDeleted: true, updatedAt: now() });
}

// ─── Favorites ───────────────────────────────────────────────

async function getFavorites(userId, { page = 1, limit = 50 } = {}) {
  const db   = getDb();
  const snap = await db.collection('musicFavorites')
    .where('user', '==', userId)
    .orderBy('createdAt', 'desc')
    .get();
  const docs  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const total = docs.length;
  const page_docs = docs.slice((page - 1) * limit, page * limit);

  // Hydrate tracks
  const trackIds = page_docs.map(d => d.track).filter(Boolean);
  let tracks = [];
  if (trackIds.length > 0) {
    const chunks = [];
    for (let i = 0; i < trackIds.length; i += 30) chunks.push(trackIds.slice(i, i + 30));
    const fetched = [];
    for (const chunk of chunks) {
      const s = await db.collection('tracks').where('__name__', 'in', chunk).where('isDeleted', '==', false).get();
      fetched.push(...s.docs.map(d => ({ id: d.id, ...d.data() })));
    }
    const byId = Object.fromEntries(fetched.map(t => [t.id, t]));
    tracks = trackIds.map(tid => byId[tid]).filter(Boolean).map(serializeTrack);
  }
  return { tracks, total, page, limit };
}

async function toggleFavorite(userId, trackId) {
  const db    = getDb();
  const favId = `${userId}_${trackId}`;
  const ref   = db.collection('musicFavorites').doc(favId);
  const snap  = await ref.get();
  if (snap.exists) {
    await ref.delete();
    await db.collection('tracks').doc(trackId).update({ likeCount: FieldValue.increment(-1) }).catch(() => {});
    return { liked: false };
  }
  await ref.set({ user: userId, track: trackId, createdAt: now() });
  await db.collection('tracks').doc(trackId).update({ likeCount: FieldValue.increment(1) }).catch(() => {});
  return { liked: true };
}

async function isFavorite(userId, trackId) {
  const db   = getDb();
  const snap = await db.collection('musicFavorites').doc(`${userId}_${trackId}`).get();
  return snap.exists;
}

// ─── History ─────────────────────────────────────────────────

async function getRecentlyPlayed(userId, limit = 20) {
  const db   = getDb();
  const snap = await db.collection('musicPlayHistory')
    .where('user', '==', userId)
    .orderBy('playedAt', 'desc')
    .limit(limit * 3)
    .get();

  const rows   = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const trackIds = [...new Set(rows.map(r => r.track).filter(Boolean))].slice(0, limit * 2);

  if (!trackIds.length) return [];

  const chunks  = [];
  for (let i = 0; i < trackIds.length; i += 30) chunks.push(trackIds.slice(i, i + 30));
  const fetched = [];
  for (const chunk of chunks) {
    const s = await db.collection('tracks').where('__name__', 'in', chunk).where('isDeleted', '==', false).get();
    fetched.push(...s.docs.map(d => ({ id: d.id, ...d.data() })));
  }
  const byId = Object.fromEntries(fetched.map(t => [t.id, t]));

  const seen   = new Set();
  const result = [];
  for (const row of rows) {
    const t = byId[row.track];
    if (!t || seen.has(row.track)) continue;
    seen.add(row.track);
    result.push({ ...serializeTrack(t), playedAt: row.playedAt });
    if (result.length >= limit) break;
  }
  return result;
}

// ─── Search ──────────────────────────────────────────────────

async function search(query, { limit = 20 } = {}) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return { tracks: [], albums: [], artists: [], playlists: [] };

  const db = getDb();

  // Firestore doesn't support full-text — fetch recent public items and filter client-side
  const [tracksSnap, albumsSnap, artistsSnap] = await Promise.all([
    db.collection('tracks').where('isDeleted', '==', false).where('isPublished', '==', true).where('visibility', '==', 'public').orderBy('createdAt', 'desc').limit(200).get(),
    db.collection('albums').where('isDeleted', '==', false).where('isPublished', '==', true).where('visibility', '==', 'public').orderBy('createdAt', 'desc').limit(100).get(),
    db.collection('artists').where('isDeleted', '==', false).orderBy('name', 'asc').limit(100).get(),
  ]);

  const matchTrack = t =>
    (t.title        || '').toLowerCase().includes(q) ||
    (t.artistName   || '').toLowerCase().includes(q) ||
    (t.albumTitle   || '').toLowerCase().includes(q) ||
    (t.genre        || '').toLowerCase().includes(q);

  const matchAlbum = a =>
    (a.title        || '').toLowerCase().includes(q) ||
    (a.artistName   || '').toLowerCase().includes(q);

  const matchArtist = a =>
    (a.name         || '').toLowerCase().includes(q) ||
    (a.biography    || '').toLowerCase().includes(q);

  return {
    tracks:    _snapshotToArray(tracksSnap).filter(matchTrack).slice(0, limit).map(serializeTrack),
    albums:    _snapshotToArray(albumsSnap).filter(matchAlbum).slice(0, Math.ceil(limit / 2)).map(serializeAlbum),
    artists:   _snapshotToArray(artistsSnap).filter(matchArtist).slice(0, Math.ceil(limit / 2)).map(serializeArtist),
    playlists: [],
  };
}

// ─── Track creation ──────────────────────────────────────────

async function createTrack({ title, artistName, albumTitle, genre, fileUrl, storagePath, mimeType, fileSize, uploader, visibility = 'public', isPublished = true }) {
  const db  = getDb();
  const id  = newId();
  const ts  = now();
  const data = {
    title,
    artistName:  artistName  || null,
    albumTitle:  albumTitle  || null,
    genre:       genre       || 'Other',
    fileUrl:     fileUrl     || null,
    storagePath: storagePath || null,
    mimeType:    mimeType    || null,
    fileSize:    fileSize    || null,
    uploader:    uploader    || null,
    visibility,
    isPublished,
    isDeleted:   false,
    plays:       0,
    likeCount:   0,
    waveformData: [],
    tags:        [],
    createdAt:   ts,
    updatedAt:   ts,
  };
  await db.collection('tracks').doc(id).set(data);
  return serializeTrack({ id, ...data });
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
  serializeTrack,
  serializeAlbum,
  serializeArtist,
  serializePlaylist,

  listTracks,
  getTrack,
  recordPlay,
  createTrack,

  listAlbums,
  getAlbum,

  listArtists,
  getArtist,

  listPlaylists,
  getPlaylist,
  createPlaylist,
  renamePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
  deletePlaylist,

  getFavorites,
  toggleFavorite,
  isFavorite,

  getRecentlyPlayed,

  search,
};
