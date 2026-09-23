/**
 * MusicService — Shared Frontend Music Library Interface
 *
 * Reusable by:
 *   - Avenora Music Hub (this file)
 *   - Avenora DJ System  (deck loading, BPM, cue points)
 *   - Avenora Cloud Stream
 *   - Avenora Live
 *
 * Usage:
 *   const tracks = await MusicService.getTracks();
 *   const playlist = MusicService.getLocalPlaylist(id);
 *   MusicService.onQueueChange(callback);
 *
 * The service exposes a unified queue that combines local imported tracks
 * (held in MP.queue) with backend tracks (when connected).
 * The DJ System reads from MusicService.getQueue() instead of directly
 * accessing MP.queue, ensuring a single source of truth.
 */

(function (global) {
  'use strict';

  // ─── Subscribers ─────────────────────────────────────────
  const _subscribers = { queueChange: [], trackChange: [], playState: [] };

  function emit(event, data) {
    (_subscribers[event] || []).forEach(fn => { try { fn(data); } catch {} });
  }

  // ─── Queue access ─────────────────────────────────────────
  /**
   * Returns the current local import queue (MP.queue).
   * Always sync — no network call.
   */
  function getQueue() {
    return (typeof MP !== 'undefined') ? MP.queue : [];
  }

  /**
   * Returns the currently playing track object, or null.
   */
  function getCurrentTrack() {
    const q = getQueue();
    const i = (typeof MP !== 'undefined') ? MP.currentIndex : -1;
    return (i >= 0 && i < q.length) ? q[i] : null;
  }

  function isPlaying() {
    return (typeof MP !== 'undefined') ? MP.isPlaying : false;
  }

  // ─── Backend queries (async) ───────────────────────────────

  /**
   * Fetch tracks from the backend API.
   * Returns [] when backend is unavailable.
   * @param {object} opts  — passed to LegendAPI.music.tracks
   */
  async function getTracks(opts = {}) {
    try {
      const data = await LegendAPI.music.tracks(opts);
      return data.tracks || [];
    } catch {
      return [];
    }
  }

  async function getAlbums(opts = {}) {
    try {
      const data = await LegendAPI.music.albums(opts);
      return data.albums || [];
    } catch {
      return [];
    }
  }

  async function getArtists(opts = {}) {
    try {
      const data = await LegendAPI.music.artists(opts);
      return data.artists || [];
    } catch {
      return [];
    }
  }

  /**
   * Fetch a compact track list for the DJ System.
   * Returns plain track objects with fileUrl, duration, bpm, waveformData.
   */
  async function getDJLibrary(opts = {}) {
    try {
      const data = await LegendAPI.music.tracks({
        limit: opts.limit || 100,
        genre: opts.genre || undefined,
        sort: 'newest',
      });
      return data.tracks || [];
    } catch {
      return [];
    }
  }

  // ─── Local playlist management ─────────────────────────────

  function getLocalPlaylists() {
    return LS.get('lu_music_playlists', []);
  }

  function getLocalPlaylist(id) {
    return getLocalPlaylists().find(p => p.id === id) || null;
  }

  /**
   * Get tracks for a local playlist, resolved from the current queue.
   */
  function getLocalPlaylistTracks(id) {
    const pl = getLocalPlaylist(id);
    if (!pl) return [];
    const q = getQueue();
    return (pl.tracks || [])
      .map(tid => q.find(t => t.id === tid))
      .filter(Boolean);
  }

  // ─── Favorites ─────────────────────────────────────────────

  function getLocalFavorites() {
    const ids = new Set(LS.get('lu_mp_favorites', []));
    return getQueue().filter(t => ids.has(t.id));
  }

  function isFavorited(trackId) {
    return LS.get('lu_mp_favorites', []).includes(String(trackId));
  }

  // ─── Playback control bridge ───────────────────────────────
  // These delegate to the player engine in music.js when on the Music Hub page.
  // When called from the DJ System (which manages its own audio), they are no-ops
  // unless the caller explicitly provides a handler.

  function play(indexOrTrack) {
    if (typeof indexOrTrack === 'number' && typeof mpLoadTrack === 'function') {
      mpLoadTrack(indexOrTrack);
    } else if (typeof indexOrTrack === 'object' && indexOrTrack.url && typeof mpLoadBackendTrack === 'function') {
      mpLoadBackendTrack(indexOrTrack, 0, 'external');
    }
  }

  function pause() {
    const audio = document.getElementById('mp-audio');
    if (audio) audio.pause();
  }

  function resume() {
    const audio = document.getElementById('mp-audio');
    if (audio) audio.play().catch(() => {});
  }

  // ─── Event subscriptions ───────────────────────────────────

  function onQueueChange(fn)  { _subscribers.queueChange.push(fn); }
  function onTrackChange(fn)  { _subscribers.trackChange.push(fn); }
  function onPlayState(fn)    { _subscribers.playState.push(fn); }
  function off(event, fn) {
    if (_subscribers[event]) {
      _subscribers[event] = _subscribers[event].filter(f => f !== fn);
    }
  }

  // ─── Internal hooks (called by music.js player engine) ─────
  // music.js calls these to keep MusicService in sync.

  function _notifyTrackChange(track) { emit('trackChange', track); }
  function _notifyQueueChange(queue) { emit('queueChange', queue); }
  function _notifyPlayState(playing)  { emit('playState', { playing }); }

  // ─── resolveAudioUrl ──────────────────────────────────────────
  /**
   * Resolve the best playable URL from a track object.
   *
   * Checks in order:
   *   1. track.audioUrl
   *   2. track.fileUrl
   *   3. track.url
   *   4. track.publicUrl
   *   5. track.downloadURL
   *   6. Derive from track.storagePath via AvenoraStorage.getPublicUrl()
   *
   * Logs full diagnostics for every resolved (or failed) URL.
   * Returns the first truthy URL found, or null if nothing works.
   */
  // ─── Supabase public URL constants (mirrors supabase.js) ────────────────
  const _SUPABASE_URL   = 'https://licuiqxkkfboqezzmsqu.supabase.co';
  const _STORAGE_BASE   = `${_SUPABASE_URL}/storage/v1`;

  /**
   * Generate the Supabase public URL for a given bucket + path.
   * Each path segment is percent-encoded to handle spaces and special chars.
   * Does NOT double-encode a path that already contains %XX sequences.
   */
  function _supabasePublicUrl(bucket, path) {
    // Decode first (handles already-encoded paths) then re-encode uniformly
    let decoded;
    try { decoded = decodeURIComponent(path); } catch (_) { decoded = path; }
    const encoded = decoded.split('/').map(encodeURIComponent).join('/');
    return `${_STORAGE_BASE}/object/public/${bucket}/${encoded}`;
  }

  /**
   * Resolve the best playable URL from a track object.
   *
   * Priority:
   *   1. track.audioUrl
   *   2. track.fileUrl
   *   3. track.url
   *   4. track.publicUrl
   *   5. track.downloadURL
   *   6. storagePath → Supabase public music-bucket URL
   *      (tries AvenoraStorage.getPublicUrl first, then falls back to inline derivation)
   */
  function resolveAudioUrl(track) {
    if (!track) return null;

    const candidates = [
      { field: 'audioUrl',    val: track.audioUrl    },
      { field: 'fileUrl',     val: track.fileUrl     },
      { field: 'url',         val: track.url         },
      { field: 'publicUrl',   val: track.publicUrl   },
      { field: 'downloadURL', val: track.downloadURL },
    ];

    for (const { field, val } of candidates) {
      if (val && typeof val === 'string' && val.trim()) {
        console.log(
          '[AVN MUSIC URL] resolveAudioUrl',
          'id:', track.id || '(none)',
          'title:', track.title || track.name || '(none)',
          'resolvedUrl:', val,
          'storagePath:', track.storagePath || null,
          'usedField:', field,
        );
        return val.trim();
      }
    }

    // Derive from storagePath
    if (track.storagePath) {
      // 6a: Try AvenoraStorage (supabase.js) first
      if (window.AvenoraStorage && typeof window.AvenoraStorage.getPublicUrl === 'function') {
        try {
          const derived = window.AvenoraStorage.getPublicUrl('music', track.storagePath);
          if (derived) {
            console.log(
              '[AVN MUSIC URL] resolveAudioUrl — from storagePath via AvenoraStorage',
              'id:', track.id || '(none)',
              'storagePath:', track.storagePath,
              'resolvedUrl:', derived,
            );
            return derived;
          }
        } catch (e) {
          console.warn('[AVN MUSIC URL] AvenoraStorage.getPublicUrl failed:', e.message);
        }
      }
      // 6b: Inline derivation — works without AvenoraStorage (cross-user, other devices)
      const derived = _supabasePublicUrl('music', track.storagePath);
      console.log(
        '[AVN MUSIC URL] resolveAudioUrl — from storagePath (inline derivation)',
        'id:', track.id || '(none)',
        'storagePath:', track.storagePath,
        'resolvedUrl:', derived,
      );
      return derived;
    }

    console.warn(
      '[AVN MUSIC URL] resolveAudioUrl — NO URL FOUND',
      'id:', track.id || '(none)',
      'title:', track.title || track.name || '(none)',
      'storagePath:', track.storagePath || null,
      'keys:', Object.keys(track).join(', '),
    );
    return null;
  }

  // ─── 24-Hour Radio / Cloud Stream interface ─────────────────
  /**
   * Returns the next track for cloud stream auto-progression.
   * In shuffle mode returns a random track; otherwise sequential.
   * Returns null when queue is empty.
   */
  function getNextStreamTrack(currentId, shuffle = false) {
    const q = getQueue();
    if (!q.length) return null;
    if (shuffle) return q[Math.floor(Math.random() * q.length)];
    const idx = q.findIndex(t => t.id === currentId);
    return q[(idx + 1) % q.length] || null;
  }

  // ─── Export ───────────────────────────────────────────────
  global.MusicService = {
    // Queue
    getQueue,
    getCurrentTrack,
    isPlaying,

    // Backend queries
    getTracks,
    getAlbums,
    getArtists,
    getDJLibrary,

    // Local playlists
    getLocalPlaylists,
    getLocalPlaylist,
    getLocalPlaylistTracks,

    // Favorites
    getLocalFavorites,
    isFavorited,

    // Playback control
    play,
    pause,
    resume,

    // Events
    onQueueChange,
    onTrackChange,
    onPlayState,
    off,

    // Stream
    getNextStreamTrack,

    // URL resolution
    resolveAudioUrl,

    // Internal (for music.js only)
    _notifyTrackChange,
    _notifyQueueChange,
    _notifyPlayState,
  };

})(window);
