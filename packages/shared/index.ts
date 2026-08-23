// Issue #89: benannte Texte fuer die fachlichen Ablehnungen der
// Bestellannahme, die tatsaechlich beim Bedienpersonal ankommen (siehe
// apps/backend/src/orders/orders.service.ts fuer die vollstaendige
// Einordnung Gruppe 1 vs. Gruppe 2).
//
// Liegt in packages/shared statt im Backend, weil Backend und Frontend sich
// hier ueber einen gemeinsamen Vertrag einigen muessen:
// apps/frontend/src/lib/offlineQueueClassify.test.ts importiert diese
// Konstanten direkt, um zu pruefen, dass die Regex-Muster in
// offlineQueueClassify.ts noch zu den tatsaechlichen Backend-Texten passen.
// Aendert sich ein Text hier, ohne dass das zugehoerige Muster dort
// nachgezogen wird, schlaegt dieser Test fehl statt die Ursachenzeile der
// Konfliktansicht stillschweigend auf den UNKNOWN_4XX-Standardtext ("Der
// Server hat die Bestellung abgelehnt.") zurueckfallen zu lassen. Genau das
// ist beim ersten Anlauf von Issue #89 passiert (Texte wurden deutsch, die
// Muster blieben englisch) und wurde erst bei einer manuellen Abnahme der
// Konfliktansicht bemerkt.
//
// Ein direkter Import von apps/frontend nach apps/backend (oder umgekehrt)
// waere die falsche Loesung gewesen: das Frontend-Docker-Abbild kopiert nur
// apps/frontend, apps/backend liegt dort gar nicht vor, und der Build waere
// in der CI gescheitert, ohne dass das lokal auffaellt. Dieses Paket ist
// deshalb bewusst ohne Laufzeitabhaengigkeiten gehalten (kein NestJS, kein
// Prisma, kein React) - siehe Dockerfiles beider Anwendungen, die es analog
// zu packages/database kopieren und bauen.
//
// Das ist ein Notbehelf gegen Text-Drift zwischen den beiden Anwendungen,
// keine stabile, textunabhaengige Fehlerkennung. Letzteres ist Entscheidung
// 11.4 aus docs/development/offline-warteschlange.md und bleibt einem
// eigenen Vorgang vorbehalten - siehe Issue #89, Abschnitt "Nicht-Ziele".
export const ORDER_REJECTION_MESSAGES = {
  EVENT_NOT_ACTIVE_FOR_ORDERS:
    "Diese Veranstaltung ist derzeit nicht aktiv. Bestellungen sind erst möglich, wenn sie gestartet wurde.",
  EVENT_NOT_ACTIVE_FOR_SALES:
    "Diese Veranstaltung ist derzeit nicht aktiv. Verkäufe sind erst möglich, wenn sie gestartet wurde.",
  PRODUCT_OUT_OF_STOCK: (productName: string) =>
    `Produkt „${productName}" ist derzeit nicht verfügbar. Bitte aus der Bestellung entfernen.`,
  PRODUCT_NOT_IN_EVENT: (productId: string) =>
    `Ein Produkt (${productId}) ist für diese Veranstaltung nicht hinterlegt. Bitte die Auswahl aktualisieren und erneut versuchen.`,
  PRODUCT_NOT_IN_EVENT_QUICK_SALE:
    "Ein Produkt gehört nicht zu dieser Veranstaltung. Bitte die Auswahl aktualisieren und erneut versuchen.",
  // Issue #66, Stationskasse: eigene Meldung fuer ein Produkt, das zwar zur
  // Veranstaltung gehoert, aber zu einer anderen Station als der gewaehlten
  // (orders.service.ts, createQuickSale). Ohne diese Unterscheidung landet
  // dieser Fall in PRODUCT_NOT_IN_EVENT_QUICK_SALE und schickt die Bedienung
  // an der Kasse in die falsche Richtung: sie prueft die Veranstaltung,
  // obwohl die stimmt, statt die Station zu wechseln. Bewusst ohne
  // Stationsnamen oder -kennung - der Text geht an ein Bediengeraet, nicht
  // in ein Protokoll.
  PRODUCT_NOT_AT_STATION_QUICK_SALE:
    "Dieses Produkt gehört zum Sortiment einer anderen Station. Bitte die Station wechseln oder das Produkt dort verkaufen.",
  AREA_NOT_IN_EVENT:
    "Der gewählte Bereich gehört nicht zu dieser Veranstaltung. Bitte einen anderen Bereich wählen.",
  ORDER_EMPTY:
    "Es wurde keine Position ausgewählt. Bitte mindestens ein Produkt zur Bestellung hinzufügen.",
  USER_NOT_ACTIVE:
    "Dieses Benutzerkonto ist nicht aktiv. Bitte bei der Administration melden.",
  IDEMPOTENCY_KEY_CONFLICT:
    "Für dieses Vorgangskennzeichen liegt bereits eine abweichende Bestellung vor. Bitte neu erfassen und erneut senden.",
  // Issue #66, Stationskasse: Reissleine gegen einen entlaufenen
  // Abholnummernzaehler. Der Verkauf wird abgewiesen, statt die Nummer
  // umbrechen zu lassen - ein Umbruch gaebe zwei Personen dieselbe Nummer.
  // Steht hier und nicht im Backend, weil es eine fachliche Ablehnung des
  // Verkaufs ist, die beim Bedienpersonal ankommt, wie
  // EVENT_NOT_ACTIVE_FOR_SALES und PRODUCT_NOT_IN_EVENT_QUICK_SALE. Wie
  // diese beiden hat der Text bewusst KEIN Muster in
  // apps/frontend/src/lib/offlineQueueClassify.ts: die Bonkassen senden nicht
  // ueber die Offline-Warteschlange, der Text erreicht sie also nie.
  PICKUP_NUMBER_EXHAUSTED:
    "Der Abholnummernbereich dieser Veranstaltung ist erschöpft. Bitte bei der Administration melden; der Verkauf wurde nicht gebucht.",
} as const;
