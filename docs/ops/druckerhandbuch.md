# Druckerhandbuch für VereinOrder

Dieses Dokument beschreibt die Einrichtung, den Betrieb und die Fehlerbehebung von Bondruckern in VereinOrder.

---

## 1. Unterstützte Drucker & Verbindungstypen

VereinOrder unterstützt handelsübliche Thermobondrucker (58 mm und 80 mm Papierbreite) über zwei Verbindungswege:

1. **Netzwerkdrucker (LAN / WLAN) via ESC/POS über Raw TCP (Port 9100):**
   - Empfohlener Standard für Festbetrieb (z. B. Epson TM-T20III / TM-T88, Star Micronics, Bixolon, Munbyn, Xprinter).
   - Jeder Drucker erhält eine feste IP-Adresse im Festnetzwerk (z. B. `192.168.1.51` für Küche, `192.168.1.52` für Schank).
2. **USB-Bondrucker via CUPS / IPP:**
   - Drucker wird per USB direkt an den Raspberry Pi oder Server angeschlossen und über CUPS als Warteschlange freigegeben.

---

## 2. Einrichtung im Admin-Panel

Administratoren konfigurieren Drucker unter **Administration -> Druckerverwaltung** (`/admin/printers`):

### A. Netzwerkdrucker (ESC/POS Raw TCP)

- **Name:** z. B. `Küche Bondrucker 1`
- **Typ:** `ESC/POS Raw TCP`
- **Host / IP:** `192.168.1.51`
- **Port:** `9100` (Standard)
- **Papierbreite:** `80mm` (oder `58mm`)
- **Zeichensatz:** `PC437` / `PC858` / `UTF-8`
- **Automatischer Papierschnitt:** `Ja`
- **Kopien:** `1` (oder `2` bei Doppelbon)
- **Ersatzdrucker:** Optional einen Ausweichdrucker auswählen (z. B. `Schank Bondrucker`).

### B. USB-Drucker (CUPS)

- **Name:** z. B. `Bonkasse USB Drucker`
- **Typ:** `CUPS / IPP`
- **CUPS Warteschlangenname:** Name der CUPS-Queue (z. B. `EPSON_TM_T20III`)
- **CUPS Server URL:** `http://localhost:631`

---

## 3. Zuweisung zu Stationen

Jede Station (z. B. Küche, Schank, Grill) wird unter **Stationen** mit einem **primären Drucker** und optional einem **Ersatzdrucker** verknüpft. Sobald eine Bestellung aufgegeben wird, erstellt VereinOrder automatisch separate Druckaufträge für alle beteiligten Stationen.

---

## 4. Automatisches Failover & Ersatzdrucker

Kann ein Drucker nach Ablauf der konfigurierten Wiederholungsversuche (Standard: 3 Versuche à 5 Sekunden Timeout) nicht erreicht werden (z. B. Papierstau, Kabel gezogen, ausgeschaltet):

1. Der Druckjob wird automatisch auf den konfigurierten **Ersatzdrucker** umgeleitet.
2. Der Bon wird auf dem Ersatzdrucker mit einem deutlich sichtbaren Kopfzeilenhinweis gedruckt:  
   `*** UMGELEITET VON [ORIGINAL-DRUCKER] ***`
3. Im Admin-Dashboard (`/admin/diagnostics`) erscheint eine rote Warnmeldung mit der genauen Fehlerursache.

---

## 5. Unklare Druckaufträge & Nachdruck

- **Testdruck:** Über die Schaltfläche _Testdruck_ im Admin-Panel kann jederzeit ein Testbeleg gedruckt werden. Der Status des Testdrucks wird erst nach echter Druckerrückmeldung als erfolgreich gemeldet.
- **Unklare Druckaufträge:** Aufträge, die aufgrund von Timeouts unklar sind, können im Admin-Panel eingesehen, mit Kopienachweis erneut gedruckt oder mit Pflichtbegründung verworfen werden.
