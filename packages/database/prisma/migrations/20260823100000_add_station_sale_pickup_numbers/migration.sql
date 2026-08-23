-- Abholnummer und Station an der Bestellung (Issue #66, Stationskasse).
--
-- Neu:
--   * "Order"."pickupNumber"  - je Veranstaltung und Betriebsart fortlaufende,
--     laut aufrufbare Abholnummer. NULL heisst "kein Stationsverkauf".
--   * "Order"."stationId"     - die Station, an der kassiert wurde. NULL ebenso.
--   * "EventPickupCounter"    - der Zaehler, aus dem die Nummer gezogen wird.
--
-- Warum ein eigener Zaehler und nicht "Order"."orderNumber": jene Spalte ist
-- eine globale SERIAL. Sie zaehlt ueber alle Veranstaltungen hinweg, trennt
-- Test- und Echtbetrieb nicht und ist wegen nextval ausserhalb der Transaktion
-- luecken behaftet. Am Tresen ist eine Luecke die Nummer, die nie aufgerufen
-- wird. Der Zaehler ist deshalb eine gewoehnliche Zeile: bricht die
-- Verkaufstransaktion nach der Vergabe ab, wird die Erhoehung mit
-- zurueckgenommen und die naechste Zahlung bekommt dieselbe Nummer.
--
-- Verhalten auf Bestandsdaten: rein additiv. Alle vorhandenen Bestellungen
-- bekommen "pickupNumber" = NULL und "stationId" = NULL; es wird keine Zeile
-- geschrieben, geloescht oder umgerechnet. Der Zaehler startet fuer jede
-- Veranstaltung leer, die erste Vergabe legt die Zeile an.
--
-- Der Unique-Index ueber ("eventId", "dataMode", "pickupNumber") kollidiert
-- dabei nicht: PostgreSQL legt Unique-Indizes ohne NULLS NOT DISTINCT an,
-- NULL-Werte gelten also als voneinander verschieden. An dieser Instanz
-- nachgemessen (PostgreSQL 18.6): drei Zeilen mit gleicher Veranstaltung,
-- gleicher Betriebsart und NULL als Nummer werden angenommen, zwei Zeilen mit
-- derselben echten Nummer werden abgewiesen; pg_index.indnullsnotdistinct ist
-- fuer den erzeugten Index "f".
--
-- "Order"."stationId" loescht bei entfallener Station nicht mit, sondern setzt
-- auf NULL (ON DELETE SET NULL). Eine Aenderung an der Stationsverwaltung darf
-- keine bezahlte Bestellung mitreissen; ON DELETE CASCADE wuerde genau das tun
-- und ON DELETE RESTRICT wuerde eine Station nach dem ersten Verkauf auf Dauer
-- unloeschbar machen. Das entspricht jeder anderen Station-Beziehung im
-- Bestand ("Product", "ProductCategory", "ProductVoucher").
--
-- Selbstpruefung: die tragende Zusage dieser Migration ist, dass sich an den
-- Bestellungen selbst nichts aendert. Vorher werden Anzahl und Summe der
-- Betraege je Veranstaltung und Betriebsart festgehalten und am Ende Zeile fuer
-- Zeile dagegen gehalten. Jede Abweichung bricht mit RAISE EXCEPTION ab.
--
-- Auf einer leeren Datenbank laeuft die Migration vollstaendig durch: die
-- Momentaufnahme ist leer und die Schlusspruefung vergleicht 0 mit 0.

-- Zustand vor der Umstellung. Regulaere Tabelle statt TEMP, damit die
-- Momentaufnahme unabhaengig davon ueberlebt, ob die Migration in einer
-- Sitzung oder je Anweisung ausgefuehrt wird. Wird am Ende wieder entfernt.
CREATE TABLE "_issue66_orders_before" AS
SELECT
  o."eventId",
  o."dataMode",
  count(*) AS "orderCount",
  COALESCE(sum(o."totalAmount"), 0) AS "amountSum"
FROM "Order" o
GROUP BY o."eventId", o."dataMode";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "pickupNumber" INTEGER,
ADD COLUMN     "stationId" TEXT;

-- CreateTable
CREATE TABLE "EventPickupCounter" (
    "eventId" TEXT NOT NULL,
    "dataMode" "OperationalDataMode" NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventPickupCounter_pkey" PRIMARY KEY ("eventId","dataMode")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_eventId_dataMode_pickupNumber_key" ON "Order"("eventId", "dataMode", "pickupNumber");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPickupCounter" ADD CONSTRAINT "EventPickupCounter_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nachweis der Verlustfreiheit. Erfasst drei Faelle in einer Menge: eine
-- Gruppe aus der Momentaufnahme fehlt, eine Gruppe ist neu hinzugekommen, oder
-- Anzahl beziehungsweise Summe weichen ab. FULL OUTER JOIN und
-- IS DISTINCT FROM behandeln dabei die fehlende Gegenseite als vergleichbaren
-- Wert und nicht als unbekannt.
CREATE TABLE "_issue66_orders_drift" AS
WITH "after" AS (
  SELECT
    o."eventId",
    o."dataMode",
    count(*) AS "orderCount",
    COALESCE(sum(o."totalAmount"), 0) AS "amountSum"
  FROM "Order" o
  GROUP BY o."eventId", o."dataMode"
)
SELECT
  COALESCE(b."eventId", a."eventId") AS "eventId",
  COALESCE(b."dataMode", a."dataMode") AS "dataMode",
  b."orderCount" AS "countBefore",
  a."orderCount" AS "countAfter",
  b."amountSum" AS "sumBefore",
  a."amountSum" AS "sumAfter"
FROM "_issue66_orders_before" b
FULL OUTER JOIN "after" a
  ON a."eventId" = b."eventId" AND a."dataMode" = b."dataMode"
WHERE b."eventId" IS NULL
   OR a."eventId" IS NULL
   OR a."orderCount" IS DISTINCT FROM b."orderCount"
   OR a."amountSum" IS DISTINCT FROM b."amountSum";

DO $$
DECLARE
  drifted int;
  sample text;
BEGIN
  SELECT count(*) INTO drifted FROM "_issue66_orders_drift";
  IF drifted <> 0 THEN
    SELECT string_agg(
             d."eventId" || '/' || d."dataMode"
               || ': ' || COALESCE(d."countBefore"::text, '-')
               || ' -> ' || COALESCE(d."countAfter"::text, '-')
               || ' Bestellungen, ' || COALESCE(d."sumBefore"::text, '-')
               || ' -> ' || COALESCE(d."sumAfter"::text, '-') || ' Cent',
             '; ' ORDER BY d."eventId", d."dataMode")
      INTO sample
    FROM (
      SELECT * FROM "_issue66_orders_drift"
      ORDER BY "eventId", "dataMode" LIMIT 20
    ) AS d;
    RAISE EXCEPTION 'Die Einfuehrung der Abholnummer hat Bestellungen veraendert: % Gruppen weichen in Anzahl oder Betragssumme ab. Betroffen unter anderem: %.', drifted, sample;
  END IF;
END $$;

-- Zusatzpruefung: kein Bestandsdatensatz darf eine Abholnummer oder eine
-- Station erhalten haben. Die Migration vergibt keine Nummern; taete sie es,
-- traegen zwei Personen dieselbe.
DO $$
DECLARE
  filled int;
BEGIN
  SELECT count(*) INTO filled
  FROM "Order"
  WHERE "pickupNumber" IS NOT NULL OR "stationId" IS NOT NULL;
  IF filled <> 0 THEN
    RAISE EXCEPTION 'Nach der Migration tragen % Bestandsbestellungen eine Abholnummer oder eine Station, obwohl die Migration keine vergibt.', filled;
  END IF;
END $$;

DROP TABLE "_issue66_orders_drift";
DROP TABLE "_issue66_orders_before";
