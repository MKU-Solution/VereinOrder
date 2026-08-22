-- Auswahlmoeglichkeiten je Produkt (Issue #75).
--
-- Ausgangslage: "ProductVariant" war fest verdrahtet als Pflicht-Einfachauswahl
-- mit absolutem Preis, "ProductExtra" fest verdrahtet als freiwillige
-- Mehrfachauswahl mit Aufpreis. Damit konnte ein Produkt genau eine
-- Pflichtdimension tragen. Das Schnitzel mit Pflicht-Beilage UND freiwilligen
-- Zusaetzen war nicht abbildbar.
--
-- Neu: ein generisches Paar "ProductOptionGroup" / "ProductOption". Pflicht
-- gegen freiwillig und Einfach- gegen Mehrfachauswahl sind ausdrueckliche
-- Stammdaten, die Preiswirkung ist eine Eigenschaft der Gruppe. Beide alten
-- Tabellen werden in derselben Migration verlustfrei uebernommen und danach
-- entfernt.
--
-- "OrderItem" bleibt unveraendert. Bestellungen speichern weiterhin
-- variantId / variantName / extras als Momentaufnahme; bestehende Zeilen
-- bleiben ohne Datenwanderung lesbar. Es gab und gibt keinen Fremdschluessel
-- von "OrderItem"."variantId" auf "ProductVariant", das Loeschen der alten
-- Tabelle beruehrt keine Bestellung.
--
-- Die Identitaeten der bisherigen Varianten und Extras werden als
-- "ProductOption"."id" unveraendert weitergefuehrt. Dadurch zeigen bestehende
-- "OrderItem"."variantId" und die JSON-Eintraege in "OrderItem"."extras" nach
-- der Migration weiterhin auf dieselbe Auswahl.
--
-- Die Pruefbedingungen und die partiellen eindeutigen Indizes am Ende bilden
-- Invarianten ab, die Prisma nicht darstellen kann. Sie stehen bewusst vor der
-- Datenuebernahme, damit unsaubere Altdaten an der einfuegenden Anweisung
-- scheitern und nicht erst an einem nachtraeglichen ALTER TABLE. Eine spaetere
-- Migration darf sie nicht stillschweigend entfernen.
--
-- Bekannte Bruchbedingungen bei Altdaten: die Migration bricht ab, wenn ein
-- vorhandener Varianten- oder Extra-Preis betragsmaessig groesser als 1000000
-- Cent ist, oder wenn ein Varianten- oder Extra-Name leer ist beziehungsweise
-- nur aus Leerzeichen besteht. Beide Faelle sind fachlich ungueltig; ein
-- Abbruch ist der gewollte Ausgang, eine stille Korrektur waere Datenverlust.
--
-- Auf einer leeren Datenbank laeuft die Migration vollstaendig durch: alle
-- Uebernahmeschritte sind INSERT ... SELECT ueber leere Quelltabellen.

-- CreateEnum
CREATE TYPE "ProductOptionSelectionType" AS ENUM ('SINGLE', 'MULTIPLE');

-- CreateEnum
CREATE TYPE "ProductOptionPriceMode" AS ENUM ('ABSOLUTE', 'SURCHARGE');

-- CreateTable
CREATE TABLE "ProductOptionGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "selectionType" "ProductOptionSelectionType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER,
    "priceMode" "ProductOptionPriceMode" NOT NULL DEFAULT 'SURCHARGE',
    "quickSaleTiles" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT NOT NULL,

    CONSTRAINT "ProductOptionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceEffect" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProductOptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
-- Lesepfad der Produktpflege und der Bestellmasken:
-- WHERE "productId" = ... ORDER BY "sortOrder"
CREATE INDEX "ProductOptionGroup_productId_sortOrder_idx" ON "ProductOptionGroup"("productId", "sortOrder");
CREATE INDEX "ProductOption_groupId_sortOrder_idx" ON "ProductOption"("groupId", "sortOrder");

-- CreateIndex (partiell, von Prisma nicht abgebildet)
-- Der Grundpreis einer Bestellposition muss eindeutig bestimmt sein. Zwei
-- Gruppen mit absolutem Preis am selben Produkt waeren nicht aufloesbar.
CREATE UNIQUE INDEX "ProductOptionGroup_productId_absolute_key"
  ON "ProductOptionGroup"("productId")
  WHERE "priceMode" = 'ABSOLUTE';

-- Der Schnellverkauf faechert genau eine Dimension in Kacheln auf. Die Marke
-- ist die einzige Quelle dieser Entscheidung, deshalb darf sie je Produkt nur
-- einmal vergeben sein.
CREATE UNIQUE INDEX "ProductOptionGroup_productId_quickSaleTiles_key"
  ON "ProductOptionGroup"("productId")
  WHERE "quickSaleTiles";

-- AddCheckConstraint (von Prisma nicht abgebildet, siehe Kopfkommentar)

-- Eine negative Sortierung hat keine Bedeutung; die Anzeige sortiert
-- aufsteigend ab 0.
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_sortOrder_check"
  CHECK ("sortOrder" >= 0);

-- Eine namenlose Frage ist in keiner Oberflaeche darstellbar.
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_name_not_blank_check"
  CHECK (length(btrim("name")) > 0);

-- Zulaessiger Bereich der Antwortanzahl. maxSelect NULL bedeutet unbegrenzt.
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_select_range_check"
  CHECK (
    "minSelect" >= 0
    AND ("maxSelect" IS NULL OR ("maxSelect" >= 1 AND "maxSelect" >= "minSelect"))
  );

-- Pflicht ist keine zweite, frei setzbare Wahrheit neben minSelect, sondern
-- deren Lesart. Damit kann eine Gruppe nicht als Pflicht markiert sein und
-- zugleich null Antworten verlangen.
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_required_matches_min_check"
  CHECK ("isRequired" = ("minSelect" >= 1));

-- Einfachauswahl bedeutet hoechstens eine Antwort. Pflicht plus SINGLE ergibt
-- damit ueber die vorige Bedingung genau eine Antwort.
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_single_bounds_check"
  CHECK (
    "selectionType" <> 'SINGLE'
    OR ("maxSelect" = 1 AND "minSelect" <= 1)
  );

-- Eine Gruppe mit absolutem Preis setzt den Grundpreis der Position. Waere sie
-- freiwillig oder mehrfach waehlbar, gaebe es keinen oder mehr als einen
-- Grundpreis.
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_absolute_mode_check"
  CHECK (
    "priceMode" <> 'ABSOLUTE'
    OR ("selectionType" = 'SINGLE' AND "isRequired")
  );

-- Eine Kachel im Schnellverkauf traegt genau eine Antwort und genau einen
-- Preis. Das setzt eine Pflichtgruppe mit Einfachauswahl voraus.
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_quick_sale_tiles_check"
  CHECK (
    NOT "quickSaleTiles"
    OR ("selectionType" = 'SINGLE' AND "isRequired")
  );

ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_sortOrder_check"
  CHECK ("sortOrder" >= 0);

ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_name_not_blank_check"
  CHECK (length(btrim("name")) > 0);

-- Preiswirkung in ganzen Cent: INTEGER schliesst Bruchteile aus, die Bedingung
-- begrenzt den Betrag auf 10000 Euro je Option und faengt damit Eingabefehler
-- ab. Negative Betraege bleiben ausdruecklich erlaubt: ein Abschlag wie
-- "ohne Beilage -2,00" ist eine vorhandene und gewollte Pflegemoeglichkeit
-- (siehe prisma/seed.ts). Zwei Regeln kann eine zeilenweise Bedingung nicht
-- pruefen und sie gehoeren deshalb in die Anwendung: eine Option einer
-- ABSOLUTE-Gruppe darf nicht negativ sein, und der errechnete Endpreis einer
-- Bestellposition darf nicht kleiner als 0 sein.
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_priceEffect_range_check"
  CHECK ("priceEffect" BETWEEN -1000000 AND 1000000);

-- Datenuebernahme 1 von 4: je Produkt mit mindestens einer Variante entsteht
-- genau eine Pflichtgruppe mit Einfachauswahl und absolutem Preis. Sie traegt
-- die Kachelmarke des Schnellverkaufs, weil bisher genau die Varianten dort
-- aufgefaechert wurden. Die Gruppenkennung wird deterministisch aus der
-- Produktkennung abgeleitet, damit die Migration bei einer Wiederholung auf
-- derselben Datenbasis dieselben Zeilen erzeugt.
INSERT INTO "ProductOptionGroup" (
  "id", "name", "selectionType", "isRequired", "minSelect", "maxSelect",
  "priceMode", "quickSaleTiles", "sortOrder", "productId"
)
SELECT
  substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-' || substr(h, 13, 4) || '-'
    || substr(h, 17, 4) || '-' || substr(h, 21, 12),
  'Variante',
  'SINGLE',
  true,
  1,
  1,
  'ABSOLUTE',
  true,
  0,
  s."productId"
FROM (
  SELECT DISTINCT "productId", md5('ProductOptionGroup/variants/' || "productId") AS h
  FROM "ProductVariant"
) AS s;

-- Datenuebernahme 2 von 4: je Produkt mit mindestens einem Extra entsteht genau
-- eine freiwillige Gruppe mit Mehrfachauswahl und Aufpreis, ohne obere Grenze.
INSERT INTO "ProductOptionGroup" (
  "id", "name", "selectionType", "isRequired", "minSelect", "maxSelect",
  "priceMode", "quickSaleTiles", "sortOrder", "productId"
)
SELECT
  substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-' || substr(h, 13, 4) || '-'
    || substr(h, 17, 4) || '-' || substr(h, 21, 12),
  'Extras',
  'MULTIPLE',
  false,
  0,
  NULL,
  'SURCHARGE',
  false,
  1,
  s."productId"
FROM (
  SELECT DISTINCT "productId", md5('ProductOptionGroup/extras/' || "productId") AS h
  FROM "ProductExtra"
) AS s;

-- Datenuebernahme 3 von 4: die Varianten selbst. Die bisherige Kennung bleibt
-- erhalten, der bisherige absolute Preis wird zur Preiswirkung. Die Sortierung
-- wird dicht ab 0 neu vergeben, geordnet nach bisherigem sortOrder, dann Name,
-- dann Kennung. Das erhaelt die bisherige Reihenfolge, macht sie eindeutig und
-- schliesst negative Werte aus.
INSERT INTO "ProductOption" ("id", "name", "priceEffect", "isActive", "sortOrder", "groupId")
SELECT
  v."id",
  v."name",
  v."price",
  true,
  (ROW_NUMBER() OVER (
     PARTITION BY v."productId"
     ORDER BY v."sortOrder" ASC, v."name" ASC, v."id" ASC
   ) - 1)::int,
  substr(h.m, 1, 8) || '-' || substr(h.m, 9, 4) || '-' || substr(h.m, 13, 4) || '-'
    || substr(h.m, 17, 4) || '-' || substr(h.m, 21, 12)
FROM "ProductVariant" v
CROSS JOIN LATERAL (SELECT md5('ProductOptionGroup/variants/' || v."productId") AS m) AS h;

-- Datenuebernahme 4 von 4: die Extras. Der bisherige Aufpreis wird zur
-- Preiswirkung, die Sortierung folgt derselben Regel wie bei den Varianten.
INSERT INTO "ProductOption" ("id", "name", "priceEffect", "isActive", "sortOrder", "groupId")
SELECT
  e."id",
  e."name",
  e."price",
  true,
  (ROW_NUMBER() OVER (
     PARTITION BY e."productId"
     ORDER BY e."sortOrder" ASC, e."name" ASC, e."id" ASC
   ) - 1)::int,
  substr(h.m, 1, 8) || '-' || substr(h.m, 9, 4) || '-' || substr(h.m, 13, 4) || '-'
    || substr(h.m, 17, 4) || '-' || substr(h.m, 21, 12)
FROM "ProductExtra" e
CROSS JOIN LATERAL (SELECT md5('ProductOptionGroup/extras/' || e."productId") AS m) AS h;

-- DropTable
-- Erst nach der vollstaendigen Uebernahme in derselben Migration.
DROP TABLE "ProductExtra";
DROP TABLE "ProductVariant";
