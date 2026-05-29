#!/bin/bash

# HOTOVO Launcher
# Builds the frontend (if needed) and starts the unified server in PRODUCTION
# mode on a single port. For a hot-reloading dev environment use `npm run dev`.

set -e

BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

# Ensure dependencies are present.
if [ ! -d "node_modules" ] || [ ! -d "server/node_modules" ] || [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}Závislosti nebyly nalezeny. Spouštím instalaci...${NC}"
    ./scripts/install-arch.sh
fi

# Build the frontend bundle if it is missing (production serves static files).
if [ ! -f "frontend/dist/index.html" ]; then
    echo -e "${BLUE}Sestavuji produkční frontend...${NC}"
    npm run build:frontend
fi

echo -e "${BLUE}Spouštím HOTOVO v produkčním režimu...${NC}"
NODE_ENV=production npm start
