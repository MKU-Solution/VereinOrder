import { buildDocument, PrintJobLike } from "./documents";
import { alignLine, renderDocument } from "./document";
import { formatCurrency, formatDateTime } from "./format";
import { PAPER_PROFILES, PaperWidth } from "./profiles";

const WIDTHS: PaperWidth[] = [58, 80];

const createdAt = new Date(2026, 7, 21, 18, 5, 9).toISOString();

const stationTicket: PrintJobLike = {
  id: "job-station",
  jobType: "STATION_TICKET",
  createdAt,
  content: {
    title: "ABHOL-/KÜCHENBON",
    stationName: "Küche",
    orderNumber: 42,
    tableName: "Tisch 7 – Zelt Süd",
    waiterName: "Käthe Österreicher",
    isPriority: true,
    createdAt,
    items: [
      {
        productName: "Schweinsbraten mit Semmelknödel und Krautsalat",
        quantity: 2,
        variantName: "groß",
        extras: [{ name: "extra Soße" }, "ohne Kraut"],
      },
      { productName: "Cola", quantity: 1 },
    ],
  },
};

const productVoucher: PrintJobLike = {
  id: "job-voucher",
  jobType: "PRODUCT_VOUCHER",
  createdAt,
  content: {
    eventName: "Frühlingsfest",
    orderNumber: 42,
    voucherCode: "VO-2026-000042",
    productName: "Grillhendl",
    variantName: "halb",
    quantity: 1,
    stationName: "Grillstation",
    issuedAt: createdAt,
  },
};

const receipt: PrintJobLike = {
  id: "job-receipt",
  jobType: "RECEIPT",
  createdAt,
  content: {
    eventName: "Frühlingsfest",
    orderNumber: 42,
    tableName: "Tisch 7",
    waiterName: "Käthe",
    createdAt,
    items: [
      {
        productName: "Schweinsbraten mit Semmelknödel und Krautsalat",
        quantity: 2,
        price: 1450,
        totalPrice: 2900,
        variantName: "groß",
        extras: [{ name: "extra Soße" }],
      },
      { productName: "Cola", quantity: 1, price: 350, totalPrice: 350 },
    ],
    totalAmount: 3250,
    payments: [{ method: "CASH", amount: 3250 }],
    tenderedAmount: 5000,
    changeAmount: 1750,
  },
};

const cashierClosing: PrintJobLike = {
  id: "job-closing",
  jobType: "CASHIER_CLOSING",
  createdAt,
  content: {
    eventName: "Frühlingsfest",
    cashierName: "Käthe Österreicher",
    sessionName: "Kasse Zelt Süd",
    openedAt: createdAt,
    closedAt: createdAt,
    orderCount: 128,
    startingCash: 20000,
    totals: { CASH: 184050, CARD: 62500, VOUCHER: 4500 },
    totalAmount: 251050,
    expectedCash: 204050,
    countedCash: 203550,
    difference: -500,
    note: "Differenz durch Wechselgeldfehler am Abend.",
  },
};

const testPrint: PrintJobLike = {
  id: "job-test",
  jobType: "RECEIPT",
  createdAt,
  content: {
    kind: "TEST_PRINT",
    printerName: "Küchendrucker",
    printerType: "ESC_POS_NETWORK",
    paperWidth: 80,
    codepage: "CP858",
    timestamp: createdAt,
  },
};

const ALL_JOBS = [
  stationTicket,
  productVoucher,
  receipt,
  cashierClosing,
  testPrint,
];

function textOf(job: PrintJobLike, width: PaperWidth): string {
  const profile = PAPER_PROFILES[width];
  return renderDocument(buildDocument(job), profile)
    .map((line) => alignLine(line, profile.columns))
    .join("\n");
}

