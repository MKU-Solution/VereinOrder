import { DocumentBlock, PrintDocument } from "./document";
import {
  extraLabel,
  firstText,
  formatCurrency,
  formatDateTime,
  toQuantity,
} from "./format";

export type PrintJobType =
  | "STATION_TICKET"
  | "PRODUCT_VOUCHER"
  | "RECEIPT"
  | "CASHIER_CLOSING";

export interface PrintJobLike {
  id: string;
  jobType: PrintJobType | string;
  content: Record<string, any>;
  createdAt?: string;
}

const RKSV_HINT = "VereinOrder ist keine RKSV-Registrierkasse.";

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Bar",
  CARD: "Karte",
  VOUCHER: "Gutschein",
};

function paymentLabel(method: unknown): string {
  const key = String(method ?? "").toUpperCase();
  return PAYMENT_LABELS[key] ?? firstText(method, "Zahlung");
}

function heading(text: string): DocumentBlock[] {
  return [
    { kind: "text", text, align: "center", bold: true, doubleHeight: true },
  ];
}

function labelled(label: string, value: string): DocumentBlock {
  return { kind: "columns", left: label, right: value };
}

/**
 * Issue #98: Kopiekennzeichnung für nachgedruckte Belege und Produktbons.
 * Gilt genau dann, wenn der Druckauftrag `content.isCopy === true` trägt
 * (nur reprintOrder in orders.service.ts setzt das); reguläre Verkäufe
 * lassen das Feld weg, und diese Funktion liefert dann keine Zeilen. Direkt
 * nach der Überschrift platziert, nicht erst im Fußtext, damit die
 * Kopiekennzeichnung nicht übersehen wird - bei Abholware entscheidet sie
 * darüber, ob ein zweites Mal Ware ausgegeben wird.
 */
function copyNotice(content: Record<string, any>): DocumentBlock[] {
  if (!content.isCopy) return [];
  return [
    {
      kind: "text",
      text: "*** KOPIE ***",
      align: "center",
      bold: true,
      doubleHeight: true,
    },
    {
      kind: "text",
      text: `Nachdruck: ${formatDateTime(content.reprintedAt)}`,
      align: "center",
      bold: true,
    },
  ];
}

function itemLines(
  item: Record<string, any>,
  withPrice: boolean,
): DocumentBlock[] {
  const quantity = toQuantity(item.quantity);
  const name = firstText(item.productName, item.name, "Position");
  const blocks: DocumentBlock[] = [];

  if (withPrice) {
    const total = Number.isFinite(Number(item.totalPrice))
      ? Number(item.totalPrice)
      : Number(item.price ?? 0) * quantity;
    blocks.push({
      kind: "columns",
      left: `${quantity}x ${name}`,
      right: formatCurrency(total),
      fill: ".",
    });
  } else {
    blocks.push({ kind: "text", text: `${quantity}x ${name}`, bold: true });
  }

  const variant = firstText(item.variantName, item.variant);
  if (variant) {
    blocks.push({ kind: "text", text: `> ${variant}`, indent: 3 });
  }

  for (const extra of item.extras ?? []) {
    const label = extraLabel(extra);
    if (label) blocks.push({ kind: "text", text: `+ ${label}`, indent: 3 });
  }

  return blocks;
}

function footer(content: Record<string, any>): DocumentBlock[] {
  return [
    { kind: "rule" },
    {
      kind: "text",
      text: firstText(content.rksvDisclaimer, RKSV_HINT),
      align: "center",
    },
  ];
}

function stationTicket(job: PrintJobLike): PrintDocument {
  const content = job.content ?? {};
  const blocks: DocumentBlock[] = [
    ...heading(firstText(content.title, "ABHOL-/KÜCHENBON")),
    {
      kind: "text",
      text: firstText(content.stationName, "Zentrale Ausgabe"),
      align: "center",
      bold: true,
    },
  ];

  if (content.isPriority) {
    blocks.push({
      kind: "text",
      text: "*** PRIORITÄT - EILT ***",
      align: "center",
      bold: true,
    });
  }

  blocks.push(
    { kind: "rule" },
    labelled(
      "Bestellung",
      `#${firstText(content.orderNumber, content.orderId, "-")}`,
    ),
    labelled("Tisch/Bereich", firstText(content.tableName, "Theke")),
    labelled("Bedienung", firstText(content.waiterName, "Kellner")),
    labelled(
      "Zeitpunkt",
      formatDateTime(firstText(content.createdAt, job.createdAt)),
    ),
    { kind: "rule" },
  );

  for (const item of content.items ?? []) {
    blocks.push(...itemLines(item, false));
  }

  blocks.push({ kind: "rule" });
  return { title: "Stationsbon", blocks };
}

