# Produktoptionen: Datenmodell und Feldvertrag

Gültig ab Migration `20260821140000_add_product_option_groups` (Issue #75).

Ein Produkt trägt beliebig viele Auswahlgruppen. Jede Gruppe stellt eine Frage
(„Größe?", „Beilage?", „Zusätze?") und ist unabhängig von den anderen als Pflicht
oder freiwillig sowie als Einfach- oder Mehrfachauswahl gekennzeichnet. Damit kann
ein Produkt mehrere Pflichtdimensionen tragen. Die bisherigen Tabellen
`ProductVariant` und `ProductExtra` sind entfallen; ihre Zeilen wurden in derselben
Migration übernommen.

Auswahlgruppen gehören immer genau einem Produkt. Gruppen, die über mehrere Produkte
hinweg wiederverwendet werden, sind ausdrücklich nicht vorgesehen.

## Warum ein gemeinsames Modell und nicht zwei

Erwogen wurde, `ProductVariant` als eigene Größendimension zu behalten und nur die
Extras-Seite zu Gruppen zu verallgemeinern. Dagegen spricht, dass die Verwaltung dann
dauerhaft zwei Pflegekonzepte für dieselbe Frage anbieten müsste — „Variante" und
„Auswahlgruppe" —, obwohl sich beide nur in Pflicht, Anzahl und Preiswirkung
unterscheiden; genau diese drei Merkmale sind jetzt Felder. Ein Produkt hätte
außerdem weiterhin nur über die Variantenschiene eine preissetzende Pflichtdimension,
sodass jede zweite Pflichtfrage in der Extras-Schiene landet und dort anders gepflegt
wird als die erste. Der Preis dieser Entscheidung ist eine breitere Umstellung des
bestehenden Codes; die Momentaufnahme in `OrderItem` bleibt davon jedoch vollständig
unberührt, weshalb Berichte, Stornos und Bondruck ohne Datenwanderung weiterlaufen.

## Abbildung der fachlichen Beispiele

| Produkt   | Gruppe    | selectionType | isRequired | minSelect | maxSelect | priceMode | quickSaleTiles |
| --------- | --------- | ------------- | ---------- | --------- | --------- | --------- | -------------- |
| Getränk   | Größe     | `SINGLE`      | `true`     | 1         | 1         | ABSOLUTE  | `true`         |
| Schnitzel | Beilage   | `SINGLE`      | `true`     | 1         | 1         | SURCHARGE | `false`        |
| Schnitzel | Anpassung | `MULTIPLE`    | `false`    | 0         | `null`    | SURCHARGE | `false`        |

Das Getränk hat zwei Optionen mit `priceEffect` 350 und 200 (jeweils Endpreis).
Das Schnitzel hat in „Beilage" zwei Optionen mit `priceEffect` 0 und in „Anpassung"
die Optionen „ohne Salat" (`priceEffect` 0) und „extra Soße" (`priceEffect` 80).
Beide Pflichtgruppen bestehen nebeneinander.

## `ProductOptionGroup`

| Feld             | Typ                          | Pflicht | Vorgabe     | Bedeutung                                                                                                                   |
| ---------------- | ---------------------------- | ------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `String` (uuid)              | ja      | `uuid()`    | Kennung der Gruppe.                                                                                                         |
| `name`           | `String`                     | ja      | –           | Anzeigename der Frage. Nicht leer und nicht nur Leerzeichen.                                                                |
| `selectionType`  | `ProductOptionSelectionType` | ja      | –           | `SINGLE` = höchstens eine Antwort, `MULTIPLE` = mehrere Antworten möglich.                                                  |
| `isRequired`     | `Boolean`                    | ja      | `false`     | Pflicht oder freiwillig. Datenbankseitig streng an `minSelect` gebunden: `isRequired = (minSelect >= 1)`.                   |
| `minSelect`      | `Int`                        | ja      | `0`         | Mindestanzahl zu wählender Optionen.                                                                                        |
| `maxSelect`      | `Int?`                       | nein    | `null`      | Höchstanzahl zu wählender Optionen. `null` bedeutet unbegrenzt. Bei `SINGLE` immer `1`.                                     |
| `priceMode`      | `ProductOptionPriceMode`     | ja      | `SURCHARGE` | `ABSOLUTE` = die gewählte Option setzt den Grundpreis der Position, `SURCHARGE` = die gewählten Optionen werden aufaddiert. |
| `quickSaleTiles` | `Boolean`                    | ja      | `false`     | Genau diese Gruppe fächert im Schnellverkauf in einzelne Kacheln auf.                                                       |
| `sortOrder`      | `Int`                        | ja      | `0`         | Anzeigereihenfolge der Gruppen innerhalb des Produkts. Nicht negativ.                                                       |
| `productId`      | `String`                     | ja      | –           | Produkt, dem die Gruppe gehört. Löschen des Produkts löscht die Gruppe (`onDelete: Cascade`).                               |

## `ProductOption`

| Feld          | Typ             | Pflicht | Vorgabe  | Bedeutung                                                                                                |
| ------------- | --------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `id`          | `String` (uuid) | ja      | `uuid()` | Kennung der Option. Wird in `OrderItem` als Momentaufnahme festgehalten.                                 |
| `name`        | `String`        | ja      | –        | Anzeigename der Antwort. Nicht leer und nicht nur Leerzeichen.                                           |
| `priceEffect` | `Int`           | ja      | `0`      | Preiswirkung in ganzen Cent. Deutung nach `priceMode` der Gruppe. Bereich −1 000 000 bis 1 000 000 Cent. |
| `isActive`    | `Boolean`       | ja      | `true`   | `false` blendet die Option aus, ohne sie zu löschen. Bestehende Bestellungen bleiben unberührt.          |
| `sortOrder`   | `Int`           | ja      | `0`      | Anzeigereihenfolge innerhalb der Gruppe. Nicht negativ.                                                  |
| `groupId`     | `String`        | ja      | –        | Gruppe, der die Option gehört. Löschen der Gruppe löscht die Option (`onDelete: Cascade`).               |

## Sortierung

Anzeigereihenfolge ist immer:

```
Gruppen:  ORDER BY "sortOrder" ASC, "name" ASC, "id" ASC
Optionen: ORDER BY "sortOrder" ASC, "name" ASC, "id" ASC
```

`sortOrder` allein ist nicht eindeutig. Die beiden weiteren Schlüssel machen die
Reihenfolge deterministisch, auch wenn die Pflege gleiche Werte vergibt.

## Preisberechnung einer Bestellposition

Der Einzelpreis einer Position (`OrderItem.priceAtTime`) ergibt sich in zwei
Schritten und ist damit eindeutig:

1. **Grundpreis.** Hat das Produkt eine Gruppe mit `priceMode = ABSOLUTE` und ist in
   ihr eine Option gewählt, ist der Grundpreis der `priceEffect` dieser Option.
   Andernfalls ist der Grundpreis `Product.price`.
2. **Aufpreise.** Auf den Grundpreis wird die Summe der `priceEffect` aller
   gewählten Optionen aus Gruppen mit `priceMode = SURCHARGE` addiert.

```
priceAtTime = grundpreis + summe(priceEffect aller gewählten SURCHARGE-Optionen)
gesamt      = priceAtTime * quantity
```

Eine Option aus einer `ABSOLUTE`-Gruppe wird nie addiert, eine Option aus einer
`SURCHARGE`-Gruppe nie als Grundpreis verwendet. Da je Produkt höchstens eine
`ABSOLUTE`-Gruppe zulässig ist, gibt es genau einen Grundpreis.

### Abschläge

`priceEffect` darf in `SURCHARGE`-Gruppen negativ sein. Das ist Absicht und kein
Versehen: die vorhandene Pflege kennt Abschläge wie „ohne Beilage −2,00" (siehe
`prisma/seed.ts`), und das alte Feld `ProductExtra.price` hatte keine untere Schranke.
Ein Verbot wäre ein Rückschritt gegenüber dem heutigen Stand.

Daraus folgen zwei Regeln, die die Datenbank nicht zeilenweise prüfen kann und die
die Anwendung durchsetzen muss:

- Eine Option einer `ABSOLUTE`-Gruppe darf nicht negativ sein, sonst wäre der
  Grundpreis negativ.
- Der errechnete `priceAtTime` muss größer oder gleich 0 sein. Die Bestellannahme hat
  eine Position mit negativem Endpreis abzulehnen. `createQuickSale` prüft das heute
  schon (`priceAtTime < 0`), `createOrder` noch nicht.

`Product.taxRate` bleibt unverändert am Produkt und wird von Optionen nicht berührt.

## Regeln, die die Datenbank erzwingt

Prisma bildet weder `CHECK`-Bedingungen noch partielle eindeutige Indizes ab. Beide
stehen ausschließlich in der SQL-Migration und dürfen von einer späteren Migration
nicht stillschweigend entfernt werden. Prisma liest partielle Indizes bei der
Introspektion nicht ein; ein künftig von `prisma migrate dev` erzeugter Entwurf ist
daraufhin zu prüfen, dass er sie nicht löscht.

| Regel                                                        | Umsetzung                    |
| ------------------------------------------------------------ | ---------------------------- |
| `sortOrder` nicht negativ (Gruppe und Option)                | `CHECK`                      |
| Name nicht leer (Gruppe und Option)                          | `CHECK`                      |
| `minSelect >= 0`, `maxSelect >= 1`, `maxSelect >= minSelect` | `CHECK`                      |
| `isRequired = (minSelect >= 1)`                              | `CHECK`                      |
| `SINGLE` erzwingt `maxSelect = 1` und `minSelect <= 1`       | `CHECK`                      |
| `ABSOLUTE` erzwingt `SINGLE` und `isRequired`                | `CHECK`                      |
| `quickSaleTiles` erzwingt `SINGLE` und `isRequired`          | `CHECK`                      |
| `priceEffect` zwischen −1 000 000 und 1 000 000 Cent         | `CHECK`                      |
| Höchstens eine `ABSOLUTE`-Gruppe je Produkt                  | partieller eindeutiger Index |
| Höchstens eine `quickSaleTiles`-Gruppe je Produkt            | partieller eindeutiger Index |

### Pflichtgruppe mit Mehrfachauswahl

Eine Pflichtgruppe mit Mehrfachauswahl ist zulässig und bedeutet: mindestens
`minSelect` Antworten, höchstens `maxSelect` Antworten. Sie wird nicht verboten, weil
„mindestens zwei Beilagen wählen" eine reale Vorgabe ist und ein Verbot die Pflege in
Behelfskonstruktionen drängen würde. Die Bedeutung ist eindeutig, weil `isRequired`
keine zweite frei setzbare Wahrheit neben `minSelect` ist, sondern deren Lesart:
`isRequired = (minSelect >= 1)` wird von der Datenbank erzwungen. Eine Pflichtgruppe
ohne Mindestanzahl kann es daher nicht geben.

## Regeln, die die Anwendung erzwingen muss

Diese Regeln sind mit reinem SQL nicht zeilenweise prüfbar. Sie gehören in die
Produktpflege im Backend:

1. Eine Gruppe muss mindestens eine aktive Option haben, sonst ist eine Pflichtgruppe
   unerfüllbar.
2. `maxSelect` darf die Anzahl der aktiven Optionen der Gruppe nicht überschreiten,
   `minSelect` ebenso wenig.
3. Trägt ein Produkt eine `ABSOLUTE`-Gruppe, so darf `quickSaleTiles` nur an genau
   dieser Gruppe gesetzt sein. Andernfalls wäre der Preis einer Kachel unbestimmt,
   weil die Kachel die Antwort auf die `ABSOLUTE`-Gruppe nicht mitliefert.
4. Namen von Gruppen innerhalb eines Produkts und Namen von Optionen innerhalb einer
   Gruppe sollen eindeutig sein. Bewusst nicht als Datenbankbedingung geführt, damit
   die Migration an vorhandenen Doppelnamen nicht scheitert.
5. Bei der Bestellannahme ist zu prüfen, dass für jede Gruppe des Produkts die Anzahl
   der gewählten Optionen zwischen `minSelect` und `maxSelect` liegt, dass jede
   gewählte Option zu einer Gruppe genau dieses Produkts gehört und dass sie
   `isActive` ist.
6. Eine Option einer `ABSOLUTE`-Gruppe darf keinen negativen `priceEffect` haben.
7. Der errechnete `priceAtTime` einer Position darf nicht negativ sein.

## Schnellverkauf

Die Frage „welche Dimension fächert in Kacheln auf?" wird ausschließlich über
`ProductOptionGroup.quickSaleTiles` beantwortet, nie aus `priceMode` oder aus der
Anzahl der Gruppen abgeleitet.

- Genau eine Gruppe je Produkt darf die Marke tragen (partieller eindeutiger Index).
- Trägt eine Gruppe die Marke, entsteht je aktiver Option eine Kachel. Der Preis der
  Kachel folgt der Preisregel oben mit dieser einen Option als Auswahl.
- Trägt keine Gruppe die Marke, entsteht genau eine Kachel zum `Product.price`.
- Die Migration hat die aus `ProductVariant` übernommene Gruppe mit der Marke
  versehen. Der Schnellverkauf verhält sich dadurch für Bestandsdaten unverändert.

Offen und von der Umsetzungsrolle zu entscheiden: wie der Schnellverkauf mit einem
Produkt umgeht, das neben der Kachelgruppe weitere Pflichtgruppen trägt. Die Kachel
liefert dafür keine Antwort. Der Schnellverkauf gibt Produktgutscheine aus; die
Antwort kann bei der Einlösung an der Station nachgeholt werden, sofern die weiteren
Pflichtgruppen ohne Aufpreis sind. Sind sie mit Aufpreis belegt, ist der Kachelpreis
unvollständig und das Produkt darf im Schnellverkauf nicht angeboten werden.

## `OrderItem` bleibt unverändert

Die Spalten `variantId`, `variantName` und `extras` behalten Namen, Typ und Aufbau.
Bestehende Zeilen bleiben ohne Datenwanderung lesbar, weil Berichte, Stornos und der
Bondruck darauf zugreifen. Neu ist nur die Herkunft der Werte:

| Spalte        | Typ       | Inhalt ab Issue #75                                                                                                      |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `variantId`   | `String?` | `ProductOption.id` der gewählten Option aus der `ABSOLUTE`-Gruppe. `null`, wenn das Produkt keine `ABSOLUTE`-Gruppe hat. |
| `variantName` | `String?` | `ProductOption.name` derselben Option als Text zum Bestellzeitpunkt.                                                     |
| `extras`      | `Json?`   | Array aller übrigen gewählten Optionen: `[{ id, name, price }]`, `price` = `priceEffect` in Cent.                        |

Ein Eintrag in `extras` darf zusätzlich `groupId` und `groupName` führen. Beide
Felder sind optional; Leser müssen sie als möglicherweise fehlend behandeln, weil
Zeilen aus der Zeit vor dieser Migration sie nicht haben.

Die gewählte Option einer Pflichtgruppe mit Einfachauswahl und `SURCHARGE` (Beispiel
„Beilage: Pommes") landet in `extras`, nicht in `variantName`. Auf dem Bon erscheint
sie damit in der Zusatzzeile. Das ist gewollt: `variantName` ist die Momentaufnahme
der preissetzenden Antwort, nicht die aller Pflichtantworten.

Es gibt keinen Fremdschlüssel von `OrderItem.variantId` auf die Optionstabelle. Der
Wert ist eine Momentaufnahme und muss auch dann lesbar bleiben, wenn die Option
später gelöscht wird.

## Übernahme der Altdaten

Die Migration erzeugt je Produkt

- mit mindestens einer Variante: eine Gruppe „Variante", `SINGLE`, Pflicht,
  `minSelect` 1, `maxSelect` 1, `ABSOLUTE`, `quickSaleTiles = true`, `sortOrder` 0;
- mit mindestens einem Extra: eine Gruppe „Extras", `MULTIPLE`, freiwillig,
  `minSelect` 0, `maxSelect` `null`, `SURCHARGE`, `quickSaleTiles = false`,
  `sortOrder` 1.

Die Kennungen der bisherigen Varianten und Extras werden als `ProductOption.id`
unverändert weitergeführt. Bestehende `OrderItem.variantId` und die Kennungen in
`OrderItem.extras` zeigen dadurch weiterhin auf dieselbe Auswahl.

`sortOrder` wird je Gruppe dicht ab 0 neu vergeben, geordnet nach bisherigem
`sortOrder`, dann Name, dann Kennung. Die bisherige Reihenfolge bleibt erhalten,
wird eindeutig und enthält keine negativen Werte mehr.

Die Gruppenkennungen werden deterministisch aus der Produktkennung abgeleitet, damit
eine Wiederholung der Migration auf derselben Datenbasis dieselben Zeilen erzeugt.
