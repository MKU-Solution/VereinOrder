# ADR 0002: Admin-PIN und HTTP im abgeschotteten Festnetz beibehalten

- **Status:** angenommen (Projektleitung, 2026-08-24)
- **Datum:** 2026-08-24
- **Vorgang:** Issue #68
- **Entscheidungsträger:** Projektleitung VereinOrder

## Entscheidung

VereinOrder bleibt für alle menschlichen Rollen einschließlich Administratoren bei der
Anmeldung mit Benutzername und persönlicher PIN. Für Administratoren wird keine
Passphrase, kein zweites Geheimnis und keine zeitlich begrenzte zusätzliche
Admin-Freigabe eingeführt.

Der Festbetrieb bleibt eine normale responsive Browseranwendung über HTTP im lokalen,
vom Verein kontrollierten Netz. Für die Administration wird keine HTTPS-Pflicht und
keine lokale Zertifikatsinfrastruktur eingeführt.

Die Projektleitung priorisiert damit die einfache, für nicht technikaffine Helfer
verständliche Bedienung und den störungsarmen Offline-Betrieb höher als den zusätzlichen
Schutz durch stärkere Admin-Zugangsdaten und Transportverschlüsselung.

Diese Entscheidung weicht bewusst von zwei bisherigen Anforderungen ab:

- `docs/product/master-prompt.md`, Abschnitt 13, fordert „stärkere Zugangsdaten für
  Administratoren".
- Issue #68 verlangte als Akzeptanzkriterium eine nachweislich stärkere
  Administrator-Anmeldung als die operative Kurz-PIN.

Beide Anforderungen werden durch die ausdrückliche Entscheidung der Projektleitung
aufgehoben. Issue #68 wird deshalb nicht als technisch umgesetzt, sondern als bewusst
nicht weiterverfolgt geschlossen.

## Geltungsbereich

Die Entscheidung gilt ausschließlich, solange alle folgenden Bedingungen erfüllt sind:

1. VereinOrder ist nicht aus dem öffentlichen Internet erreichbar.
2. Es existiert keine Portweiterleitung, kein öffentlicher Reverse Proxy und kein
   Cloud-Tunnel auf Frontend, Backend oder PostgreSQL.
3. Das Festnetz wird vom Verein kontrolliert und ist nicht dasselbe ungeschützte WLAN,
   das Gästen öffentlich angeboten wird.
4. Der Raspberry Pi und seine Datenträger sind physisch nicht frei zugänglich.
5. Administratoren melden sich nur an Vereinsgeräten oder persönlich kontrollierten
   Geräten an.

Sobald eine dieser Bedingungen entfällt, ist diese ADR nicht mehr anwendbar. Vor einer
Freigabe von Fernzugriff oder öffentlicher Erreichbarkeit muss Issue #68 neu bewertet
werden; HTTP und Kurz-PIN sind dafür ausdrücklich nicht freigegeben.

## Ausgangslage

Der aktuelle technische Stand ist:

- Jede Rolle verwendet `User.pinHash`; `AuthService` akzeptiert PINs mit 4 bis 12
  Ziffern.
- Fünf fehlerhafte Versuche sperren den Benutzernamen für fünf Minuten und werden
  auditiert.
- Erfolgreiche Anmeldung und Benutzerwechsel werden auditiert.
- Das Backend stellt ein 12 Stunden gültiges JWT aus.
- Das Frontend speichert dieses JWT in `localStorage` und verwendet es als
  Bearer-Token.
- Die Oberfläche sperrt sich standardmäßig nach 60 Sekunden Inaktivität; die Person
  muss ihre PIN erneut eingeben. Die Sperre ist derzeit eine Frontend-Sperre und
  widerruft das JWT nicht serverseitig.
- Berechtigungen werden weiterhin im Backend über JWT und Rollen-Guards geprüft. Das
  Verbergen einer Schaltfläche bleibt keine Sicherheitsgrenze.
- CORS ist derzeit pauschal aktiviert. Im vorgesehenen Festbetrieb werden Frontend und
  API dennoch unter demselben lokalen Ursprung ausgeliefert.

## Bedrohungsmodell und bewusste Risikoannahme

