# HOTOVO — nasazení

Vzor podle `realestate-bot` na **fishlive.org** (Raspberry Pi 4): aplikace běží
jako systemd služba na `127.0.0.1:3000`, **nginx** terminuje TLS na **veřejném
portu `17854`**, který přesměruješ v routeru (port forwarding) na Pi.

```
Internet ──TCP 17854──> router ──> Pi:17854 (nginx, TLS) ──proxy──> 127.0.0.1:3000 (systemd: hotovo)
Public URL: https://fishlive.org:17854
```

> **Port 17854** je zvolený tak, aby nekolidoval s realestate-bot (17852/17853).
> Tenhle port dej do routeru. Cert se reusne z existujícího `fishlive.org`
> (Let's Encrypt) — port pro certifikát nehraje roli.

Soubory:
- `systemd/hotovo.service` — produkční unit pro `/opt/hotovo` (hardened; node z fixní cesty `/opt/hotovo/.node/node`).
- `nginx-hotovo.conf` — reverse proxy + SSL na portu 17854.
- `hotovo.env.example` — produkční `.env` → `/opt/hotovo/etc/hotovo.env`.
- `install-pi.sh` — první instalace na Pi.
- `../scripts/deploy-pi.sh` — aktualizace existující instalace z dev boxu.

---

## 1. První instalace na Pi

```bash
# na Pi (uživatel se sudo; Node 20+ na PATH, např. přes fnm: fnm use 20):
REPO=git@github.com:raven2cz/HOTOVO.git ./deploy/install-pi.sh
```

Skript: ověří Node, vytvoří uživatele `hotovo`, naklonuje repo do `/opt/hotovo`,
připne node na fixní cestu, nainstaluje závislosti, sestaví frontend, vygeneruje
`TODO_SECRET_KEY`, založí a spustí službu. Pak ručně nginx + router (vypíše příkazy).

### nginx + router + TLS
```bash
sudo cp /opt/hotovo/deploy/nginx-hotovo.conf /etc/nginx/sites-available/hotovo
sudo ln -sf /etc/nginx/sites-available/hotovo /etc/nginx/sites-enabled/hotovo
sudo nginx -t && sudo systemctl reload nginx
```
- **Router:** forwardni externí TCP **17854** → Pi:17854.
- **Cert:** reuse `fishlive.org` (už na Pi je). Případně nový:
  `sudo certbot certonly --nginx -d fishlive.org`.

---

## 2. Přihlášení / token

Za reverzní proxy je `LOCAL_UI_BYPASS=false`, takže **každý** `/api` požadavek
vyžaduje token. První token je v `/opt/hotovo/data/INITIAL_TOKEN.txt`:

```bash
sudo cat /opt/hotovo/data/INITIAL_TOKEN.txt   # zkopíruj
sudo rm  /opt/hotovo/data/INITIAL_TOKEN.txt    # a smaž
```

Na `https://fishlive.org:17854` ho jednou vlož do **Nastavení** (uloží se do
prohlížeče). Volitelně přidej nginx HTTP Basic Auth (komentář v `nginx-hotovo.conf`).

---

## 3. Google Calendar

`hotovo.env` má `PUBLIC_BASE_URL=https://fishlive.org:17854`, takže OAuth redirect
je `https://fishlive.org:17854/api/sync/callback` — tuto URL zaregistruj v Google
Cloud → Credentials → Authorized redirect URIs.

---

## 4. Aktualizace (kdykoli z dev boxu)

```bash
PI=pi@fishlive.org ./scripts/deploy-pi.sh
```

## 5. Diagnostika
```bash
sudo systemctl status hotovo
sudo journalctl -u hotovo -f
curl -sf http://127.0.0.1:3000/api/health
```
