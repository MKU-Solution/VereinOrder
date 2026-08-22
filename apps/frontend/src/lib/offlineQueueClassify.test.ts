import { describe, expect, it } from "vitest";
import {
  classifyConflictKind,
  classifySubmissionOutcome,
  computeNextAttemptDelayMs,
  sanitizeOperatorMessage,
} from "./offlineQueueClassify";
// Issue #89: die Backend-Texte fuer fachliche Ablehnungen der
// Bestellannahme sind deutsch. Statt sie hier erneut abzutippen (was genau
// die Falle war, die die Ursachenzeile beim ersten Anlauf von #89 lautlos
// hat wegdriften lassen), wird die tatsaechliche Quelle aus dem gemeinsam
// genutzten Paket importiert - siehe packages/shared/index.ts fuer die
// Begruendung dieser Kopplung und ihre Grenzen.
import { ORDER_REJECTION_MESSAGES } from "@vereinorder/shared";

const RECORD = { idempotencyKey: "key-1", eventId: "event-1" };

describe("Einordnung der Serverantworten (Abschnitt 3)", () => {
  it("bestätigt bei 2xx mit passendem idempotencyKey", () => {
    const outcome = classifySubmissionOutcome(RECORD, {
      success: true,
      data: {
        id: "order-1",
        orderNumber: "R-42",
        idempotencyKey: "key-1",
        eventId: "event-1",
      },
    });
    expect(outcome).toEqual({
      nextState: "CONFIRMED",
      serverOrderId: "order-1",
      serverOrderNumber: "R-42",
    });
  });

  it("erkennt eine fremde Bestellung hinter demselben Schlüssel als Konflikt (Antwort auf B6)", () => {
    const outcome = classifySubmissionOutcome(RECORD, {
      success: true,
      data: {
        id: "order-2",
        idempotencyKey: "key-1",
        eventId: "ein-anderes-event",
      },
    });
    expect(outcome.nextState).toBe("CONFLICT");
    if (outcome.nextState === "CONFLICT") {
      expect(outcome.conflictKind).toBe("DUPLICATE_KEY_MISMATCH");
    }
  });

  it("wiederholt ein fachliches 4xx nie automatisch", () => {
    const outcome = classifySubmissionOutcome(RECORD, {
      success: false,
      error: {
        response: {
          status: 400,
          data: {
            message: ORDER_REJECTION_MESSAGES.PRODUCT_OUT_OF_STOCK("xyz"),
          },
        },
      },
    });
    expect(outcome.nextState).toBe("CONFLICT");
    if (outcome.nextState === "CONFLICT") {
      expect(outcome.conflictKind).toBe("PRODUCT_UNAVAILABLE");
    }
  });

  it("ordnet 401 unabhängig vom Meldungstext als AUTH_EXPIRED ein", () => {
    const outcome = classifySubmissionOutcome(RECORD, {
      success: false,
      error: { response: { status: 401, data: { message: "Unauthorized" } } },
    });
    expect(outcome.nextState).toBe("CONFLICT");
    if (outcome.nextState === "CONFLICT") {
      expect(outcome.conflictKind).toBe("AUTH_EXPIRED");
    }
  });

  it("markiert 409 wegen abweichendem Betriebsmodus als EVENT_MODE, nicht als SESSION_CLOSED", () => {
    const kind = classifyConflictKind(
      409,
      "Die aktive Kassensitzung gehört zu einem anderen Betriebsmodus.",
    );
    expect(kind).toBe("EVENT_MODE");
  });

  it("fällt ohne erkanntes Muster auf UNKNOWN_4XX zurück", () => {
    expect(classifyConflictKind(422, "Irgendetwas ganz Neues")).toBe(
      "UNKNOWN_4XX",
    );
  });

  it.each([408, 425, 429, 500, 502, 503])(
    "wiederholt Status %i automatisch",
    (status) => {
      const outcome = classifySubmissionOutcome(RECORD, {
        success: false,
        error: { response: { status, data: {} } },
      });
      expect(outcome.nextState).toBe("RETRY");
    },
  );

  it("wiederholt einen Netzwerkfehler ohne Antwort automatisch", () => {
    const outcome = classifySubmissionOutcome(RECORD, {
      success: false,
      error: { code: "ERR_NETWORK", message: "Network Error" },
    });
    expect(outcome.nextState).toBe("RETRY");
    if (outcome.nextState === "RETRY") {
      expect(outcome.error.kind).toBe("NETWORK");
      expect(outcome.error.httpStatus).toBeNull();
    }
  });

  it("liest Retry-After aus einer 429-Antwort für die Wartezeit", () => {
    const outcome = classifySubmissionOutcome(RECORD, {
      success: false,
      error: {
        response: { status: 429, headers: { "retry-after": "30" }, data: {} },
      },
    });
    expect(outcome.nextState).toBe("RETRY");
    if (outcome.nextState === "RETRY") {
      expect(outcome.retryAfterMs).toBe(30_000);
    }
  });
});