function productVoucher(job: PrintJobLike): PrintDocument {
  const content = job.content ?? {};
  const blocks: DocumentBlock[] = [
    ...heading(firstText(content.title, "PRODUKTBON")),
    ...copyNotice(content),
    {
      kind: "text",
      text: firstText(content.eventName, "Vereinsfest"),
      align: "center",
    },
    { kind: "rule" },
    labelled("Bestellung", `#${firstText(content.orderNumber, "-")}`),
    labelled("Ausgabe", firstText(content.stationName, "Zentrale Ausgabe")),
    labelled(
      "Ausgestellt",
      formatDateTime(firstText(content.issuedAt, job.createdAt)),
    ),
    { kind: "rule" },
    {
      kind: "text",
      text: `${toQuantity(content.quantity)}x ${firstText(content.productName, "Produkt")}`,
      align: "center",
      bold: true,
      doubleHeight: true,
    },
  ];

  const variant = firstText(content.variantName);
  if (variant) {
    blocks.push({ kind: "text", text: variant, align: "center" });
  }

  blocks.push(
    { kind: "rule" },
    { kind: "text", text: "Bon-Code", align: "center" },
    {
      kind: "text",
      text: firstText(content.voucherCode, "NICHT VERFÜGBAR"),
      align: "center",
      bold: true,
      doubleHeight: true,
    },
    ...footer(content),
  );

  return { title: "Produktbon", blocks };
}

function receipt(job: PrintJobLike): PrintDocument {
  const content = job.content ?? {};
  const blocks: DocumentBlock[] = [
    ...heading(firstText(content.title, "KASSENBELEG")),
    ...copyNotice(content),
    {
      kind: "text",
      text: firstText(content.eventName, "Vereinsfest"),
      align: "center",
    },
    { kind: "rule" },
    labelled(
      "Bestellung",
      `#${firstText(content.orderNumber, content.orderId, "-")}`,
    ),
    labelled("Tisch/Bereich", firstText(content.tableName, "Theke")),
    labelled("Bedienung", firstText(content.waiterName, "Kellner")),
    labelled(
      "Datum",
      formatDateTime(firstText(content.createdAt, job.createdAt)),
    ),
    { kind: "rule" },
  ];

  for (const item of content.items ?? []) {
    blocks.push(...itemLines(item, true));
  }

  blocks.push(
    { kind: "rule" },
    {
      kind: "columns",
      left: "GESAMT",
      right: formatCurrency(content.totalAmount),
      bold: true,
    },
  );

  for (const payment of content.payments ?? []) {
    blocks.push(
      labelled(
        `Zahlung ${paymentLabel(payment.method)}`,
        formatCurrency(payment.amount),
      ),
    );
  }

  const tendered = Number(content.tenderedAmount ?? 0);
  if (tendered > 0) {
    blocks.push(labelled("Gegeben", formatCurrency(tendered)));
  }
  const change = Number(content.changeAmount ?? 0);
  if (change > 0) {
    blocks.push({
      kind: "columns",
      left: "Rückgeld",
      right: formatCurrency(change),
      bold: true,
    });
  }

  blocks.push(...footer(content), {
    kind: "text",
    text: "Vielen Dank für die Unterstützung!",
    align: "center",
  });

  return { title: "Kassenbeleg", blocks };
}

