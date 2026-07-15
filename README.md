# 🎲 Nomolopy Online

Eine vollständige Monopoly-Webanwendung mit **Echtzeit-Multiplayer** für 2–8 Spieler:
React + TypeScript im Frontend, Node.js + Socket.io als serverautoritatives Backend,
eine gemeinsame Spiel-Engine für Regeln und Validierung – plus Admin-Panel für eigene
Editionen (Straßennamen, Farben, Bilder) und Spielstände.

> Spielgeld only – keine echten Geldtransaktionen. 😉

---

## Schnellstart

Voraussetzung: Node.js ≥ 20

```bash
npm install

# Entwicklung (Server auf :3001, Client mit Hot-Reload auf :5173)
npm run dev
# → http://localhost:5173 öffnen (mehrere Tabs/Geräte für Multiplayer)

# Produktion
npm run build
npm start
# → http://localhost:3001
```

Der Produktions-Server liefert den gebauten Client direkt aus – für ein Spiel im
LAN einfach `http://<deine-IP>:3001` an die Mitspieler geben. Port per `PORT`,
Datenverzeichnis (Editionen/Spielstände) per `DATA_DIR` konfigurierbar.

```bash
npm test        # Engine-Unit-Tests (Regeln, Miete, Gefängnis, Bankrott, …)
npm run build && npm run test:e2e  # End-to-End-Test im echten Browser (Playwright)
npm run typecheck
```

---

## Features

### Spielmechanik (Originalregeln)

- **2–8 Spieler**, Standardbrett mit 40 Feldern (Los, Gefängnis, Frei Parken, „Gehe ins Gefängnis“)
- **Grundstückskauf** mit klassischen, steigenden Preisen (Badstraße → Schlossallee)
- **Miete** abhängig von Besitzstatus und Bebauung; Bahnhöfe gestaffelt (25/50/100/200),
  Werke nach Augenzahl (4×/10×), doppelte Grundmiete bei kompletter Farbgruppe (Regeloption)
- **Häuser & Hotels** (1–4 Häuser, dann Hotel) mit Gleichmäßigkeits-Regel und
  begrenztem Bankvorrat (32 Häuser / 12 Hotels)
- **Ereignis- und Gemeinschaftskarten** (vereinfacht: Geldbeträge, Bewegungen,
  Gefängnis-Frei-Karten, Reparaturen, Geburtstag …) – Texte passen sich der Edition an
- **Gefängnis**: Pasch würfeln (3 Versuche), Kaution zahlen oder Frei-Karte einsetzen
- **Pasch**: sofort noch ein Zug; drei Päsche in Folge → Gefängnis
- **Hypotheken** (50 % Beleihung, 10 % Zins beim Ablösen)
- **Handel** zwischen Spielern (Geld + Grundstücke, Angebot/Annahme/Ablehnung)
- **Schulden & Bankrott**: Wer nicht zahlen kann, muss verkaufen/beleihen oder aufgeben –
  der Besitz geht an den Gläubiger. Letzter verbleibender Spieler gewinnt. 🏆

### Online-Multiplayer

- **Live-Synchronisation** über Socket.io – der Server ist alleinige Regelinstanz,
  Clients senden nur Aktionen (Cheaten zwecklos)
- **Chat** in Lobby und Spiel, **Aktions-Log** mit allen Transaktionen
- **Räume mit 5-stelligem Code**, Farben/Figuren werden zufällig vergeben
- **Zug-Benachrichtigungen** („Du bist dran!“ + Tab-Titel)
- **Verbindungsstatus** pro Spieler; **Reconnect** über gespeicherte Sitzung oder
  einfach erneut mit demselben Namen beitreten
- Host-Werkzeuge: Zug getrennter Spieler automatisch abschließen, Spieler entfernen,
  neue Runde nach Spielende

### Admin-Panel (⚙️)

- **Editionen**: Straßennamen pro Monopoly-Edition anpassen – eingebaut sind
  *Klassisch (Deutschland)*, *Berlin*, *München* und *USA (Atlantic City)*
- **Farben** aller 8 Grundstücksgruppen und des Bretts frei wählbar
- **Bilder**: Logo für die Brettmitte und optionale Grafiken pro Feld
  (Upload, clientseitig verkleinert, als Data-URL gespeichert)
- **Regel-Presets**: *Originalversion*, *Schnelle Variante* (mehr Startkapital,
  Frei-Parken-Bonus), *Hardcore* – in der Lobby weiter feinjustierbar
- **Spielstände speichern/laden** (JSON auf dem Server); nach dem Laden treten
  Mitspieler einfach mit ihrem alten Namen wieder bei

### Debugging & Fehlerbehandlung

- 🐞-Dialog zeigt den kompletten Spielzustand als JSON (kopierbar)
- **Debug-Modus** (Lobby-Option): nächsten Würfelwurf manuell setzen – für Tests
- Ungültige Züge werden serverseitig abgelehnt und als Toast erklärt;
  die UI blendet unzulässige Aktionen von vornherein aus

---

## Architektur

