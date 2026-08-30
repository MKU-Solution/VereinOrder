-- Datenbank-CHECK fuer die Payment.method-Tenderregel (Issue #165).
--
-- Aus einer Bestandsaufnahme ueber alle Schreibpfade (orders.service.ts:
-- createOrder, createQuickSale/createStationSale, addPaymentsToOrder,
-- splitPaymentOrder; value-vouchers.service.ts: redeemValueVoucher) ergibt
-- sich folgende, tatsaechlich geschriebene Regel:
--   - CASH: tenderedAmount ist ENTWEDER NULL (dann ist changeAmount = 0,
--     so bei einer Tischbestellung ueber createOrder,
--     addPaymentsToOrder oder splitPaymentOrder, die keinen Bargeldbeleg
--     erfasst) ODER >= amount (dann ist changeAmount die exakte Differenz,
--     so bei createQuickSale/createStationSale und der Restzahlung in
--     value-vouchers.service.ts).
--   - CARD, VOUCHER, REFUND: tenderedAmount bleibt an jedem Schreibpfad
--     NULL, changeAmount bleibt 0.
-- Bewusst NICHT umgesetzt: "CASH verlangt immer tenderedAmount", wie es
-- ValueVoucherMovement_tender_check fuer Wertgutscheine tut. Diese
-- staerkere Regel wuerde die woechentliche Tischbestellung ohne
-- Bargeldbeleg als Defekt ablehnen und damit eine gueltige Sicherung
-- verwerfen - siehe die gleichlautende Pruefung in backup-document.ts
-- (parseBackupDocument/validateReferences) und den zugehoerigen Bericht zu
-- Issue #165 fuer die vollstaendige Herleitung.
--
-- Selbstpruefung nach dem Vorbild von
-- "20260830090000_add_event_status_testmode_check": eine bestehende
-- Instanz koennte bereits eine verletzende Zeile tragen (zum Beispiel aus
-- einer JSON-Wiederherstellung vor Issue #165). Die Migration prueft
-- deshalb vorher und nennt die betroffenen Zahlungen, statt einfach mit
-- einem rohen Constraint-Fehler abzubrechen.
DO $$
DECLARE
  violation_count bigint;
  sample text;
BEGIN
  WITH violations AS (
    SELECT id, "orderId", "method", "amount", "tenderedAmount", "changeAmount"
    FROM "Payment"
    WHERE NOT (
      ("method" = 'CASH' AND (
        ("tenderedAmount" IS NULL AND "changeAmount" = 0)
        OR (
          "tenderedAmount" IS NOT NULL
          AND "tenderedAmount" >= "amount"
          AND "changeAmount" = "tenderedAmount" - "amount"
        )
      ))
      OR (
        "method" IN ('CARD', 'VOUCHER', 'REFUND')
        AND "tenderedAmount" IS NULL
        AND "changeAmount" = 0
      )
    )
  ), sample_rows AS (
    SELECT * FROM violations ORDER BY id LIMIT 20
  )
  SELECT
    (SELECT count(*) FROM violations),
    (SELECT string_agg(
       format(
         '%s (Bestellung %s): method=%s, amount=%s, tenderedAmount=%s, changeAmount=%s',
         id, "orderId", "method", "amount", "tenderedAmount", "changeAmount"
       ),
       '; ' ORDER BY id
     ) FROM sample_rows)
  INTO violation_count, sample;

  IF violation_count > 0 THEN
    RAISE EXCEPTION
      'Der Tender-Constraint fuer Zahlungen kann nicht aktiviert werden: % Zahlung(en) tragen eine unmoegliche Kombination aus method, tenderedAmount und changeAmount. Betroffene Zahlungen (hoechstens 20): %. Diese muessen vor der Migration fachlich bereinigt werden.',
      violation_count, sample;
  END IF;
END $$;

-- AddCheckConstraint (von Prisma nicht abgebildet, siehe Kopfkommentar am
-- Payment-Modell in schema.prisma)
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tender_check"
  CHECK (
    ("method" = 'CASH' AND (
      ("tenderedAmount" IS NULL AND "changeAmount" = 0)
      OR (
        "tenderedAmount" IS NOT NULL
        AND "tenderedAmount" >= "amount"
        AND "changeAmount" = "tenderedAmount" - "amount"
      )
    ))
    OR (
      "method" IN ('CARD', 'VOUCHER', 'REFUND')
      AND "tenderedAmount" IS NULL
      AND "changeAmount" = 0
    )
  );
