# VereinOrder Admin-Panel – Bedien- und Gestaltungskonzept

Status: verbindliches Umsetzungskonzept für Issue #120  
Stand: 24. August 2026  
Geltungsbereich: `/admin` und alle künftigen Admin-Unterseiten

## 1. Gegenstand und einzelne Aufgabe

VereinOrder wird von Vereinsmitgliedern bedient, die nur an wenigen Tagen im
Jahr mit Kassen- und Verwaltungssoftware arbeiten. Das Admin-Panel ist deshalb
kein Analyse-Dashboard für tägliche Büroarbeit. Es ist der lokale Leitstand, in
dem eine verantwortliche Person einen Festbetrieb vorbereitet, prüft und bei
Störungen sicher handelt.

Die einzelne Aufgabe des Panels lautet:

> Einen lokalen Festbetrieb verständlich einrichten, seinen Zustand erkennen
> und notwendige Eingriffe sicher ausführen.

Das Panel bleibt Teil von VereinOrder. Es ist keine zweite Anwendung und kein
losgelöstes Technik-Portal.

## 2. Gestaltungsrichtung

### 2.1 Gewählte Richtung: Vereins-Leitstand

Die bestehende dunkle VereinOrder-Oberfläche bleibt erkennbar. Die Verwaltung
erhält jedoch eine festere, ruhigere Struktur als die Kassenoberflächen:

- eine beschriftete, nach Aufgaben gruppierte Sidebar;
- einen eindeutigen Seitenkopf statt eines globalen Sammelkopfs;
- ein schmales Betriebsband mit belegbaren Zuständen;
- zurückhaltende Flächen statt vieler gleich gewichteter Glaskarten;
- klare Verben und reale Fachbegriffe statt technischer Bezeichnungen.

Die visuelle Referenz ist kein beliebiges SaaS-Dashboard, sondern ein sauber
beschriftetes Schaltpult im Festbüro: Man erkennt, wo man ist, welcher Betrieb
betroffen ist und was als Nächstes sicher möglich ist.

### 2.2 Verworfene Richtungen

| Richtung                              | Warum sie nicht passt                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| KPI-Dashboard mit großen Zahlenkarten | Umsatz und Auswertung gehören zur Revision. Dekorative Kennzahlen helfen beim Einrichten und Störungsbeheben nicht.      |
| Vollflächige Glasoptik                | Viele halbtransparente Flächen schwächen Hierarchie und Lesbarkeit, besonders auf schwächeren Displays.                  |
| Reine Icon-Sidebar                    | Selten geschulte Benutzer sollen nicht lernen müssen, welches Symbol für Backup, Wartung oder Audit steht.               |
| Verschachtelte Akkordeon-Menüs        | Die wichtigsten Verwaltungsbereiche würden hinter zusätzlichen Klicks verschwinden.                                      |
| Helles Büro-Theme                     | Es bricht die Identität und verschlechtert den Wechsel zwischen Kasse, Station und Verwaltung in dunklen Festumgebungen. |

### 2.3 Selbstkritik und Korrektur

Ein erster Ansatz mit Statuskarten, einklappbarer Icon-Leiste und mehreren
farbigen Akzenten wäre austauschbar und für VereinOrder zu technisch gewesen.
Er wurde auf eine einzige charakteristische Idee reduziert: das Betriebsband.
Die Sidebar bleibt standardmäßig beschriftet. Farbe kennzeichnet Zustände nur
zusätzlich zu Text und Symbol.

## 3. Informationsarchitektur

Jeder heutige Verwaltungsbereich ist genau einer Gruppe zugeordnet. Gruppen
strukturieren die Liste, sind aber keine zusätzliche Navigationsebene und
lassen sich nicht zuklappen.

### Übersicht

- **Betriebsübersicht**

### Betrieb

- **Veranstaltungen**
- **Bereiche**
- **Stationen**

### Sortiment

- **Kategorien**
- **Produkte**

### Personal

- **Mitarbeiter**

### System

- **Drucker & Bon-Routing**
- **Backups & Wiederherstellung**
- **Wartungsmodus**
- **Systemstatus & Diagnose**

### Sicherheit

- **Audit-Protokoll**

Die Reihenfolge folgt dem Arbeitsablauf: zuerst Überblick und Festbetrieb,
dann Sortiment und Personal, danach technische Eingriffe und zuletzt der
nur lesende Sicherheitsnachweis.

