# HOTOVO ✓

> Sebehostovaná správa úkolů pro jednoho člověka a jeho agenty.
> Název říká vše: *HOTOVO* je to slovo, co řekneš, když je úkol odškrtnutý.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-18%2B-339933.svg)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57.svg)](https://www.sqlite.org/)
[![MCP](https://img.shields.io/badge/AI%20agents-REST%20%2B%20MCP-7c6cf6.svg)](docs/MCP.md)

<p align="center"><img src="docs/patmat.gif" width="320" alt="A je to!" /></p>
<p align="center"><em>A je to!</em></p>

![HOTOVO - seznam úkolů](docs/screenshots/list.png)

## Co to je

Osobní to-do aplikace, kterou si hostuješ sám, typicky na Raspberry Pi 4. Jeden
Node proces, SQLite, React frontend. Kromě webového UI má **REST API a MCP server
pro AI agenty** (custom GPTs, Gemini/Gemma) a obousměrnou synchronizaci s **Google
Kalendářem**.

Není to týmový nástroj ani SaaS: počítá s **jedním uživatelem**, váže se na
`127.0.0.1` a citlivá data drží lokálně.

## Vlastnosti

- **Hierarchické úkoly** s rollupem stavu: dokončením všech podúkolů se dokončí rodič a naopak.
- **Opakování** (denně / týdně / měsíčně) stylem roll-forward: dokončený úkol se posune na další termín, nevytváří duplikát.
- **Štítky a hledání**: tagy napříč projekty, fulltext a filtry `Dnes` / `Tento týden` / `Po termínu`.
- **Kalendář**: měsíční přehled úkolů, rychlé plánování kliknutím na den.
- **Command palette** (`Ctrl/Cmd + K`) pro skok kamkoli; `/` filtruje úkoly v projektu.
- **API pro agenty**: REST + dependency-free MCP stdio server. `GET /api/agent/guide` vrátí stručný system prompt, `GET /api/agent/state` snapshot stavu jedním voláním.
- **Google Calendar sync**: úkol s termínem se propíše do kalendáře přes durable outbox (idempotentní insert přes `todoTaskId` marker, retry/backoff, dead-letter, recovery po pádu).
- **Export**: JSON, Markdown, CSV.

## Architektura

- **Backend:** Node.js (Express, ES modules), SQLite ve WAL. Jeden proces, < 70 MB RAM.
- **Frontend:** React (Vite), Tailwind, Framer Motion, Lucide. V produkci se zkompiluje do statických souborů a Express je servíruje na portu `3000`.
- **Bezpečnost:** fail-closed auth, tokeny jen jako SHA-256 hash, OAuth secrets šifrované at-rest.

<p align="center">
  <img src="docs/screenshots/calendar.png" width="49%" alt="Kalendář" />
  <img src="docs/screenshots/command-palette.png" width="49%" alt="Command Palette" />
</p>

## Spuštění (lokálně)

```bash
npm run install:all        # závislosti (Arch: ./scripts/install-arch.sh)

npm run dev                # vývoj: API :3000 + Vite :5173 (hot reload) -> http://localhost:5173
./scripts/start-app.sh     # produkce: build frontendu + node server na :3000
```

Konfigurace přes `.env` (viz [`.env.example`](.env.example)): `PORT`, `HOST`,
`NODE_ENV`, `DB_PATH`, `TODO_SECRET_KEY`, `LOCAL_UI_BYPASS`, `PUBLIC_BASE_URL`.

Nasazení na server / Raspberry Pi (nginx + systemd + port forwarding): viz
[`deploy/README.md`](deploy/README.md).

## API pro AI agenty

Lokální UI na stejném zařízení token nepotřebuje (loopback). Vzdálení klienti
posílají `Authorization: Bearer <token>`; token vytvoříš v **Nastavení -> AI Agenti**
a ukládá se jen jako hash.

- `GET /api/agent/guide`: stručný návod do system promptu (i pro malé modely).
- `GET /api/agent/state`: projekty + úkoly jedním voláním.
- `GET /api/docs`: přehled, `GET /api/docs/openapi.json`: OpenAPI 3.1.

**MCP server:** `npm run mcp` (stdio, 8 nástrojů, tenká vrstva nad API). Návod pro
agenta: [`docs/MCP.md`](docs/MCP.md), [`docs/MCP.en.md`](docs/MCP.en.md).
Lokálně běží proti `127.0.0.1:PORT`; na vzdálený deployment ho nasměruješ přes
`HOTOVO_BASE_URL` + `HOTOVO_API_TOKEN`:

```bash
HOTOVO_BASE_URL=https://fishlive.org:17854 HOTOVO_API_TOKEN=<token> npm run mcp
```

Hlavní endpointy:

- `GET /api/tasks`: filtry `list_id`, `status`, `priority`, `due_date`, `search`, `tag`, `due=today|week|overdue`
- `POST /api/tasks`: vytvořit úkol/podúkol (`parent_id` musí být ve stejném projektu); pole `recurrence`, `tags`
- `PUT /api/tasks/:id`, `DELETE /api/tasks/:id` (s podúkoly `?confirm=true`)
- `GET /api/lists`, `POST /api/lists`, `DELETE /api/lists/:id?confirm=true`
- `GET /api/tokens/export-data?format=markdown|json|csv`

## Google Calendar

1. [Google Cloud Console](https://console.cloud.google.com/): nový projekt, povol **Google Calendar API**.
2. **OAuth consent screen**: typ *External*, přidej svůj e-mail mezi testovací uživatele.
3. **Credentials**: vytvoř **OAuth client ID** (Web application).
4. **Authorized redirect URI**: `http://localhost:3000/api/sync/callback` (nebo `https://<doména>/api/sync/callback`).
5. V appce **Nastavení -> Google Kalendář** zadej Client ID + Secret a připoj účet.

Úkol s termínem se pak automaticky propíše do kalendáře; bez termínu se
nesynchronizuje.

## Testy

```bash
npm run test:backend   # node:test API integrační testy
npm run test:e2e       # Playwright e2e (izolovaný port + čistá test DB)
```

## Licence

MIT, viz [LICENSE](LICENSE).
