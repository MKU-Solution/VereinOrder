# Bedienkonzept Produktoptionen (Issue #75)

Rolle: UI/UX-Konzept. Diese Datei beschreibt ausschließlich die Bedienoberfläche für
Kasse und Verwaltung. Datenmodell und Migration liegen bei einem anderen Mitarbeiter
und werden hier nicht festgelegt.

## Ausgangslage

Die heutige Kassenmaske (`apps/frontend/src/components/ProductOptionsModal.tsx`) kennt
zwei feste Blöcke: "Variante wählen" (Radio-artig, per `useEffect` wird beim Öffnen
automatisch die erste Variante vorausgewählt) und "Extras" (Checkbox-artig, ohne
Vorauswahl). Es gibt keinen Begriff "Pflicht", keine Prüfung vor dem Hinzufügen und
keine Unterscheidung zwischen "diese Antwort ersetzt den Preis" und "diese Antwort
zählt zum Preis dazu" außer der Formatierung des Preistexts (`formatAbsPrice` vs.
`formatPrice`). Die Verwaltung (`apps/frontend/src/pages/AdminDashboard.tsx`, Produktmodal
ab Zeile 3160) pflegt heute Name, Preis, Kategorie, Zielstation und Sortierung eines
Produkts, aber keine Varianten oder Extras.

Der Auftrag verlangt: mehrere Auswahlgruppen je Produkt, davon mehrere Pflichtgruppen
möglich, Einfach- und Mehrfachauswahl, sowie zwei Preislogiken (Endpreis je Antwort
vs. Aufpreis je Antwort, auch mit Aufpreis null). Gruppen werden ausschließlich je
Produkt gepflegt, keine Wiederverwendung über Produkte hinweg.

Begriffe in diesem Dokument: **Auswahlgruppe** (bisher "Variante"/"Extras", z. B.
"Beilage"), **Antwort** (bisher "Extra", eine wählbare Option innerhalb einer Gruppe,
z. B. "Pommes").

## Kassenmaske

### Grundprinzip: keine stille Vorauswahl, sondern ein sprechender Weiter-Button

Die heutige Zeile

```
setSelectedVariant(product.variants?.length > 0 ? product.variants[0] : null);
```

wird ersatzlos entfernt. Jede Pflichtgruppe startet unbeantwortet. Eine automatische
Erstauswahl ist keine Lösung, weil das Bedienpersonal die Vorauswahl unter Zeitdruck
nicht prüft und ein Bon mit "0,5 l" entsteht, obwohl der Gast "0,25 l" bestellt hat —
der Fehler ist im Vorgang unsichtbar, er zeigt sich erst beim Kassensturz oder bei der
Reklamation.

Statt eines separaten Fehlerzustands nach dem Tippen bekommt die Maske einen einzigen,
immer aktiven Haupt-Button, dessen Beschriftung den nächsten offenen Schritt nennt:

- Solange mindestens eine Pflichtgruppe unbeantwortet ist, lautet der Button
  **"Weiter zu: {Gruppenname}"** (bei mehreren offenen Pflichtgruppen wird die erste in
  Anzeigereihenfolge genannt). Ein Tipp auf den Button scrollt zu dieser Gruppe und
  setzt den Tastaturfokus auf deren erste Antwort; die Gruppe blitzt kurz mit einem
  Rahmen auf (siehe Zustände unten). Es wird nichts abgesendet, es ist keine Fehlermeldung,
  sondern eine Navigationshilfe.
- Sind alle Pflichtgruppen beantwortet, wechselt der Button zu **"Hinzufügen · € {Summe}"**
  und legt den Artikel in den Warenkorb.

Begründung: Ein deaktivierter ("ausgegrauter") Button an derselben Stelle wäre unter
Zeitdruck und bei Sonnenlicht schwer von einem aktiven zu unterscheiden, ist für
Tastatur/Screenreader nicht fokussierbar und beantwortet nicht, _was_ fehlt. Der
sprechende Button bleibt immer bedienbar, bleibt an derselben Position (kein Layoutsprung)
und sagt exakt, was zu tun ist. Die serverseitige/Code-seitige Prüfung in `onAdd` bleibt
zusätzlich als Absicherung bestehen (z. B. gegen Doppel-Tipp-Wettlaufsituationen); dafür
sind die unten beschriebenen Fehlerzustände nötig, sollen im Normalbetrieb aber praktisch
nie sichtbar werden.