## 4. Seitenkatalog und URL-Modell

`/admin` leitet mit `replace` auf `/admin/overview`. Der aktive Bereich wird
nicht zusätzlich im Komponentenstatus gespeichert. URL, Seitenüberschrift
und `aria-current="page"` sind die drei verbindlichen Quellen für den Ort.

| Gruppe     | URL                  | Seitentitel                 | Kurzbeschreibung                                                   | Primäre Aktion                              |
| ---------- | -------------------- | --------------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| Übersicht  | `/admin/overview`    | Betriebsübersicht           | Aktive Veranstaltung, lokaler Systemzustand und Handlungsbedarf.   | Status aktualisieren                        |
| Betrieb    | `/admin/events`      | Veranstaltungen             | Veranstaltungen vorbereiten, testen, aktivieren und abschließen.   | Veranstaltung anlegen                       |
| Betrieb    | `/admin/areas`       | Bereiche                    | Bedienbereiche und ihre Reihenfolge verwalten.                     | Bereich anlegen                             |
| Betrieb    | `/admin/stations`    | Stationen                   | Ausgabe-, Küchen- und Verkaufsstationen zuordnen.                  | Station anlegen                             |
| Sortiment  | `/admin/categories`  | Kategorien                  | Produkte verständlich gruppieren und Zielstationen vorgeben.       | Kategorie anlegen                           |
| Sortiment  | `/admin/products`    | Produkte                    | Preise, Kategorien, Stationen und Auswahlgruppen pflegen.          | Produkt anlegen                             |
| Personal   | `/admin/users`       | Mitarbeiter                 | Benutzer, Rollen und lokale Zugänge verwalten.                     | Mitarbeiter anlegen                         |
| System     | `/admin/printers`    | Drucker & Bon-Routing       | Druckwege, Ersatzdrucker und unklare Aufträge prüfen.              | Drucker anlegen                             |
| System     | `/admin/backups`     | Backups & Wiederherstellung | Sicherungen erstellen, prüfen und kontrolliert wiederherstellen.   | Datensicherung erstellen                    |
| System     | `/admin/maintenance` | Wartungsmodus               | Schreibzugriffe für sichere Wartungsarbeiten kontrolliert sperren. | Nächsten sicheren Wartungsschritt ausführen |
| System     | `/admin/diagnostics` | Systemstatus & Diagnose     | Backend, Datenbank, Druck und Sicherungen lokal prüfen.            | Status aktualisieren                        |
| Sicherheit | `/admin/audit`       | Audit-Protokoll             | Sicherheits- und Geldaktionen nachvollziehen und exportieren.      | CSV exportieren                             |

Die primäre Aktion des Wartungsmodus trägt immer den konkreten nächsten
Schritt, beispielsweise „Wartungsmodus starten“ oder „Wartungsmodus beenden“.
Ein allgemeines „Ausführen“ ist unzulässig.

Ungültige Admin-Unterseiten zeigen innerhalb der Admin-Shell:

> Verwaltungsseite nicht gefunden. Öffne die Betriebsübersicht oder wähle
> links einen Bereich.

Die Anzeige enthält die Aktion **Betriebsübersicht öffnen**. Sie leitet nicht
still um, weil eine vertippte oder veraltete URL sonst unbemerkt bliebe.

## 5. Zusammenspiel mit der globalen Navigation

### 5.1 Entscheidung

Innerhalb von `/admin/*` ist die Admin-Sidebar die einzige Bereichsnavigation.
Die gewöhnliche horizontale Hauptnavigation aus `AppLayout` wird dort nicht
parallel angezeigt.

Eine kompakte, anwendungsweite Kopfzeile bleibt erhalten. Sie enthält:

1. VereinOrder-Zeichen und den Text **Verwaltung**;
2. die eindeutige Ausstiegsaktion **Zur Bestellaufnahme**;
3. **Benutzer wechseln** mit aktuellem Benutzernamen;
4. **Abmelden**.

„Meine Kassa“, „Stationen“, „Revision“ und andere operative Ziele werden nicht
zusätzlich in die Admin-Kopfzeile gelegt. Die Aktion **Zur Bestellaufnahme**
führt in die für den aktuellen Administrator vorgesehene operative Startseite.
Die Browser-Zurück-Funktion bleibt davon unabhängig.

### 5.2 Wartungsmodus

