# VereinOrder - Raspberry Pi Setup & Offline-Festbetrieb

Dieses Dokument beschreibt die Inbetriebnahme von **VereinOrder** auf einem **Raspberry Pi 4 oder 5** mit **Raspberry Pi OS 64-Bit** für den 100% offlinefähigen Festbetrieb ohne Internetverbindung.

---

## 1. Voraussetzungen

- **Hardware**: Raspberry Pi 4 (ab 4 GB RAM) oder Raspberry Pi 5.
- **Speichermedium**: Schnelle microSD-Karte (mind. 32 GB, A2-Klasse) oder externe USB-3.0-SSD.
- **Betriebssystem**: Raspberry Pi OS Lite (64-bit).
- **Netzwerk**: Eigenes Festzelt-WLAN (z. B. über Access Point oder Raspberry Pi internen Hotspot).

---

## 2. Betriebssystem vorbereiten & Docker installieren

Nach dem Flashen der SD-Karte mit dem _Raspberry Pi Imager_:

```bash
# System aktualisieren
sudo apt update && sudo apt upgrade -y

# Docker installieren
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Benutzer 'pi' zur Docker-Gruppe hinzufügen
sudo usermod -aG docker $USER
newgrp docker
```

---

## 3. VereinOrder bereitstellen

```bash
# Projektverzeichnis anlegen
mkdir -p ~/vereinorder && cd ~/vereinorder

# Repository klonen
git clone https://github.com/MKU-Solution/VereinOrder.git .

# Umgebungsvariablen anlegen (mindestens ein sicheres POSTGRES_PASSWORD eintragen)
cp .env.example .env

# Stack im Hintergrund starten
docker compose up -d
```

Der Entrypoint des Backend-Abbilds bringt die Datenbank beim ersten Start automatisch auf
den aktuellen Migrationsstand — dafür ist kein Befehl auf der Konsole des Servers nötig.
Anschließend im Browser `http://<IP-des-Raspberry-Pi>/` öffnen: Solange noch kein
Benutzer angelegt ist, führt die Anwendung direkt zur Ersteinrichtung. Dort wird das
erste Administrator-Konto angelegt, und man ist danach unmittelbar angemeldet.

**Wichtig:** Solange die Ersteinrichtung aussteht, wird Administrator, wer zuerst darauf
zugreift. Schließe sie deshalb ab, **bevor** du das Gäste-WLAN öffnest — der Hinweis
steht seit der Ersteinrichtung selbst auch dauerhaft im Assistenten.

### Aktualisierung eines laufenden Systems

Die maßgebliche Beschreibung des Aktualisierungswegs steht in
[`betrieb-wartung.md`](./betrieb-wartung.md), Kapitel 4 ("Updates & Rollback"). Hier nur
das, was für den Raspberry Pi als Zielgerät besonders gilt.

