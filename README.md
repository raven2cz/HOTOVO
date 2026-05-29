# Aether Todo - 2026 Task Space ⚡

Moderní, graficky a animačně pokročilá Todo-List aplikace navržená pro běh na **Raspberry Pi 4** (a jiných zařízeních s nízkou spotřebou RAM). Obsahuje vestavěné **REST API pro AI agenty** (s OpenAPI dokumentací) a obousměrnou integraci s **Google Kalendářem**.

---

## 🎨 Vlastnosti Aplikace
- **2026 UI/UX:** Tmavé rozhraní se skleněným efektem (glassmorphism), plynulé animace, čistý a funkční design využívající moderní písmo *Outfit*.
- **Hierarchické úkoly:** Podpora pro nekonečně vnořené podúkoly (ideální pro komplexní projekty jako je nákup/prodej domu).
- **Zobrazení kalendáře:** Přepínatelné zobrazení úkolů v měsíčním kalendářním gridu s možností rychlého plánování.
- **Rychlý Command Palette (Ctrl + K):** Kompletní ovládání aplikace z klávesnice. Hledejte úkoly, přecházejte mezi projekty, přepínejte režimy nebo vytvářejte úkoly bez použití myši.
- **AI Agent API:** Zabezpečené API rozhraní umožňující agentům (např. custom GPTs) plánovat, mazat a aktualizovat úkoly.
- **Google Calendar Sync:** Automatická synchronizace úkolů s termínem do vašeho Google Kalendáře.
- **Export dat:** Stahování úkolů ve formátech **JSON**, **Markdown** (jako čisté checklisty) a **CSV**.

---

## 🏗️ Architektura a Technologie
- **Backend:** Node.js (Express), ES modules, SQLite (sqlite3 / sqlite pro rychlé, bez-serverové a stabilní ukládání dat s minimální spotřebou paměti).
- **Frontend:** React (Vite), Tailwind CSS, Framer Motion pro animace a Lucide Icons.
- **Produkční balíček:** Frontend se zkompiluje do statických souborů a Express backend je servíruje přímo na portu `3000`. Celá aplikace tak běží pod **jediným Node.js procesem** (RAM < 70MB na Pi-4).

---

## 🚀 Jak aplikaci spustit

### 1. Instalace závislostí
Spusťte v kořenovém adresáři:
```bash
npm run install:all
```
*(Tento příkaz nainstaluje knihovny pro backend i frontend).*

### 2. Spuštění ve vývojovém režimu (Development)
Pro souběžný běh backendu (port 3000) a frontendového Vite serveru (s proxy) spusťte:
```bash
npm run dev
```
Otevřete v prohlížeči: [http://localhost:5173/](http://localhost:5173/)

### 3. Sestavení a produkční běh (vhodné pro Pi-4)
Pro zkompilování frontendu a spuštění sjednoceného serveru:
```bash
# 1. Sestavit frontend
npm run build:frontend

# 2. Spustit server
npm start
```
Aplikace poběží na: [http://localhost:3000/](http://localhost:3000/)

---

## 🤖 API pro AI Agenty
Všechny požadavky musí být autorizovány v hlavičce:
```
Authorization: Bearer agent-secret-42-pineapple-token
```
*(Tento výchozí token je předgenerován. Další klíče si můžete vytvořit a spravovat v **Nastavení** přímo v UI).*

### Hlavní API Endpointy
- `GET /api/tasks` - Výpis všech úkolů (lze filtrovat parametry: `list_id`, `status`, `priority`, `due_date`).
- `POST /api/tasks` - Vytvoření úkolu nebo podúkolu (předáním parametru `parent_id`).
- `PUT /api/tasks/:id` - Úprava detailů úkolu (přejmenování, splnění, změna termínu).
- `DELETE /api/tasks/:id` - Smazání úkolu a všech jeho podúkolů.
- `GET /api/lists` - Výpis všech projektů/listů.
- `GET /api/tokens/export-data?format=markdown` - Stažení všech úkolů jako Markdown.

👉 Kompletní interaktivní OpenAPI specifikaci a dokumentaci naleznete při spuštěném serveru na:  
[http://localhost:3000/api/docs](http://localhost:3000/api/docs)

---

## 📅 Nastavení Google Calendar Sync
Pro spuštění synchronizace s kalendářem:
1. Přejděte na [Google Cloud Console](https://console.cloud.google.com/).
2. Vytvořte nový projekt a povolte v něm **Google Calendar API**.
3. V sekci **OAuth consent screen** (Souhlasná obrazovka) nastavte aplikaci jako *External* a přidejte svůj testovací Google email pod testovací uživatele.
4. V sekci **Credentials** (Přihlašovací údaje) vytvořte **OAuth client ID** (typ Webová aplikace).
5. Přidejte následující URI do **Authorized redirect URIs**:
   `http://localhost:3000/api/sync/callback` (popř. `http://[IP-vaseho-pi]:3000/api/sync/callback`).
6. Zkopírujte vygenerované **Client ID** a **Client Secret**.
7. V aplikaci klikněte na **Nastavení & Integrace** (vlevo dole), zadejte tyto údaje a uložte.
8. Klikněte na **Připojit účet Google** a povolte přístup ke svému kalendáři.
