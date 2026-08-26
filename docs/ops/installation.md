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

Erzeuge sichere Passwörter und Tokens für Produktion (z. B. mit `openssl rand -hex 32`):

```bash
# In .env eintragen:
POSTGRES_PASSWORD=SicheresDatenbankPasswort123!
JWT_SECRET=KryptografischSichererJWTSchluessel456!
ADMIN_SECRET=AdminNotfallPIN789!
```

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

| Dienst           | Container-Name             | Port (Host)        | Beschreibung                         |
| ---------------- | -------------------------- | ------------------ | ------------------------------------ |
| **Frontend**     | `vereinorder-frontend`     | `5173` (oder `80`) | Nginx Webserver mit React PWA        |
| **Backend**      | `vereinorder-backend`      | `3000`             | NestJS REST-API & SSE-Echtzeitstream |
| **Datenbank**    | `vereinorder-db`           | `5432`             | PostgreSQL 16 Datenbank              |
| **Druck-Worker** | `vereinorder-print-worker` | -                  | Asynchroner Druckauftragsprozessor   |

---

## 4. Erstinbetriebnahme

1. Öffne im Webbrowser `http://<SERVER_IP>:5173` (z. B. `http://192.168.1.100:5173`).
2. Melde dich als Administrator an:
   - **Benutzer:** `admin`
   - **Standard-PIN:** `1234`
3. Ändere im Admin-Panel unter **Personal & Rollen** umgehend die Administrator-PIN.
4. Erstelle unter **Veranstaltungen** deine erste Festveranstaltung.
