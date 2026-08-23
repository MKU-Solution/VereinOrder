-- Eine Kategorie und optionale Zielstationen duerfen nur innerhalb derselben
-- Veranstaltung referenziert werden (Issue #96). Die Anwendung prueft dies
-- bereits, die Datenbank macht die Regel nun auch bei Direktzugriffen bindend.
--
-- Bestandsdaten werden absichtlich nicht korrigiert. Eine falsche Zuordnung
-- kann einen Bon an eine andere Veranstaltung leiten und muss fachlich
-- entschieden werden. Der Abbruch nennt deshalb hoechstens 20 konkrete Faelle.
--
-- Prisma Migrate fuehrt PostgreSQL-Migrationen nicht automatisch atomar aus.
-- Die Pruefung und alle Constraint-Aenderungen liegen daher in einer eigenen
-- Transaktion. SHARE ROW EXCLUSIVE blockiert konkurrierende Schreibvorgaenge,
-- damit zwischen Pruefung und Fremdschluesseln keine falsche Zuordnung entsteht.
BEGIN;

LOCK TABLE "Event", "Station", "ProductCategory", "Product" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  violation_count bigint;
  sample text;
BEGIN
  WITH violations AS (
    SELECT
      'Product->ProductCategory' AS relation,
      p.id AS source_id,
      p."eventId" AS source_event_id,
      p."categoryId" AS target_id,
      c."eventId" AS target_event_id
    FROM "Product" p
    JOIN "ProductCategory" c ON c.id = p."categoryId"
    WHERE p."eventId" IS DISTINCT FROM c."eventId"

    UNION ALL

    SELECT
      'ProductCategory->Station' AS relation,
      c.id AS source_id,
      c."eventId" AS source_event_id,
      c."targetStationId" AS target_id,
      s."eventId" AS target_event_id
    FROM "ProductCategory" c
    JOIN "Station" s ON s.id = c."targetStationId"
    WHERE c."eventId" IS DISTINCT FROM s."eventId"

    UNION ALL

    SELECT
      'Product->Station' AS relation,
      p.id AS source_id,
      p."eventId" AS source_event_id,
      p."targetStationId" AS target_id,
      s."eventId" AS target_event_id
    FROM "Product" p
    JOIN "Station" s ON s.id = p."targetStationId"
    WHERE p."eventId" IS DISTINCT FROM s."eventId"
  ), sample_rows AS (
    SELECT *
    FROM violations
    ORDER BY relation, source_id
    LIMIT 20
  )
  SELECT
    (SELECT count(*) FROM violations),
    string_agg(
      format('%s: id=%s, eventId=%s, referenzId=%s, referenzEventId=%s',
        relation, source_id, source_event_id, target_id, target_event_id),
      '; ' ORDER BY relation, source_id
    )
  INTO violation_count, sample
  FROM sample_rows;

  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Gleiche Eventzugehoerigkeit fuer Produkte, Kategorien und Zielstationen kann nicht aktiviert werden: % ungueltige Referenzen vorhanden. Betroffene Referenzen (maximal 20): %. Keine Daten wurden automatisch korrigiert.',
      violation_count, sample;
  END IF;
END $$;

-- Die Primaerschluessel bleiben unveraendert. Die zusaetzlichen eindeutigen
-- Paare sind ausschliesslich die Zielseite der zusammengesetzten FKs.
CREATE UNIQUE INDEX "Station_id_eventId_key" ON "Station"("id", "eventId");
CREATE UNIQUE INDEX "ProductCategory_id_eventId_key" ON "ProductCategory"("id", "eventId");

ALTER TABLE "ProductCategory" DROP CONSTRAINT "ProductCategory_targetStationId_fkey";
ALTER TABLE "Product" DROP CONSTRAINT "Product_categoryId_fkey";
ALTER TABLE "Product" DROP CONSTRAINT "Product_targetStationId_fkey";

-- Bei geloeschter Station wird weiterhin nur die optionale Stationskennung
-- geloescht. eventId bleibt erhalten und die Zeile bleibt ihrer Veranstaltung
-- zugeordnet; PostgreSQL 16 unterstuetzt diese partielle SET-NULL-Aktion.
ALTER TABLE "ProductCategory"
  ADD CONSTRAINT "ProductCategory_targetStationId_eventId_fkey"
  FOREIGN KEY ("targetStationId", "eventId")
  REFERENCES "Station"("id", "eventId")
  ON DELETE SET NULL ("targetStationId") ON UPDATE NO ACTION;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_categoryId_eventId_fkey"
  FOREIGN KEY ("categoryId", "eventId")
  REFERENCES "ProductCategory"("id", "eventId")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_targetStationId_eventId_fkey"
  FOREIGN KEY ("targetStationId", "eventId")
  REFERENCES "Station"("id", "eventId")
  ON DELETE SET NULL ("targetStationId") ON UPDATE NO ACTION;

COMMIT;