### Sichtbarkeit der Pflichtgruppe ohne Scrollen

Unter dem Produktnamen sitzt eine **festgeklebte Status-Zeile** (sticky, bleibt beim
Scrollen der Optionenliste stehen):

- Offen: "Noch 1 Pflichtangabe offen: Beilage" bzw. bei mehreren:
  "Noch 2 Pflichtangaben offen: Größe, Beilage"
- Erledigt: "Alle Pflichtangaben ausgewählt" mit Häkchen-Symbol.

Zusätzlich werden Pflichtgruppen in der Anzeigereihenfolge immer vor freiwilligen
Gruppen platziert, unabhängig von ihrer Sortierung in der Verwaltung (siehe offene
Punkte). Damit ist die erste Pflichtgruppe im Regelfall ohnehin ohne Scrollen sichtbar;
die Status-Zeile plus der sprechende Button stellen zusätzlich sicher, dass eine
Pflichtgruppe auch dann auffindbar bleibt, wenn sie durch viele vorangehende Gruppen aus
dem sichtbaren Bereich gerutscht ist — ohne dass man dafür suchen/scrollen müsste.

Ab 1024 px Breite (siehe Breit-Skizze) steht zusätzlich eine feste rechte Spalte mit
Status-Zeile, Preiszusammenfassung und Button zur Verfügung, sodass dort gar nicht
gescrollt werden muss, um Pflichtstatus und Gesamtpreis gleichzeitig zu sehen. Diese
breite Ansicht ist ein Zusatznutzen für größere Bildschirme (Kassenübersicht am
Tresen); das Konzept darf sich für 390–1023 px (das Zielgerät: Tablet, ggf. mit
Handschuhen) nicht darauf verlassen.

### Zustände einer Gruppe

- **Unbeantwortet, Pflicht:** Rahmen `border-slate-700` (wie heute), Kopfzeile trägt
  eine Beschriftungs-Chip "Pflicht" (Text, keine reine Farbcodierung).
- **Unbeantwortet, freiwillig:** Rahmen `border-slate-700`, Chip "Freiwillig".
- **Beantwortet (einzelne Antwort ausgewählt/mehrere angehakt):** ausgewählte Antwort
  erhält Rahmen `border-indigo-500 bg-indigo-500/20` (Einfachauswahl, wie heutige
  Variante) bzw. `border-emerald-500 bg-emerald-500/20` (Mehrfachauswahl-Haken, wie
  heutige Extras) plus sichtbares Häkchen-Symbol in der Antwort selbst — Zustand ist
  also nie nur über Farbe erkennbar.
- **Fehlerzustand (nur als Absicherung, siehe oben):** Rahmen der Gruppe wechselt zu
  `border-2 border-rose-500`, unter der Gruppenüberschrift erscheint ein Text mit
  Warndreieck-Symbol: "Bitte eine Option auswählen." (`text-rose-200` auf
  `bg-rose-500/10`, siehe Kontrasttabelle). Für Screenreader wird zusätzlich eine
  `aria-live="polite"`-Ansage ausgelöst: "Bitte fehlende Pflichtangaben ergänzen:
  {Gruppenname}".

### Preisanzeige ohne Fachjargon

Zwei Preisarten, unterschiedlich beschriftet, keine Begriffe wie "additiv" oder
"Override":

- **Endpreis-Gruppen** (z. B. Getränkegröße): jede Antwort zeigt ihren vollen Preis,
  z. B. "0,5 l — € 3,50". Die gewählte Antwort ersetzt den bisherigen Gesamtpreis.