Im gesperrten Wartungsmodus bleibt die gesamte Admin-Shell für
`ADMINISTRATOR` erhalten. Admin-Unterseiten, die nur lesen oder zur Auflösung
des Wartungszustands nötig sind, bleiben erreichbar. Die heutige Prüfung auf
den exakten Pfad `/admin` muss deshalb bei der Umsetzung auf `/admin/*`
erweitert werden.

Andere Rollen sehen weiterhin ausschließlich die Wartungsanzeige. Sichtbares
Verbergen ersetzt keinen Backend-Guard.

## 6. Admin-Shell

Die Shell besteht aus vier dauerhaften Zonen:

1. **Anwendungsleiste** – Identität, sicherer Ausstieg, Benutzeraktionen;
2. **Sidebar** – ausschließlich Admin-Bereiche;
3. **Betriebsband** – Veranstaltung, Betriebsart, Verbindung, Hinweise;
4. **Seitenfläche** – Seitenkopf, Werkzeuge und fachlicher Inhalt.

Die Seitenfläche folgt immer demselben Aufbau:

```text
Seitenpfad / Gruppe
Seitentitel                         [Primäre Aktion]
Kurze, konkrete Aufgabenbeschreibung
[Veranstaltungsauswahl, falls fachlich erforderlich]

Betriebsband

Werkzeugleiste: Suche / Filter / Sortierung / Aktualisieren
Inhalt: Tabelle, Karten, Formularhinweis oder Status
```

Es gibt pro Seite höchstens eine visuell primäre Aktion. Gefährliche Aktionen
sind niemals primär und werden nicht in das Betriebsband gelegt.

## 7. Signatur: das Betriebsband

Das Betriebsband ist kein Kennzahlenblock. Es beantwortet auf jeder
Admin-Seite drei Fragen:

1. **Woran arbeite ich?** – „Sommerfest 2026 · Testbetrieb“;
2. **Ist das lokale System erreichbar?** – „Lokal verbunden · vor 12 s“;
3. **Muss ich handeln?** – „2 Hinweise · Druck prüfen“ oder „Keine Hinweise“.

Beispiel:

```text
┌ Sommerfest 2026 · TESTBETRIEB ┬ Lokal verbunden · vor 12 s ┬ 2 Hinweise · Druck prüfen ┐
```

Regeln:

- Betriebsart steht ausgeschrieben im Band; `LIVE` oder `TEST_MODE` sind
  keine sichtbaren Hauptbezeichnungen.
- Testbetrieb verwendet zusätzlich ein Kolben-Symbol und den Text
  **Testbetrieb**.
- Echtbetrieb verwendet zusätzlich ein Schild-Symbol und den Text
  **Echtbetrieb**.
- Unbekannte Daten werden als **Betriebsart unbekannt** oder
  **Verbindung nicht geprüft** angezeigt, niemals als Null oder Erfolg.
- Ein Hinweis verlinkt in den zuständigen Bereich, löst aber nichts aus.
- Die Quelle besitzt einen sichtbaren Aktualisierungszeitpunkt.
- Bei Teilfehlern bleiben belegte Segmente stehen; das betroffene Segment
  erklärt den Fehler und bietet **Erneut prüfen**.
- Auf dem Smartphone stehen die drei Segmente untereinander.

## 8. Responsives Verhalten und Wireframes

### 8.1 Desktop – 1440 × 900

- Anwendungsleiste: 64 px hoch;
- Sidebar: 264 px breit und unter der Anwendungsleiste klebend;
- Seitenfläche: bis 1180 px breit, mit 24 px Innenabstand;
- Sidebar und Seite besitzen bei Bedarf getrennte vertikale Scrollbereiche;
  die Seite bleibt der primäre Scrollbereich.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ VereinOrder · Verwaltung    Zur Bestellaufnahme     admin  Wechseln  Abmelden│
