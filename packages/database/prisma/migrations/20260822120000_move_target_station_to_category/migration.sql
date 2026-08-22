-- Zielstation wandert von den Produkten an die Kategorien (Issue #84).
--
-- Ausgangslage: die Zielstation stand ausschliesslich am Produkt. Bei einem
-- Fest mit vielen Artikeln wurde dieselbe Angabe dutzendfach wiederholt, und
-- ein vergessenes Feld leitete den Bon still an die zentrale Ausgabe statt an
-- die Kueche.
--
-- Neu: "ProductCategory" traegt eine optionale Zielstation als Vorgabe fuer
-- alle ihre Produkte. "Product"."targetStationId" bleibt bestehen, bedeutet
-- aber ab jetzt "Ausnahme von der Kategorie". Die Aufloesung lautet damit:
-- Station des Produkts, sonst Station der Kategorie, sonst zentrale Ausgabe.
-- "Product"."categoryId" wird zur Pflicht, weil die Station sonst unbestimmt
-- waere; die Fremdschluesselregel wechselt dabei zwangslaeufig von SetNull auf
-- Restrict, denn eine Pflichtspalte kann nicht auf NULL gesetzt werden.
--
-- Reihenfolge der Uebernahme und ihre Begruendung:
--   1. Auffangkategorie je Veranstaltung mit Produkten ohne Kategorie. Muss
--      zuerst laufen, damit ab Schritt 2 jedes Produkt genau einer Kategorie
--      zugeordnet ist und die Aggregation kein Produkt uebersieht.
--   2. Je Kategorie die haeufigste Zielstation ihrer Produkte als Vorgabe.
--   3. Produkte, deren Station der Vorgabe entspricht, verlieren ihren
--      Eintrag; abweichende behalten ihn als Ausnahme. Muss nach Schritt 2
--      laufen, weil erst dort feststeht, wogegen verglichen wird.
--   4. Erst danach "categoryId" auf NOT NULL. Vor Schritt 1 gaebe es noch
--      Zeilen ohne Kategorie und die Anweisung wuerde scheitern.
--
-- Ermittlung der haeufigsten Station (Schritt 2):
--   - Gezaehlt werden nur echte Stationen. NULL ist kein Kandidat und kann
--     deshalb nie als "haeufigste Station" gewinnen.
--   - Bei Gleichstand entscheidet die Reihenfolge der Stationsverwaltung:
--     "sortOrder" aufsteigend, dann "name", dann "id". Die ersten beiden
--     Kriterien sind fuer Bedienende nachvollziehbar, das dritte macht das
--     Ergebnis auch bei gleichem Namen eindeutig und wiederholbar.
--   - Eine Kategorie erhaelt die ermittelte Station nur, wenn KEINES ihrer
--     Produkte bisher ohne Station war. Sonst wuerde die neue Vorgabe genau
--     diese Produkte von der zentralen Ausgabe auf eine Station umleiten; die
--     Datenhaltung kennt kein "ausdruecklich keine Station" als Ausnahme, das
--     leere Feld bedeutet ab jetzt "Vorgabe der Kategorie". Solche gemischten
--     Kategorien bleiben ohne Vorgabe, alle ihre Produkte behalten ihren
--     Eintrag. Verlustfreiheit geht hier vor Aufraeumen.
--   - Die Auffangkategorie aus Schritt 1 ist von der Ermittlung ausgenommen
--     und bleibt ohne Vorgabe. Sie ist eine Sammelstelle unzusammenhaengender
--     Restposten; eine daraus abgeleitete Vorgabe waere fachlich willkuerlich
--     und wuerde spaeter dort eingehaengte Artikel still fehlleiten. Das
--     entspricht der Vorgabe aus Issue #84, wonach diese Produkte ihre Station
--     als Ausnahme behalten.
--
-- Nachweis der Verlustfreiheit: vor der Umstellung wird die aufgeloeste
-- Station je Produkt in "_issue84_resolution_before" festgehalten (vor der
-- Umstellung ist das schlicht "Product"."targetStationId"). Am Ende wird die
-- neue Aufloesung COALESCE(Produktstation, Kategoriestation) Zeile fuer Zeile
-- dagegen gehalten. Jede Abweichung, jedes verlorene und jedes zusaetzliche
-- Produkt bricht mit RAISE EXCEPTION ab. Eine stille Abweichung waere im
-- Festbetrieb ein Bon an der falschen Station.
--
-- Pruefbedingungen: es gibt hier keine zeilenweise pruefbare Invariante, die
-- Prisma nicht schon abbildet. Die verbleibende ungesicherte Invariante
-- "Produkt, Kategorie und Station gehoeren zur selben Veranstaltung" ist
-- tabellenuebergreifend und liesse sich nur ueber zusammengesetzte
-- Fremdschluessel erzwingen. Das ist nicht Gegenstand von Issue #84 und wuerde
-- diese Migration an moeglichen Altbestaenden scheitern lassen; die Anwendung
-- setzt die Regel bisher allein durch. Absichtlich offen gelassen, siehe
-- Uebergabebericht.
--
-- Auf einer leeren Datenbank laeuft die Migration vollstaendig durch: alle
-- Uebernahmeschritte arbeiten ueber leere Mengen, die Schlusspruefung
-- vergleicht 0 mit 0.

-- Zustand vor der Umstellung. Regulaere Tabelle statt TEMP, damit die
-- Momentaufnahme unabhaengig davon ueberlebt, ob die Migration in einer
-- Sitzung oder je Anweisung ausgefuehrt wird. Wird am Ende wieder entfernt.
CREATE TABLE "_issue84_resolution_before" AS
SELECT p."id" AS "productId", p."targetStationId" AS "stationId"
FROM "Product" p;

-- AlterTable
ALTER TABLE "ProductCategory" ADD COLUMN "targetStationId" TEXT;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_targetStationId_fkey" FOREIGN KEY ("targetStationId") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Schritt 1 von 4: Auffangkategorie je Veranstaltung, die Produkte ohne
-- Kategorie hat. Die Kennung wird deterministisch aus der Veranstaltung
-- abgeleitet, damit die Migration auf derselben Datenbasis dieselben Zeilen
-- erzeugt. Die Sortierung haengt die Gruppe hinten an, sie ist kein Sortiment,
-- sondern ein Rest. Der Name ist bewusst der einer normalen Kategorie, weil
-- Bedienende ihn in denselben Listen sehen wie alle anderen.
CREATE TABLE "_issue84_fallback_category" (
  "eventId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL
);

INSERT INTO "_issue84_fallback_category" ("eventId", "categoryId")
SELECT
  e."eventId",
  substr(m.h, 1, 8) || '-' || substr(m.h, 9, 4) || '-' || substr(m.h, 13, 4) || '-'
    || substr(m.h, 17, 4) || '-' || substr(m.h, 21, 12)
FROM (
  SELECT DISTINCT p."eventId" FROM "Product" p WHERE p."categoryId" IS NULL
) AS e
CROSS JOIN LATERAL (
  SELECT md5('ProductCategory/issue84-fallback/' || e."eventId") AS h
) AS m;

-- (eventId, name) ist in der Datenhaltung nicht eindeutig. Traegt eine
-- Veranstaltung bereits eine Gruppe dieses Namens, weicht die Auffangkategorie
-- auf den zweiten Namen aus, damit in der Verwaltung keine zwei gleichnamigen
-- Gruppen nebeneinander stehen.
INSERT INTO "ProductCategory" ("id", "name", "sortOrder", "eventId", "targetStationId", "createdAt", "updatedAt")
SELECT
  f."categoryId",
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "ProductCategory" c
      WHERE c."eventId" = f."eventId" AND c."name" = 'Sonstige Artikel'
    ) THEN 'Sonstige Artikel (ohne Kategorie)'
    ELSE 'Sonstige Artikel'
  END,
  o."nextSortOrder",
  f."eventId",
  NULL,
  now(),
  now()
