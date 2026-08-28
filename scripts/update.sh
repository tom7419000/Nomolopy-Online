#!/usr/bin/env bash
#
# Aktualisiert eine bestehende PlayHub-Installation (siehe README →
# "Deployment unter einem Pfad"): Code ziehen, Abhängigkeiten installieren,
# bauen, systemd-Dienst neu starten, Healthcheck prüfen. Bei fehlgeschlagenem
# Healthcheck automatischer Rollback auf den vorherigen Commit.
#
# Verwendung (auf dem Server, i.d.R. als root/sudo):
#   sudo ./scripts/update.sh
#
# Konfigurierbar per Umgebungsvariable:
#   APP_DIR      Installationsverzeichnis      (Standard: /opt/playhub)
#   SERVICE      systemd-Diensteinheit         (Standard: playhub)
#   BRANCH       zu ziehender Branch           (Standard: aktuell ausgecheckter Branch)
#   HEALTH_URL   URL für den Healthcheck       (Standard: http://127.0.0.1:$PORT/healthz,
#                PORT aus der systemd-Unit oder 3001)

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/playhub}"
SERVICE="${SERVICE:-playhub}"

log()  { printf '\033[1;34m[update]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[update]\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[1;31m[update]\033[0m %s\n' "$1" >&2; exit 1; }

[ -d "$APP_DIR/.git" ] || die "Kein Git-Repo unter $APP_DIR (APP_DIR falsch gesetzt?)."
cd "$APP_DIR"

command -v git >/dev/null || die "git nicht gefunden."
command -v npm >/dev/null || die "npm nicht gefunden."

BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

# Laufende Änderungen im Arbeitsverzeichnis niemals stillschweigend verwerfen.
if [ -n "$(git status --porcelain)" ]; then
  die "Arbeitsverzeichnis hat uncommittete Änderungen – Update abgebrochen. \
Erst sichern/verwerfen (git stash / git status), dann erneut versuchen."
fi

OLD_COMMIT="$(git rev-parse HEAD)"
log "Aktueller Stand: $(git log -1 --oneline)"

log "Hole $BRANCH von origin …"
git fetch origin "$BRANCH"

NEW_COMMIT="$(git rev-parse "origin/$BRANCH")"
if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
  log "Bereits auf dem neuesten Stand (nichts zu tun)."
  exit 0
fi

git checkout "$BRANCH"
git merge --ff-only "origin/$BRANCH"
log "Neuer Stand: $(git log -1 --oneline)"

log "Installiere Abhängigkeiten (npm ci) …"
npm ci

log "Baue Client (npm run build) …"
npm run build

# Port für den Healthcheck aus der systemd-Unit lesen, falls dort gesetzt.
PORT_FROM_UNIT="$(systemctl show "$SERVICE" -p Environment 2>/dev/null \
  | grep -o 'PORT=[0-9]*' | head -n1 | cut -d= -f2 || true)"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT_FROM_UNIT:-3001}/healthz}"

rollback() {
  warn "Healthcheck fehlgeschlagen – rolle zurück auf $(git -C "$APP_DIR" log -1 --oneline "$OLD_COMMIT")."
  git reset --hard "$OLD_COMMIT"
  npm ci
  npm run build
  systemctl restart "$SERVICE" || true
  die "Rollback durchgeführt. Bitte Server-Logs prüfen (journalctl -u $SERVICE -n 100)."
}

log "Starte Dienst neu (systemctl restart $SERVICE) …"
systemctl restart "$SERVICE"

log "Prüfe Healthcheck ($HEALTH_URL) …"
OK=""
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    OK=1
    break
  fi
  sleep 1
done
[ -n "$OK" ] || rollback

log "✔ Update erfolgreich: $(git log -1 --oneline) läuft und antwortet auf $HEALTH_URL"