├──────────────────┬───────────────────────────────────────────────────────────┤
│ ÜBERSICHT        │ Betrieb / Veranstaltungen          [Veranstaltung anlegen]│
│ ▣ Betriebsübers. │ Veranstaltungen verwalten                                │
│                  │ ┌ Sommerfest · TEST ┬ Lokal verbunden ┬ Keine Hinweise ┐ │
│ BETRIEB          │ └───────────────────────────────────────────────────────┘ │
│ ◫ Veranstaltungen│                                                           │
│ ◫ Bereiche       │ [Suche________________] [Status ▾] [Aktualisieren]         │
│ ◫ Stationen      │ ┌───────────────────────────────────────────────────────┐ │
│                  │ │ Veranstaltungen / fachlicher Seiteninhalt             │ │
│ SORTIMENT        │ │                                                       │ │
│ ◫ Kategorien     │ │                                                       │ │
│ ◫ Produkte       │ └───────────────────────────────────────────────────────┘ │
│                  │                                                           │
│ PERSONAL         │                                                           │
│ ◫ Mitarbeiter    │                                                           │
│                  │                                                           │
│ SYSTEM           │                                                           │
│ ◫ Drucker        │                                                           │
│ ◫ Backups        │                                                           │
│ ◫ Wartungsmodus  │                                                           │
│ ◫ Diagnose       │                                                           │
│                  │                                                           │
│ SICHERHEIT       │                                                           │
│ ◫ Audit-Protokoll│                                                           │
└──────────────────┴───────────────────────────────────────────────────────────┘
```

Fokusreihenfolge:

1. Sprunglink **Zum Verwaltungsinhalt**;
2. VereinOrder/Verwaltung und **Zur Bestellaufnahme**;
3. Benutzer wechseln und Abmelden;
4. Sidebar von oben nach unten;
5. Seitentitel und primäre Aktion;
6. Betriebsband;
7. Werkzeuge;
8. fachlicher Inhalt.

### 8.2 Tablet – 768 × 1024

- Anwendungsleiste: 64 px;
- beschriftete Sidebar: 216 px;
- kürzere Seitenbeschreibungen, aber keine abgekürzten Navigationsbegriffe;
- Gruppenabstände werden reduziert, Gruppen bleiben vollständig sichtbar;
- Seitenaktionen dürfen unter den Titel umbrechen;
- Tabellen scrollen nur horizontal in ihrem eigenen gekennzeichneten Rahmen.

```text
┌──────────────────────────────────────────────────────────────┐
│ Verwaltung       Zur Bestellaufnahme      admin   Abmelden  │
├─────────────────┬────────────────────────────────────────────┤
│ ÜBERSICHT       │ Veranstaltungen                          │
│ Betriebsübers.  │ Veranstaltungen vorbereiten              │
│                 │ [Veranstaltung anlegen]                   │
│ BETRIEB         │ ┌ Sommerfest · TEST ────────────────────┐ │
│ Veranstaltungen │ │ Lokal verbunden · Keine Hinweise      │ │
│ Bereiche        │ └───────────────────────────────────────┘ │
│ Stationen       │                                            │
│                 │ [Suche___________] [Filter ▾]              │
│ SORTIMENT       │ ┌────────────────────────────────────────┐ │
│ Kategorien      │ │ fachlicher Inhalt                     │ │
│ Produkte        │ │                                      ⇆│ │
│                 │ └────────────────────────────────────────┘ │
│ PERSONAL        │                                            │
│ Mitarbeiter     │                                            │
│                 │                                            │
│ SYSTEM          │                                            │
│ Drucker         │                                            │
│ Backups         │                                            │
│ Wartungsmodus   │                                            │
│ Diagnose        │                                            │
│                 │                                            │
│ SICHERHEIT      │                                            │
│ Audit-Protokoll │                                            │
└─────────────────┴────────────────────────────────────────────┘
```

Die Sidebar kann auf ausdrückliche Aktion temporär geschlossen werden. Sie
startet jedoch beschriftet und offen. Ein Zustand „nur Icons“ ist nicht
vorgesehen. Der Schließzustand darf lokal gespeichert werden; beim nächsten
Öffnen erscheint ein beschrifteter Dialog.

### 8.3 Smartphone – 390 × 844

- keine dauerhaft sichtbare Sidebar;
- Anwendungsleiste: 56 px mit **Verwaltung**, Menü und Benutzeraktion;
- der Menüknopf öffnet einen modalen Navigationsdialog bis maximal 360 px;
- das Hauptdokument scrollt vertikal;
- primäre Aktion steht direkt unter Titel/Beschreibung und nutzt bei langen
  Bezeichnungen die volle Breite;
- Betriebsband steht in drei Zeilen;
- Tabellen werden als Karten-/Zeilenansicht dargestellt. Nur fachlich echte
  Tabellen dürfen einen deutlich erkennbaren horizontalen Scrollrahmen nutzen.

```text
┌──────────────────────────────────────┐
│ ☰  Verwaltung          admin  Abmelden│
├──────────────────────────────────────┤
│ Betrieb / Veranstaltungen            │
│ Veranstaltungen                      │
│ Veranstaltungen vorbereiten …        │
│ [ Veranstaltung anlegen            ] │
│                                      │
│ ┌ Sommerfest 2026 · TESTBETRIEB    ┐ │
│ ├ Lokal verbunden · vor 12 s       ┤ │
│ └ 2 Hinweise · Druck prüfen        ┘ │
│                                      │
│ [Suche____________________________]  │
│ [Status ▾]       [Aktualisieren]     │
│                                      │
│ ┌ Sommerfest 2026                   ┐ │
│ │ Testbetrieb · 24.–25. August     │ │
│ │ 12 Produkte · 2 Stationen        │ │
│ │ [Bearbeiten] [Weitere Aktionen ▾]│ │
│ └───────────────────────────────────┘ │
└──────────────────────────────────────┘