| Szenario                           | Bestehender Schutz                                             | Bewusst akzeptiertes Restrisiko                                                                                            |
| ---------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Verlorenes Bediengerät             | Automatische Oberflächensperre und erneute PIN-Eingabe         | Das 12-Stunden-JWT bleibt im Browser gespeichert und ist bis zum Ablauf nicht einzeln widerrufbar                          |
| Schulterblick                      | Verdeckte PIN-Anzeige und persönliche Konten                   | Eine beobachtete PIN kann wiederverwendet werden; bei vier Stellen ist der Suchraum klein                                  |
| Erratene PIN                       | Fünf Versuche, danach fünf Minuten Sperre; Fehleraudit         | Ein Angreifer im lokalen Netz kann wiederholt versuchen oder den bekannten Admin-Namen gezielt sperren                     |
| Kopierter Browser-Webspeicher      | JWT läuft nach zwölf Stunden ab                                | Ein kopiertes JWT gewährt bis zum Ablauf dieselben Rechte und wird durch PIN-Wechsel oder UI-Sperre nicht sofort entwertet |
| Teilnehmer im Fest-WLAN            | Kontrolliertes Vereinsnetz als organisatorische Grenze         | HTTP verschlüsselt weder PIN noch JWT; ein Teilnehmer mit geeigneter Netzposition kann Verkehr beobachten oder verändern   |
| Kompromittierter Browser/XSS       | Backend prüft Rolle und Token                                  | Ein Skript im VereinOrder-Ursprung kann `localStorage` lesen und das JWT entnehmen                                         |
| Fremde Webseite im selben Browser  | Bearer-Token wird nicht automatisch wie ein Cookie mitgesendet | Pauschales CORS bleibt unnötig weit; eine Fehlkonfiguration oder ein Skript mit Tokenzugriff kann Daten übertragen         |
| Datenbanksicherung in fremder Hand | PINs liegen nur als Bcrypt-Hashes vor                          | Vierstellige PINs lassen sich aus einem entwendeten Hash trotz Bcrypt mit begrenztem Aufwand vollständig durchprobieren    |

Die Projektleitung nimmt diese Risiken zugunsten der einfacheren Bedienung ausdrücklich
an. „Kein öffentliches Internet" ist dabei eine Begrenzung der Angriffsfläche, kein
kryptografischer Schutz.

## Bewertete Möglichkeiten

### A. Admin-Passphrase und widerrufbare Serversitzung

Administratoren verwenden eine starke Passphrase; Browser erhalten statt eines
langlebigen JWTs eine serverseitig widerrufbare Sitzung.

- **Sicherheit:** höchste der betrachteten Möglichkeiten; schützt besser bei
  Schulterblick, Geräteverlust und kopiertem Webspeicher.
- **Bedienbarkeit:** schlechter für spontane Administration durch nicht technikaffine
  Vereinshelfer; Passphrase und Recovery müssen sicher verwahrt werden.
- **Recovery:** benötigt dokumentierten lokalen Bootstrap und Wiederherstellungsweg.
- **Aufwand:** hoch durch Datenmodell, Auth-API, Migration und neue Bedienabläufe.
- **Entscheidung:** verworfen, weil der lokale Offline-Betrieb und die einfache
  Bedienung höher gewichtet werden.

### B. PIN plus zweites Geheimnis

Administratoren verwenden die gewohnte PIN und zusätzlich beispielsweise TOTP oder
einen statischen zweiten Code.

- **Sicherheit:** stärker als PIN allein, besonders gegen Schulterblick.
- **Bedienbarkeit:** ein zusätzliches Gerät oder ein sicher verwahrter Code wird im
  Festbetrieb benötigt; Zeitabweichung und Gerätewechsel erzeugen Störfälle.
- **Recovery:** zusätzliche Seed- oder Recovery-Code-Verwaltung, ohne Cloud-Pflicht.
- **Aufwand:** hoch und für kleine Vereine schwerer zu erklären.
- **Entscheidung:** verworfen.

### C. Persönliche PIN und lokales HTTP – gewählt

Bestehende PIN-Anmeldung, schnelle Benutzerwechsel, Browser-JWT und lokaler
HTTP-Betrieb bleiben erhalten.

- **Sicherheit:** ausschließlich im kontrollierten lokalen Netz vertretbar; die oben
  genannten Risiken bleiben bestehen.
