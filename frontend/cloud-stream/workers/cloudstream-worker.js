/**
 * AVENORA — CloudStream Worker (REMOVED)
 *
 * This Cloudflare Worker has been removed as part of the Supabase Storage migration.
 * The worker previously used:
 *   - Cloudflare KV (cloudStreamKV)     → replaced by Firestore + Supabase Storage
 *   - Cloudflare Durable Objects        → removed entirely
 *   - Cloudflare Workers runtime        → removed entirely
 *
 * All stream control, media management, and state is now handled by:
 *   - Backend API: /api/admin/cloud-stream/*  (Express + MongoDB)
 *   - Media storage: Supabase Storage (stream-media bucket)
 *   - Now-Playing sync: Firestore cloudStreams/{streamId} (unchanged)
 *
 * The wrangler-studio.jsonc file in this directory is no longer used.
 * Do not deploy this file to Cloudflare Workers.
 *
 * See SUPABASE_SETUP.md at the project root for migration instructions.
 */

// This file intentionally left as a comment-only placeholder.
// Nothing in the AVENORA frontend or backend imports from this file.