Für ein bereits eingerichtetes System — nicht für den ersten Start — läuft eine
Aktualisierung ausschließlich über den abgesicherten Betriebsweg. Das Skript nimmt die
neuen Abbilder dabei selbst in Betrieb (#199); auf dem Server wird **kein** eigenes
`docker compose up -d` oder `--build` davor oder danach ausgeführt:

```bash
export ADMIN_TOKEN='<aktuelles Administrator-JWT>'
./scripts/ops/upgrade.sh
```

**`ADMIN_TOKEN` wird VOR dem Aufruf geholt, gegen das noch laufende, alte System** — das
ist gegenüber früheren Fassungen dieser Anleitung umgekehrt. Das Skript braucht das
Token bereits für den allerersten Schritt, um den Wartungsmodus zu setzen; der Neubau
folgt erst danach als Teil des Skripts selbst, nicht mehr vorab von Hand.

**Seit #200 wird auf dem Pi nichts mehr gebaut.** Das Skript zieht die fertigen
Abbilder mit `docker compose pull` aus der Registry — dieselben, die die CI für `arm64`
ohnehin baut und bisher weggeworfen hat. Vorher zwang jede Aktualisierung das Gerät, das
gleichzeitig Bestellungen bedient, zu bis zu sechs `pnpm install`-Läufen und setzte eine
erreichbare npm-Registry voraus.

Damit braucht der Pi **zum Zeitpunkt der Aktualisierung** eine Verbindung zu
`ghcr.io` — im laufenden Festbetrieb weiterhin nicht. Zugangsdaten braucht er keine: Die
drei Pakete sind öffentlich.

Wer ohne Registry arbeiten muss — ein Stand, der nie nach `main` gelangt ist, oder ein
Gerät ganz ohne Netz —, ruft dasselbe Skript mit `VEREINORDER_BUILD=1` auf und bekommt
den bisherigen örtlichen Bau:

```bash
export ADMIN_TOKEN='<aktuelles Administrator-JWT>'
VEREINORDER_BUILD=1 ./scripts/ops/upgrade.sh
```

Der Ablauf ist damit ein einziger Befehl: Wartungsmodus setzen, eine geprüfte
`PRE_MIGRATION`-Sicherung erzeugen — beides **vor** jeder Schemaänderung —, danach die
neuen Abbilder ziehen und starten. Die automatische Migration im Entrypoint
(`apps/backend/docker-entrypoint.sh`, #172) bleibt dabei unverändert eingeschaltet und
läuft dadurch genau im geschützten Fenster zwischen Sperre und Sicherung einerseits und
der Wiederöffnung andererseits. Danach wartet das Skript mit Zeitgrenze auf ein wieder
antwortendes Backend, kontrolliert `prisma migrate status` und öffnet das System erst
nach Erfolg wieder. Details und der Notfall-Restore stehen in
[`docs/ops/backup-recovery.md`](./backup-recovery.md).

**Schlägt ein Schritt fehl, bleibt das System absichtlich im Wartungsmodus gesperrt.**
Das Skript gibt dabei aus, welcher Schritt betroffen war und wie man — nach Klärung der
Ursache — wieder herauskommt; es öffnet den Wartungsmodus im Fehlerfall nie von selbst.

Schlägt das Ziehen fehl — kein Netz, oder eine in `VEREINORDER_VERSION` gepinnte
Fassung, die es nicht gibt —, bricht das Skript ab, **bevor** irgendetwas ausgetauscht
wurde, und lässt das System gesperrt. Die Meldung nennt beide Auswege.

**Sonderfall Installationen von vor #175:** Lief die bisherige Installation ohne
gesetztes `JWT_SECRET`, erzeugt der Austausch in Schritt 4 einen neuen Schlüssel — das
eingangs geholte `ADMIN_TOKEN` wird dadurch ungültig, und das abschließende Entsperren
scheitert vorhersehbar mit 401, obwohl Sicherung und Migration bereits erfolgreich
gelaufen sind. Das Skript erkennt diesen Fall vorab (bevor der Neubau überhaupt
angestoßen wird) an einer fehlenden, dauerhaft hinterlegten `JWT_SECRET` und warnt
davor; bleibt das abschließende Entsperren dennoch am ungültig gewordenen Token hängen,
nennt die Fehlermeldung des Skripts den Weg heraus: neu anmelden und
`POST /maintenance/end` von Hand mit dem frischen Token nachholen.

---

## 4. Ausfallsicherheit bei Stromausfall

Alle Container sind mit `restart: always` konfiguriert.

- Nach einem plötzlichen Stromausfall (z. B. Notstromaggregat-Umschaltung) startet der Raspberry Pi automatisch neu.
- Docker initialisiert PostgreSQL, Backend, Frontend und Print-Worker.
- Nach ca. 20–30 Sekunden ist das Kassensystem wieder unter `http://<IP-des-Raspberry-Pi>` erreichbar.
- Alle bis zum Ausfall getätigten Buchungen bleiben dank persistenter PostgreSQL-Volumes und atomarer Transaktionen vollständig erhalten.

---

## 5. USB-Bondrucker am Raspberry Pi

USB-Bondrucker (z.B. Epson TM-T20, Bixolon, Munbyn) werden automatisch als `/dev/usb/lp0` erkannt.

1. Drucker per USB verbinden:
   ```bash
   ls -la /dev/usb/lp*
   ```
2. In der Administration (`/admin` -> Tab _Drucker & Bon-Routing_) den Druckertyp `ESC_POS_USB` auswählen.

**Ausführliche Anleitung:** Der USB-Bondrucker wird auf dem Pi über CUPS als Raw-Queue
betrieben und in der Verwaltung als Druckertyp `CUPS_IPP` angelegt (nicht direkt über
`/dev/usb/lp*`). Installation, Härtung von CUPS, Einrichtung der Raw-Queue, stabile
Geräteidentität beim Wiedereinstecken, Ersatzdrucker-Zuordnung, Austausch im laufenden
Betrieb und Fehlersuche stehen vollständig in
[`docs/ops/druckerbetrieb.md`](./druckerbetrieb.md).

---

## 6. Offline-Betrieb & WLAN-Access-Point

Im Festbetrieb ist keine Verbindung zum öffentlichen Internet erforderlich. Die Kellner-Handys verbinden sich direkt mit dem lokalen WLAN des Festzelts und rufen im Browser `http://vereinorder.local` oder die IP-Adresse des Raspberry Pi auf.

## 7. Datensicherung vor dem Fest

Auf dem ARM64-Gerät mindestens eine native Sicherung erstellen, die vollständige
Wiederherstellungsprüfung ausführen und einen kontrollierten Backend-Neustart im
Wartungsmodus testen. Dump und Manifest gemeinsam auf einen geschützten zweiten
Datenträger kopieren. Der vollständige Ablauf einschließlich Rücknahme steht im
Backup-Handbuch.
