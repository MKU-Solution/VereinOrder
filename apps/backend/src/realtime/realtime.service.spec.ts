import {
  RealtimeService,
  REALTIME_HEARTBEAT_INTERVAL_MS,
  REALTIME_HEARTBEAT_TYPE,
} from "./realtime.service";

/**
 * #186: apps/frontend/nginx.conf setzt in der Location /realtime/ ein
 * Zeitlimit (proxy_read_timeout/proxy_send_timeout), das ohne eigenen
 * Herzschlag jede Ruhephase im Ereignisstrom nach der dort eingetragenen
 * Zeit stumm beendet — unabhängig von broadcast(). Diese Suite belegt, dass
 * der Strom auch OHNE broadcast()-Aufruf regelmäßig sendet, und dass dieser
 * Herzschlag echte Nachrichten nicht verdrängt.
 */
describe("RealtimeService – Herzschlag (#186)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("sendet in einer Ruhephase ohne jeden broadcast()-Aufruf regelmäßig einen Herzschlag", () => {
    jest.useFakeTimers();
    const service = new RealtimeService();
    const received: any[] = [];
    const subscription = service
      .getStream()
      .subscribe((msg) => received.push(msg));

    // Ruhephase: Zeit vergeht, aber niemand ruft broadcast() auf.
    expect(received).toHaveLength(0);

    jest.advanceTimersByTime(REALTIME_HEARTBEAT_INTERVAL_MS);
    expect(received).toHaveLength(1);
    expect(received[0].data.type).toBe(REALTIME_HEARTBEAT_TYPE);
    expect(received[0].data.data).toBeNull();
    expect(typeof received[0].data.timestamp).toBe("string");

    jest.advanceTimersByTime(REALTIME_HEARTBEAT_INTERVAL_MS * 2);
    expect(received).toHaveLength(3);

    subscription.unsubscribe();
  });

  it("liefert broadcast()-Nachrichten unverändert neben dem Herzschlag weiter", () => {
    jest.useFakeTimers();
    const service = new RealtimeService();
    const received: any[] = [];
    const subscription = service
      .getStream()
      .subscribe((msg) => received.push(msg));

    service.broadcast(undefined, "PRODUCT_INVENTORY_CHANGED", {
      productId: "p1",
    });

    expect(received).toHaveLength(1);
    expect(received[0].data.type).toBe("PRODUCT_INVENTORY_CHANGED");
    expect(received[0].data.data).toEqual({ productId: "p1" });

    subscription.unsubscribe();
  });

  it("hält den Herzschlag nicht durch den eventId-Filter zurück, da er keine eventId trägt", () => {
    jest.useFakeTimers();
    const service = new RealtimeService();
    const received: any[] = [];
    const subscription = service
      .getStream("event-1")
      .subscribe((msg) => received.push(msg));

    jest.advanceTimersByTime(REALTIME_HEARTBEAT_INTERVAL_MS);
    expect(received).toHaveLength(1);
    expect(received[0].data.type).toBe(REALTIME_HEARTBEAT_TYPE);

    subscription.unsubscribe();
  });

  it("beendet den Herzschlag-Zeitgeber, sobald niemand mehr den Strom abonniert hat", () => {
    jest.useFakeTimers();
    const service = new RealtimeService();
    const received: any[] = [];
    const subscription = service
      .getStream()
      .subscribe((msg) => received.push(msg));

    subscription.unsubscribe();
    jest.advanceTimersByTime(REALTIME_HEARTBEAT_INTERVAL_MS * 5);

    expect(received).toHaveLength(0);
  });
});