Geöffnete Navigation:

┌──────────────────────────────────────┐
│ Verwaltung                       [×] │
│ Übersicht                            │
│   Betriebsübersicht                  │
│ Betrieb                              │
│   Veranstaltungen                    │
│   Bereiche                           │
│   Stationen                          │
│ Sortiment                            │
│   Kategorien                         │
│   Produkte                           │
│ …                                    │
│──────────────────────────────────────│
│ Zur Bestellaufnahme                  │
│ Benutzer wechseln                    │
│ Abmelden                             │
└──────────────────────────────────────┘
```

Fokus im geöffneten Dialog:

1. Schließen;
2. Admin-Bereiche von oben nach unten;
3. Zur Bestellaufnahme;
4. Benutzer wechseln;
5. Abmelden.

Der Fokus bleibt im Dialog. `Escape`, Klick auf die abgedunkelte Fläche und
**Schließen** schließen ihn. Danach kehrt der Fokus zum Menüknopf zurück. Der
Hintergrund ist währenddessen `inert` und scrollt nicht.

## 9. Design-Tokens

### 9.1 Kernpalette

| Token                                | Hex       | Aufgabe                                                   |
| ------------------------------------ | --------- | --------------------------------------------------------- |
| `admin-canvas` „Zeltnacht“           | `#020617` | Seitenhintergrund, Tailwind `slate-950`                   |
| `admin-sidebar` „Schaltpult“         | `#0F172A` | Sidebar und feste Kopfzeile, `slate-900`                  |
| `admin-panel` „Paneel“               | `#1E293B` | Werkzeuge, Zeilen und hervorgehobene Flächen, `slate-800` |
| `admin-divider` „Beschriftungslinie“ | `#475569` | sichtbare Trennung, nicht als alleiniger Fokusindikator   |
| `admin-text` „Arbeitslicht“          | `#F8FAFC` | Haupttext, `slate-50`                                     |
| `admin-accent` „Vereins-Indigo“      | `#A5B4FC` | aktiver Ort, Links und ruhige Hervorhebung, `indigo-300`  |

Primäre Schaltflächen verwenden `#4F46E5` mit `#F8FAFC`. Große Flächen
verwenden höchstens einen Indigo-Akzent; Emerald, Amber und Rose bleiben
semantischen Zuständen vorbehalten.

### 9.2 Zustände

| Zustand                      | Text      | Hintergrund | zusätzliche Kennzeichnung                   |
| ---------------------------- | --------- | ----------- | ------------------------------------------- |
| bereit / Echtbetrieb         | `#6EE7B7` | `#064E3B`   | Schild oder Haken + ausgeschriebener Text   |
| Testbetrieb / Aufmerksamkeit | `#FCD34D` | `#78350F`   | Kolben oder Dreieck + ausgeschriebener Text |
| kritisch / gesperrt          | `#FDA4AF` | `#881337`   | Warnsymbol + Ursache und nächste Handlung   |
| unbekannt / nicht geprüft    | `#CBD5E1` | `#334155`   | Fragezeichen + „nicht geprüft“              |

Kein pulsierender Punkt ist alleinige Zustandsanzeige. Animation darf keinen
Unterschied zwischen sicher und unsicher tragen.

### 9.3 Kontrastnachweise

Die Werte wurden nach WCAG 2.x aus den sRGB-Relative-Luminance-Werten
berechnet.