- **Aufpreis-Gruppen** (z. B. Beilage, Extras): jede Antwort zeigt entweder
  "+ € 0,50" oder, bei null Aufpreis, den bestehenden Text "Kostenlos" — bewusst
  keine neue Formulierung wie "ohne Aufpreis", um die vorhandene, bereits verständliche
  Beschriftung aus `ProductOptionsModal.tsx` (`formatPrice`/"Kostenlos") weiterzuverwenden.

Am unteren Rand der Maske steht durchgehend sichtbar (sticky footer) die Zeile
**"Gesamtpreis: € {Summe}"**, live berechnet aus: Basispreis des Produkts, ersetzt
durch die gewählte Antwort einer Endpreis-Gruppe (falls vorhanden und beantwortet),
zuzüglich aller angehakten Aufpreise. Diese Summe ist auch dann sichtbar, wenn noch
nicht alle Pflichtangaben gewählt sind (dann als Zwischenstand zu verstehen); die Zahl
auf dem Hinzufügen-Button ist identisch mit dieser Zeile, sodass keine zwei
widersprüchlichen Preise auf dem Bildschirm stehen.

### Mindestgröße der Tippflächen

- Antwort-Zeilen (ganze Zeile ist die Tippfläche, wie heute in `ProductOptionsModal.tsx`
  bereits umgesetzt): mindestens 56 px Höhe (`min-h-14`), volle Breite der Spalte,
  mindestens 8 px Abstand zur nächsten Zeile.
- Icon-Buttons (Schließen, Auf/Ab in der Verwaltung): mindestens 44×44 px.

Begründung: WCAG 2.5.8 (AA) verlangt mindestens 24×24 px, WCAG 2.5.5 (AAA) empfiehlt
44×44 px. Handschuhe verschieben den nötigen effektiven Fingerdurchmesser gegenüber
nacktem Finger deutlich nach oben (vergleichbar mit Empfehlungen für
Industrie-Touchscreens, dort werden oft 48–60 px genannt); 56 px liegt bewusst über der
AAA-Empfehlung, weil Kasse und Handschuhbedienung ein Härtefall sind, keine gewöhnliche
Bürobedienung. Sonnenlicht erschwert zusätzlich die optische Zielerfassung, was denselben
großzügigen Wert stützt.

### Skizze, schmal (390 px)

Deckt zugleich das Tablet-Hochformat-Maß aus der Browser-Smoke-Prüfung (390×844) ab
und ist die für die Kasse maßgebliche Ansicht bis 1023 px Breite.

```
+---------------------------------------+
| Schnitzel                        [X]  |
+---------------------------------------+ <- sticky
| Noch 1 Pflichtangabe offen: Beilage    |
+---------------------------------------+
| Beilage  [Pflicht]                     |
| +--------------+  +--------------+     |
| | Pommes       |  | Reis         |     |
| | Kostenlos    |  | Kostenlos    |     |
| +--------------+  +--------------+     |
|                                         |
| Extras  [Freiwillig]                   |
| +-------------------------------+      |
| | ohne Salat        Kostenlos [ ]|     |
| +-------------------------------+      |
| | extra Soße         + 0,50 [ ] |      |
| +-------------------------------+      |
|           (Liste scrollt bei Bedarf)   |
+---------------------------------------+ <- sticky
| Gesamtpreis: 8,50 EUR                  |
| [        Weiter zu: Beilage        ]   |
+---------------------------------------+
```

Nach Auswahl der Beilage wechselt der untere Button zu
`[        Hinzufügen . 8,50 EUR        ]`.

### Skizze, breit (1440 px)

```
+--------------------------------------------------------------------+
| Schnitzel                                                     [X]  |
+---------------------------------------------+----------------------+
| Beilage  [Pflicht]                           | Zusammenfassung      |
| +------------+  +------------+                | Beilage: -           |
| | Pommes     |  | Reis       |                | Extras: -            |
| +------------+  +------------+                |                      |
|                                                | Gesamtpreis: 8,50 EUR|
| Extras  [Freiwillig]                          |                      |
| +-------------------------------+             | Noch 1 Pflichtangabe |
| | ohne Salat        Kostenlos [ ]|            | offen: Beilage       |
| +-------------------------------+             |                      |
| | extra Soße         + 0,50 [ ] |             | [ Weiter zu: Beilage]|
| +-------------------------------+             |                      |
+---------------------------------------------- +----------------------+
```