FROM "_issue84_fallback_category" f
CROSS JOIN LATERAL (
  SELECT COALESCE(max(c."sortOrder"), -1) + 1 AS "nextSortOrder"
  FROM "ProductCategory" c
  WHERE c."eventId" = f."eventId"
) AS o;

UPDATE "Product" p
SET "categoryId" = f."categoryId"
FROM "_issue84_fallback_category" f
WHERE f."eventId" = p."eventId"
  AND p."categoryId" IS NULL;

-- Schritt 2 von 4: haeufigste Zielstation je Kategorie als Vorgabe. Regeln und
-- Begruendung siehe Kopfkommentar.
WITH counted AS (
  SELECT
    p."categoryId" AS "categoryId",
    p."targetStationId" AS "stationId",
    count(*) AS "hits"
  FROM "Product" p
  WHERE p."categoryId" IS NOT NULL
    AND p."targetStationId" IS NOT NULL
  GROUP BY p."categoryId", p."targetStationId"
),
ranked AS (
  SELECT
    c."categoryId",
    c."stationId",
    ROW_NUMBER() OVER (
      PARTITION BY c."categoryId"
      ORDER BY c."hits" DESC, s."sortOrder" ASC, s."name" ASC, s."id" ASC
    ) AS "rank"
  FROM counted c
  JOIN "Station" s ON s."id" = c."stationId"
)
UPDATE "ProductCategory" pc
SET "targetStationId" = r."stationId"
FROM ranked r
WHERE r."categoryId" = pc."id"
  AND r."rank" = 1
  -- Kein Produkt der Gruppe war bisher ohne Station, sonst wuerde die Vorgabe
  -- genau diese Produkte umleiten.
  AND NOT EXISTS (
    SELECT 1 FROM "Product" p
    WHERE p."categoryId" = pc."id" AND p."targetStationId" IS NULL
  )
  -- Die Auffangkategorie bleibt ohne Vorgabe.
  AND NOT EXISTS (
    SELECT 1 FROM "_issue84_fallback_category" f
    WHERE f."categoryId" = pc."id"
  );