| Paar                    | Verhältnis | Verwendung                   |
| ----------------------- | ---------: | ---------------------------- |
| `#F8FAFC` auf `#020617` |    19,28:1 | Haupttext                    |
| `#CBD5E1` auf `#0F172A` |    12,02:1 | Neben- und Beschreibungstext |
| `#94A3B8` auf `#0F172A` |     6,96:1 | zurückhaltende Metadaten     |
| `#A5B4FC` auf `#1E293B` |     7,34:1 | aktive Navigation und Links  |
| `#F8FAFC` auf `#4F46E5` |     6,01:1 | primäre Schaltfläche         |
| `#6EE7B7` auf `#064E3B` |     6,38:1 | bereit / Echtbetrieb         |
| `#FCD34D` auf `#78350F` |     6,29:1 | Testbetrieb / Aufmerksamkeit |
| `#FDA4AF` auf `#881337` |     5,06:1 | kritisch / gesperrt          |

Der Fokusindikator verwendet `#FDE68A`, 3 px durchgehend plus 2 px Abstand.
Sein Kontrast beträgt 16,20:1 zu `#020617`, 14,33:1 zu `#0F172A`, 11,75:1
zu `#1E293B` und 5,05:1 zur primären Fläche `#4F46E5`.

### 9.4 Typografie ohne Internetabhängigkeit

| Rolle                                | Schriftfolge                                                           | Größen und Gewichte                                                  |
| ------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Marke und Seitentitel                | lokal gebündeltes `Outfit`, danach `system-ui`, `Segoe UI`, sans-serif | 28/34 px und 700; mobil 24/30 px                                     |
| Bedienung und Fließtext              | `system-ui`, `Segoe UI`, sans-serif                                    | 16/24 px regulär, 14/20 px für Beschreibungen, 600 für Schaltflächen |
| Kennungen, Zeit und technische Werte | `ui-monospace`, `Cascadia Mono`, `Consolas`, monospace                 | 12/18 oder 14/20 px, tabellarische Ziffern                           |

`Outfit` darf nicht von Google Fonts oder einer anderen öffentlichen Quelle
zur Laufzeit geladen werden. Die Umsetzung bündelt benötigte Schnitte lokal
oder verwendet vollständig die Systemschrift. Es gibt keinen unsichtbaren
Layoutwechsel nach einem fehlgeschlagenen Netzaufruf.

### 9.5 Maße

- Raster: 4 px;
- Abstände: 4, 8, 12, 16, 24, 32 und 48 px;
- kleinste Touch-Fläche: 44 × 44 px;
- Standardsteuerung: mindestens 44 px hoch;
- primäre Schaltfläche auf Mobilgeräten: mindestens 48 px hoch;
- Radius Steuerung: 10 px;
- Radius Panel: 16 px;
- Radius große Dialoge: 20 px;
- Sidebar Desktop: 264 px;
- Sidebar Tablet: 216 px;
- mobiler Dialog: `min(360px, 100vw)`.

## 10. Interaktion und Bewegung

- Farb- und Hintergrundwechsel: 120 ms;
- mobiler Navigationsdialog: 180 ms;
- keine gestaffelten Seiten- oder Kartenanimationen;
- keine Animation beim periodischen Statusabruf;
- Layout darf beim Nachladen nicht springen;
- `prefers-reduced-motion: reduce` entfernt Translation, Zoom und
  nicht notwendige Übergänge vollständig;
- aktive Betätigung darf eine Fläche leicht abdunkeln, aber nicht auf eine
  reine Skalierungsanimation angewiesen sein.

## 11. Seitenzustände und Sprache

Jede Seite besitzt dieselben vier Grundzustände:

### Laden

Die Seitenstruktur und der Titel stehen bereits. Der Inhaltsbereich zeigt
beschriftete Platzhalter. Eine globale leere Seite mit „Laden …“ ist nicht
zulässig.

### Leer

Ein leerer Zustand erklärt, warum die Liste leer ist und welche Aktion hilft:

> Noch keine Kategorien angelegt. Lege zuerst eine Kategorie an, damit du
> Produkte eindeutig zuordnen kannst.

Aktion: **Kategorie anlegen**.

### Fehler

Fehler nennen Gegenstand und nächsten Schritt:

> Drucker konnten nicht geladen werden. Prüfe die lokale Verbindung und
> versuche es erneut.

Aktion: **Erneut laden**. Technische Details stehen nur in einer aufklappbaren
Diagnose, niemals anstelle der verständlichen Meldung.

### Teilfehler oder veraltete Daten