Die rechte Spalte ist fest positioniert (kein Mitscrollen nötig); Pflichtstatus,
Gesamtpreis und Button sind hier dauerhaft gleichzeitig sichtbar.

## Verwaltungsmaske

Die Auswahlgruppen werden als neuer Abschnitt im bestehenden Produktmodal
(`apps/frontend/src/pages/AdminDashboard.tsx`, ab der Modal-Überschrift in Zeile 3163)
ergänzt, unterhalb des Felds "Sortierung" und oberhalb der Buttonzeile
"Abbrechen"/"Speichern". Das Modal ist bereits `overflow-y-auto` mit
`max-h-[calc(100vh-2rem)]`; der neue Abschnitt fügt sich in dieses Scrollverhalten ein,
das restliche Formular ändert sich nicht.

### Aufbau einer Gruppe

Jede Gruppe ist eine eigene Karte mit:

- Textfeld "Name der Gruppe" (Pflichtfeld, wie das bestehende Feld "Produktname").
- Umschalter "Pflicht" / "Freiwillig" (zwei Knöpfe, kein verstecktes Dropdown).
- Umschalter "Einfachauswahl" / "Mehrfachauswahl".
- Auswahl "Preisart": "Legt Endpreis fest" oder "Aufpreis je Antwort". Bei
  "Mehrfachauswahl" ist nur "Aufpreis je Antwort" sinnvoll (zwei gleichzeitig gewählte
  Endpreise widersprechen sich); das Feld wird in diesem Fall auf "Aufpreis je Antwort"
  fest gestellt und als deaktiviert dargestellt, mit Hinweistext "Bei Mehrfachauswahl
  immer Aufpreis je Antwort."
