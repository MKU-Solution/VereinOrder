# VereinOrder - Druckerbetrieb (USB/CUPS und Ersatzdrucker-Failover)

> **Hinweis zur Gegenprüfung.** Diese Anleitung wurde ohne Zugriff auf echte Hardware und
> ohne einen Raspberry Pi erstellt. Alle Befehle sind nach Dokumentation und dem in diesem
> Projekt entschiedenen Architekturentwurf (Issue #64) formuliert, aber **nicht am Gerät
> ausgeführt worden**. Vor dem produktiven Einsatz jeden Befehl einmal am tatsächlichen
> Raspberry Pi mit dem tatsächlich verwendeten Drucker gegenprüfen, insbesondere die
> Geräte-URI (`lpinfo -v`) und die genauen `printer-state-reasons`-Werte des jeweiligen
> Druckermodells.
>
> **Hinweis zum Ausbaustand.** Diese Anleitung beschreibt den Betrieb, wie ihn die
> Architekturentscheidung zu Issue #64 vorsieht (Druckertyp `CUPS_IPP`, Warteschlangenname,
> Ersatzdrucker-Zuordnung). Backend und Weboberfläche werden im Rahmen desselben Issues von
> anderen Rollen ergänzt. Erscheint der Druckertyp `CUPS_IPP` in der Verwaltung noch nicht,
> ist die Umsetzung dort noch nicht abgeschlossen — die CUPS-seitigen Schritte (Abschnitte 1
> bis 3) sind davon unabhängig und schon jetzt gültig.

## Überblick

CUPS läuft auf dem Raspberry Pi selbst (Host), nicht in einem Container. Der Print-Worker
läuft weiterhin im Container und spricht CUPS ausschließlich über IPP per HTTP an
(`CUPS_BASE_URL`, Vorgabe `http://host.docker.internal:631`). Der Worker braucht dafür
keine Gerätefreigabe, kein `privileged` und keine zusätzlichen Pakete im Image — die
gesamte USB-Ansteuerung des Bondruckers übernimmt CUPS auf dem Host. Details und
Begründung stehen in der Architekturvorgabe zu Issue #64, Abschnitt 1; diese Anleitung
setzt die dortige Entscheidung praktisch um.

Die CUPS-Warteschlange muss eine **Raw-Queue** sein. Der Worker liefert fertige
ESC/POS-Bytes; eine Treiber-Queue würde diese Bytes filtern und Müll ausdrucken — und das
ohne erkennbaren Fehler, siehe Abschnitt 8.

## 1. CUPS auf dem Raspberry Pi installieren

```bash
sudo apt update
sudo apt install -y cups
sudo usermod -aG lpadmin $USER
newgrp lpadmin
```

Die Installation selbst braucht wie in `docs/ops/raspberry-pi-setup.md` beschrieben einmalig
Internetzugang zu den Paketquellen. Danach läuft CUPS wie der übrige Festbetrieb vollständig
offline weiter.

## 2. CUPS härten

Ziel: CUPS bedient ausschließlich den Worker-Container (über das Docker-Gateway) und bei
Bedarf die eigene Kommandozeile am Pi. Es wird nichts im Netz gesucht und nichts im Netz
veröffentlicht.

**`cups-browsed` abschalten.** Der Dienst sucht aktiv nach freigegebenen Druckern anderer
CUPS-Server im Netz und kann sie automatisch als eigene Warteschlangen anlegen — im
Festzelt-Netz nicht erwünscht:

```bash
sudo systemctl disable --now cups-browsed
```

**`/etc/cups/cupsd.conf` anpassen.** Nur auf `localhost` (für den Worker-Container über das
Docker-Gateway) und die tatsächlich benötigte LAN-Adresse des Pi lauschen, keine
Bonjour/DNS-SD-Veröffentlichung, keine Fremdserver durchsuchen:

```
# <LAN-IP-DES-PI> durch die feste Adresse des Pi im Festzelt-Netz ersetzen
Listen localhost:631
Listen <LAN-IP-DES-PI>:631
Listen /run/cups/cups.sock

Browsing Off
BrowseLocalProtocols none
```

```bash
sudo systemctl restart cups
```