Vorhandene Daten bleiben sichtbar. Ein Hinweis nennt die letzte erfolgreiche
Aktualisierung und markiert nur den betroffenen Teil als ungeprüft.

Schaltflächen verwenden aktive Verben:

- **Produkt speichern**, nicht „Absenden“;
- **Datensicherung erstellen**, nicht „Backup starten“;
- **Wiederherstellung vorbereiten**, nicht „Restore“;
- **Wartungsmodus starten**, nicht „Aktivieren“;
- **CSV exportieren**, nicht „Download“.

## 12. Tabellen, Karten und Formulare

### Tabellen

- Tabellenkopf bleibt bei langen Listen innerhalb des Inhaltsbereichs klebend;
- die erste Spalte benennt den Gegenstand;
- Aktionen stehen rechts und besitzen sichtbare Textalternativen;
- horizontales Scrollen ist auf den Tabellenrahmen begrenzt und wird durch
  einen Schatten beziehungsweise eine Scrollkante erkennbar;
- die gesamte Seite erhält keinen horizontalen Überlauf;
- auf Smartphones werden verwaltende Listen bevorzugt als Kartenzeilen
  dargestellt, sofern Spaltenbeziehungen nicht verloren gehen.

### Formulare

- Formularfelder folgen dem fachlichen Ablauf, nicht dem Datenbankschema;
- Labels bleiben beim Feld sichtbar; Platzhalter ersetzen kein Label;
- Fehler stehen beim betroffenen Feld und zusätzlich in einer
  zusammenfassenden `role="alert"`-Meldung;
- Speichern ist gegen Doppelklick gesperrt und nennt den Ladezustand;
- Abbrechen bleibt während normaler Speicherung erreichbar, außer der
  Backendvertrag verbietet einen Abbruch;
- Test-/Echtbetrieb und Veranstaltungskontext stehen vor den Feldern, die sie
  beeinflussen.

### Kritische Aktionen

Löschen, Aktivieren, Veranstaltungsabschluss, Wartung, Restore und die
Entscheidung über unklare Druckaufträge behalten ihre bestehenden
Bestätigungen und Backend-Prüfungen. Der Umbau darf sie weder in ein
Mehrfachaktionsmenü verstecken noch als primäre Seitenaktion hervorheben.

## 13. Semantik und Barrierefreiheit

- eine `header`-Landmarke für die Anwendungsleiste;
- eine `nav`-Landmarke mit `aria-label="Verwaltungsbereiche"`;
- genau ein `main` mit `id="admin-content"`;
- Sprunglink **Zum Verwaltungsinhalt** als erstes fokussierbares Element;
- genau eine sichtbare `h1` je Unterseite;
- Gruppenüberschriften in der Sidebar sind Text, keine fokussierbaren
  Pseudo-Schaltflächen;
- aktiver Link erhält `aria-current="page"`;
- Abzeichen ergänzen ihren zugänglichen Namen um die Bedeutung, zum Beispiel
  „Drucker, 2 unklare Druckaufträge“;
- Statusänderungen nach Benutzeraktionen verwenden eine höfliche Live-Region;
- kritische Fehler verwenden `role="alert"`;
- Fokus wird nicht durch Polling oder neue Hinweise verschoben;
- Dialoge sperren Fokus, unterstützen `Escape` und stellen den Auslöserfokus
  wieder her;
- Symbole sind dekorativ, wenn der angrenzende Text bereits dieselbe Aussage
  trägt.

## 14. Technische Leitplanken für die Folge-Issues

1. #121 trennt die elf fachlichen Bereiche, bevor die Route sie einzeln lädt.
2. #122 führt die Shell und Unterrouten ein; alte Tab-Zustände werden nicht
   parallel weitergeführt.
3. `RoleGuard` bleibt der Frontend-Wächter. Alle Berechtigungen bleiben im
   Backend maßgeblich.
4. Die Wartungslogik in `AppLayout` muss `/admin/*` statt nur `/admin`
   zulassen.
5. Browser-Neuladen auf einer Unterroute benötigt denselben SPA-Fallback wie
   die übrigen React-Routen.
6. Die Sidebar verwendet eine zentrale Routendefinition. Titel, Gruppe und
   Rollen werden nicht an mehreren Stellen dupliziert.
7. Das bestehende externe Google-Fonts-Stylesheet ist mit dem verbindlichen
   Offline-Betrieb unvereinbar. Spätestens #122 entfernt den Laufzeitabruf und
   bündelt die Schrift lokal oder nutzt die festgelegte Systemschriftfolge.