- Liste der Antworten, je Zeile: Textfeld Bezeichnung, Preisfeld (Beschriftung folgt
  der Preisart: "Preis in EUR" bei Endpreis-Gruppen, "Aufpreis in EUR" bei
  Aufpreis-Gruppen, Cent-Eingabe analog zum bestehenden Muster "Preis in Euro"/"Preis
  in Cent"), zwei Pfeil-Buttons zum Verschieben, ein Textbutton "Entfernen".
- Button "+ Antwort hinzufügen" am Ende der Liste.

Ganz unten im Abschnitt: Button "+ Auswahlgruppe hinzufügen"; Leerzustand (keine
Gruppen vorhanden) zeigt den Text "Noch keine Auswahlgruppen angelegt." statt einer
leeren Fläche.

### Verhindern einer Pflichtgruppe ohne Antwort

Die Prüfung erfolgt an zwei Stellen, nach demselben Muster wie das bestehende
`modalError` (Zeile 3170 ff., `role="alert"`, `border-rose-500/50 bg-rose-500/10
text-rose-200`):

1. **Inline, je Gruppe:** Hat eine Gruppe (Pflicht oder freiwillig — eine Gruppe ohne
   jede Antwort ist an der Kasse ohnehin unbrauchbar, siehe Nicht-Ziele) beim Absenden
   null Antworten, erscheint unter deren Antwortliste: "Diese Gruppe braucht mindestens
   eine Antwort." Die Karte erhält denselben Fehlerrahmen wie das bestehende
   `border-rose-500/50`-Muster.
2. **Zusammenfassend, oberhalb des Formulars:** wiederverwendet die bestehende
   `modalError`-Zeile mit dem Text "Bitte ergänze fehlende Antworten in den markierten
   Gruppen." Das Absenden (`handleSaveProductModal`) wird clientseitig blockiert, bevor
   ein Request erzeugt wird — analog zur bestehenden Namensprüfung
   ("Bitte gib einen Produktnamen ein.", Zeile 779).

### Löschen einer Antwort, die in alten Bestellungen vorkommt

Da Bestellungen laut Auftrag eine Momentaufnahme des Namens speichern, bleiben alte
Bestellungen beim Löschen unverändert lesbar. Damit das dem Bedienpersonal in der
Verwaltung klar ist, öffnet "Entfernen" bei einer Antwort (nicht bei einer ganzen
Gruppe mit noch mehreren Antworten, dort reicht die einfache Zeilenentfernung vor dem
Speichern) einen Bestätigungsdialog:

> **Antwort löschen?**
> "{Name}" wird aus dieser Gruppe entfernt und steht an der Kasse danach nicht mehr zur
> Auswahl. Bereits abgeschlossene Bestellungen zeigen die Bezeichnung unverändert
> weiter an.
> [Abbrechen] [Löschen]

Der Dialog erscheint unabhängig davon, ob die Antwort tatsächlich schon verwendet
wurde (siehe offener Punkt zur Nutzungszählung) — er beschreibt damit korrekt sowohl
den häufigen Fall (nie verwendet, Text trifft trivial zu) als auch den kritischen Fall
(verwendet, Text verhindert eine Fehlannahme "das ändert alte Bons").

### Sortieren ohne Ziehen und Ablegen

Sowohl Gruppen (Reihenfolge der Karten) als auch Antworten (Reihenfolge innerhalb
einer Gruppe) werden über je zwei Buttons "Nach oben" / "Nach unten" pro Zeile
sortiert (Beschriftung als `aria-label`, sichtbar als Pfeilsymbole). Die Buttons sind
mit Tab erreichbar und mit Enter/Leertaste auslösbar — kein Ziehen nötig, funktioniert
gleich auf Tablet, Maus und Tastatur. Der oberste Eintrag hat einen deaktivierten
"Nach oben"-Button, der unterste einen deaktivierten "Nach unten"-Button; die
Deaktivierung ist nie die einzige Kennung des Zustands, sondern geht mit dem
nativen `disabled`-Attribut einher (für Screenreader und Tastaturfokus korrekt
ausgeschlossen, nicht nur optisch abgeblendet).

### Skizze Verwaltung (Produktmodal, Ausschnitt neuer Abschnitt)

```
+-----------------------------------------+
| Neues Produkt anlegen                [X]|
+-----------------------------------------+
| Produktname [ Schnitzel             ]    |
| Preis  [ 12 ] EUR  [ 50 ] Ct             |
| Kategorie [ Speisen           v]         |
| Zielstation [ Kueche           v]        |
| Sortierung [ 0 ]                         |
+-----------------------------------------+
| Auswahlgruppen                           |
| +---------------------------------+      |
| | Beilage                [Entfernen]     |
| | (*) Pflicht   ( ) Freiwillig     |     |
| | (*) Einfachauswahl ( ) Mehrfach  |     |
| | Preisart: Legt Endpreis fest  v  |     |
| | Antworten:                       |     |
| |  [Pommes  ] [0,00] Auf Ab Entfernen    |
| |  [Reis    ] [0,00] Auf Ab Entfernen    |
| |  [+ Antwort hinzufuegen]         |     |
| +---------------------------------+      |
| +---------------------------------+      |
| | Extras                 [Entfernen]     |
| | ( ) Pflicht   (*) Freiwillig     |     |
| | ( ) Einfachauswahl (*) Mehrfach  |     |
| | Preisart: Aufpreis je Antwort    |     |
| | Antworten:                       |     |
| |  [ohne Salat][0,00] Auf Ab Entfernen   |
| |  [extra Sosse][0,50] Auf Ab Entfernen  |
| |  [+ Antwort hinzufuegen]         |     |
| +---------------------------------+      |
| [+ Auswahlgruppe hinzufuegen]            |
+-----------------------------------------+
|                    [Abbrechen] [Speichern]
+-----------------------------------------+
```

## Beschriftungen und Meldungstexte (wortwörtlich verwendbar)

Kasse:

- Chip Pflicht: "Pflicht"
- Chip freiwillig: "Freiwillig"
- Status offen, ein Eintrag: "Noch 1 Pflichtangabe offen: {Gruppenname}"
- Status offen, mehrere: "Noch {n} Pflichtangaben offen: {Gruppe1}, {Gruppe2}"
- Status erledigt: "Alle Pflichtangaben ausgewählt"
- Button, unvollständig: "Weiter zu: {Gruppenname}"
- Button, vollständig: "Hinzufügen · € {Summe}"
- Inline-Fehler (Absicherung): "Bitte eine Option auswählen."
- Screenreader-Ansage (Absicherung): "Bitte fehlende Pflichtangaben ergänzen: {Gruppenname}"
- Aufpreis: "+ € {Betrag}"
- Kein Aufpreis: "Kostenlos"
- Gesamtpreiszeile: "Gesamtpreis: € {Summe}"

Verwaltung:

- Abschnittstitel: "Auswahlgruppen"
- Leerzustand: "Noch keine Auswahlgruppen angelegt."
- Gruppe hinzufügen: "+ Auswahlgruppe hinzufügen"
- Antwort hinzufügen: "+ Antwort hinzufügen"
- Feldbeschriftung Gruppenname: "Name der Gruppe"
- Umschalter: "Pflicht" / "Freiwillig"
- Umschalter: "Einfachauswahl" / "Mehrfachauswahl"
- Feldbeschriftung Preisart: "Preisart", Werte "Legt Endpreis fest" / "Aufpreis je Antwort"
- Hinweistext bei Mehrfachauswahl: "Bei Mehrfachauswahl immer Aufpreis je Antwort."
- Preisfeld Endpreis-Gruppe: "Preis in EUR"
- Preisfeld Aufpreis-Gruppe: "Aufpreis in EUR"
- Löschen-Bestätigung Titel: "Antwort löschen?"
- Löschen-Bestätigung Text: "„{Name}" wird aus dieser Gruppe entfernt und steht an der
  Kasse danach nicht mehr zur Auswahl. Bereits abgeschlossene Bestellungen zeigen die
  Bezeichnung unverändert weiter an."
- Inline-Fehler je Gruppe: "Diese Gruppe braucht mindestens eine Antwort."
- Zusammenfassender Fehler (modalError-Zeile): "Bitte ergänze fehlende Antworten in
  den markierten Gruppen."
- aria-label Sortieren: "{Name} nach oben verschieben" / "{Name} nach unten verschieben"

## Farb- und Kontrasttabelle (gerechnet)

Berechnung nach der WCAG-Formel für relative Luminanz (sRGB-Linearisierung, Koeffizienten
0,2126/0,7152/0,0722) und Kontrastverhältnis `(L_hell + 0,05) / (L_dunkel + 0,05)`. Alle
Hex-Werte sind die tatsächlichen Tailwind-Farbwerte aus `ProductOptionsModal.tsx`
beziehungsweise dem bestehenden `modalError`-Muster in `AdminDashboard.tsx`. Bei
teiltransparenten Flächen (z. B. `bg-rose-500/10`) wurde zuerst die tatsächlich
gerenderte Mischfarbe über dem jeweiligen Hintergrund berechnet und dann damit der
Kontrast bestimmt.

| Verwendung                                               | Vordergrund          | Hintergrund (ggf. gemischt)                          | Kontrast  | Bewertung                        |
| -------------------------------------------------------- | -------------------- | ---------------------------------------------------- | --------- | -------------------------------- |
| Produkttitel (Bestand)                                   | `#ffffff` weiß       | `#0f172a` slate-900                                  | 17,86 : 1 | AAA                              |
| Unausgewählte Antwort, Text (Bestand)                    | `#cbd5e1` slate-300  | `#1e293b` slate-800                                  | 9,85 : 1  | AAA                              |
| Gruppenüberschrift (Bestand)                             | `#94a3b8` slate-400  | `#0f172a` slate-900                                  | 6,97 : 1  | AA (Normaltext), knapp unter AAA |
| Basispreis-Text (Bestand)                                | `#818cf8` indigo-400 | `#0f172a` slate-900                                  | 5,99 : 1  | AA                               |
| Ausgewählte Antwort, weißer Text auf `bg-indigo-500/20`  | `#ffffff`            | gemischt `#2c355f` (indigo-500 20 % über slate-800)  | 11,79 : 1 | AAA                              |
| Ausgewählte Antwort, weißer Text auf `bg-emerald-500/20` | `#ffffff`            | gemischt `#1b4649` (emerald-500 20 % über slate-800) | 10,40 : 1 | AAA                              |
| Fehlertext (neu, Kasse + Verwaltung, wie `modalError`)   | `#fecdd3` rose-200   | gemischt `#261b2f` (rose-500 10 % über slate-900)    | 11,63 : 1 | AAA                              |
| Chip "Pflicht", Text                                     | `#fcd34d` amber-300  | gemischt `#322b25` (amber-500 15 % über slate-900)   | 9,66 : 1  | AAA                              |
| Chip "Pflicht", Rahmen (nicht-Text-Kontrast)             | `#fbbf24` amber-400  | gemischt `#322b25` (wie oben)                        | 8,34 : 1  | weit über Minimum 3 : 1          |
| Fokusrahmen (weiß) auf Standardhintergrund               | `#ffffff`            | `#0f172a` slate-900                                  | 17,86 : 1 | weit über Minimum 3 : 1          |
| Fokusrahmen (weiß) auf ausgewähltem indigo-Feld          | `#ffffff`            | gemischt `#2c355f`                                   | 11,79 : 1 | weit über Minimum 3 : 1          |
| Fokusrahmen (weiß) auf ausgewähltem emerald-Feld         | `#ffffff`            | gemischt `#1b4649`                                   | 10,40 : 1 | weit über Minimum 3 : 1          |

Referenzwerte: WCAG 2.1 AA verlangt 4,5 : 1 für Fließtext und 3 : 1 für großen Text
sowie für nicht-textliche UI-Komponenten wie Fokusrahmen (Kriterium 1.4.11); AAA
verlangt 7 : 1 für Fließtext. Alle für dieses Konzept neu vorgeschlagenen Farbpaare
(Fehlertext, Chip "Pflicht", Fokusrahmen auf beiden Auswahlzuständen) liegen über 8 : 1
und damit auf AAA-Niveau. Empfehlung für den Fokusrahmen im gesamten Modal:
`focus-visible:ring-2 ring-white ring-offset-2 ring-offset-slate-900`, da Weiß auf allen
drei vorkommenden Hintergründen (Standard, indigo-getönt, emerald-getönt) den größten
Sicherheitsabstand zum Minimum hat.

## Nicht-Ziele

- Auswahlgruppen sind nicht produktübergreifend wiederverwendbar (fachliche Vorgabe).
- Kein Ziehen-und-Ablegen (Drag-and-Drop) zum Sortieren.
- Keine Mengenangabe je Antwort (z. B. "2× extra Soße"); jede Antwort ist genau
  einmal wählbar/ankreuzbar.
- Keine Abhängigkeiten zwischen Gruppen (z. B. eine Antwort in Gruppe A schaltet
  Gruppe B frei oder aus).
- Keine Änderung an `packages/database/prisma/schema.prisma` oder an Migrationen;
  dieses Dokument beschreibt nur die Bedienoberfläche.
- Keine Mehrsprachigkeit der Beschriftungen.
- Kein Kopieren/Duplizieren einer Gruppe von einem Produkt in ein anderes (siehe
  offene Punkte für eine mögliche spätere Ergänzung).

## Offene Punkte für die Projektleitung

1. Preisregel bei unbeantworteter Endpreis-Gruppe: Dieses Konzept zeigt in diesem Fall
   den Produkt-Basispreis als Zwischenstand in der Gesamtpreis-Zeile. Ist das gewünscht,
   oder soll dort bewusst kein Preis stehen, solange die Pflichtgruppe offen ist?
2. Soll die Produktkachel außerhalb der Auswahlmaske (Katalogübersicht der Kasse)
   weiterhin einen einzelnen Preis zeigen, wenn das Produkt eine Pflicht-Endpreis-Gruppe
   hat (z. B. als "ab €"-Angabe)? Dieses Verhalten wurde in den gelesenen Dateien nicht
   festgelegt.
3. Ist eine Zählung "diese Antwort wurde in N Bestellungen verwendet" beim Löschen
   technisch/performant sinnvoll abrufbar? Falls ja, könnte der Bestätigungsdialog die
   Zahl nennen statt der generischen Formulierung.
4. Sollen auch freiwillige Gruppen ohne jede Antwort das Speichern blockieren (wie hier
   vorgeschlagen, einheitlich mit Pflichtgruppen), oder nur Pflichtgruppen?
5. Gibt es eine sinnvolle Obergrenze für Anzahl Gruppen bzw. Antworten je Produkt, damit
   die Kassenmaske auf 390 px Breite nicht unbrauchbar lang wird?
6. Dieses Konzept sortiert Pflichtgruppen an der Kasse immer vor freiwilligen Gruppen,
   unabhängig von der in der Verwaltung gewählten Reihenfolge. Ist diese Abweichung
   zwischen Pflege-Reihenfolge und Kassen-Reihenfolge gewollt, oder soll die
   Verwaltungs-Reihenfolge 1:1 übernommen werden?
7. Dürfen alle Admin-Rollen Gruppen und Antworten löschen, oder soll das wie andere
   kritische Admin-Aktionen im Projekt eingeschränkt werden?

## Entscheidungen der Projektleitung zu den offenen Punkten

Die folgenden Festlegungen sind für die Umsetzung verbindlich. Sie ersetzen die
Vorschläge im Abschnitt "Offene Punkte".

1. **Kein Zwischenpreis bei offener Endpreis-Gruppe.** Solange eine Pflichtgruppe mit
   Endpreis unbeantwortet ist, steht in der Gesamtpreis-Zeile ein Gedankenstrich statt
   einer Zahl: "Gesamtpreis: —". Der Basispreis eines Getränks entspricht bei
   Größenauswahl keinem tatsächlich kaufbaren Artikel; eine Zahl an dieser Stelle wäre
   eine Zahl, die niemand bezahlt. Der sprechende Button nennt ohnehin die fehlende
   Gruppe.
2. **Produktkachel zeigt "ab € {kleinster Preis}".** Hat ein Produkt eine Pflichtgruppe
   mit Endpreis, zeigt die Kachel im Kassenkatalog den kleinsten Antwortpreis mit dem
   Zusatz "ab". Ohne solche Gruppe bleibt die Kachel unverändert.
3. **Keine Nutzungszählung beim Löschen.** Der Bestätigungstext bleibt in der
   vorgeschlagenen allgemeinen Form. Eine Zählung müsste das JSON-Feld `extras` aller
   Bestellpositionen durchsuchen; der Aufwand steht in keinem Verhältnis zum Nutzen,
   weil die Momentaufnahme alte Bestellungen ohnehin unverändert lässt.
4. **Einheitliche Sperre für leere Gruppen.** Auch eine freiwillige Gruppe ohne Antwort
   blockiert das Speichern. Eine Gruppe ohne Antworten ist an der Kasse in beiden Fällen
   unbrauchbar; eine Ausnahme wäre eine Sonderregel ohne fachlichen Gewinn.
5. **Obergrenzen: 10 Auswahlgruppen je Produkt, 20 Antworten je Gruppe.** Geprüft wird
   im Backend, nicht nur im Formular, mit der Meldung "Höchstens 10 Auswahlgruppen je
   Produkt." beziehungsweise "Höchstens 20 Antworten je Auswahlgruppe."
6. **Reihenfolge eins zu eins aus der Verwaltung.** Die Kasse zeigt die Gruppen genau in
   der gepflegten Reihenfolge; Pflichtgruppen werden **nicht** vorgezogen. Wer sortiert,
   muss das Ergebnis seiner Sortierung sehen. Die Auffindbarkeit trägt die festgeklebte
   Status-Zeile zusammen mit dem sprechenden Button, nicht eine verdeckte Umsortierung.
7. **Berechtigungen wie die übrige Produktpflege.** Anlegen, Ändern, Sortieren und
   Löschen von Gruppen und Antworten sind auf `ADMINISTRATOR` und `EVENT_MANAGER`
   beschränkt, geprüft im Backend, wie bei `createProduct` und `updateProduct`.
