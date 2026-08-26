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

| Variable         | Beschreibung                                          | Standard / Beispiel                                                      |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `JWT_SECRET`     | Geheimer Schlüssel zur Signierung von JSON Web Tokens | _(min. 32 Zeichen Zufallsstring)_                                        |
| `JWT_EXPIRES_IN` | Gültigkeitsdauer eines JWT-Sitzungstokens             | `12h`                                                                    |
| `ADMIN_SECRET`   | Notfall-Admin-PIN für die Ersteinrichtung             | `1234`                                                                   |
| `CORS_ORIGIN`    | Erlaubte Origins für Cross-Origin-Requests            | `http://localhost:5173,http://127.0.0.1:5173` (oder `*` im lokalen Netz) |

---

## 3. Server & Ports

| Variable        | Beschreibung                                              | Standard     |
| --------------- | --------------------------------------------------------- | ------------ |
| `PORT`          | Port für den NestJS Fastify Backend-Server                | `3000`       |
| `FRONTEND_PORT` | Port für die Webanwendung                                 | `5173`       |
| `NODE_ENV`      | Ausführungsumgebung (`development`, `production`, `test`) | `production` |

---

## 4. Druck-Worker (`apps/print-worker`)

| Variable                 | Beschreibung                                                | Standard               |
| ------------------------ | ----------------------------------------------------------- | ---------------------- |
| `PRINT_POLL_INTERVAL_MS` | Abfrageintervall der DB-Druckwarteschlange in Millisekunden | `1000`                 |
| `PRINT_TIMEOUT_MS`       | Timeout für Druckerverbindungen (Raw TCP / IPP)             | `5000`                 |
| `PRINT_MAX_ATTEMPTS`     | Maximale automatische Wiederholungsversuche vor Failover    | `3`                    |
| `CUPS_SERVER_URL`        | URL zum lokalen CUPS-Server für USB-Drucker                 | `http://localhost:631` |
