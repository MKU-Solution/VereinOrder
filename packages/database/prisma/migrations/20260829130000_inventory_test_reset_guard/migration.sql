-- Issue #141 (Abnahmefehler B1): Die Testdatenbereinigung einer Veranstaltung
-- loescht Bestellungen und Bestellpositionen. "InventoryMovement" haengt per
-- ON DELETE RESTRICT an beiden, deshalb scheiterte die Bereinigung mit 23001,
-- sobald im Testbetrieb ein bestandsgefuehrtes Produkt verkauft wurde. Damit
-- liess sich eine solche Veranstaltung nicht mehr auf Echtbetrieb umstellen.
--
-- Die Loesung darf die Unveraenderlichkeit des Ledgers im Echtbetrieb nicht
-- aufweichen. Die vorhandene Restore-Ausnahme waere dafuer viel zu weit: sie
-- erlaubt UPDATE und DELETE in jeder Betriebsart. Stattdessen bekommt der
-- Waechter eine zweite, engere transaktionslokale Ausnahme:
--
--   vereinorder.inventory_test_reset = 'on'
--     -> ausschliesslich DELETE, ausschliesslich auf Zeilen mit
--        "dataMode" = 'TEST'. Jede Aenderung und jede LIVE-Zeile bleibt
--        gesperrt, auch waehrend die Ausnahme gesetzt ist.
--
-- Beide Ausnahmen wirken nur per SET LOCAL innerhalb der jeweiligen
-- Transaktion. Ein Rollback oder Commit entfernt sie automatisch; normale
-- Anwendungstransaktionen sehen sie nie.
--
-- Die Migration 20260829100000 wird bewusst nicht nachtraeglich umgeschrieben.
-- Der Trigger bleibt unveraendert bestehen und zeigt weiterhin auf dieselbe
-- Funktion; ersetzt wird nur deren Rumpf.

BEGIN;

CREATE OR REPLACE FUNCTION "guard_inventory_movement_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Unveraendert: der Legacy-JSON-Restore ersetzt den gesamten Datenbestand.
  IF current_setting('vereinorder.inventory_restore', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- Neu: Bereinigung der Testdaten einer Veranstaltung. Erlaubt ist genau
  -- das Loeschen von Bewegungen der Betriebsart TEST - nicht mehr.
  IF current_setting('vereinorder.inventory_test_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' AND OLD."dataMode" = 'TEST'::"OperationalDataMode" THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION
      'Inventory test reset may only delete TEST movements'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'InventoryMovement is append-only'
    USING ERRCODE = '55000';
END;
$$;

COMMIT;