**Warteschlangen nicht freigeben.** Beim Anlegen der Queue in Abschnitt 3 wird
`printer-is-shared=false` ausdrücklich gesetzt, damit die Warteschlange auch dann nicht im
Netz sichtbar wird, wenn auf dem Pi aus anderen Gründen ein mDNS-Dienst läuft (der Avahi-Dienst
für die Namensauflösung `vereinorder.local` aus `docs/ops/raspberry-pi-setup.md` bleibt davon
unberührt und wird hier nicht angetastet).

**Prüfen, dass CUPS nur lokal erreichbar ist:**

```bash
# vom Pi selbst - muss antworten
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:631/

# von einem anderen Gerät im Festzelt-Netz aus, ausserhalb der erlaubten LAN-Adresse -
# darf NICHT antworten
```

## 3. USB-Bondrucker anschließen und als Raw-Queue einrichten

```bash
# Bondrucker per USB einstecken, dann die Geräte-URI ermitteln
lpinfo -v | grep -i usb
# Beispielhafte Ausgabe (Hersteller, Modell und Seriennummer stammen vom Gerät selbst
# und sind hier bewusst nicht vorausgefüllt):
# direct usb://<Hersteller>/<Modell>?serial=<Seriennummer>

# Raw-Queue anlegen. <queue> durch einen sprechenden, stabilen Namen ersetzen,
# z. B. bon-tresen oder bon-kueche. <URI> durch die Ausgabe von lpinfo ersetzen.
sudo lpadmin -p <queue> -E -v <URI> -m raw -o printer-is-shared=false

# Warteschlange aktivieren und Auftragsannahme einschalten
sudo cupsenable <queue>
sudo cupsaccept <queue>
```

**Prüfen, dass es wirklich eine Raw-Queue ist.** Mit `-m raw` legt CUPS **keine**
Treiberdatei (PPD) an. Eine vorhandene PPD-Datei ist ein sicheres Zeichen dafür, dass die
Queue stattdessen einen Treiber verwendet und Bytes filtert:

```bash
# erwartete Ausgabe: "No such file or directory" -
# keine PPD vorhanden, also keine Treiberfilterung
ls -la /etc/cups/ppd/<queue>.ppd

# Warteschlangenstatus und Gerät
lpstat -p <queue> -l
lpstat -v <queue>
```

Zur weiteren Absicherung kann der Eintrag in `/etc/cups/printers.conf` gegengeprüft werden:
der Abschnitt der Queue darf keine `Filter`-Zeile auf einen Treiber enthalten.

```bash
sudo grep -A 8 "<Printer <queue>>" /etc/cups/printers.conf
```

## 4. Stabile Queue- und Geräteidentität

VereinOrder speichert für einen Drucker vom Typ `CUPS_IPP` ausschließlich den
**Warteschlangennamen** (`queueName`) — keinen USB-Pfad, keine Bus- oder
Geräteadressnummer. Das ist bewusst so: `/dev/usb/lp0` bzw. die Bus/Geräte-Nummern unter
`/dev/bus/usb/` können sich beim Wiedereinstecken oder nach einem Neustart ändern. CUPS
selbst adressiert den Drucker über die Geräte-URI (Hersteller, Modell und, falls vom Gerät
gemeldet, die Seriennummer), die beim Anlegen der Queue in Abschnitt 3 festgelegt wurde —
nicht über den momentanen Kernel-Pfad.

**Beim Wiedereinstecken desselben physischen Druckers** ändert sich also unter Umständen der
Kernel-Pfad, nicht aber die Geräte-URI. CUPS findet den Drucker unter derselben Warteschlange
automatisch wieder. Kein manueller Schritt am Pi, keine Änderung in der VereinOrder-Verwaltung
nötig.

**Wird ein anderer physischer Drucker** (andere Seriennummer, anderes Modell) an denselben
USB-Port gehängt, bleibt die alte Geräte-URI in der Queue-Konfiguration bestehen und passt
nicht mehr. Die Queue muss dann auf das neue Gerät umgebogen werden — siehe Abschnitt 6,
Austausch im laufenden Betrieb.

## 5. Drucker in der VereinOrder-Verwaltung anlegen und Testbon auslösen

1. In der Administration den Bereich _Drucker & Bon-Routing_ öffnen.
2. Neuen Drucker anlegen, Druckertyp `CUPS_IPP` wählen.
3. **Warteschlangenname**: exakt der Name, der in Abschnitt 3 bei `lpadmin -p <queue>`
   verwendet wurde. Ein Tippfehler hier führt zu `client-error-not-found` beim Druckversuch.
