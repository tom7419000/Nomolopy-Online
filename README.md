# 🎮 PlayHub – Spieleabend online

Eine Gaming-Plattform mit **Echtzeit-Multiplayer**, auf der du mit Freunden in
privaten oder öffentlichen Räumen spielst – aktuell mit zwei Spielen:

| | Spiel | Spieler | Besonderheiten |
|---|---|---|---|
| 🎲 | **Monopoly** | 2–8 | Originalregeln, eigene Editionen (Berlin, München, USA …), Spielstände |
| 🃏 | **Texas Hold'em Poker** | 2–9 | No-Limit, steigende Blinds, Side-Pots, Auto-Fold-Timer, Zuschauer-Modus |

React + TypeScript im Frontend, Node.js + Socket.io als serverautoritatives
Backend, eine gemeinsame Engine pro Spiel für Regeln und Validierung.

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
npm test                                 # Unit-Tests: Monopoly, Poker, lokaler Raum, Trivia (92 Tests)
npm run typecheck
npm run build && npm run test:e2e        # Browser-E2E: Monopoly (Playwright)
npm run build && npm run test:e2e:poker  # Browser-E2E: Poker inkl. Karten-Redaction
npm run build && npm run test:e2e:pwa    # Browser-E2E: Manifest, Service Worker, Offline
npm run build && npm run test:e2e:local  # Browser-E2E: Pass & Play mit abgeschaltetem Netz
```

> Die E2E-Tests starten je einen eigenen Server (Ports 4096–4099). Bricht ein
> Lauf hart ab, können Server zurückbleiben – dann vor dem nächsten Lauf
> `pkill -f "server/index.ts"` ausführen.

---

## 👨‍👩‍👧‍👦 Zu viert an einem Tablet (Pass & Play)

Neben dem Online-Modus lässt sich **an einem einzigen Gerät** spielen: Tablet
in die Tischmitte, alle sitzen drumherum, das Gerät wandert reihum. Auf der
Startseite bei Monopoly oder Poker auf **„📱 Am Gerät spielen"** tippen,
Namen eintragen, los.

- **Kein Server, kein Netz.** Die Spiel-Engine läuft im Browser. Der Modus
  funktioniert im Flugmodus, im Zug und im Garten – die Verbindung wird für
  die Dauer der Partie sogar bewusst schlafen gelegt.
- **Kein Wartezimmer, kein Code.** Es gibt niemanden, auf den man warten
  müsste: Nach dem Setup startet die Partie sofort.
- **Der Spielstand überlebt einen Reload.** Er liegt im Browser-Speicher;
  Tab zumachen und später weiterspielen geht.
- **„👉 Anna ist dran"** steht dauerhaft über dem Spielfeld – am geteilten
  Bildschirm die wichtigste Information überhaupt.

### Weiterreichen oder feste Plätze

Beim Anlegen der Partie wird gewählt, wie das Gerät auf dem Tisch liegt:

| | |
|---|---|
| **📱 Weiterreichen** (Vorgabe) | Das Gerät wandert reihum, die Ansicht bleibt wie sie ist. |
| **🪑 Feste Plätze** | Das Gerät liegt in der Mitte, jeder sitzt an einer Kante (unten / rechts / oben / links). Wer dran ist, bekommt das Brett zu sich gedreht. |

Feste Plätze gehen bis vier Spieler – ein Tisch hat vier Kanten. Der Text auf
den Feldern wird bewusst **nicht** gegengedreht: bei 180° liest das Brett für
die Gegenübersitzenden kopfüber, genau wie ein echtes Brett.

Gedreht wird nur das Spielfeld, nicht die App-Hülle. Toasts, Dialoge und die
Kopfzeile bleiben aufrecht – sie hängen an `position: fixed` und an
Viewport-Einheiten, die sich immer auf den physischen Bildschirm beziehen.
Bei Poker bleibt der Sitzkranz stehen und stattdessen dreht sich jede
Sitzbox einzeln zu ihrem Spieler; der Filz selbst ist auf „ich unten"
zugeschnitten und liefe quer über den Rand.

### Poker: Handkarten bleiben geheim

Am gemeinsamen Bildschirm liegen die Karten verdeckt. Wer dran ist, hält
**„🔍 Karten ansehen"** gedrückt und sieht seine Hand, solange der Finger
liegen bleibt; Loslassen deckt sie wieder zu. Zusätzlich verdeckt sich die
Hand von selbst, sobald der Zug weitergeht, die App in den Hintergrund
gerät – oder nach zehn Sekunden, falls das Loslassen mal nicht ankommt.

Es ist eine Anzeige-Sperre, keine Verschlüsselung: Wer die Entwickler-
werkzeuge öffnet, kommt an die Karten des aktiven Sitzes. Genau wie jemand,
der am echten Tisch dem Nachbarn auf die Hand schaut – dagegen hilft kein
Frontend.

Eine **Bedenkzeit gibt es lokal nicht**. Online foldet die Uhr Abwesende
automatisch; am Tisch wäre ein Auto-Fold, nur weil das Tablet gerade
weitergereicht wird, die falsche Strafe. Nach dem Showdown bleiben die
aufgedeckten Karten dafür länger stehen (25 statt 9 Sekunden), damit alle
in Ruhe schauen können.

### Was lokal wegfällt

Raum-Link und -Code, Beitreten, Spieler entfernen, Lobby-Chat, öffentliche
Raumliste, Spielstände auf dem Server und der Editionen-Admin – all das
setzt einen Server voraus und ist im lokalen Modus ausgeblendet statt
kaputt.

---

## 📱 Als App installieren (PWA)

PlayHub ist eine installierbare Progressive Web App: eigenes Fenster ohne
Adressleiste, eigenes Icon, und die Oberfläche startet auch ohne Netz.

| Plattform | Installation |
|---|---|
| **Chrome/Edge (Desktop)** | Installations-Symbol in der Adressleiste – oder die Leiste „PlayHub installieren" unten in der App |
| **Android (Chrome)** | Banner „PlayHub installieren" bzw. Menü → *App installieren* |
| **iOS (Safari)** | Teilen-Symbol → *Zum Home-Bildschirm*. Die App zeigt dazu von selbst einen Hinweis. |

**Was offline funktioniert:** Oberfläche, Spiele-Katalog, Assets und der
lokale Pass-&-Play-Modus. Online-Multiplayer braucht naturgemäß eine
Verbindung – die Statusanzeige meldet den Verbindungsverlust ehrlich und
verbindet automatisch neu.

**Updates ohne veraltete Assets:** Die Build-Kennung wandert als `?v=…` in die
Service-Worker-URL, sodass jeder Build automatisch als neue Version erkannt
wird – ohne manuell gepflegte Versionsnummer. Dabei gilt:

- `index.html` läuft **network-first** → online immer die frische Fassung
- gehashte Assets (`/assets/index-ABC123.js`) laufen **cache-first** → sie sind
  unveränderlich, Vite vergibt bei Inhaltsänderung einen neuen Dateinamen
- beim Aktivieren werden Caches fremder Versionen gelöscht
- `/socket.io/` wird **nie** gecacht

Ein Update lädt die Seite **nicht** von selbst neu – das würde eine laufende
Partie zerstören. Stattdessen erscheint die Leiste „Neue Version verfügbar",
und erst ein Klick auf *Neu laden* übernimmt sie.

Icons werden reproduzierbar aus einer SVG-Vorlage erzeugt (`npm run icons`,
gerendert mit Chromium); die PNGs sind eingecheckt, der normale Build braucht
das Skript nicht.

---

## Die Plattform

### Lobby & Räume

- **Startseite** mit Spiele-Katalog (Bild, Beschreibung, Spielerzahl, Dauer)
- **Raum erstellen** mit Raumname, Beschreibung, Spielerlimit und
  spielspezifischen Optionen (Edition/Regeln bzw. Buy-in/Blinds)
- **Teilbarer Link**: Jeder Raum ist unter `…/#/room/CODE` direkt erreichbar –
  Link verschicken (oder 5-stelligen Code nennen), Name eingeben, fertig.
  Auf Mobilgeräten öffnet „Teilen" das native Share-Menü.
