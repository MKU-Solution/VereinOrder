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

| Dienst           | Container-Name             | Port (Host)      | Beschreibung                                                                                                       |
| ---------------- | -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Frontend**     | `vereinorder_frontend`     | `80`             | Nginx Webserver mit React PWA                                                                                      |
| **Backend**      | `vereinorder_backend`      | `3000`           | NestJS REST-API & SSE-Echtzeitstream                                                                               |
| **Datenbank**    | `vereinorder_postgres`     | `127.0.0.1:5432` | PostgreSQL 16. Bewusst nur auf der Loopback-Adresse veroeffentlicht und damit aus dem Netz nicht erreichbar (#181) |
| **Druck-Worker** | `vereinorder_print_worker` | -                | Asynchroner Druckauftragsprozessor                                                                                 |

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
