# Rollen- und Berechtigungsmatrix

Dieses Dokument beschreibt die Rollen in VereinOrder, ihre fachlichen Aufgaben sowie die Durchsetzung von Berechtigungen im Backend und Frontend.

---

## 1. Übersicht der Benutzerrollen

| Rolle (`UserRole`) | Fachliche Bezeichnung      | Typischer Einsatzort                    |
| ------------------ | -------------------------- | --------------------------------------- |
| `ADMINISTRATOR`    | Gesamtadministrator        | Kassenbüro, Systemadministrator         |
| `EVENT_MANAGER`    | Veranstaltungsleitung      | Festleitung, Organisationskomitee       |
| `WAITER`           | Kellner / Bedienung        | Smartphone im Tischservice              |
| `CASHIER`          | Kassa (Bon-/Stationskasse) | Festes Touch-Terminal, Bonkassenzelt    |
| `STATION`          | Stationsmonitor / Küche    | Küchen-/Schankmonitor                   |
| `RUNNER`           | Zusteller / Träger         | Tablet/Smartphone bei der Essensausgabe |
| `AUDITOR`          | Revision / Kassenprüfer    | Kassenprüfer, Vereinsobmann             |

---

## 2. Detaillierte Berechtigungsmatrix

| Bereich / Funktion                                | ADMIN | EVENT_MGR |    WAITER    |   CASHIER    | STATION | RUNNER | AUDITOR |
| ------------------------------------------------- | :---: | :-------: | :----------: | :----------: | :-----: | :----: | :-----: |
| **System & Administration**                       |       |           |              |              |         |        |         |
| Systemstatus & Diagnose (`/admin/diagnostics`)    |  ✅   |    ❌     |      ❌      |      ❌      |   ❌    |   ❌   |   ❌    |
| Drucker anlegen / bearbeiten (`/admin/printers`)  |  ✅   |    ❌     |      ❌      |      ❌      |   ❌    |   ❌   |   ❌    |
| Backups erstellen & einspielen (`/admin/backups`) |  ✅   |    ❌     |      ❌      |      ❌      |   ❌    |   ❌   |   ❌    |
| Wartungsmodus schalten (`/admin/maintenance`)     |  ✅   |    ❌     |      ❌      |      ❌      |   ❌    |   ❌   |   ❌    |
| Unklare Druckjobs verwerfen                       |  ✅   |    ❌     |      ❌      |      ❌      |   ❌    |   ❌   |   ❌    |
| **Veranstaltungsmanagement**                      |       |           |              |              |         |        |         |
| Veranstaltung anlegen / bearbeiten                |  ✅   |    ✅     |      ❌      |      ❌      |   ❌    |   ❌   |   ❌    |
| Sortiment, Preise & Optionen pflegen              |  ✅   |    ✅     |      ❌      |      ❌      |   ❌    |   ❌   |   ❌    |
| Stationen & Bereiche anlegen                      |  ✅   |    ✅     |      ❌      |      ❌      |   ❌    |   ❌   |   ❌    |
| Benutzer & PINs verwalten                         |  ✅   |    ✅     |      ❌      |      ❌      |   ❌    |   ❌   |   ❌    |
| Testmodus starten / Testdaten löschen             |  ✅   |    ✅     |      ❌      |      ❌      |   ❌    |   ❌   |   ❌    |
| Veranstaltung scharf schalten & abschließen       |  ✅   |    ✅     |      ❌      |      ❌      |   ❌    |   ❌   |   ❌    |
| **Kassen- & Bestellbetrieb**                      |       |           |              |              |         |        |         |
| Tischbestellung aufnehmen                         |  ✅   |    ✅     |      ✅      |      ✅      |   ❌    |   ❌   |   ❌    |
| Schnellverkauf (Bonkasse)                         |  ✅   |    ✅     |      ❌      |      ✅      |   ❌    |   ❌   |   ❌    |
| Stationsverkauf & Abholbon                        |  ✅   |    ✅     |      ❌      |      ✅      |   ✅    |   ❌   |   ❌    |
| Barzahlung kassieren                              |  ✅   |    ✅     |      ✅      |      ✅      |   ✅    |   ❌   |   ❌    |
| Eigene Kassensitzung öffnen/schließen             |  ✅   |    ✅     |      ✅      |      ✅      |   ✅    |   ❌   |   ❌    |
| Offene Tischbestellung stornieren                 |  ✅   |    ✅     | ⚠️ (mit PIN) | ⚠️ (mit PIN) |   ❌    |   ❌   |   ❌    |
| **Zubereitung & Auslieferung**                    |       |           |              |              |         |        |         |
| Küchenmonitor einsehen & Status setzen            |  ✅   |    ✅     |      ❌      |      ❌      |   ✅    |   ❌   |   ❌    |
| Produkt als ausverkauft melden                    |  ✅   |    ✅     |      ❌      |      ❌      |   ✅    |   ❌   |   ❌    |
| Runner-Übersicht & Auslieferung quittieren        |  ✅   |    ✅     |      ✅      |      ❌      |   ❌    |   ✅   |   ❌    |
| **Auswertung & Revision**                         |       |           |              |              |         |        |         |
| Live-Umsatzübersicht & Berichte                   |  ✅   |    ✅     |      ❌      |      ❌      |   ❌    |   ❌   |   ✅    |
| Kassensitzungsabschlüsse einsehen                 |  ✅   |    ✅     |      ❌      |      ❌      |   ❌    |   ❌   |   ✅    |
| Audit-Log einsehen & exportieren                  |  ✅   |    ✅     |      ❌      |      ❌      |   ❌    |   ❌   |   ✅    |
| CSV- und JSON-Umsatzexporte                       |  ✅   |    ✅     |      ❌      |      ❌      |   ❌    |   ❌   |   ✅    |

_Legende: ✅ Vollzugriff, ⚠️ Zugriff nur mit Autorisierung/Grund, ❌ Kein Zugriff._

---

## 3. Technische Durchsetzung der Berechtigungen

### Backend (Strikte Sicherheitsebene)

- **`RolesGuard`:** Prüft das über das JWT-Token mitgelieferte `role`-Attribut gegen die `@Roles(...)`-Dekoratoren der Controller-Methoden.
- **`AdminSessionGuard`:** Verlangt für administrative Kernfunktionen (Backup, Wiederherstellung, Wartungsmodus, Druckerverwaltung) zwingend die Rolle `ADMINISTRATOR`.
- **Backend-Fehler:** Bei unzureichenden Rechten antwortet die API mit `403 Forbidden` (`{"message": "Forbidden resource"}`).

### Frontend (Bedienungsebene)

- **`RoleGuard` & `routeAccess.ts`:** Leitet nicht autorisierte Benutzer automatisch auf ihre jeweilige Standard-Startseite um (z. B. Kellner auf die Bestellansicht `/`, Stationen auf `/stations`).