function cashierClosing(job: PrintJobLike): PrintDocument {
  const content = job.content ?? {};
  const blocks: DocumentBlock[] = [
    ...heading(firstText(content.title, "KASSENABSCHLUSS")),
    {
      kind: "text",
      text: firstText(content.eventName, "Vereinsfest"),
      align: "center",
    },
    { kind: "rule" },
    labelled("Kassier", firstText(content.cashierName, "-")),
    labelled("Kasse", firstText(content.sessionName, content.sessionId, "-")),
    labelled("Beginn", formatDateTime(content.openedAt)),
    labelled(
      "Ende",
      formatDateTime(firstText(content.closedAt, job.createdAt)),
    ),
    { kind: "rule" },
    labelled(
      "Bestellungen",
      String(Math.trunc(Number(content.orderCount) || 0)),
    ),
    labelled("Startgeld", formatCurrency(content.startingCash)),
  ];

  const totals = content.totals ?? {};
  for (const [method, amount] of Object.entries(totals)) {
    blocks.push(labelled(paymentLabel(method), formatCurrency(amount)));
  }

  blocks.push(
    { kind: "rule" },
    {
      kind: "columns",
      left: "UMSATZ",
      right: formatCurrency(content.totalAmount),
      bold: true,
    },
    labelled("Soll-Bestand", formatCurrency(content.expectedCash)),
    labelled("Ist-Bestand", formatCurrency(content.countedCash)),
    {
      kind: "columns",
      left: "Differenz",
      right: formatCurrency(content.difference),
      bold: true,
    },
  );

  const note = firstText(content.note);
  if (note) {
    blocks.push({ kind: "rule" }, { kind: "text", text: note });
  }

  blocks.push(
    ...footer(content),
    { kind: "rule", char: "=" },
    { kind: "text", text: "Unterschrift", align: "center" },
    { kind: "feed", lines: 2 },
  );

  return { title: "Kassenabschluss", blocks };
}

function testPrint(job: PrintJobLike): PrintDocument {
  const content = job.content ?? {};
  return {
    title: "Testdruck",
    blocks: [
      ...heading(firstText(content.title, "TEST-DRUCK")),
      { kind: "rule" },
      labelled("Drucker", firstText(content.printerName, "-")),
      labelled("Typ", firstText(content.printerType, "-")),
      labelled("Papier", `${firstText(content.paperWidth, "80")} mm`),
      labelled("Zeichensatz", firstText(content.codepage, "CP858")),
      labelled(
        "Zeitpunkt",
        formatDateTime(firstText(content.timestamp, job.createdAt)),
      ),
      { kind: "rule" },
      {
        kind: "text",
        text: firstText(
          content.message,
          "Druckerschnittstelle erfolgreich verbunden!",
        ),
        align: "center",
      },
      { kind: "rule" },
      // Umlautprobe: zeigt sofort, ob Codepage und Papierbreite passen.
      {
        kind: "text",
        text: "Umlautprobe: ÄÖÜ äöü ß 1,50 €",
        align: "center",
      },
      { kind: "columns", left: "Musterposition", right: "12,34 €", fill: "." },
      ...footer(content),
    ],
  };
}

function fallback(job: PrintJobLike): PrintDocument {
  const content = job.content ?? {};
  const blocks: DocumentBlock[] = [
    ...heading("DRUCKAUFTRAG"),
    { kind: "rule" },
    labelled("Typ", String(job.jobType ?? "UNBEKANNT")),
    labelled("Auftrag", String(job.id ?? "-")),
    { kind: "rule" },
  ];

  for (const [key, value] of Object.entries(content)) {
    if (value === null || typeof value === "object") continue;
    blocks.push(labelled(key, String(value)));
  }

  blocks.push({ kind: "rule" });
  return { title: "Unbekannter Auftrag", blocks };
}

/**
 * Baut aus einem Druckauftrag das geräteunabhängige Dokument. Simulator und
 * Netzwerkdrucker verwenden anschließend dasselbe Ergebnis.
 */
export function buildDocument(job: PrintJobLike): PrintDocument {
  const content = job.content ?? {};
  if (String(content.kind ?? "") === "TEST_PRINT") return testPrint(job);

  switch (job.jobType) {
    case "STATION_TICKET":
      return stationTicket(job);
    case "PRODUCT_VOUCHER":
      return productVoucher(job);
    case "RECEIPT":
      return receipt(job);
    case "CASHIER_CLOSING":
      return cashierClosing(job);
    default:
      return fallback(job);
  }
}