-- Schritt 3 von 4: Produkte, deren Station der Vorgabe ihrer Kategorie
-- entspricht, verlieren ihren Eintrag. Fuer sie gilt ab jetzt die Kategorie.
-- Abweichende Produkte behalten ihren Eintrag als Ausnahme.
UPDATE "Product" p
SET "targetStationId" = NULL
FROM "ProductCategory" c
WHERE c."id" = p."categoryId"
  AND p."targetStationId" IS NOT NULL
  AND c."targetStationId" = p."targetStationId";

-- Schritt 4 von 4: Kategorie wird Pflicht. Die Vorpruefung liefert eine
-- lesbare Meldung, bevor die Datenhaltung mit einer generischen
-- Verletzungsmeldung abbricht.
DO $$
DECLARE
  orphaned int;
BEGIN
  SELECT count(*) INTO orphaned FROM "Product" WHERE "categoryId" IS NULL;
  IF orphaned <> 0 THEN
    RAISE EXCEPTION 'Nach der Zuordnung zur Auffangkategorie sind noch % Produkte ohne Kategorie. Die Pflichtspalte darf nicht gesetzt werden.', orphaned;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "categoryId" SET NOT NULL;

-- DropForeignKey / AddForeignKey
-- SetNull ist mit einer Pflichtspalte nicht mehr gueltig.
ALTER TABLE "Product" DROP CONSTRAINT "Product_categoryId_fkey";
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nachweis der Verlustfreiheit. Erfasst drei Faelle in einer Menge: ein
-- Produkt aus der Momentaufnahme fehlt, ein Produkt ist neu hinzugekommen,
-- oder die aufgeloeste Station weicht ab. IS DISTINCT FROM behandelt dabei
-- "keine Station" als vergleichbaren Wert und nicht als unbekannt.
CREATE TABLE "_issue84_drift" AS
SELECT
  COALESCE(p."id", b."productId") AS "productId",
  b."stationId" AS "stationBefore",
  COALESCE(p."targetStationId", c."targetStationId") AS "stationAfter"
FROM "_issue84_resolution_before" b
FULL OUTER JOIN "Product" p ON p."id" = b."productId"
LEFT JOIN "ProductCategory" c ON c."id" = p."categoryId"
WHERE b."productId" IS NULL
   OR p."id" IS NULL
   OR COALESCE(p."targetStationId", c."targetStationId") IS DISTINCT FROM b."stationId";

DO $$
DECLARE
  drifted int;
  sample text;
BEGIN
  SELECT count(*) INTO drifted FROM "_issue84_drift";
  IF drifted <> 0 THEN
    SELECT string_agg(d."productId", ', ' ORDER BY d."productId") INTO sample
    FROM (SELECT "productId" FROM "_issue84_drift" ORDER BY "productId" LIMIT 20) AS d;
    RAISE EXCEPTION 'Die Umstellung der Zielstation ist nicht verlustfrei: % Produkte loesen auf eine andere Station auf als vorher oder sind verloren gegangen. Betroffen unter anderem: %.', drifted, sample;
  END IF;
END $$;

DROP TABLE "_issue84_drift";
DROP TABLE "_issue84_fallback_category";
DROP TABLE "_issue84_resolution_before";
