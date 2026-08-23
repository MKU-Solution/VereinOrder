-- Bestellnummern sind je Veranstaltung und Betriebsart die menschlich
-- lesbare Referenz einer Bestellung. SERIAL allein erzeugt zwar normalerweise
-- neue Werte, schuetzt aber nicht gegen explizite Werte aus Restore- oder
-- Importvorgaengen.
--
-- Bestandsdaten werden bewusst nicht automatisch veraendert. Stattdessen
-- bricht die Migration vor dem Anlegen des Constraints mit den betroffenen
-- Bestellnummern ab, damit deren fachliche Zuordnung nachvollziehbar geklaert
-- werden kann.
--
-- Prisma Migrate fuehrt PostgreSQL-Migrationen in der hier verwendeten
-- Version nicht automatisch als eine Transaktion aus. Check, Unique-Index und
-- Sequenzabgleich muessen daher in derselben expliziten Transaktion bleiben.
BEGIN;

-- Das Schloss haelt konkurrierende Schreibvorgaenge bis zum Commit an, damit
-- zwischen Duplikatpruefung, Unique-Index und Sequenzabgleich keine
-- Bestellnummer eingeschleust werden kann.
LOCK TABLE "Order" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  duplicate_count bigint;
  duplicate_keys text;
BEGIN
  WITH duplicates AS (
    SELECT "eventId", "dataMode", "orderNumber"
    FROM "Order"
    GROUP BY "eventId", "dataMode", "orderNumber"
    HAVING count(*) > 1
  ), sample AS (
    SELECT *
    FROM duplicates
    ORDER BY "eventId", "dataMode", "orderNumber"
    LIMIT 20
  )
  SELECT
    (SELECT count(*) FROM duplicates),
    string_agg(
      'eventId=' || "eventId" || ', dataMode=' || "dataMode"::text
        || ', orderNumber=' || "orderNumber"::text,
      '; ' ORDER BY "eventId", "dataMode", "orderNumber"
    )
  INTO duplicate_count, duplicate_keys
  FROM sample;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Eindeutigkeit der Bestellnummer je Veranstaltung und Betriebsart kann nicht aktiviert werden: % doppelte Schluessel vorhanden. Betroffene Schluessel (maximal 20): %. Keine Daten wurden automatisch korrigiert.',
      duplicate_count,
      duplicate_keys;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "Order_eventId_dataMode_orderNumber_key" ON "Order"("eventId", "dataMode", "orderNumber");

-- Ein frueherer Import kann explizite Bestellnummern geschrieben haben,
-- ohne die SERIAL-Sequenz weiterzusetzen. Die Sequenz wird deshalb nach dem
-- Bestandscheck/Constraint auf das vorhandene Maximum ausgerichtet. Bei einer
-- leeren Tabelle oder wenn alle importierten Nummern <= 0 sind, ist 1 der
-- kleinste gueltige SERIAL-Wert und is_called=false, damit die naechste
-- Bestellung die Nummer 1 erhaelt.
SELECT setval(
  pg_get_serial_sequence('"Order"', 'orderNumber'),
  GREATEST(COALESCE(MAX("orderNumber"), 1), 1),
  COALESCE(MAX("orderNumber") >= 1, false)
)
FROM "Order";

COMMIT;