8. Sidebar-Präferenzen enthalten ausschließlich Darstellungszustand und keine
   fachlichen oder sicherheitsrelevanten Daten.
9. Das Betriebsband zeigt nur Daten, die bestehende Endpunkte belegen. Neue
   Sammelwerte benötigen ein eigenes Backend-Issue.
10. Alle Geld-, Storno-, Preis-, Restore-, Wartungs- und Sicherheitsaktionen
    behalten ihre Auditierbarkeit.

## 15. Konzeptprüfung gegen den Master-Prompt

| Vorgabe                               | Umsetzung im Konzept                                                 |
| ------------------------------------- | -------------------------------------------------------------------- |
| selbsterklärend und wenig Einschulung | beschriftete Sidebar, reale Begriffe, konkrete Leer- und Fehlertexte |
| Touchscreens und Handschuhe           | mindestens 44 × 44 px, mobil primär 48 px                            |
| kleine Smartphones                    | modaler Navigationsdialog, Kartenzeilen, kein Seitenüberlauf         |
| PC, Tablet und Smartphone             | drei festgelegte Shell-Zustände mit Wireframes                       |
| hohe Kontraste                        | berechnete Kontrastpaare über 4,5:1                                  |
| Status nicht nur über Farbe           | Text, Symbol, Zeitpunkt und Farbe                                    |
| kritische Aktionen bestätigen         | bestehende Bestätigungen bleiben fachlich verankert                  |
| Verbindungsprobleme sichtbar          | Betriebsband und ehrliche Teilfehler                                 |
| Rollen und Backend-Berechtigung       | Admin-Shell nur für Administrator; Backend bleibt maßgeblich         |
| lokaler Betrieb ohne Internet         | keine Laufzeitschrift oder andere öffentliche Abhängigkeit           |
| Test- und Echtbetrieb trennen         | Betriebsart dauerhaft ausgeschrieben und fachlich kontextualisiert   |
| österreichische Sprache und Formate   | deutsche Begriffe, österreichische Zeit- und Datumsdarstellung       |

## 16. Abnahme der Umsetzung

Die Folgeumsetzung ist erst abgenommen, wenn:

- alle Unterseiten per Sidebar, direkter URL, Neuladen sowie Browser Vor/Zurück
  erreichbar sind;
- `admin` und `kellner1` auf 390 × 844, 768 × 1024 und 1440 × 900 geprüft
  wurden;
- keine Seite unbeabsichtigt horizontal überläuft;
- mobile Navigation, Dialoge und Formulare vollständig per Tastatur bedienbar
  sind;
- Fokusindikatoren sichtbar sind und nach Dialogen korrekt zurückkehren;
- Browserkonsole und Netzwerk keine unerwarteten Fehler enthalten;
- eine lokale Prüfung ohne öffentliche Internetverbindung erfolgreich war;
- Wartungsmodus, Backup/Restore, Druckjob-Entscheidung und Audit weiterhin
  dieselben Sicherheitsgrenzen besitzen.

## 17. Bekannte Umsetzungsrisiken

| Risiko                                                     | Behandlung                                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `AdminDashboard.tsx` koppelt alle Bereiche                 | #121 ist Voraussetzung für Shell und Inhaltsmigration.                             |
| verschachtelte Routen kollidieren mit exaktem Wartungspfad | #122 erweitert die Prüfung kontrolliert auf `/admin/*`.                            |
| globale und lokale Navigation konkurrieren                 | operative Hauptnavigation wird innerhalb der Admin-Shell nicht parallel gerendert. |
| externe Schrift fällt im Festbetrieb aus                   | Google-Fonts-Abruf entfernen; lokal bündeln oder Systemschrift nutzen.             |
| zu schmale Tablet-Inhalte                                  | beschriftete 216-px-Sidebar, optional schließbar, aber keine Icon-Leiste.          |
| Polling verschiebt Fokus oder Inhalt                       | Status aktualisiert ohne Fokuswechsel und ohne Layoutsprung.                       |
| Design vereinheitlicht kritische Abläufe zu stark          | fachliche Dialoge und Sicherheitsbestätigungen bleiben beim zuständigen Modul.     |

Mit diesen Entscheidungen sind für #121 bis #126 keine offenen
Grundsatzfragen zur Navigation, visuellen Richtung oder responsiven Shell mehr
übrig.
