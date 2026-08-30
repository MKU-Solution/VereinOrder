import { BadRequestException } from "@nestjs/common";
import type { OperationalDataMode } from "@vereinorder/database";

// Einzige Ableitung der Betriebsart einer Veranstaltung aus ihrem Status
// (EventStatus) und ihrem Testflag (testMode) - Issue #152. Diese Formel war
// zehnmal im Backend nachgebaut: sechsmal an Schreibpfaden (u.a.
// orders.service.ts, sessions.service.ts, value-vouchers.service.ts,
// inventory.service.ts, reports.service.ts), dreimal an Lesepfaden
// (areas.service.ts, orders.service.ts getQuickSaleContext,
// products.service.ts) und einmal in totem Code (events.service.ts, dort
// entfernt statt umgestellt). Jede weitere eigenstaendige Kopie ist ab jetzt
// ein Fehler - alle Stellen im Backend, die die Betriebsart einer
// Veranstaltung brauchen, benutzen ausschliesslich diese Funktion.
//
// Fachliche Regel der Projektleitung: eine Veranstaltung ist
//  - "LIVE", wenn sie im Echtbetrieb laeuft (status ACTIVE, testMode false),
//  - "TEST", wenn sie im Testbetrieb laeuft (status TEST_MODE, testMode
//    true),
//  - sonst null - sie laeuft gerade nicht. Das ist der Normalfall fuer
//    DRAFT, PREPARED, PAUSED, COMPLETED und ARCHIVED, kein Defekt:
//    Verwaltungsansichten werden fuer solche Veranstaltungen regelmaessig
//    geoeffnet und muessen dafuer nicht werfen.
//
// Die Kombinationen ACTIVE+testMode=true und TEST_MODE+testMode=false
// koennen nach diesen Regeln nicht entstehen; sie sind eine unmoegliche
// Kombination (Datenkorruption, heute nur ueber das Einspielen einer alten
// JSON-Sicherung erreichbar - eigenes Issue) und werden deshalb NICHT als
// null zurueckgegeben, sondern geworfen. Fehlt die Veranstaltung ganz (null
// oder undefined), ist das kein unstimmiger Zustand, sondern schlicht kein
// Betriebsmodus: die Funktion liefert dafuer null, ohne zu werfen.
export interface EventForOperationalDataMode {
  status: string;
  testMode: boolean;
}

export function resolveOperationalDataMode(
  event: EventForOperationalDataMode | null | undefined,
): OperationalDataMode | null {
  if (!event) return null;
  if (event.status === "ACTIVE" && !event.testMode) return "LIVE";
  if (event.status === "TEST_MODE" && event.testMode) return "TEST";
  if (event.status === "ACTIVE" || event.status === "TEST_MODE") {
    throw new BadRequestException(
      "Die Veranstaltung ist nicht in einem konsistenten Betriebsmodus.",
    );
  }
  return null;
}
