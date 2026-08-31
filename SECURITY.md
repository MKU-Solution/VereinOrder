# Sicherheitskonzept und -richtlinie für VereinOrder

VereinOrder ist für den Einsatz auf Vereins- und Feuerwehrfesten im **lokalen Netzwerk** (LAN / abgesichertes Vereins-WLAN) konzipiert. Da das System weder eine dauerhafte Internetverbindung benötigt noch in einer öffentlichen Cloud betrieben wird, liegt der Fokus auf **strikter lokaler Zugriffskontrolle**, **Backend-Berechtigungsprüfungen** und **Revisionssicherheit**.

---

## 1. Sicherheitsarchitektur

### Authentifizierung & Berechtigung

- **Passwort- und PIN-Hashes:** Alle Benutzer-PINs werden mit **bcrypt** (Salt-Rounds >= 10) gehasht gespeichert. Im Klartext werden PINs niemals protokolliert oder übertragen.
- **JWT-Sitzungen:** Sitzungen basieren auf kurzlebigen JWT-Tokens (`JsonWebToken`), die in API-Aufrufen über `Authorization: Bearer <token>` validiert werden.
- **Strikte Backend-Guards:** Alle sicherheits- oder kassenrelevanten Aktionen (z. B. Stornos, Preisänderungen, Kassenabschlüsse, Datenbankbackups) werden serverseitig über NestJS-Guards (`RolesGuard`, `AdminSessionGuard`) geprüft. Das Ausblenden von Buttons im Frontend ist lediglich eine Bedienhilfe.
- **Ersteinrichtung ohne vorgegebenes Konto:** Es gibt kein Standardkonto und keine Notfall-PIN. Solange die Benutzertabelle leer ist, führt die Anwendung im Browser zu einem Assistenten, der das erste Administrator-Konto anlegt; der Weg verschwindet danach. Restrisiko, bewusst in Kauf genommen: In diesem Zeitfenster wird Administrator, wer zuerst zugreift — die Ersteinrichtung ist deshalb vor dem Öffnen des Gäste-WLANs abzuschließen (siehe [Installationsanleitung](docs/ops/installation.md)).
- **Selbst erzeugte Sicherheitsschlüssel:** `JWT_SECRET` und `PRINT_WORKER_TOKEN` stehen nicht im Repository. Bleiben sie in der `.env` leer, erzeugt das Backend beide beim ersten Start selbst und legt sie unter `STATE_DIR` ab (siehe [Umgebungsvariablen](docs/ops/umgebungsvariablen.md)).

### Schutz gegen typische Angriffsvektoren

- **Eingabevalidierung (DTOs):** Alle REST-Endpunkte nutzen `class-validator` und strikte DTO-Schemas. Unerwartete Felder werden über den globalen `ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true`) sofort verworfen.
- **SQL-Injection-Schutz:** Sämtliche Datenbankzugriffe erfolgen über parametrisierte SQL-Abfragen via **Prisma ORM**.
- **Cross-Site Scripting (XSS):** React schützt standardmäßig vor XSS. Unsichere HTML-Injektionen (`dangerouslySetInnerHTML`) sind im Quellcode verboten.
- **Brute-Force & Rate-Limiting:** Fehlgeschlagene PIN-Eingaben werden gezählt und nach mehreren Fehlversuchen zeitverzögert abgewiesen.

### Revisionssicherheit & Audit-Log

- Alle sicherheits-, kassen- und preisrelevanten Aktionen werden unveränderbar in der Tabelle `AuditLog` mit Benutzer-ID, Zeitstempel, IP-Adresse, Aktion und relevanten Vorher-/Nachher-Details protokolliert.
- Das Audit-Log kann über die Benutzeroberfläche weder gelöscht noch manipuliert werden.

---

## 2. Absicherung des Fest-Netzwerks

Da VereinOrder im lokalen Netzwerk betrieben wird, ist das lokale Netzwerk die erste Verteidigungslinie:

1. **WLAN-Verschlüsselung:** Das Vereins-WLAN muss mit mindestens **WPA2-PSK (AES)** oder **WPA3** und einem starken Passwort geschützt sein.
2. **Gastnetzwerk trennen:** Gäste-WLAN (sofern vorhanden) muss über ein separates VLAN vollständig vom Kassen-Netzwerk isoliert sein.
3. **Physische Sicherheit:** Der Server (Raspberry Pi / Mini-PC) sollte an einem vor unbefugtem Zugriff geschützten Ort (z. B. Kassenbüro / Schank-Zentrale) aufgestellt werden.

---

## 3. Melden von Sicherheitslücken

Solltest du eine Sicherheitslücke oder Schwachstelle in VereinOrder entdecken:

- Bitte **nicht** öffentlich als allgemeines Issue posten.
- Erstelle ein vertrauliches GitHub-Sicherheits-Advisory über das GitHub-Repository (`Security -> Advisories -> Report a vulnerability`) oder wende dich direkt an die Projektleitung.
