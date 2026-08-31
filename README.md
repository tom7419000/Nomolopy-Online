# 🎮 PlayHub – Spieleabend online

Eine Gaming-Plattform mit **Echtzeit-Multiplayer**, auf der du mit Freunden in
privaten oder öffentlichen Räumen spielst – aktuell mit vier Spielen:

| | Spiel | Spieler | Besonderheiten |
|---|---|---|---|
| 🎲 | **Monopoly** | 2–8 | Originalregeln inkl. Auktionen, eigene Editionen (Berlin, München, USA …), Spielstände |
| 🃏 | **Texas Hold'em Poker** | 2–9 | No-Limit, steigende Blinds, Side-Pots, Auto-Fold-Timer, Zuschauer-Modus |
| 🎯 | **Jeopardy** | 2–8 | 300 deutsche Fragen, Brett auf dem Fernseher + Buzzer auf den Handys, wahlweise mit Moderator |
| 🧀 | **Trivial Pursuit** | 2–6 | Volles Rad mit 73 Feldern, Käsestücke, Schlussfrage in der Mitte |

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
npm test                                    # Unit-Tests aller Spiele und des lokalen Raums (176 Tests)
npm run typecheck
npm run build && npm run test:e2e           # Browser-E2E: Monopoly inkl. Auktion (Playwright)
npm run build && npm run test:e2e:poker     # Browser-E2E: Poker inkl. Karten-Redaction
npm run build && npm run test:e2e:pwa       # Browser-E2E: Manifest, Service Worker, Offline
npm run build && npm run test:e2e:local     # Browser-E2E: Pass & Play mit abgeschaltetem Netz
npm run build && npm run test:e2e:jeopardy  # Browser-E2E: Fernseher + zwei Handys, lokal
npm run build && npm run test:e2e:pursuit   # Browser-E2E: Rad, Käsestück, Freitext am Tablet
```

> Die E2E-Tests starten je einen eigenen Server (Ports 4095–4099) und räumen
> ihn über die Prozessgruppe wieder ab. Bleibt nach einem harten Abbruch doch
> einmal etwas stehen: `pkill -f "server/index.ts"`.

---

## 👨‍👩‍👧‍👦 Zu viert an einem Tablet (Pass & Play)

Neben dem Online-Modus lässt sich **an einem einzigen Gerät** spielen: Tablet
in die Tischmitte, alle sitzen drumherum, das Gerät wandert reihum. Auf der
Startseite beim gewünschten Spiel auf **„📱 Am Gerät spielen"** tippen,
Namen eintragen, los. Alle vier Spiele können das.

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
| **🪑 Feste Plätze** | Das Gerät liegt in der Tischmitte, jeder sitzt an einer Kante (unten / rechts / oben / links). |

**Das Spielfeld bleibt liegen, die Bedienung dreht sich.** Ein Brett liegt auf
dem Tisch und bleibt liegen; was sich zum Spieler dreht, ist das, womit er
hantiert. Genau das macht der **Sitz-Dock**: Würfel, Knöpfe, Frage und die
letzte Protokollzeile erscheinen an der Kante dessen, der dran ist, und sind zu
ihm gedreht — wie ein Zettel, den man ihm hinschiebt.

Bei Monopoly und Trivial Pursuit liegt das Dock dabei an der **rechten Hand**
des Spielers, nicht mittig vor ihm: wer unten sitzt, hat es rechts unten; wer
oben sitzt, links oben. So bleibt die Brettmitte frei — verdeckt wird
höchstens eine Ecke (beim runden Rad praktisch gar nichts). Bei Poker hängt es
mittig an der Kante, denn darunter liegt nur der eigene Sitz.

| Spiel | Was liegt | Was sich dreht |
|---|---|---|
| 🎲 **Monopoly** | das Brett | Würfel, Aktionsknöpfe, Geldübersicht, letzte Zeile |
| 🃏 **Poker** | Filz und Sitzkranz | die Aktionsleiste (Karten + Check/Call/Raise); jede Sitzbox zeigt zu ihrem Spieler |
| 🧀 **Trivial Pursuit** | das Rad | Frage, Antwortmöglichkeiten, Würfel, Zielreihe |

Bei festen Plätzen wird der Bildschirm zum Tisch: die Seitenspalten
verschwinden, das Spielfeld wird so groß wie möglich, und Verlauf, Chat und
Spielerliste liegen hinter dem 📜 oben rechts. Bei Poker sitzt außerdem jeder
an seiner **echten** Kante (der Winkel kommt dann aus der Sitzwahl statt aus
dem Index) und der Filz wird rund statt breit-oval.

Feste Plätze gehen bis vier Spieler – ein Tisch hat vier Kanten. Der Text auf
den Brettfeldern wird bewusst **nicht** gegengedreht: bei 180° liest das Brett
für die Gegenübersitzenden kopfüber, genau wie ein echtes Brett.

Bei **Jeopardy** entfällt die Wahl, und das Setup sagt auch warum: Alle lesen
dieselbe Frage, sie zu einem Einzelnen zu drehen machte sie für die anderen
unlesbar. Ob ein Spiel etwas davon hat, steht als `caps.rotatesToActor` an
seinem Modul – so kann kein Schalter dastehen, der nichts tut.

Was **nicht** mitdreht: Toasts, Dialoge und die Kopfzeile. Sie hängen an
`position: fixed` und an Viewport-Einheiten, die sich immer auf den physischen
Bildschirm beziehen – in einem gedrehten Vorfahren verlören sie ihre
Verankerung. Wer in den Verlauf schaut, lehnt sich hinüber.

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

### 📚 Fragenpakete (Jeopardy & Trivial Pursuit)

Über die Fußzeile der Startseite erreichbar. Ein Paket besteht aus sechs
Kategorien (die klassischen Trivial-Pursuit-Farben) × fünf Schwierigkeits-
stufen. Mitgeliefert sind 300 deutsche Fragen; eigene Pakete lassen sich
anlegen, als JSON aus- und wieder einlesen und – auch offline – im Browser
speichern.

Das Abdeckungsraster im Editor ist zugleich die Jeopardy-Brettvorschau: Ein
Paket ist bespielbar, wenn **jedes** Fach mindestens vier **verschiedene
Antworten** hat. Nicht vier Fragen – zwei Fragen mit derselben Lösung liefern
nur einen Ablenker, und Trivial Pursuit zieht seine falschen
Antwortmöglichkeiten aus den übrigen Antworten desselben Fachs. Wo beides
auseinanderfällt, zeigt das Raster beide Zahlen.

---

## 🎯 Jeopardy

- **2–8 Spieler**, Brett aus **sechs Kategorien × fünf Stufen** = 30 Feldern
- Fragen aus dem gewählten **Fragenpaket** (mitgeliefert: 300 deutsche Fragen);
  gezogen wird erst beim Anklicken eines Feldes, also ist dasselbe Brett
  wiederspielbar
- **Frei geantwortet**, nicht angekreuzt – und **die Mitspieler werten**.
  Der Server rechnet vorher einen Vorschlag (normalisierter Vergleich mit
  Tippfehlertoleranz gegen die Antwort und ihre Alternativschreibweisen) und
  zeigt ihn vorausgewählt; meist ist die Wertung damit ein bestätigender Tipp.
  Mehrheit entscheidet, Gleichstand geht zugunsten des Spielers.
- **Richtig**: Punkte und man wählt weiter. **Falsch**: Abzug (abschaltbar),
  gesperrt, und der Buzzer geht für die übrigen wieder auf.
- Uhren für Vorlesezeit, Buzzer, Antwort und Wertung – alle einstellbar

### 🖥 Brett auf dem Fernseher, Buzzer auf den Handys

Das ist der eigentliche Modus. Ein zusätzliches Gerät (Fernseher, Laptop,
Tablet) tritt mit demselben Raum-Code bei, während das Spiel schon läuft, und
wird damit **Zuschauer**: Es zeigt Brett, Frage und Punktestände groß. Die
Spieler haben auf dem Handy einen bildschirmfüllenden Buzzer – und sonst fast
nichts. Wer am Zug ist, bekommt statt dessen das Brett zum Auswählen.

Spieler auf einem großen Bildschirm können mit 🖥 / 📱 zwischen beiden
Ansichten umschalten.

### 🎙 Moderiert: die Sendung mit einem Host

Beim Anlegen des Raums lässt sich **„Ich moderiere nur"** ankreuzen. Dann
spielt der Ersteller nicht mit, sondern führt durch die Sendung — das Format,
für das Jeopardy gemacht ist:

- **Sein Bildschirm ist die Sendung.** Keine Seitenspalte, kein Chat: Brett und
  Punktestände füllen die Fläche, und läuft eine Frage, steht sie
  formatfüllend in der Mitte. Der Fernseher ist also nicht mehr ein
  zusätzliches Zuschauergerät, sondern sein eigenes.
- **Er wählt die Felder.** Wer richtig lag, darf sich weiterhin eins wünschen —
  das steht ihm oben als Hinweis da, angeklickt wird es von ihm.
- **Er liest vor und macht den Buzzer auf.** Die Vorlesezeit-Uhr entfällt: Die
  Frage steht, so lange er braucht.
- **Er wertet allein**, mit ✓ und ✗ in der Leiste unten und dem
  Vorschlag vorausgewählt. Die Abstimmung unter den Mitspielern entfällt.
- **Er bekommt keine Punkte**, hat keinen Buzzer, steht nicht in der
  Punktetafel und zählt nicht zur Mindestspielerzahl — zwei Mitspieler reichen,
  auch wenn drei Leute im Raum sind.

Auf den Handys ändert sich nichts: großer Buzzer, Antwortfeld, sonst nichts.

Technisch ist der Moderator **ein Sitz mit einer Markierung** und kein
Raum-Feld. Das ist Absicht: Host-Rechte, Host-Übergang, Rauswerfen und die
öffentliche Raumliste hängen alle daran, dass der Host in `seats()` steht.
Was der Moderator *nicht* tut, entscheidet das Spiel, nicht die Plattform.

Trennt er die Verbindung, gelten wieder die normalen Regeln — sonst stünde die
Sendung still, weil nur er ein Feld wählen dürfte.

### Das Buzzer-Rennen

„Erste Nachricht gewinnt" bestraft nur das schlechtere WLAN: Der Jitter
zwischen zwei Handys im Heimnetz ist regelmäßig größer als der Unterschied
menschlicher Reaktionszeiten. Deshalb:

1. Der erste eintreffende Buzz eröffnet ein Fenster von **150 ms**.
2. Entschieden wird danach nach der **Reaktionszeit** – der Zeit von
   „Buzzer sichtbar offen" bis zum Tastendruck, die jedes Gerät für sich
   misst. Damit fällt die Laufzeit in beide Richtungen heraus, ganz ohne
   Uhrenabgleich.
3. Der Server deckelt die gemeldete Zeit nach unten auf 120 ms (schneller
   reagiert kein Mensch) und nach oben auf die selbst gemessene Spanne.

Ehrlich dazu: Gegen jemanden, der seinen Client umbaut, hilft das nicht, und
ein Wettkampf-Buzzer ist es nicht. Für einen Spieleabend reicht es.

### Am gemeinsamen Gerät

Gleichzeitig buzzern geht auf einem Tablet nicht. Stattdessen wie am echten
Spieltisch: Die Frage erscheint, alle rufen – und wer vorgelesen hat, tippt
auf den **Namen** dessen, der zuerst dran war. Gewertet wird mit einem Tipp,
und es läuft keine Uhr mit. Feste Sitzplätze gibt es hier bewusst nicht: Alle
lesen dieselbe Frage, und sie zu einem Einzelnen zu drehen machte sie für die
anderen unlesbar.

### Bewusst noch nicht drin

**Double Jeopardy** (zweite Runde mit doppelten Werten) und **Final Jeopardy**
(verdeckte Einsätze) fehlen. Wetten heißen eine weitere Redaktionsschicht pro
Empfänger; die Grundrunde ist für sich ein vollständiges Spiel.

---

## 🧀 Trivial Pursuit

- **2–6 Spieler**, volles Rad: **42 Felder im Ring**, sechs Speichen zu je fünf
  Feldern, eine Nabe = **73 Felder**
- **Ein Würfel.** Gewürfelt wird, dann sucht man sich unter den erreichbaren
  Feldern eines aus – an Abzweigungen entscheidest du, nur umdrehen ist mitten
  im Zug verboten
- **Richtig geantwortet heißt: nochmal würfeln.** Falsch: der Nächste ist dran
- Auf einer **Käse-Ecke** bringt eine richtige Antwort das Käsestück dieser
  Farbe (jede Farbe nur einmal)
- Wer alle Käsestücke hat, muss die **Mitte exakt treffen**; dann bestimmen die
  Mitspieler per Abstimmung die Farbe der Schlussfrage. Richtig = gewonnen,
  falsch = weiterspielen und erneut versuchen
- **Ankreuzen oder frei antworten**: Vorgabe sind vier Möglichkeiten je Frage –
  bei einer Frage pro Feld und 45 bis 90 Minuten hält das das Tempo. Ein
  Regelschalter stellt auf Freitext um; dann werten die Mitspieler wie bei
  Jeopardy, mit vorausgewähltem Vorschlag.
- Einstellbar: Fragenpaket, **Käsestücke zum Sieg** (3–6, für kürzere Partien),
  Schwierigkeit, Bedenkzeiten

### Das Brett wird erzeugt, nicht geschrieben

`buildWheel()` in `shared/pursuit/board.ts` liefert alle 73 Knoten samt
Nachbarschaften und Polarkoordinaten aus rund achtzig Zeilen. Es gibt **keine
handgepflegte Feldliste**, die auseinanderlaufen könnte – und weil die
Funktion deterministisch ist und in `shared/` liegt, baut der Client dasselbe
Rad selbst. Das Brett wandert nie über die Leitung; im Spielzustand stehen nur
Positions-Indizes.

Die Farbverteilung geht dabei rechnerisch auf: 42 = 6 · 7, jede Farbe käme
siebenmal vor – abzüglich je einer Käse-Ecke und eines Freiwurfs liegt jede
Farbe **genau fünfmal** im Ring. Das ist der Grund für die 42.

Bewegung ist eine Tiefensuche über genau *n* Kanten mit einer Sperre gegen die
sofortige Kehrtwende. Zwei Regeln fallen daraus von selbst heraus: die Mitte
**muss exakt getroffen werden** (sie ist im Ergebnis oder nicht), und man darf
**durch die Mitte hindurch** in eine andere Speiche – sie ist ein normaler
Knoten mit sechs Nachbarn. Festsitzen kann niemand: kein Feld hat nur einen
Nachbarn.

### 🖥 Rad auf dem Fernseher, Würfel auf den Handys

Wie bei Jeopardy: ein zusätzliches Gerät tritt mit demselben Raum-Code der
laufenden Partie bei und zeigt das Rad groß. Die erreichbaren Felder werden
dabei **für alle** hervorgehoben und durchnummeriert – am Fernseher soll man
sehen, worüber gerade nachgedacht wird –, antippen darf sie nur, wer am Zug
ist. Dieselben Ziffern stehen auf der Knopfreihe im Aktionspanel: SVG-Pfade
sind keine Knöpfe, und zwei Ziele derselben Farbe wären sonst nicht
auseinanderzuhalten.

Am gemeinsamen Gerät dreht sich das Rad zu dem, der am Zug ist. Die Frage steht
in der Seitenspalte und bleibt aufrecht – so wie bei Monopoly auch. Wen das
stört, wählt „Weiterreichen".

### Bewusst nicht drin

Kein Verfolgungsfeld, keine Sonderwürfe. Die Mitte ohne alle Käsestücke stellt
eine Frage aus einer zufälligen Farbe, statt ein totes Feld zu sein.

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
  jeopardy/module.ts Jeopardy als Plattform-Modul (dünner Adapter)
  pursuit/module.ts  Trivial Pursuit als Plattform-Modul (dünner Adapter)
  trivia/text.ts     Normalisieren und Levenshtein – ohne Abhängigkeiten
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
  jeopardy/
    types.ts         Jeopardy-Typen: JeopardyState, Brett, laufende Frage, Aktionen
    engine.ts        Brett, Buzzer-Rennen, freie Antwort, Wertung, Punkte
    rules.ts         Jeopardy-Raumoptionen, Gnadenfenster, Reaktionszeit-Grenzen
  pursuit/
    board.ts         Das Rad: buildWheel() erzeugt 73 Knoten, reachable() bewegt
    types.ts         Trivial-Pursuit-Typen: Zustand, Zugphasen, Aktionen
    engine.ts        Würfeln, Ziehen, Käsestücke, Schlussfrage, Wertung
    rules.ts         Raumoptionen, Lesepausen, Gnadenfrist für Getrennte

server/            Node.js + Express + Socket.io
  index.ts           HTTP-Server, liefert client/dist aus (BASE_PATH-fähig)
  rooms.ts           Plattform: Räume (je 1 Spiel), Spieler/Zuschauer, Lobby-Chat,
                     öffentliche Raumliste, Raum-Timer, redigierte Broadcasts
  store.ts           Persistenz: Editionen, Spielstände & Fragenpakete (./data, JSON)

client/            React 18 + TypeScript + Vite + zustand
  pages/             Home (Lobby), Room (Wartezimmer), JoinRoom (Link-Beitritt)
  games/monopoly/    Board, GameTable, Panels, Dialoge, AdminPanel
  games/poker/       PokerTable (Tisch, Sitze, Action-Bar), PlayingCard
  games/jeopardy/    JeopardyTable (Brett-/Handy-Ansicht), Board, Clue
  games/pursuit/     Wheel (das Rad als SVG), Wedges, Panels, PursuitTable
  games/trivia/      PackEditor (Fragenpakete anlegen und bearbeiten)
  components/        Chat, Modal, Toasts (spielübergreifend)
  hooks/             useHashRoute (teilbare #/room/CODE-Links)
  net/index.ts       Transport-Router: leitet je nach Modus um
  net/socket.ts      Online: Socket-Verbindung, Request/Response, Reconnect
  net/localRoom.ts   Lokal: Raum-Logik im Browser (DOM-frei, testbar)
  net/local.ts       Lokal: Verdrahtung mit Store und localStorage
  pages/LocalSetup   Setup für eine Partie am gemeinsamen Gerät
  state/store.ts     zentraler App-State (RoomEnvelope vom Server)

tests/
  engine.test.ts      30 Unit-Tests Monopoly-Regeln inkl. Auktionen (node:test)
  poker.test.ts       19 Unit-Tests Poker (Rankings, Side-Pots, Blinds, Timeouts)
  local-room.test.ts  27 Unit-Tests lokaler Raum: Sitzrotation, Klon-Vertrag, Redaction
  trivia.test.ts      18 Unit-Tests Fragenformat, Ablenker, mitgeliefertes Paket
  jeopardy.test.ts    39 Unit-Tests Jeopardy: Buzzer-Rennen, Sperre, Wertung, Moderator
  pursuit.test.ts     43 Unit-Tests Trivial Pursuit: Wegenetz, Bewegung, Käse, Finale
  e2e.ts              Browser-E2E Monopoly: 2 Spieler, Link-Beitritt, echtes Spiel
  e2e-poker.ts        Browser-E2E Poker: Showdown, Raise/Fold, Redaction, Zuschauer
  e2e-local.ts        Browser-E2E Pass & Play – mit abgeschaltetem Netz
  e2e-jeopardy.ts     Browser-E2E Jeopardy: Fernseher, Moderator, zwei Handys, lokal
  e2e-pursuit.ts      Browser-E2E Trivial Pursuit: Rad, Käsestück, Freitext lokal
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
  durchgefallen wäre. Jeopardy und Trivial Pursuit waren die Probe aufs
  Exempel: Der Compiler hat jedes Mal jede fehlende Stelle benannt, statt sie
  stumm als Poker zu rendern.
- **Inhalt liegt nicht im Zustand, wenn er geheim sein soll**: Monopoly bettet
  seine Edition ein, damit Spielstände autark sind. Jeopardy tut das mit dem
  Fragenpaket bewusst NICHT – es hat keine Spielstände, und die Antworten
  lägen sonst in den Entwicklerwerkzeugen jedes Clients offen. Gespeichert ist
  nur die Paket-ID; jede Frage wird zur Laufzeit über `GameDeps` nachgeschlagen.
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
