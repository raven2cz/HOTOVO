#!/bin/bash

# Aether Todo Launcher Script
# Starts the server in production mode.

set -e

# Visual styles
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

# Check if node_modules exists
if [ ! -d "node_modules" ] || [ ! -d "server/node_modules" ] || [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}Závislosti nebyly nalezeny. Spouštím instalaci...${NC}"
    ./scripts/install-arch.sh
fi

# Start in development mode
echo -e "${BLUE}Spouštím Aether Todo ve vývojářském režimu (dev)...${NC}"
npm run dev
