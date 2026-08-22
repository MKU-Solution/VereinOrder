# Produktoptionen: Schnittstellenvertrag (Issue #75)

Festgelegt von der Projektleitung. Verbindlich für Backend und Frontend. Ergänzt
`produktoptionen-datenmodell.md` (Felder und Invarianten) und
`../product/produktoptionen-bedienkonzept.md` (Bedienung).

## Grundsatz: Pflege verschachtelt im Produkt, nicht über eigene Endpunkte

Auswahlgruppen werden zusammen mit dem Produkt gespeichert, in **einer** Transaktion.
Es gibt bewusst keine eigenen Endpunkte je Gruppe oder Antwort.

Begründung: Die Verwaltungsmaske hat einen einzigen Speichern-Knopf. Eigene Endpunkte
je Gruppe würden dieselbe Bearbeitung in mehrere Anfragen zerlegen, von denen einzelne
scheitern können — dann steht ein Produkt mit halb gespeicherten Gruppen in der
Datenbank, und die Kasse zeigt eine Pflichtgruppe ohne Antworten. Sortieren, Anlegen,
Ändern und Löschen im Sinne des Issues sind über die Ersetzung der Liste vollständig
abgedeckt.

## Endpunkte

| Endpunkt                       | Rollen                           | Änderung                                 |
| ------------------------------ | -------------------------------- | ---------------------------------------- |
| `GET /products`                | wie bisher                       | liefert zusätzlich `optionGroups`        |
| `GET /products/admin?eventId=` | `ADMINISTRATOR`, `EVENT_MANAGER` | liefert zusätzlich `optionGroups`        |
| `POST /products`               | `ADMINISTRATOR`, `EVENT_MANAGER` | nimmt zusätzlich `optionGroups` entgegen |
| `PATCH /products/:id`          | `ADMINISTRATOR`, `EVENT_MANAGER` | nimmt zusätzlich `optionGroups` entgegen |

`GET /products` (Kasse) liefert je Gruppe nur Optionen mit `isActive = true`.
`GET /products/admin` liefert **alle** Optionen, auch inaktive, sonst kann die
Verwaltung sie nicht wieder aktivieren. Beide sortieren Gruppen und Optionen
aufsteigend nach `sortOrder`, danach nach `name`.

## Nutzlast der Pflege

```
optionGroups?: GroupInput[]

GroupInput  = { id?, name, selectionType, isRequired, minSelect, maxSelect,
                priceMode, quickSaleTiles, sortOrder, options: OptionInput[] }
OptionInput = { id?, name, priceEffect, isActive?, sortOrder }
```

- Fehlt `optionGroups` in der Nutzlast, bleiben die Gruppen des Produkts **unverändert**.
  Das unterscheidet „nicht mitgeschickt" von „auf leer gesetzt".
- Ist `optionGroups` vorhanden, beschreibt es den **vollständigen Sollzustand**.
- **Abgleich über die Kennung, nicht durch Neuanlage:** Einträge mit `id` werden
  geändert, Einträge ohne `id` neu angelegt, nicht mehr enthaltene Einträge gelöscht.
  Eine `id`, die nicht zu diesem Produkt gehört, führt zu `400`, nicht zu einer stillen
  Neuanlage.

Warum kein einfaches Löschen-und-neu-Anlegen: `OrderItem.variantId` und die Kennungen
in `OrderItem.extras` zeigen auf `ProductOption.id`. Ein Rundumtausch bei jedem
Speichern würde diese Verweise bei jeder Preisänderung entwerten, obwohl sich die
Antwort selbst nicht geändert hat.

## Prüfungen im Backend

Alle sieben Anwendungsregeln aus `produktoptionen-datenmodell.md`, zusätzlich die
Obergrenzen aus dem Bedienkonzept. Jede Verletzung ergibt `400` mit einer deutschen,
für die Verwaltung lesbaren Meldung. Die Datenbankbedingungen sind das Netz, nicht die
Prüfung: Ein `CHECK`-Verstoß darf den Bedienenden nie als roher Datenbankfehler
erreichen.