- **Bedienbarkeit:** beste der betrachteten Möglichkeiten; einheitlicher Ablauf für
  alle Helfer.
- **Recovery:** PIN kann durch einen anderen Administrator geändert werden. Der letzte
  Notfallweg bleibt lokaler Datenbank-/Serverzugriff gemäß Betriebsdokumentation.
- **Aufwand:** keine Produktionsmigration aus Issue #68.
- **Entscheidung:** gewählt und durch die Projektleitung ausdrücklich freigegeben.

## Verbindliche organisatorische Schutzmaßnahmen

Die bewusst einfachere technische Lösung ist nur zusammen mit folgenden
Betriebsregeln freigegeben:

1. Kein Gast-WLAN für VereinOrder. Bediengeräte verwenden ein getrenntes,
   passwortgeschütztes Vereinsnetz.
2. Keine Portweiterleitung und kein Cloud-Tunnel. Die lokale Erreichbarkeit wird vor
   jedem Fest geprüft.
3. Standard-PINs wie `1234`, identische PINs für mehrere produktive Personen und auf
   Geräten notierte PINs sind unzulässig. Synthetische Testbenutzer bleiben auf
   eindeutig geprüfte Testdatenbanken beschränkt.
4. Jede Person verwendet ein eigenes Konto. Gemeinsame Konten würden Audit und
   Verantwortlichkeit aufheben.
5. Administratoren melden sich nach der Verwaltung ab und lassen kein entsperrtes
   Gerät unbeaufsichtigt.
6. Verlorene Geräte werden sofort gemeldet; der betroffene Benutzer wird deaktiviert
   und dessen PIN geändert. Dass ein bereits kopiertes JWT damit heute nicht sofort
   widerrufen wird, ist Teil der angenommenen Restgefahr.
7. Backups werden wie Zugangsdaten behandelt, weil sie PIN-Hashes enthalten.

Diese ADR erlaubt keine Abschwächung der Backend-Rollenprüfung, der
Anmeldedrosselung, des Audits oder der Trennung von Test- und Echtbetrieb.

## Bootstrap, PIN-Wechsel und Recovery

- Es gibt trotz der Entscheidung für PIN **kein** freigegebenes produktives
  Standardgeheimnis. `admin`/`1234` bleibt ausschließlich synthetischer Testbestand.
- Die Installation muss einen lokal gewählten persönlichen Admin-PIN setzen. Ein
  Standard-PIN darf nicht in Dokumentation, Containerabbild oder öffentlicher
  Konfiguration ausgeliefert werden.
- Ein angemeldeter Administrator darf PINs ändern. Benutzerdeaktivierung und
  PIN-Änderung werden auditiert.
- Wenn kein Administrator mehr zugänglich ist, ist lokaler administrativer Zugriff auf
  den Raspberry Pi der letzte Recovery-Vertrauensanker. Der Vorgang muss im
  Wartungsmodus erfolgen und ohne PIN oder Hash im Protokoll auditiert werden.
- Ein öffentlicher „PIN vergessen"-Endpunkt, E-Mail-Recovery oder Cloud-Dienst wird
  nicht eingeführt.

## Token-, Ablauf- und Benutzerwechselentscheidung

- Das bestehende Browser-JWT mit zwölf Stunden absoluter Gültigkeit bleibt für alle
  Rollen bestehen.
- Die automatische Bildschirmsperre bleibt standardmäßig bei 60 Sekunden und darf nur
  auf die vorhandenen Werte 30 Sekunden bis 15 Minuten eingestellt werden.
- Entsperren und Benutzerwechsel verlangen Benutzername und persönliche PIN. Ein
  erfolgreicher Wechsel ersetzt das im Browser gespeicherte JWT; der Warenkorb darf
  lokal erhalten bleiben.
- Logout entfernt das lokale JWT. Es existiert im Rahmen dieser Entscheidung kein
  serverseitiger Einzelwiderruf.
- Bei Benutzerdeaktivierung, Rollen- oder PIN-Änderung bleiben bereits ausgestellte
  JWTs technisch bis zum Ablauf gültig. Dieses Verhalten ist ausdrücklich als Risiko
  akzeptiert, nicht als sofortiger Widerruf beschrieben.
