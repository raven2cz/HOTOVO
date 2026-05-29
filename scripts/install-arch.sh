#!/bin/bash

# HOTOVO Installer for Arch Linux
# This script ensures nodejs/npm are installed and builds the application.

set -e

# Visual styles
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== HOTOVO - Arch Linux Installer ===${NC}\n"

# 1. Verify we are on Arch Linux
if [ ! -f /etc/arch-release ] && ! command -v pacman &> /dev/null; then
    echo -e "${RED}Chyba: Tento skript je určen pouze pro Arch Linux (nebylo nalezeno 'pacman').${NC}"
    exit 1
fi

# 2. Check and Install Node.js & npm if needed
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo -e "${YELLOW}Node.js nebo npm není nainstalováno. Budeme vyžadovat sudo oprávnění k instalaci přes pacman...${NC}"
    # Full sync+upgrade avoids an Arch partial-upgrade state (-Sy alone is unsafe).
    sudo pacman -Syu --needed nodejs npm sqlite3 --noconfirm
else
    echo -e "${GREEN}✔ Node.js (${NC}$(node -v)${GREEN}) a npm (${NC}$(npm -v)${GREEN}) jsou již nainstalovány.${NC}"
fi

# 3. Navigate to root directory (the parent of scripts directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

echo -e "\n${BLUE}Instaluji závislosti projektu...${NC}"
npm run install:all

echo -e "\n${BLUE}Sestavuji produkční frontend balíček...${NC}"
npm run build:frontend

echo -e "\n${GREEN}✔ Sestavení dokončeno úspěšně!${NC}"
echo -e "\nAplikaci můžete spustit následujícími způsoby:"
echo -e "  1. Vývojářský režim:  ${YELLOW}npm run dev${NC}  (paralelně API server + Vite hot reload)"
echo -e "  2. Produkční režim:   ${YELLOW}npm start${NC}    (sjednocený běh na portu 3000)"
echo -e "  3. Pomocí start skriptu: ${YELLOW}./scripts/start-app.sh${NC}"
echo -e "  4. Jako systemd službu: Návod je v souboru ${BLUE}scripts/hotovo.service${NC}"
echo ""