| Regel                                                               | Meldung                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| höchstens 10 Gruppen je Produkt                                     | "Höchstens 10 Auswahlgruppen je Produkt."                                                  |
| höchstens 20 Antworten je Gruppe                                    | "Höchstens 20 Antworten je Auswahlgruppe."                                                 |
| mindestens eine Antwort je Gruppe                                   | "Die Auswahlgruppe „{Name}" braucht mindestens eine Antwort."                              |
| `ABSOLUTE` nur mit `SINGLE` und Pflicht                             | "Eine Gruppe, die den Endpreis festlegt, muss eine Pflichtgruppe mit Einfachauswahl sein." |
| höchstens eine `ABSOLUTE`-Gruppe je Produkt                         | "Nur eine Auswahlgruppe je Produkt darf den Endpreis festlegen."                           |
| höchstens eine `quickSaleTiles`-Gruppe je Produkt                   | "Nur eine Auswahlgruppe je Produkt darf im Schnellverkauf eigene Kacheln bekommen."        |
| `quickSaleTiles` nur an der `ABSOLUTE`-Gruppe, falls es eine gibt   | "Die Kacheln im Schnellverkauf gehören an die Gruppe, die den Endpreis festlegt."          |
| `maxSelect` nicht größer als die Anzahl aktiver Antworten           | "„{Name}" erlaubt mehr Antworten, als die Gruppe hat."                                     |
| Antwort einer `ABSOLUTE`-Gruppe nicht negativ                       | "Ein Endpreis darf nicht negativ sein."                                                    |
| Gruppennamen je Produkt eindeutig, Antwortnamen je Gruppe eindeutig | "Der Name „{Name}" kommt zweimal vor."                                                     |

## Bestellannahme

Die Bestellposition benennt die gewählten Antworten **ausschließlich über Kennungen**.
Preise und Namen werden im Backend aus der Datenbank aufgelöst und niemals aus der
Anfrage übernommen.

```
items: [{ productId, quantity, optionIds?: string[] }]
```

Dies gilt für `POST /orders` ebenso wie für den Schnellverkauf. Die bisherigen
Anfragefelder `variantId` und `extras` entfallen aus der Anfrage; die gleichnamigen
**Spalten** in `OrderItem` bleiben unverändert und werden vom Backend befüllt.

Ablauf je Position:

1. Jede Kennung in `optionIds` muss zu einer aktiven Option einer Gruppe **dieses**
   Produkts gehören. Eine unbekannte oder fremde Kennung ergibt `400`. Sie darf nicht
   still übergangen werden — das ist das heutige Verhalten in `createOrder` und
   verkauft im Zweifel zum falschen Preis.
2. Je Gruppe wird die Anzahl gewählter Antworten gegen `minSelect` und `maxSelect`
   geprüft. Eine unbeantwortete Pflichtgruppe ergibt `400`. Die Prüfung im Frontend
   ist Bequemlichkeit, diese hier ist die Zusage.
3. Grundpreis: die Antwort der `ABSOLUTE`-Gruppe, sonst `product.price`.
4. Aufpreise: Summe der `priceEffect` aller übrigen gewählten Antworten.
5. `priceAtTime` darf nicht negativ sein, sonst `400`.
6. Momentaufnahme schreiben: `variantId`/`variantName` aus der `ABSOLUTE`-Antwort,
   `extras` als `[{ id, name, price }]` aus den übrigen.

## Idempotenz des Schnellverkaufs

Der Wiederholungsschlüssel enthält heute `productId:variantId:quantity`. Er muss alle
gewählten Antworten aufnehmen, aufsteigend sortiert, sonst gelten zwei verschiedene
Zusammenstellungen desselben Produkts als Wiederholung derselben Bestellung.

## Ereignisvorlagen

`schemaVersion` steigt auf `2` und führt `optionGroups`. Der Import muss Dateien der
Version 1 weiterhin annehmen und deren `variants`/`extras` nach derselben Regel wie die
SQL-Migration in Gruppen übersetzen: Varianten werden zu einer Pflichtgruppe „Variante"
mit Einfachauswahl, `ABSOLUTE` und Kachelmarke; Extras werden zu einer freiwilligen
Gruppe „Extras" mit Mehrfachauswahl und `SURCHARGE`. Bereits exportierte Dateien dürfen
nicht wertlos werden.
