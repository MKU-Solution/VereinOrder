import * as fs from "node:fs";
import * as path from "node:path";

const migrationPath = path.resolve(
  __dirname,
  "../../../../packages/database/prisma/migrations/20260828100000_add_value_vouchers/migration.sql",
);
const schemaPath = path.resolve(
  __dirname,
  "../../../../packages/database/prisma/schema.prisma",
);

describe("Wertgutschein-Datenmodell und Migration (Issue #139)", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");
  const schema = fs.readFileSync(schemaPath, "utf8");

  it("führt Wertgutscheine getrennt von den unveränderten Produktbons ein", () => {
    expect(schema).toContain("model ValueVoucher {");
    expect(schema).toContain("model ValueVoucherMovement {");
    expect(schema).toContain("model ValueVoucherAllocation {");
    expect(migration).not.toMatch(/ALTER TABLE "ProductVoucher"/);
  });

  it("bindet Gutschein, Bestellung und Kassensitzung an Event und TEST/LIVE-Modus", () => {
    expect(migration).toContain(
      'FOREIGN KEY ("voucherId", "eventId", "dataMode")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("orderId", "eventId", "dataMode")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("cashierSessionId", "eventId", "dataMode")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("issuedCashierSessionId", "eventId", "dataMode")',
    );
  });

  it("sichert Salden, Status, Bewegungstypen und Allokationen mit CHECKs", () => {
    for (const constraint of [
      "ValueVoucher_initialBalance_positive_check",
      "ValueVoucher_currentBalance_range_check",
      "ValueVoucher_status_balance_check",
      "ValueVoucherMovement_balance_chain_check",
      "ValueVoucherMovement_tender_check",
      "ValueVoucherMovement_type_fields_check",
      "ValueVoucherAllocation_amount_positive_check",
    ]) {
      expect(migration).toContain(`CONSTRAINT "${constraint}"`);
    }
    expect(migration).toContain(
      '"balanceAfter" = "balanceBefore" + "balanceDelta"',
    );
    expect(migration).toContain("\"fundingMethod\" IN ('CASH', 'CARD')");
    expect(migration).toContain("\"type\" = 'REDEEM_REVERSAL'");
  });

  it("erweitert Druckaufträge dedupliziert um Ausgabe- und Restwertbelege", () => {
    expect(migration).toContain("VALUE_VOUCHER_ISSUE");
    expect(migration).toContain("VALUE_VOUCHER_BALANCE");
    expect(migration).toContain('CREATE UNIQUE INDEX "PrintJob_sourceKey_key"');
    expect(schema).toContain("sourceKey");
  });
});
