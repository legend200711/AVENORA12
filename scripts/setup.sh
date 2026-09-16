#!/usr/bin/env bash
# ============================================================
# LEGEND UNIVERSE — Setup Script
# Installs dependencies, creates .env from example, and
# gives you the commands to run the project locally.
# ============================================================

set -e

RESET="\033[0m"
BOLD="\033[1m"
BLUE="\033[34m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"

info()    { echo -e "${BLUE}[LU]${RESET} $*"; }
success() { echo -e "${GREEN}[OK]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[!]${RESET} $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*"; exit 1; }

# ── Check prerequisites ─────────────────────────────────────
command -v node >/dev/null 2>&1 || error "Node.js is required (v18+). Install from https://nodejs.org"
command -v npm  >/dev/null 2>&1 || error "npm is required. Install from https://nodejs.org"

NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  error "Node.js 18+ required. Current: $(node --version)"
fi

success "Node.js $(node --version) detected"

# ── Determine script directory ───────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

# ── Install backend dependencies ─────────────────────────────
info "Installing backend dependencies..."
cd "$BACKEND_DIR"
npm install --silent
success "Backend dependencies installed"

# ── Create .env from .env.example if missing ─────────────────
if [ ! -f "$BACKEND_DIR/.env" ]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  warn ".env created from .env.example"
  warn "IMPORTANT: Edit backend/.env and fill in your real values:"
  warn "  - SUPABASE_URL              (required for uploads)"
  warn "  - SUPABASE_SERVICE_ROLE_KEY (required for uploads)"
  warn "  - SUPABASE_ANON_KEY         (required for uploads)"
  warn "  - MONGODB_URI               (optional — omit to run without database)"
  warn "  - FIREBASE_PROJECT_ID       (avenora-6e147)"
  warn "  - FIREBASE_WEB_API_KEY      (for Firebase auth token verification)"
  warn "  - JWT_SECRET                (long random string)"
  warn "  - JWT_REFRESH_SECRET        (different long random string)"
  warn "  - FOUNDER_EMAIL             (your account email)"
  echo ""
  echo ""
  warn "  See SUPABASE_SETUP.md for step-by-step Supabase bucket setup."
  echo ""
else
  success ".env already exists — checking for required Supabase variables..."
  # Check if Supabase is configured (not the placeholder values)
  if grep -q 'SUPABASE_URL=https://your-project' "$BACKEND_DIR/.env" || \
     grep -q 'SUPABASE_URL=$' "$BACKEND_DIR/.env" || \
     ! grep -q 'SUPABASE_URL=' "$BACKEND_DIR/.env"; then
    echo ""
    warn "⚠️  Supabase is NOT configured in backend/.env"
    warn "   All file uploads (Feed images, Video, Music, Gallery) will return HTTP 503."
    warn "   To fix:"
    warn "     1. Go to https://supabase.com/dashboard and create a project"
    warn "     2. Go to Project Settings → API"
    warn "     3. Copy Project URL → SUPABASE_URL"
    warn "     4. Copy service_role key → SUPABASE_SERVICE_ROLE_KEY"
    warn "     5. Copy anon key → SUPABASE_ANON_KEY"
    warn "     6. Add these to backend/.env"
    warn "     7. See SUPABASE_SETUP.md for full instructions"
    echo ""
  else
    success "Supabase is configured in backend/.env"
  fi
fi

# ── Create upload directories ────────────────────────────────
mkdir -p "$BACKEND_DIR/uploads/gallery"
mkdir -p "$BACKEND_DIR/uploads/music"
mkdir -p "$BACKEND_DIR/uploads/videos"
mkdir -p "$BACKEND_DIR/uploads/avatars"
mkdir -p "$BACKEND_DIR/uploads/images"
success "Upload directories created"

# ── Done ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║       AVENORA — Setup Complete! 🌅       ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Start the backend:${RESET}"
echo -e "    cd backend && npm run dev"
echo ""
echo -e "  ${BOLD}Serve the frontend (any static server):${RESET}"
echo -e "    cd frontend && npx serve ."
echo -e "    # OR open frontend/index.html directly in your browser"
echo ""
echo -e "  ${BOLD}Backend API:${RESET}  http://localhost:3001"
echo -e "  ${BOLD}Health check:${RESET} http://localhost:3001/api/health"
echo ""
echo -e "  ${YELLOW}⚠  For uploads to work, you MUST set these in backend/.env:${RESET}"
echo -e "     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY"
echo -e "     See SUPABASE_SETUP.md for full instructions."
echo ""