- Nach Geräteverlust gilt deshalb zusätzlich: betroffenes Gerät soweit möglich
  physisch sichern beziehungsweise Browserdaten löschen und spätestens nach zwölf
  Stunden von einer Entwertung ausgehen. Für einen sofortigen globalen Widerruf kann
  der JWT-Schlüssel lokal gewechselt und das Backend neu gestartet werden; dadurch
  werden alle Benutzer abgemeldet.

## CORS-, Origin- und CSRF-Bewertung

Bearer-Token in einem expliziten `Authorization`-Header werden von einer fremden
Webseite nicht automatisch mitgesendet. Klassisches cookiebasiertes CSRF ist deshalb
im gewählten Stand nicht der primäre Angriff. Das JWT im Webspeicher erhöht dafür die
Auswirkung einer XSS-Lücke.

Pauschales CORS ist für den gleichursprünglichen Festbetrieb nicht erforderlich. Seine
spätere Einschränkung auf den tatsächlich konfigurierten lokalen Ursprung wäre eine
risikoarme Härtung, ist aber nicht Bestandteil von Issue #68 und ändert weder PIN noch
HTTP. Wildcard-CORS zusammen mit Zugangsdaten darf nicht eingeführt werden.

## Folgen

### Gewonnen

- Der Anmelde- und Benutzerwechselablauf bleibt für alle Helfer einheitlich.
- Keine Zertifikate, Zweitgeräte, Passphrase-Recovery oder neue Sitzungsdatenbank sind
  für den Festbetrieb erforderlich.
- Der Betrieb bleibt vollständig offline und auf gewöhnlichen Browsern möglich.
- Issue #68 erzeugt keine riskante Auth-Migration unmittelbar vor dem Festbetrieb.

### Erkauft

- Administratorzugang ist nicht stärker als der Zugang operativer Rollen.
- PIN und JWT werden über HTTP nicht transportverschlüsselt.
- Browser-JWTs sind bei Geräteverlust, XSS, PIN-Wechsel oder Rollenänderung nicht
  einzeln und nicht sofort widerrufbar.
- Ein entwendeter Backup-Hash einer kurzen PIN bietet nur begrenzten Schutz gegen
  Offline-Durchprobieren.
- Die Sicherheit hängt stärker von WLAN-Trennung, Geräteaufsicht und persönlicher
  Kontonutzung ab.

## Folgearbeiten

Aus Issue #68 entstehen aufgrund der Entscheidung keine Authentifizierungs- oder
HTTPS-Produktionsänderungen. Die organisatorischen Betriebsregeln werden bei der
Festvorbereitung geprüft.

Eine neue technische Entscheidung ist zwingend, sobald öffentliche Erreichbarkeit,
Fernwartung, Gastnetz-Nutzung, Cloud-Anbindung oder ein längeres Sitzungsfenster
geplant werden. Dann sind mindestens starke Admin-Zugangsdaten,
Transportverschlüsselung und serverseitiger Widerruf erneut zu bewerten.

## Prüfszenarien für den gewählten Stand

Die Entscheidung wurde anhand folgender Abläufe bewertet:

- Nicht technikaffiner Helfer meldet sich mit persönlicher PIN an und wechselt ohne
  zusätzliches Gerät den Benutzer.
- Administrator arbeitet lokal ohne Internet und kann nach automatischer Sperre mit
  seiner PIN fortfahren.
- Fünf falsche PIN-Versuche führen zur vorhandenen zeitlichen Sperre und zum Audit.
- Kellner-PIN erteilt keine Administratorrolle; alle Admin-Endpunkte bleiben durch
  Backend-Guards geschützt.
- Test- und Echtbetrieb bleiben serverseitig getrennt.
- Verlorenes Gerät führt zu Benutzerdeaktivierung, PIN-Wechsel und organisatorischer
  Wartezeit bis zum JWT-Ablauf beziehungsweise bei hoher Dringlichkeit zum globalen
  JWT-Schlüsselwechsel.
- Betrieb ohne öffentliches Internet und ohne externen Identitätsdienst bleibt
  möglich.

Die Restgefahren aus der Tabelle sind kein Testfehler, sondern Bestandteil der
ausdrücklich angenommenen Architekturentscheidung.