4. **Papierbreite**: 58 mm oder 80 mm, passend zur eingelegten Bonrolle.
5. **Zeichensatz**: `CP858` (Umlaute und Euro) als Vorgabe; `CP850` oder `CP437` nur bei
   Geräten, die `CP858` nicht unterstützen.
6. IP-Adresse/Port nur ausfüllen, wenn dieser Drucker über eine andere CUPS-Instanz läuft
   als in `CUPS_BASE_URL` hinterlegt. Im Regelfall (eine CUPS-Instanz auf dem Pi für alle
   Drucker) leer lassen.
7. Speichern, danach über _Testbon drucken_ auslösen.

Die Verwaltung meldet nach dem Testdruck entweder „Testbon wurde gedruckt.“ oder eine
Fehlermeldung. **Wichtig bei CUPS-Warteschlangen:** Die Abfrage in der Verwaltung wartet nur
kurz auf eine Rückmeldung. Hängt der Auftrag in CUPS länger (z. B. wegen fehlendem Papier,
siehe Abschnitt 8), erscheint möglicherweise „Keine Rückmeldung … Läuft der Print-Worker?“,
obwohl der Auftrag in Wahrheit noch in der Warteschlange steht und später drucken kann. In
diesem Fall den Warteschlangenstatus direkt am Pi prüfen (`lpstat -p <queue> -l`), bevor der
Testbon ein zweites Mal ausgelöst wird — sonst druckt er doppelt, sobald Papier nachgelegt
wird.

## 6. Ersatzdrucker zuordnen

Jedem Drucker kann in der Verwaltung ein Ersatzdrucker zugeordnet werden. Meldet der
Transport für einen Auftrag sicher „nicht gedruckt“ (z. B. Drucker aus, Warteschlange lehnt
ab, CUPS nicht erreichbar), wechselt das System **automatisch genau einmal** auf den
hinterlegten Ersatzdrucker. Scheitert auch dieser sicher, endet der Auftrag endgültig als
gescheitert — es gibt keinen dritten Versuch und keine Kette „Ersatz des Ersatzes“.

Für den Betrieb folgt daraus:

- Der Ersatzdrucker muss aktiv und tatsächlich einsatzbereit sein (Papier, Verbindung),
  sonst verpufft der einmalige automatische Versuch ungenutzt.
- Nach einem Wechsel druckt der Festbetrieb kommentarlos am Ersatzgerät weiter — am
  Ersatzdrucker regelmäßig nachsehen, ob dort ungewöhnlich viele Bons liegen, das ist das
  einzige unmittelbare Anzeichen für einen defekten Hauptdrucker.
- Der defekte Hauptdrucker sollte zeitnah instandgesetzt oder getauscht werden (Abschnitt 7),
  weil der automatische Wechsel nur einmal greift.
- Der Wechsel wird mit Zeitpunkt und Grund nachvollziehbar protokolliert.

## 7. Austausch eines defekten Druckers im laufenden Betrieb

1. Defekten Drucker per USB abstecken.
2. Ersatzgerät anstecken.
3. Neue Geräte-URI ermitteln:
   ```bash
   lpinfo -v | grep -i usb
   ```
4. Bestehende Queue auf das neue Gerät umbiegen — der Warteschlangenname bleibt
   unverändert, damit die VereinOrder-Konfiguration (`queueName`) nicht angefasst werden
   muss:
   ```bash
   sudo lpadmin -p <queue> -v <neue-URI>
   ```
5. Status prüfen:
   ```bash
   lpstat -p <queue> -l
   ```
6. In der Verwaltung einen Testbon auslösen, um den Austausch zu bestätigen.
7. Aufträge, die während der Ausfallzeit als unklar markiert wurden, einzeln in der Liste
   „Unklare Druckaufträge“ prüfen und entscheiden (siehe Abschnitt 9) — nicht ungeprüft
   erneut drucken, das kann zu Doppeldrucken führen, falls am alten Gerät bereits ein
   Teilbon lag.

## 8. Fehlersuche

