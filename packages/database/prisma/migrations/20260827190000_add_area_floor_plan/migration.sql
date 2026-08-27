-- Issue #138: Ein Bereich kann einen versionierten grafischen Raumplan tragen.
-- JSONB ist hier bewusst gewaehlt: der Plan wird stets atomar gespeichert und
-- im Backend streng validiert; einzelne Elemente besitzen keine unabhaengige
-- fachliche Lebensdauer ausserhalb ihres Bereichs.
ALTER TABLE "Area"
ADD COLUMN "floorPlan" JSONB;
