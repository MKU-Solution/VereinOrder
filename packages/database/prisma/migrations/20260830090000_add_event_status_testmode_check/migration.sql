-- Datenbank-CHECK fuer die aus Issue #152 vereinheitlichte Ableitung der
-- Betriebsart einer Veranstaltung
-- (apps/backend/src/common/operational-data-mode.ts, resolveOperationalDataMode):
-- nur die Kombinationen status=ACTIVE mit testMode=true und
-- status=TEST_MODE mit testMode=false sind unmoeglich. Jeder andere Status
-- (DRAFT, PREPARED, PAUSED, COMPLETED, ARCHIVED) traegt testMode frei - das
-- gilt insbesondere fuer einen Wechsel von TEST_MODE nach PAUSED, der
-- testMode=true beibehaelt und kein Defekt ist.
--
-- Bislang stand diese Regel nur an den Schreibpfaden der Anwendung. Nach der
-- Untersuchung zu Issue #152 ist das Einspielen einer alten JSON-Sicherung
-- der einzige nachgewiesene Weg, auf dem eine unmoegliche Kombination trotzdem
-- in die Datenbank gelangen konnte (Issue #157, siehe die zugehoerige
-- fachliche Pruefung in backup-document.ts). Dieser Constraint ist der Riegel
-- darunter: selbst wenn ein anderer Weg an jener Pruefung vorbeifuehrt, kann
-- die Zeile nicht landen.
--
-- Selbstpruefung nach dem Vorbild von
-- "20260823100000_add_station_sale_pickup_numbers" bzw.
-- "20260823120000_enforce_event_referential_integrity": auf einer
-- Bestandsinstanz koennte bereits eine verletzende Zeile liegen (zum Beispiel
-- aus einer JSON-Wiederherstellung vor der Behebung von Issue #157). Ein roher
-- Constraint-Fehler waere fuer den Bedienenden nicht verstaendlich; die
-- Migration prueft deshalb vorher und nennt die betroffenen Veranstaltungen,
-- statt einfach abzubrechen.
DO $$
DECLARE
  violation_count bigint;
  sample text;
BEGIN
  WITH violations AS (
    SELECT id, name, status, "testMode"
    FROM "Event"
    WHERE ("status" = 'ACTIVE' AND "testMode")
       OR ("status" = 'TEST_MODE' AND NOT "testMode")
  ), sample_rows AS (
    SELECT * FROM violations ORDER BY id LIMIT 20
  )
  SELECT
    (SELECT count(*) FROM violations),
    (SELECT string_agg(
       format('%s (%s): status=%s, testMode=%s', id, name, status, "testMode"),
       '; ' ORDER BY id
     ) FROM sample_rows)
  INTO violation_count, sample;

  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Der Betriebsart-Constraint fuer Veranstaltungen kann nicht aktiviert werden: % Veranstaltung(en) tragen eine unmoegliche Kombination aus status und testMode. Betroffene Veranstaltungen (hoechstens 20): %. Diese muessen vor der Migration fachlich bereinigt werden.',
      violation_count, sample;
  END IF;
END $$;

-- AddCheckConstraint (von Prisma nicht abgebildet, siehe Kopfkommentar am
-- Event-Modell in schema.prisma)
ALTER TABLE "Event" ADD CONSTRAINT "Event_status_testMode_check"
  CHECK (NOT (("status" = 'ACTIVE' AND "testMode") OR ("status" = 'TEST_MODE' AND NOT "testMode")));