| Symptom                                   | Kommando am Pi                                                                                                                                 | Erwartete Anzeige in CUPS                                                                                     | Erwartete Anzeige in der Verwaltung                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drucker aus                               | `lpstat -p <queue> -l`                                                                                                                         | `printer-state-reasons` enthält `offline-report`                                                              | Auftrag hängt kurz, dann bei sicherem Fehlschlag automatischer Wechsel auf den Ersatzdrucker (falls hinterlegt), sonst endgültig gescheitert                  |
| Papier aus                                | `lpstat -p <queue> -l`                                                                                                                         | `printer-state-reasons` enthält `media-empty` bzw. `media-needed`, Auftrag bleibt in der Warteschlange stehen | Auftrag bleibt in Zustellung, **kein Fehler** — nach dem Nachlegen druckt derselbe Auftrag automatisch fertig. Kein Doppeldruck, kein Failover                |
| USB getrennt (während des Drucks)         | `lsusb` (Gerät fehlt in der Liste), `lpstat -p <queue> -l`                                                                                     | Auftragszustand wechselt auf `processing-stopped`/`aborted`, Gerät nicht mehr ansprechbar                     | Ergebnis unklar — landet als „unklares“ Ergebnis in der Verwaltung, **kein** automatischer Zweitdruck, Admin-Entscheidung nötig (siehe Abschnitt 9)           |
| CUPS auf dem Pi nicht erreichbar          | vom Pi: `curl -sS http://localhost:631/`; aus dem Container: `docker exec vereinorder_print_worker wget -qO- http://host.docker.internal:631/` | Zeitüberschreitung/Verbindungsfehler                                                                          | Auftrag sicher nicht gedruckt, automatischer Wechsel auf den Ersatzdrucker (falls hinterlegt)                                                                 |
| Auftrag hängt in der Queue (unklar warum) | `lpstat -o <queue>` (zeigt wartende/laufende Aufträge), `lpstat -p <queue> -l`                                                                 | Auftrag bleibt länger als erwartet in `pending`/`processing` sichtbar                                         | Bleibt so lange in Zustellung, bis CUPS ein Ergebnis meldet oder die Wartezeit (`PRINT_CUPS_WAIT_MS`, Vorgabe 120 Sekunden) abläuft; danach unklares Ergebnis |

Bei allen Fällen mit unklarem Ausgang gilt: **kein automatischer zweiter Druckversuch.**
Das System wartet auf eine Entscheidung in der Verwaltung.

**Kaltstart-Neustarts des Print-Workers sind normal, kein Defekt.** Backend und
Print-Worker starten beim ersten `docker compose up -d` gleichzeitig. Das gemeinsame
Geheimnis `PRINT_WORKER_TOKEN` erzeugt aber erst das Backend (siehe
[Umgebungsvariablen](./umgebungsvariablen.md)); der Worker liest es über ein gemeinsames
Volume. Verliert der Worker dieses Wettrennen, protokolliert er `worker.token_waiting`
und wartet bis zu 60 Sekunden; findet die Datei danach immer noch nicht, endet der
Prozess mit Fehlerstatus und wird durch `restart: always` erneut gestartet — deshalb
zeigt `docker compose ps` oder `docker logs vereinorder_print_worker` in den ersten
Sekunden nach dem allerersten Start mitunter einen oder zwei Neustarts des Containers
`vereinorder_print_worker`. Sobald die Tokendatei existiert, läuft der Worker stabil
weiter.

## 9. Was „gedruckt“ bedeutet

Der Nachweis, den VereinOrder führen kann, endet an der Übergabe an das Gerät: CUPS meldet
`completed`, sobald alle Daten an den Drucker übergeben wurden. Das ist **keine** Aussage
darüber, ob tatsächlich Papier herausgekommen ist — ein Papierstau, ein leerer Farbträger
oder ein mechanischer Defekt direkt nach der Übergabe bleiben für die Software unsichtbar.
Diese Grenze ist bewusst in Kauf genommen: Ohne einen Rückkanal vom Drucker (den ESC/POS über
IPP nicht bietet) lässt sie sich softwareseitig nicht schließen.

Deshalb gilt in VereinOrder als „sicher gedruckt“ ausschließlich: die Daten wurden
nachweislich vollständig an das Gerät übergeben. Alles, was diese Schwelle nicht eindeutig
erreicht oder nicht eindeutig davor endet, gilt als **unklar** — nicht als Fehler. Genau
deshalb landen solche Aufträge nicht automatisch ein zweites Mal in der Druckwarteschlange,
sondern als sichtbare Entscheidung bei einer Person in der Verwaltung: nur ein Mensch vor Ort
kann prüfen, ob am Drucker tatsächlich ein Bon liegt.
