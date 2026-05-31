# HOTOVO — nasazení

Vzor podle `realestate-bot` na **fishlive.org** (Raspberry Pi 4): aplikace běží
jako systemd služba na `127.0.0.1:3000`, **nginx** ji vystavuje přes HTTPS na
subdoméně `hotovo.fishlive.org` (Let's Encrypt).

```
Internet ──HTTPS──> nginx (hotovo.fishlive.org:443) ──proxy──> 127.0.0.1:3000 (systemd: hotovo)
```

Soubory:
- `systemd/hotovo.service` — produkční unit pro `/opt/hotovo` (hardened, build se dělá při deployi, ne při startu).
- `nginx-hotovo.conf` — reverse proxy + SSL + rate limit.
- `hotovo.env.example` — produkční `.env` (zkopíruje se do `/opt/hotovo/etc/hotovo.env`).
- `install-pi.sh` — první instalace na Pi.
- `../scripts/deploy-pi.sh` — aktualizace existující instalace z dev boxu.

---

## 0. Publikace na GitHub (jednou, dnes večer)

Repo zatím **není** vytvořené ani pushnuté (děláme večer společně). Až budeš chtít:

```bash
cd ~/git/github/todo-list
# vytvoří PUBLIC repo raven2cz/HOTOVO, nastaví remote a pushne main:
gh repo create raven2cz/HOTOVO --public --source=. --remote=origin \
  --description "HOTOVO — self-hosted task app with an AI-agent API and Google Calendar sync" \
  --push
```

> `gh` je přihlášený jako `raven2cz` (ssh). Ověř, že v repu nejsou žádné `*.db`,
> `INITIAL_TOKEN.txt`, `.todo-secret-key` (jsou v `.gitignore`).

---

## 1. První instalace na Pi (dnes večer)

DNS: `hotovo.fishlive.org` → IP Pi (A/AAAA záznam).

```bash
# na Pi (uživatel se sudo):
REPO=git@github.com:raven2cz/HOTOVO.git ./install-pi.sh
# nebo nejdřív naklonovat a spustit deploy/install-pi.sh z checkoutu
```

Skript: vytvoří uživatele `hotovo`, naklonuje repo do `/opt/hotovo`, nainstaluje
závislosti, sestaví frontend, vygeneruje `TODO_SECRET_KEY`, založí službu a
spustí ji. Pak ručně dodělej nginx + TLS (vypíše přesné příkazy).

### nginx + TLS
```bash
sudo cp /opt/hotovo/deploy/nginx-hotovo.conf /etc/nginx/sites-available/hotovo
sudo ln -sf /etc/nginx/sites-available/hotovo /etc/nginx/sites-enabled/hotovo
sudo nginx -t && sudo systemctl reload nginx
# certifikát (pokud ještě není wildcard/fishlive.org):
sudo certbot --nginx -d hotovo.fishlive.org
```

---

## 2. Přihlášení / token

Za reverzní proxy je `LOCAL_UI_BYPASS=false`, takže **každý** `/api` požadavek
vyžaduje token. Při prvním startu se vygeneroval do `/opt/hotovo/data/INITIAL_TOKEN.txt`:

```bash
sudo cat /opt/hotovo/data/INITIAL_TOKEN.txt   # zkopíruj
sudo rm /opt/hotovo/data/INITIAL_TOKEN.txt    # a smaž
```

V prohlížeči na `https://hotovo.fishlive.org` ho jednou vlož (uloží se do
localStorage). Volitelně lze přidat ještě nginx HTTP Basic Auth (viz komentář v
`nginx-hotovo.conf`).

---

## 3. Google Calendar

V `hotovo.env` je `PUBLIC_BASE_URL=https://hotovo.fishlive.org`, takže výchozí
OAuth redirect je `https://hotovo.fishlive.org/api/sync/callback` — tuto URL
zaregistruj v Google Cloud → Credentials → Authorized redirect URIs.

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