describe("Bonaufbau je Auftragsart", () => {
  it.each(WIDTHS)("hält auf %s mm die Papierbreite ein", (width) => {
    const profile = PAPER_PROFILES[width];

    for (const job of ALL_JOBS) {
      for (const line of renderDocument(buildDocument(job), profile)) {
        const printed = alignLine(line, profile.columns);
        const allowed = line.doubleWidth
          ? Math.floor(profile.columns / 2)
          : profile.columns;
        expect(printed.length).toBeLessThanOrEqual(allowed);
      }
    }
  });

  it.each(WIDTHS)("druckt den Stationsbon auf %s mm lesbar", (width) => {
    const text = textOf(stationTicket, width);

    expect(text).toContain("Küche");
    expect(text).toContain("PRIORITÄT");
    expect(text).toContain("#42");
    expect(text).toContain("Käthe Österreicher");
    expect(text).toContain("2x Schweinsbraten");
    expect(text).toContain("   > groß");
    expect(text).toContain("   + extra Soße");
    expect(text).toContain("   + ohne Kraut");
    expect(text).toContain(formatDateTime(createdAt));
    // Der Stationsbon zeigt bewusst keine Preise.
    expect(text).not.toContain("€");
  });

  it.each(WIDTHS)("druckt den Produktbon auf %s mm mit Code", (width) => {
    const text = textOf(productVoucher, width);

    expect(text).toContain("PRODUKTBON");
    expect(text).toContain("VO-2026-000042");
    expect(text).toContain("1x Grillhendl");
    expect(text).toContain("Grillstation");
    // Der Hinweis darf umbrechen; entscheidend ist, dass er vollständig steht.
    expect(text.replace(/\s+/g, " ")).toContain(
      "VereinOrder ist keine RKSV-Registrierkasse.",
    );
  });

  it.each(WIDTHS)("druckt den Kassenbeleg auf %s mm mit Summen", (width) => {
    const text = textOf(receipt, width);

    expect(text).toContain("KASSENBELEG");
    expect(text).toContain(formatCurrency(2900));
    expect(text).toContain("Zahlung Bar");
    expect(text).toMatch(/GESAMT\.*\s*32,50 €/);
    expect(text).toContain("Gegeben");
    expect(text).toContain("Rückgeld");
    expect(text).toContain(formatCurrency(1750));
  });

  it.each(WIDTHS)("druckt den Kassenabschluss auf %s mm", (width) => {
    const text = textOf(cashierClosing, width);

    expect(text).toContain("KASSENABSCHLUSS");
    expect(text).toContain("Kasse Zelt Süd");
    expect(text).toContain("128");
    expect(text).toContain(formatCurrency(184050));
    expect(text).toContain(formatCurrency(-500));
    expect(text).toContain("Unterschrift");
  });

  it.each(WIDTHS)("druckt den Testbon auf %s mm mit Umlautprobe", (width) => {
    const text = textOf(testPrint, width);

    expect(text).toContain("TEST-DRUCK");
    expect(text).toContain("Küchendrucker");
    expect(text).toContain("ÄÖÜ äöü ß");
  });

  it("bricht lange Produktnamen um, statt sie abzuschneiden", () => {
    const lines = renderDocument(
      buildDocument(stationTicket),
      PAPER_PROFILES[58],
    ).map((line) => line.text);

    const joined = lines.join(" ");
    expect(joined).toContain("Semmelknödel");
    expect(joined).toContain("Krautsalat");
  });

  it("trennt Wörter hart, die breiter als das Papier sind", () => {
    const text = textOf(
      {
        id: "job-long",
        jobType: "STATION_TICKET",
        content: {
          stationName: "Küche",
          items: [{ productName: "A".repeat(70), quantity: 1 }],
        },
      },
      58,
    );

    for (const line of text.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(PAPER_PROFILES[58].columns);
    }
    expect(text).toContain("A".repeat(30));
  });

  it("zeigt unbekannte Auftragsarten statt sie zu verwerfen", () => {
    const text = textOf(
      {
        id: "job-unknown",
        jobType: "SOMETHING_NEW",
        content: { hinweis: "Bitte prüfen", zahl: 5 },
      },
      80,
    );

    expect(text).toContain("DRUCKAUFTRAG");
    expect(text).toContain("SOMETHING_NEW");
    expect(text).toContain("Bitte prüfen");
  });
});

describe("Beträge und Zeitpunkte", () => {
  it("rechnet ganzzahlige Cent korrekt in Euro um", () => {
    expect(formatCurrency(0)).toBe("0,00 €");
    expect(formatCurrency(5)).toBe("0,05 €");
    expect(formatCurrency(250)).toBe("2,50 €");
    expect(formatCurrency(100000)).toBe("1.000,00 €");
    expect(formatCurrency(251050)).toBe("2.510,50 €");
    expect(formatCurrency(-500)).toBe("-5,00 €");
  });

  it("formatiert Zeitpunkte in österreichischer Schreibweise", () => {
    expect(formatDateTime(new Date(2026, 7, 21, 8, 5, 9))).toBe(
      "21.08.2026 08:05:09",
    );
    expect(formatDateTime("keine Zeit")).toBe("-");
    expect(formatDateTime(undefined)).toBe("-");
  });
});
