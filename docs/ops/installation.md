# Installationsanleitung für VereinOrder

Dieses Dokument beschreibt die Installation von VereinOrder für den Festbetrieb über **Docker Compose** auf Standard-Linux-Servern, Mini-PCs und Laptops.

---

## 1. Systemvoraussetzungen

- **Betriebssystem:** Linux (Debian 12 / Ubuntu 22.04+ / Raspberry Pi OS 64-Bit), Windows 10/11 (mit WSL2/Docker) oder macOS.
- **Architektur:** AMD64 (x86_64) oder ARM64 (aarch64).
- **Arbeitsspeicher:** Mindestens 2 GB RAM (4 GB empfohlen für > 30 gleichzeitige Geräte).
- **Speicherplatz:** Mindestens 10 GB freier SSD-/SD-Kartenspeicher.
- **Software:** Docker Engine 24+ und Docker Compose Plugin (V2).

---

## 2. Standard-Installation mit Docker Compose

### Schritt 1: Repository klonen oder Release herunterladen

```bash
git clone https://github.com/seipekm/VereinOrder.git /opt/vereinorder
cd /opt/vereinorder
```

### Schritt 2: Umgebungsvariablen anpassen

Kopiere die Vorlage `.env.example` nach `.env`:

```bash
cp .env.example .env
```

Trage mindestens ein sicheres `POSTGRES_PASSWORD` ein (z. B. mit `openssl rand -hex 32`
erzeugt); der mitgelieferte Beispielwert taugt nicht für den Festbetrieb. `JWT_SECRET`
und `PRINT_WORKER_TOKEN` bleiben leer: Das Backend erzeugt beide beim ersten Start selbst
und legt sie unter `STATE_DIR` ab (siehe [Umgebungsvariablen](./umgebungsvariablen.md)).

### Schritt 3: Container bauen und starten

```bash
docker compose up -d --build
```

### Schritt 4: Status und Logs prüfen

```bash
docker compose ps
docker compose logs -f backend
```

---

## 3. Bereitgestellte Dienste & Ports