- **Öffentliche Räume**: Optional erscheint der Raum in der Raumliste der
  Startseite; private Räume sind nur per Link/Code erreichbar.
- **Host-Rechte**: Einstellungen ändern, Spieler entfernen, Spiel starten,
  neue Runde nach Spielende. Verlässt der Host, wandern die Rechte weiter.
- **Reconnect**: Sitzung wird lokal gespeichert; nach Tab-Schließen oder
  Verbindungsabbruch einfach zurückkommen (oder mit demselben Namen neu
  beitreten). Server-Limit: max. 200 gleichzeitige Räume.

### Chat

- **Lobby-Chat** für alle auf der Startseite (letzte 100 Nachrichten)
- **Raum-Chat** im Wartezimmer und im Spiel (bei Poker mit Quick-Messages
  wie „👏 Gut gespielt")
- **Aktions-Log** mit allen Spielereignissen

---

## 🎲 Monopoly (Originalregeln)

- **2–8 Spieler**, Standardbrett mit 40 Feldern (Los, Gefängnis, Frei Parken, „Gehe ins Gefängnis“)
- **Grundstückskauf** mit klassischen, steigenden Preisen (Badstraße → Schlossallee)
- **Auktionen** (Regeloption): Wer den Kauf ausschlägt – oder ihn sich nicht leisten
  kann – bringt das Grundstück unter den Hammer. Geboten wird reihum, bis nur noch
  einer übrig ist; passen scheidet endgültig aus dieser Auktion aus. Ohne die Option
  bleibt das Feld einfach unverkauft (bisheriges Verhalten, weiterhin Vorgabe).
- **Miete** abhängig von Besitzstatus und Bebauung; Bahnhöfe gestaffelt (25/50/100/200),
  Werke nach Augenzahl (4×/10×), doppelte Grundmiete bei kompletter Farbgruppe (Regeloption)
- **Häuser & Hotels** (1–4 Häuser, dann Hotel) mit Gleichmäßigkeits-Regel und
  begrenztem Bankvorrat (32 Häuser / 12 Hotels)
- **Ereignis- und Gemeinschaftskarten**, Texte passen sich der Edition an
- **Gefängnis**: Pasch würfeln (3 Versuche), Kaution zahlen oder Frei-Karte einsetzen
- **Pasch**: sofort noch ein Zug; drei Päsche in Folge → Gefängnis
- **Hypotheken** (50 % Beleihung, 10 % Zins beim Ablösen)
- **Handel** zwischen Spielern (Geld + Grundstücke, Angebot/Annahme/Ablehnung)
- **Schulden & Bankrott**: Wer nicht zahlen kann, muss verkaufen/beleihen oder
  aufgeben – der Besitz geht an den Gläubiger. Letzter verbleibender Spieler gewinnt. 🏆

### Admin-Panel (⚙️, nur Monopoly)

- **Editionen**: Straßennamen pro Edition anpassen – eingebaut sind
  *Klassisch (Deutschland)*, *Berlin*, *München* und *USA (Atlantic City)*
- **Farben** aller 8 Gruppen und des Bretts, **Bilder** für Brettmitte und Felder
  (Upload, clientseitig verkleinert, als Data-URL gespeichert)
- **Regel-Presets**: *Originalversion* (mit Auktionen), *Schnelle Variante* (ohne),
  *Hardcore* (mit, kurze Bedenkzeit) – in der Lobby weiter feinjustierbar
- **Spielstände speichern/laden** (JSON auf dem Server); nach dem Laden treten
  Mitspieler einfach mit ihrem alten Namen wieder bei
- **Debug-Modus** (Lobby-Option): nächsten Würfelwurf setzen – für Tests

### 📚 Fragenpakete (für die kommenden Trivia-Spiele)

Über die Fußzeile der Startseite erreichbar. Ein Paket besteht aus sechs
Kategorien (die klassischen Trivial-Pursuit-Farben) × fünf Schwierigkeits-
stufen. Mitgeliefert sind 300 deutsche Fragen; eigene Pakete lassen sich
anlegen, als JSON aus- und wieder einlesen und – auch offline – im Browser
speichern.

Das Abdeckungsraster im Editor ist zugleich die Jeopardy-Brettvorschau: Ein
Paket ist bespielbar, wenn **jedes** Fach mindestens vier Fragen hat. Weniger
geht nicht, weil Trivial Pursuit seine falschen Antwortmöglichkeiten aus den
übrigen Antworten desselben Fachs zieht – ohne sie extra schreiben zu müssen.

---

## 🃏 Texas Hold'em Poker

- **2–9 Spieler** pro Tisch, No-Limit
- **Blinds**: Small/Big Blind rotieren mit dem Dealer-Button (Heads-up:
  Dealer = Small Blind); optional automatische **Verdopplung alle X Minuten**
- **Spielphasen**: Pre-Flop → Flop → Turn → River → Showdown, mit
  Setzrunden (Check, Bet, Call, Raise mit Mindest-Erhöhung, Fold, All-In)
- **Side-Pots** bei All-Ins werden automatisch korrekt aufgeteilt
  (inkl. Split-Pots bei gleichwertigen Händen)
- **Hand-Bewertung**: Royal Flush bis Höchste Karte, beste 5 aus 7 Karten,
  mit deutschen Hand-Namen im Showdown („Full House (K über 8)")
- **Bedenkzeit** 30–120 s mit sichtbarem Countdown; wer nicht reagiert,
  checkt bzw. foldet automatisch (Getrennte nach kurzer Gnadenfrist)
- **Buy-in** 1.000–10.000 Chips; optional **Rebuy** für Pleite-Spieler
  (Cash-Game-Stil, Host kann die Partie jederzeit zwischen zwei Händen beenden)
- **Zuschauer-Modus**: Wer bei laufendem Spiel dazukommt, schaut zu und
  chattet mit – bei der nächsten Runde ist ein Sitz frei
- **Anfänger-Hilfe**: Unter den eigenen Karten steht die aktuell beste Hand
- **Karten bleiben geheim**: Der Server schickt jedem Client eine redigierte
  Sicht – fremde Hole Cards verlassen den Server erst beim Showdown

Bewusste Vereinfachungen bei Auktionen (in `shared/engine.ts` dokumentiert):
Geboten wird reihum statt offen und gleichzeitig – nur so lässt es sich gegen
getrennte Spieler absichern, und nur so funktioniert es am geteilten Gerät.
Und es wird höchstens das eigene Bargeld geboten; im Original dürfte man
darüber hinausgehen und danach Häuser verkaufen.

Bewusste Vereinfachungen (in `shared/poker/engine.ts` dokumentiert):
Jede Erhöhung eröffnet die Setzrunde neu (auch kurze All-Ins), beim Showdown
decken alle verbliebenen Spieler auf, Rebuy nur zwischen zwei Händen.

---

## Architektur

```
shared/            Engines & Typen (laufen auf Server UND Client)
  games.ts           Spiele-Liste (GameStateMap), Raum-Metadaten, RoomEnvelope
  registry.ts        Vertrag jedes Spiels gegenüber der Plattform + GAME_MODULES
  monopoly/module.ts Monopoly als Plattform-Modul (dünner Adapter)
  poker/module.ts    Poker als Plattform-Modul (dünner Adapter)
  trivia/types.ts    Fragenformat für Jeopardy & Trivial Pursuit + Validierung
  trivia/ask.ts      Fragen ziehen, Antworten prüfen, Ablenker bilden
  trivia/packs/      Mitgeliefertes deutsches Paket (300 Fragen)
  types.ts           Monopoly-Typen: GameState, Player, TileDef, Aktionen …
  engine.ts          Monopoly-Spiellogik: applyAction(state, playerId, action)
  boards.ts          Brettstruktur + 4 eingebaute Editionen
  cards.ts           Ereignis-/Gemeinschaftskarten
  rules.ts           Monopoly-Regel-Presets
  games.ts           Spiele-Katalog, Raum-Metadaten, Zustands-Hülle (RoomEnvelope)
  poker/
    types.ts         Poker-Typen: PokerState, Aktionen, redigierte PokerView
    hands.ts         Hand-Bewertung (beste 5 aus 7, Kicker, deutsche Namen)
    engine.ts        Setzrunden, Side-Pots, Blinds, Timeouts, viewFor()-Redaction
    rules.ts         Poker-Raumoptionen & Grenzen

server/            Node.js + Express + Socket.io
  index.ts           HTTP-Server, liefert client/dist aus (BASE_PATH-fähig)
  rooms.ts           Plattform: Räume (je 1 Spiel), Spieler/Zuschauer, Lobby-Chat,
                     öffentliche Raumliste, Poker-Timer, redigierte Broadcasts
  store.ts           Persistenz: eigene Editionen & Spielstände (./data, JSON)

client/            React 18 + TypeScript + Vite + zustand
  pages/             Home (Lobby), Room (Wartezimmer), JoinRoom (Link-Beitritt)
  games/monopoly/    Board, GameTable, Panels, Dialoge, AdminPanel
  games/poker/       PokerTable (Tisch, Sitze, Action-Bar), PlayingCard
  components/        Chat, Modal, Toasts (spielübergreifend)
  hooks/             useHashRoute (teilbare #/room/CODE-Links)
  net/index.ts       Transport-Router: leitet je nach Modus um
  net/socket.ts      Online: Socket-Verbindung, Request/Response, Reconnect
  net/localRoom.ts   Lokal: Raum-Logik im Browser (DOM-frei, testbar)
  net/local.ts       Lokal: Verdrahtung mit Store und localStorage
  pages/LocalSetup   Setup für eine Partie am gemeinsamen Gerät
  state/store.ts     zentraler App-State (RoomEnvelope vom Server)

tests/
  engine.test.ts     19 Unit-Tests Monopoly-Regeln (node:test)
  poker.test.ts      19 Unit-Tests Poker (Rankings, Side-Pots, Blinds, Timeouts)
  e2e.ts             Browser-E2E Monopoly: 2 Spieler, Link-Beitritt, echtes Spiel
  e2e-poker.ts       Browser-E2E Poker: Showdown, Raise/Fold, Redaction, Zuschauer
  local-room.test.ts 17 Unit-Tests lokaler Raum: Sitzrotation, Klon-Vertrag, Redaction
  e2e-local.ts       Browser-E2E Pass & Play – mit abgeschaltetem Netz
```

**Designentscheidungen**

- **Socket.io statt Firebase/Supabase**: keine externen Accounts/Keys, läuft
  überall (auch offline im LAN und hinter dem eigenen Reverse-Proxy).
  Der komplette Zustand ist klein genug, um nach jeder Aktion vollständig
  gebroadcastet zu werden – das macht die Synchronisation trivial robust.
- **Serverautoritative Engines**: Clients rendern nur und schicken Aktionen;
  alle Züge werden serverseitig validiert (Cheaten zwecklos). Bei Poker wird
  der Zustand pro Empfänger redigiert (kein Deck, fremde Karten verdeckt).
- **Ein Raum = ein Spiel**: Die Plattform-Schicht (Räume, Chat, Raumliste)
  ist spielunabhängig. Ein neues Spiel wird an genau EINER Stelle eingetragen –
  in `GameStateMap` (`shared/games.ts`). Danach verlangt der Compiler die drei
  fehlenden Einträge: den Katalog (`GAME_INFOS`), die Engine-Anbindung
  (`GAME_MODULES` in `shared/registry.ts`) und die Oberfläche (`CLIENT_GAMES`
  in `client/src/games/registry.tsx`). Vorher waren es rund siebzig
  `game ? … : poker ? …`-Ketten, an denen ein drittes Spiel stumm
  durchgefallen wäre.
- **Nickname statt Accounts**: bewusst ohne Registrierung/E-Mail – der Name
  wird lokal gespeichert. Accounts, Freundeslisten, Achievements und weitere
  Spiele (Kniffel, Rommé …) sind auf der Roadmap.

---

## Deployment unter einem Pfad (z. B. neben WordPress auf Hetzner)

Die App braucht einen **dauerhaft laufenden Node.js-Prozess** (Socket.io).
Das funktioniert auf jedem Server mit SSH-/Root-Zugang (Hetzner Cloud,
Dedicated, Managed Server) – **nicht** auf klassischem Shared-Webhosting
(nur PHP/FTP). Der Client ist subpfad-fähig gebaut (relative Assets,
WebSocket-Pfad wird zur Laufzeit abgeleitet), es sind also keine
Code-Anpassungen nötig – auch die Raum-Links (`…/playhub/#/room/CODE`)
funktionieren unter jedem Pfad.

### 1. App auf dem Server installieren

```bash
# Node ≥ 20 (Beispiel Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs

sudo git clone https://github.com/tom7419000/Nomolopy-Online /opt/playhub
cd /opt/playhub && sudo npm ci && sudo npm run build
```

### 2. Als systemd-Dienst starten

`/etc/systemd/system/playhub.service`:

```ini
[Unit]
Description=PlayHub (Monopoly & Poker)
After=network.target

[Service]
WorkingDirectory=/opt/playhub
ExecStart=/usr/bin/npm start
Environment=PORT=3001
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now playhub
curl http://127.0.0.1:3001/healthz   # → {"ok":true}
```

### 3. Reverse-Proxy auf den Pfad legen

Die Direktiven gehören in den **vHost** (nicht in die `.htaccess` –
`ProxyPass` funktioniert dort nicht) und haben Vorrang vor den
WordPress-Rewrite-Regeln.

**Apache** (≥ 2.4.47, `a2enmod proxy proxy_http proxy_wstunnel`):

```apache
# im vHost der WordPress-Seite:
ProxyPass        /playhub/ http://127.0.0.1:3001/ upgrade=websocket
ProxyPassReverse /playhub/ http://127.0.0.1:3001/
Redirect         /playhub  /playhub/
```

**nginx**:

```nginx
location /playhub/ {
    proxy_pass http://127.0.0.1:3001/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
location = /playhub { return 301 /playhub/; }
```

**Plesk**: Domain → „Apache & nginx Einstellungen“ → *Zusätzliche
nginx-Anweisungen* → den nginx-Block von oben eintragen.

Danach läuft die Plattform unter `https://deine-domain.de/playhub/` –
in WordPress einfach einen Menüpunkt als „Individuellen Link“ darauf
anlegen. Alternativ (Proxy behält den Präfix bei): den Dienst mit
`Environment=BASE_PATH=/playhub` starten und ohne abschließenden
Slash proxyen.

### 4. Updates einspielen

`scripts/update.sh` zieht den konfigurierten Branch, installiert
Abhängigkeiten, baut den Client neu, startet den systemd-Dienst neu und
prüft `/healthz`. Schlägt der Healthcheck fehl, wird automatisch auf den
vorherigen Commit zurückgerollt.

```bash
cd /opt/playhub
sudo APP_DIR=/opt/playhub SERVICE=playhub ./scripts/update.sh
# oder kurz, falls im Repo-Verzeichnis: sudo npm run update
```

Bricht das Skript ab (z. B. wegen uncommitteter Änderungen im
Arbeitsverzeichnis), wird nichts angefasst – erst danach erneut ausführen.

---

## Bedienung

1. **Startseite**: Name eingeben → Spiel im Katalog wählen → *Raum erstellen*
   (Optionen einstellen) – oder per Code/Link einem Raum beitreten.
2. **Wartezimmer**: Link teilen, Host wählt Edition/Regeln bzw. Blinds/Buy-in,
   dann *Spiel starten*.
3. **Monopoly**: Würfeln → kaufen/passen → bauen/handeln → Zug beenden.
   Klick auf ein Feld zeigt die Grundstückskarte mit allen Aktionen.
   **Poker**: Check/Bet/Call/Raise/Fold/All-In über die Action-Bar,
   Erhöhen per Slider oder ½-Pot/Pot-Buttons.
4. **Spielende**: Rangliste bzw. Chip-Stände mit Statistik – der Host kann
   direkt eine neue Runde in derselben Lobby starten.