// Issue #89: die Zuordnung Backend-Text -> Ursache in classifyConflictKind
// laeuft ausschliesslich ueber Text-Matching und hat keinen Compiler, der bei
// einer Textaenderung im Backend automatisch mitzoege. Genau das ist beim
// ersten Anlauf von Issue #89 passiert: die Meldungen wurden von Englisch
// auf Deutsch umgestellt, die Muster oben blieben aber auf den alten
// englischen Texten stehen - sechs Ursachen fielen dadurch lautlos auf den
// generischen UNKNOWN_4XX-Text zurueck ("Der Server hat die Bestellung
// abgelehnt.") statt ihre eigene Ursachenzeile zu zeigen. Bemerkt wurde das
// nur durch eine manuelle Abnahme der Konfliktansicht, nicht durch einen
// roten Test.
//
// Dieser Block importiert die tatsaechlichen Backend-Texte (siehe Import
// oben) und prueft jede Zuordnung gegenueber der echten Quelle, statt einer
// hier erneut abgetippten Kopie. Faellt eine dieser Pruefungen auf
// UNKNOWN_4XX statt der erwarteten Ursache, ist entweder ein Muster oben
// veraltet oder ein Backend-Text hat sich geaendert, ohne dass das Muster
// nachgezogen wurde.
describe("classifyConflictKind haelt mit den deutschen Backend-Texten Schritt (Issue #89)", () => {
  it.each([
    [
      "Veranstaltung nicht aktiv (Bestellannahme)",
      ORDER_REJECTION_MESSAGES.EVENT_NOT_ACTIVE_FOR_ORDERS,
      "EVENT_MODE",
    ],
    [
      "Produkt ausverkauft",
      ORDER_REJECTION_MESSAGES.PRODUCT_OUT_OF_STOCK(
        "Wienerschnitzel mit Pommes",
      ),
      "PRODUCT_UNAVAILABLE",
    ],
    [
      "Produkt gehört nicht zur Veranstaltung (Bestellannahme)",
      ORDER_REJECTION_MESSAGES.PRODUCT_NOT_IN_EVENT("product-123"),
      "PRODUCT_UNAVAILABLE",
    ],
    [
      "Bereich gehört nicht zur Veranstaltung",
      ORDER_REJECTION_MESSAGES.AREA_NOT_IN_EVENT,
      "VALIDATION",
    ],
    [
      "Bestellung ohne Position",
      ORDER_REJECTION_MESSAGES.ORDER_EMPTY,
      "VALIDATION",
    ],
    [
      "Benutzerkonto nicht aktiv",
      ORDER_REJECTION_MESSAGES.USER_NOT_ACTIVE,
      "FORBIDDEN",
    ],
  ] as const)("%s -> %s", (_label, backendMessage, expectedKind) => {
    expect(classifyConflictKind(400, backendMessage)).toBe(expectedKind);
  });
});

describe("Fehlertexte ohne Token und ohne Stacktrace (Akzeptanzkriterium des Issues)", () => {
  it("entfernt ein JWT-artiges Token aus dem Meldungstext", () => {
    const token =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.dGhpc2lzYXNpZ25hdHVyZXBhcnQ";
    const sanitized = sanitizeOperatorMessage(
      `Zugriff verweigert für Bearer ${token}`,
      401,
    );
    expect(sanitized).not.toContain(token);
    expect(sanitized).not.toMatch(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  });

  it("kürzt einen Stacktrace auf die erste Zeile", () => {
    const withStack =
      "Order must contain at least one item\n    at OrdersService.createOrder (orders.service.ts:766:11)\n    at process";
    const sanitized = sanitizeOperatorMessage(withStack, 400);
    expect(sanitized).toBe("Order must contain at least one item");
    expect(sanitized).not.toContain("orders.service.ts");
    expect(sanitized).not.toContain("OrdersService.createOrder");
  });

  it("kürzt auf höchstens 300 Zeichen", () => {
    // Leerzeichen dazwischen, damit keine der Bereinigungsregeln (die auf
    // durchgehende Token- oder JWT-artige Zeichenketten zielen) vorher
    // greift — diese Prüfung testet ausschließlich die Längenbegrenzung.
    const longMessage = "ab cd ".repeat(80);
    expect(longMessage.length).toBeGreaterThan(300);
    const sanitized = sanitizeOperatorMessage(longMessage, 400);
    expect(sanitized.length).toBeLessThanOrEqual(300);
  });

  it("liefert einen eigenen Text, wenn keine Servermeldung vorliegt", () => {
    expect(sanitizeOperatorMessage(null, null)).toBe(
      "Keine Verbindung zum Server.",
    );
    expect(sanitizeOperatorMessage(undefined, 401)).toBe(
      "Anmeldung ist abgelaufen.",
    );
  });
});

describe("Wartezeiten der Sendeschleife (Abschnitt 2)", () => {
  it("verdoppelt die Wartezeit je Versuch, gedeckelt bei 5 Minuten", () => {
    const noJitter = () => 0.5; // Streuungsfaktor 1.0
    expect(computeNextAttemptDelayMs(1, undefined, noJitter)).toBe(5_000);
    expect(computeNextAttemptDelayMs(2, undefined, noJitter)).toBe(10_000);
    expect(computeNextAttemptDelayMs(3, undefined, noJitter)).toBe(20_000);
    expect(computeNextAttemptDelayMs(10, undefined, noJitter)).toBe(
      5 * 60 * 1000,
    );
  });
});