```
shared/    Spiel-Engine & Typen (läuft auf Server UND Client)
  types.ts     alle Typen: GameState, Player, TileDef, Aktionen, …
  boards.ts    Brettstruktur (Preise/Mieten) + 4 eingebaute Editionen
  cards.ts     Ereignis-/Gemeinschaftskarten (editionsabhängige Texte)
  rules.ts     Regel-Presets
  engine.ts    komplette Spiellogik: applyAction(state, playerId, action)

server/    Node.js + Express + Socket.io
  index.ts     HTTP-Server, liefert client/dist aus
  rooms.ts     Räume, Beitritt/Reconnect, Broadcast des Spielzustands
  store.ts     Persistenz: eigene Editionen & Spielstände (./data, JSON)

client/    React 18 + TypeScript + Vite + zustand
  net/socket.ts       Socket-Verbindung, Request/Response, Reconnect
  state/store.ts      zentraler App-State (Spielzustand vom Server)
  components/         StartScreen, Lobby, GameTable, Board, Panels,
                      Dialoge (Karten, Grundstück, Handel, Debug), AdminPanel
  styles.css          Designsystem (CSS-Variablen, responsive bis Tablet)

tests/
  engine.test.ts   19 Unit-Tests der Spielregeln (node:test)
  e2e.ts           Browser-E2E: 2 Spieler spielen ein echtes Spiel (Playwright)
```

**Designentscheidungen**

- **Socket.io statt Firebase**: keine externen Accounts/Keys, läuft überall
  (auch offline im LAN); der komplette `GameState` ist klein genug, um nach jeder
  Aktion vollständig gebroadcastet zu werden – das macht die Synchronisation trivial
  robust (kein Delta-Drift).
- **Serverautoritative Engine**: Clients rendern nur und schicken Aktionen;
  dieselben `can*`-Prüffunktionen steuern die Button-Zustände in der UI.
- **Bewusste Regel-Vereinfachungen** (dokumentiert in `shared/engine.ts`):
  keine Auktionen bei ausgeschlagenem Kauf; bei „zahle jedem Spieler“-Karten
  werden zahlungsunfähige Spieler automatisch liquidiert.

---

## Deployment unter einem Pfad (z. B. neben WordPress auf Hetzner)

Das Spiel braucht einen **dauerhaft laufenden Node.js-Prozess** (Socket.io).
Das funktioniert auf jedem Server mit SSH-/Root-Zugang (Hetzner Cloud,
Dedicated, Managed Server) – **nicht** auf klassischem Shared-Webhosting
(nur PHP/FTP). Der Client ist subpfad-fähig gebaut (relative Assets,
WebSocket-Pfad wird zur Laufzeit abgeleitet), es sind also keine
Code-Anpassungen nötig.

### 1. App auf dem Server installieren

```bash
# Node ≥ 20 (Beispiel Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs

sudo git clone https://github.com/tom7419000/Nomolopy-Online /opt/nomolopy
cd /opt/nomolopy && sudo npm ci && sudo npm run build
```

### 2. Als systemd-Dienst starten

`/etc/systemd/system/nomolopy.service`:

```ini
[Unit]
Description=Nomolopy Online (Monopoly)
After=network.target

[Service]
WorkingDirectory=/opt/nomolopy
ExecStart=/usr/bin/npm start
Environment=PORT=3001
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now nomolopy
curl http://127.0.0.1:3001/healthz   # → {"ok":true}
```

### 3. Reverse-Proxy auf den Pfad legen

Die Direktiven gehören in den **vHost** (nicht in die `.htaccess` –
`ProxyPass` funktioniert dort nicht) und haben Vorrang vor den
WordPress-Rewrite-Regeln.

**Apache** (≥ 2.4.47, `a2enmod proxy proxy_http proxy_wstunnel`):

```apache
# im vHost der WordPress-Seite:
ProxyPass        /monopoly/ http://127.0.0.1:3001/ upgrade=websocket
ProxyPassReverse /monopoly/ http://127.0.0.1:3001/
Redirect         /monopoly  /monopoly/
```

**nginx**:

```nginx
location /monopoly/ {
    proxy_pass http://127.0.0.1:3001/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
location = /monopoly { return 301 /monopoly/; }
```

**Plesk**: Domain → „Apache & nginx Einstellungen“ → *Zusätzliche
nginx-Anweisungen* → den nginx-Block von oben eintragen.

Danach läuft das Spiel unter `https://deine-domain.de/monopoly/` –
in WordPress einfach einen Menüpunkt als „Individuellen Link“ darauf
anlegen. Alternativ (Proxy behält den Präfix bei): den Dienst mit
`Environment=BASE_PATH=/monopoly` starten und ohne abschließenden
Slash proxyen.

## Bedienung

1. **Startbildschirm**: Name eingeben → *Spiel erstellen* (Edition + Preset wählen)
   oder mit Raum-Code *beitreten*.
2. **Lobby**: Host wählt Edition/Regeln, Spieler losen Farben/Figuren, dann *Spiel starten*.
3. **Spieltisch**: Würfeln → kaufen/passen → bauen/handeln → Zug beenden.
   Klick auf ein Feld zeigt die Grundstückskarte mit allen Aktionen
   (bauen, verkaufen, Hypothek).
4. **Spielende**: Rangliste, Host kann direkt eine neue Runde starten.