| Dienst           | Compose-Name   | Host-Port (Vorgabe) | Variable        | Beschreibung                                                                                                       |
| ---------------- | -------------- | ------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Frontend**     | `frontend`     | `80`                | `FRONTEND_PORT` | Nginx Webserver mit React PWA. Im Container lauscht er auf `8080`, siehe unten                                     |
| **Backend**      | `backend`      | `3000`              | `BACKEND_PORT`  | NestJS REST-API & SSE-Echtzeitstream                                                                               |
| **Datenbank**    | `postgres`     | `127.0.0.1:5432`    | `POSTGRES_PORT` | PostgreSQL 16. Bewusst nur auf der Loopback-Adresse veroeffentlicht und damit aus dem Netz nicht erreichbar (#181) |
| **Druck-Worker** | `print-worker` | -                   | -               | Asynchroner Druckauftragsprozessor                                                                                 |

Die Host-Ports sind seit #185 **Vorgaben, keine Festlegungen**: Ist einer davon auf dem
Rechner belegt, setzt man die Variable in der `.env` und startet neu – ohne
`docker-compose.yml` anzufassen und ohne Override-Datei. Fest bleibt allein die Bindung
der Datenbank an `127.0.0.1`; das ist die Entscheidung aus #181 und keine Vorgabe.

### Container ansprechen

Seit #185 vergibt `docker-compose.yml` **keine festen Containernamen** mehr. Ein solcher
Name gilt je Docker-Dienst, nicht je Compose-Projekt – ein zweites Bündel auf demselben
Rechner scheiterte daran selbst bei völlig freien Ports, und `COMPOSE_PROJECT_NAME` blieb
wirkungslos. Beides ist jetzt möglich, aber ein zweites Bündel braucht mehr als einen
Projektnamen: siehe die Warnung weiter unten.

Angesprochen werden die Container über ihren **Compose-Namen** aus der Spalte oben, nicht
über einen geratenen Containernamen:

```bash
docker compose ps
docker compose logs -f backend
docker compose exec backend sh
docker compose restart print-worker
```

Diese Form ist ohnehin die robustere, weil sie vom Projektnamen unabhängig ist. Sie
setzt voraus, dass man im Verzeichnis mit der `docker-compose.yml` steht – von woanders
aus hilft `docker compose --project-directory /pfad/zum/repo …`.

### Ein zweites Bündel auf demselben Rechner

> **Warnung.** Ein zweiter Projektname allein genügt **nicht**. Die Volumes tragen feste
> Namen (`vereinorder_postgres_data` und die beiden anderen), und ein Volumename gilt –
> wie früher der Containername – je Docker-Dienst, nicht je Compose-Projekt. Ohne
> geänderte Volumenamen hängen beide Bündel **dieselben** Volumes ein: Ein zweiter
> PostgreSQL-Server nimmt dasselbe Datenverzeichnis in Betrieb, während der erste noch
> läuft. Die Sperrdatei `postmaster.pid` verhindert das nicht – jeder Container hat
> seinen eigenen PID-Namensraum, der zweite Server hält die Sperre für verwaist und
> räumt sie weg. Nachgemessen: Der zweite Server führte eine Wiederherstellung auf dem
> laufenden Datenverzeichnis aus und meldete sich als bereit.

Vollständig getrennt läuft ein zweites Bündel deshalb nur so – Projektname, alle drei
Ports **und** alle drei Volumenamen:

```bash
POSTGRES_PORT=25432 BACKEND_PORT=23000 FRONTEND_PORT=28080 \
POSTGRES_DATA_VOLUME=probe_postgres_data \
BACKUP_DATA_VOLUME=probe_backup_data \
STATE_DATA_VOLUME=probe_state_data \
docker compose -p vereinorder-probe up -d
```

Wer das nur einmal braucht, ist mit einem eigenen Verzeichnis und einer eigenen `.env`
besser bedient als mit einer langen Befehlszeile.

### Benutzerrechte in den Containern (#180)

Keiner der drei selbst gebauten Dienste läuft noch als `root`:

| Dienst         | Benutzer im Container | Uid    |
| -------------- | --------------------- | ------ |
| `backend`      | `node`                | `1000` |
| `frontend`     | `nginx`               | `101`  |
| `print-worker` | `node`                | `1000` |

Zwei Folgen davon sind im Betrieb sichtbar:

- **Der Containerport des Frontends ist `8080`, nicht `80`.** Ein unprivilegierter
  Prozess kann keinen Port unterhalb von 1024 binden. Am Host bleibt es bei `80`;
  `docker-compose.yml` bildet `80` auf `8080` ab. Für den Zugriff ändert sich nichts.
- **Die Dateien in den Volumes `vereinorder_backup_data` und `vereinorder_state_data`
  gehören dem Benutzer `node` (uid 1000).** In einer Installation, die vor #180
  angelegt wurde, gehören sie noch `root`. Der Entrypoint des Backend-Abbilds
  übereignet sie deshalb beim ersten Start nach dem Update ein einziges Mal und
  protokolliert das mit der Zeile
  `docker-entrypoint: uebereigne /app/backups an node (einmalig, #180).` Es ist kein
  Handgriff nötig, und ab dem nächsten Start unterbleibt der Schritt.

Der Datenbankcontainer ist davon nicht betroffen: Das PostgreSQL-Abbild bringt seine
eigene Benutzerbehandlung mit und wird nicht angefasst.

### Bereitschaftszustand der Dienste (#184)

`backend` und `frontend` melden Docker seit #184 einen Zustand; `docker compose ps`
zeigt ihn in der Spalte **Status** als `healthy` oder `unhealthy` an.

Das Backend prüft dafür `GET /health`. Der Weg ist **unangemeldet** erreichbar – ein
Healthcheck im Container hat keine Anmeldedaten – und antwortet mit genau einem von
zwei Rümpfen:

| Antwort                        | Bedeutung                                                             |
| ------------------------------ | --------------------------------------------------------------------- |
| `200 {"status":"ok"}`          | Die Anwendung läuft, und das Schema in der Datenbank ist ansprechbar. |
| `503 {"status":"unavailable"}` | Eines von beidem trifft nicht zu.                                     |

Mehr gibt der Weg nicht preis: keine Verbindungszeichenfolge, keinen Migrationsstand,
keine Fehlermeldung der Datenbank. Er liegt im Festbetrieb im selben WLAN wie die
Bediengeräte und die Gäste. Welche der beiden Ursachen vorliegt, steht im
Containerprotokoll (`docker compose logs backend`, Zeile
`Bereitschaftsprüfung fehlgeschlagen (Prisma-Code …)`) – `P1001` heißt „Datenbank nicht
erreichbar", `P2021` „Tabelle fehlt". Einzelheiten für Angemeldete liefert wie bisher
`GET /diagnostics/status` hinter einem Administrator-Token.

Über nginx ist der Weg als `http://<SERVER-IP>/api/health` erreichbar, ohne dass der
Backend-Port bekannt sein muss.

Zwei Punkte, die im Betrieb regelmäßig für Rückfragen sorgen:

- **`unhealthy` löst keinen Neustart aus.** `restart: always` reagiert auf das Ende des
  Prozesses, nicht auf den Gesundheitszustand; das täte nur Docker Swarm. Ein Backend
  ohne Datenbank bleibt also stehen und meldet `unhealthy`, bis die Datenbank
  zurückkommt – dann wird es von selbst wieder `healthy`.
- **Das Frontend wartet bewusst nicht auf ein gesundes Backend**, nur auf ein
  gestartetes. Es ist ein statischer Dateiserver und braucht das Backend zum Ausliefern
  der Oberfläche nicht. Andernfalls lieferte der Server bei einem Kaltstart mit kaputter
  Datenbank überhaupt keine Seite aus – ausgerechnet dann, wenn jemand am Gerät
  nachsehen will. Der Print-Worker wartet dagegen sehr wohl auf `healthy`: Ohne
  antwortendes Backend hat er nichts zu tun und füllte sein Protokoll bisher mit
  Fehlern, die keine waren.

Der erste Start darf lange dauern: Der Entrypoint bringt die Datenbank vor dem
Anwendungsstart auf den Migrationsstand. Die `start_period` des Healthchecks ist
deshalb auf drei Minuten gesetzt; währenddessen zählt keine fehlgeschlagene Prüfung.

An den Rechten der Sicherungsdateien ändert sich nichts: Sie bleiben `0600` in einem
Verzeichnis mit `0700` (`apps/backend/src/backup/native-backup.service.ts`), nur der
Eigentümer wechselt von `root` auf `node`. Der in `docs/ops/backup-recovery.md`
beschriebene Weg über den Datenbankcontainer (`docker compose exec postgres ...`)
läuft als `root` und erreicht sie unverändert.

### Woher die Abbilder kommen (#200)

`backend`, `frontend` und `print-worker` tragen in `docker-compose.yml` **beides**: ein
`image:` aus der Registry und ein `build:`. Was davon greift, hängt vom Befehl ab:

| Befehl                         | Wirkung                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `docker compose up -d`         | Baut örtlich, wenn das Abbild fehlt. Zieht **nicht** von sich aus. |
| `docker compose pull`          | Holt die fertigen Abbilder aus `ghcr.io`.                          |
| `docker compose up -d --build` | Baut immer neu. Der Weg für Entwicklung und CI.                    |

Für die **Aktualisierung im Festbetrieb** zieht `scripts/ops/upgrade.sh` seit #200
fertige Abbilder, statt auf dem Raspberry Pi zu bauen — Einzelheiten im
[Raspberry-Pi-Setup](./raspberry-pi-setup.md). Die drei Pakete sind öffentlich, der Pi
braucht also keine Zugangsdaten.

`VEREINORDER_VERSION` wählt die Fassung: ohne Angabe `latest` (der letzte vollständig
grüne Stand von `main`), sonst eine Commit-SHA. Vor einem Fest ist das Pinnen einer
geprüften Fassung die sicherere Wahl.

> **Einmalig nach dem allerersten Veröffentlichungslauf:** GitHub legt neue Pakete
> zunächst **privat** an. Die drei Pakete unter
> `https://github.com/seipekm?tab=packages` müssen einmal auf **Public** gestellt
> werden, sonst scheitert `docker compose pull` auf dem Pi mit `denied`. Danach ist
> nichts mehr zu tun.

---

## 4. Ersteinrichtung

Es gibt keinen vorgegebenen Administrator und keinen Konsolenbefehl auf dem Server. Der
Entrypoint des Backend-Abbilds bringt die Datenbank beim ersten Start automatisch auf den
aktuellen Migrationsstand; die Anwendung selbst führt anschließend durch die Ersteinrichtung.

1. Öffne im Webbrowser `http://<SERVER_IP>/` (z. B. `http://192.168.1.100/`).
2. Solange noch kein Benutzer angelegt ist, erscheint automatisch der Ersteinrichtungs-Assistent.
   Lege dort Benutzername und PIN des ersten Administrator-Kontos fest.
3. Nach dem Anlegen bist du unmittelbar angemeldet, ohne erneute Eingabe.
4. **Wichtig:** Solange die Ersteinrichtung aussteht, wird Administrator, wer zuerst darauf
   zugreift — ohne Einmal-Token, denn eines abzulesen würde wieder eine Serverkonsole
   voraussetzen. Schließe die Ersteinrichtung deshalb ab, **bevor** du das Gäste-WLAN öffnest.
   Derselbe Hinweis steht dauerhaft im Assistenten selbst.
5. Erstelle anschließend im Admin-Bereich unter **Veranstaltungen** deine erste
   Festveranstaltung.
