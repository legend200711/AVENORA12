#!/usr/bin/env bash
# ============================================================
# AVENORA — Add Supabase and Firebase variables to backend/.env
#
# Run this script ONCE from the project root:
#   bash scripts/add-supabase-env.sh
#
# It appends the required variables to backend/.env if they are
# not already present. You must then fill in the real values.
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$(dirname "$SCRIPT_DIR")/backend/.env"

RESET="\033[0m"
GREEN="\033[32m"
YELLOW="\033[33m"
BLUE="\033[34m"

info()    { echo -e "${BLUE}[AVN]${RESET} $*"; }
success() { echo -e "${GREEN}[OK]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[!]${RESET} $*"; }

if [ ! -f "$ENV_FILE" ]; then
  info "Creating backend/.env from .env.example..."
  cp "$(dirname "$ENV_FILE")/.env.example" "$ENV_FILE"
fi

# ── Add Supabase variables if missing ────────────────────────
add_if_missing() {
  local key="$1"
  local placeholder="$2"
  local comment="$3"
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    echo "" >> "$ENV_FILE"
    [ -n "$comment" ] && echo "# $comment" >> "$ENV_FILE"
    echo "${key}=${placeholder}" >> "$ENV_FILE"
    warn "Added ${key} placeholder — fill in the real value"
  else
    success "${key} already present"
  fi
}

echo ""
info "Checking backend/.env for required variables..."
echo ""

add_if_missing "SUPABASE_URL"              "https://YOUR_PROJECT_ID.supabase.co"      "Supabase project URL (Settings → API → Project URL)"
add_if_missing "SUPABASE_SERVICE_ROLE_KEY" "YOUR_SERVICE_ROLE_KEY"                     "Service-role key — NEVER expose in frontend (Settings → API → service_role)"
add_if_missing "SUPABASE_ANON_KEY"         "YOUR_ANON_KEY"                             "Anon/public key — safe for frontend (Settings → API → anon public)"
add_if_missing "FIREBASE_PROJECT_ID"       "avenora-6e147"                             "Firebase project ID"
add_if_missing "FIREBASE_WEB_API_KEY"      "AIzaSyDnEEYamIVYfn7l6sPPS1Dp2fWJE34OXlI" "Firebase Web API key (for token verification)"
add_if_missing "FOUNDER_EMAIL"             "christijerina46@gmail.com"                 "Email of the platform founder"
add_if_missing "FRONTEND_URL"              "https://legend200711.github.io"            "Primary frontend origin for CORS"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}  Next steps:${RESET}"
echo -e ""
echo -e "  1. Open ${YELLOW}backend/.env${RESET}"
echo -e "  2. Replace the placeholder values for:"
echo -e "       SUPABASE_URL"
echo -e "       SUPABASE_SERVICE_ROLE_KEY"
echo -e "       SUPABASE_ANON_KEY"
echo -e ""
echo -e "  Get these from: ${BLUE}https://supabase.com/dashboard${RESET}"
echo -e "  → Your Project → Settings → API"
echo -e ""
echo -e "  3. Restart the backend: ${YELLOW}cd backend && npm run dev${RESET}"
echo -e "  4. Check the console — you should see:"
echo -e "       ✅ Supabase Storage buckets verified"
echo -e ""
echo -e "  See ${YELLOW}SUPABASE_SETUP.md${RESET} for full instructions."
echo -e "${GREEN}═══════════════════════════════════════════════════${RESET}"
echo ""
