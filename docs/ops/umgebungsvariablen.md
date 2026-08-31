# Referenz der Umgebungsvariablen (`.env`)

Dieses Dokument beschreibt alle Konfigurationsparameter von VereinOrder in der `.env`-Datei.

---

## 1. Datenbank & ORM

| Variable            | Beschreibung                                      | Standard / Beispiel                                                          |
| ------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`      | PostgreSQL-Verbindungszeichenfolge für Prisma ORM | `postgresql://vereinorder:password@localhost:5432/vereinorder?schema=public` |
| `POSTGRES_USER`     | Datenbank-Benutzername für Docker-Container       | `vereinorder`                                                                |
| `POSTGRES_PASSWORD` | Datenbank-Passwort für Docker-Container           | _(sicheres Passwort vergeben)_                                               |
| `POSTGRES_DB`       | Datenbank-Name                                    | `vereinorder`                                                                |

---

## 2. Authentifizierung & Sicherheit

| Variable             | Beschreibung                                            | Standard / Beispiel        |
| -------------------- | ------------------------------------------------------- | -------------------------- |
| `JWT_SECRET`         | Geheimer Schlüssel zur Signierung von JSON Web Tokens   | _leer lassen, siehe unten_ |
| `PRINT_WORKER_TOKEN` | Gemeinsames Geheimnis zwischen Backend und Print-Worker | _leer lassen, siehe unten_ |

**Beide Werte dürfen leer bleiben.** Fehlt einer, erzeugt das Backend beim ersten Start
(im Entrypoint des Backend-Abbilds, vor dem eigentlichen Programmstart) 32 Zufallsbytes
und legt sie mit Dateirechten `0600` unter `STATE_DIR` ab; jeder weitere Start verwendet
denselben Wert wieder. Der Print-Worker läuft in einem eigenen Container und hat keinen
Zugriff auf die Umgebung des Backends — er liest das vom Backend erzeugte
`PRINT_WORKER_TOKEN` stattdessen über dasselbe, nur lesend eingehängte Volume aus
derselben Datei. Eine hier gesetzte Umgebungsvariable gewinnt immer und wird an beide
Dienste weitergereicht; sie muss dann mindestens 32 Zeichen haben.

**Ablageort und Folge eines Volumeverlusts.** Beide Schlüssel liegen unter `STATE_DIR`,
also auf dem Docker-Volume `vereinorder_state_data` — bewusst nicht in der Datenbank,
damit eine Wiederherstellung sie nicht überschreibt. Geht dieses Volume verloren
(z. B. `docker volume rm`, versehentliches `docker compose down -v`), erzeugt der
nächste Start neue Schlüssel. Jedes zuvor ausgestellte Anmelde-Token wird damit
ungültig, und jedes Gerät muss sich neu anmelden — bei einer Token-Gültigkeit von 12
Stunden im laufenden Betrieb lästig, aber ungefährlich.

**Migrationshinweis für bestehende Installationen.** Wer bisher ohne gesetztes
`JWT_SECRET` lief (stillschweigend mit einem im Repository stehenden Vorgabewert),
bekommt beim ersten Start nach dem Update einen neu erzeugten Schlüssel — dieselbe
Folge wie oben: alle Geräte müssen sich einmalig neu anmelden. Deshalb vor der
Veranstaltung aktualisieren, nicht während. Wer mitten im Betrieb aktualisieren muss,
trägt den bisherigen Wert vorher ausdrücklich in die `.env` ein (eine gesetzte
Umgebungsvariable gewinnt immer gegenüber der Neuerzeugung) und leert ihn erst bei
einem regulären Wartungszeitpunkt wieder, um ihn dann durch einen erzeugten Schlüssel
abzulösen.

---

## 3. Server & Ports

| Variable   | Beschreibung                                              | Standard     |
| ---------- | --------------------------------------------------------- | ------------ |
| `PORT`     | Port, auf dem das NestJS-Backend (Fastify-Adapter) hört   | `3000`       |
| `NODE_ENV` | Ausführungsumgebung (`development`, `production`, `test`) | `production` |

Der Port der Webanwendung selbst ist nicht über eine Umgebungsvariable konfigurierbar:
`apps/frontend/Dockerfile` und `apps/frontend/nginx.conf` legen ihn fest auf `80`, und
`docker-compose.yml` bildet ihn auf denselben Host-Port `80` ab.

---

## 4. Druck-Worker (`apps/print-worker`)

| Variable                 | Beschreibung                                                          | Standard                          |
| ------------------------ | --------------------------------------------------------------------- | --------------------------------- |
| `BACKEND_URL`            | Adresse des Backends, das der Worker abfragt                          | `http://backend:3000`             |
| `PRINT_POLL_INTERVAL_MS` | Abfrageintervall der Druckwarteschlange in Millisekunden              | `2500`                            |
| `PRINT_TIMEOUT_MS`       | Zeitlimit für Netzwerkdrucker ohne eigenen Wert in Millisekunden      | `5000`                            |
| `PRINT_FORCE_SIMULATOR`  | Auf `1` setzen, um jeden Drucker auf den Simulator zu lenken          | `0`                               |
| `CUPS_BASE_URL`          | Adresse des CUPS-Dienstes auf dem Host für Drucker vom Typ `CUPS_IPP` | `http://host.docker.internal:631` |
| `PRINT_CUPS_POLL_MS`     | Abfrageintervall des Auftragsstatus in der CUPS-Warteschlange         | `1000`                            |
| `PRINT_CUPS_WAIT_MS`     | Maximale Wartezeit auf ein Enddruckergebnis bei CUPS                  | `120000`                          |
