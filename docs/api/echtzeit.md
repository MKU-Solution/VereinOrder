# Echtzeit-Ereigniskatalog (Server-Sent Events)

VereinOrder verwendet standardmäßig **Server-Sent Events (SSE)** über HTTP, um Echtzeitaktualisierungen effizient und firewall-freundlich an alle verbundenen Web-Clients (Smartphones, Tablets, Küchenmonitore) zu übertragen.

---

## 1. Verbindungsendpunkt

- **URL:** `GET /realtime/stream?eventId=<EVENT_ID>`
- **Protokoll:** HTTP Server-Sent Events (`text/event-stream`)
- **Keepalive:** Alle 15 Sekunden wird ein Kommentar (`: keepalive`) gesendet, um Verbindungstimeouts bei Routern und Proxies zu verhindern.
- **Wiederverbindung:** Der Browser-Client baut die Verbindung bei Unterbrechung automatisch mit exponentiellem Backoff wieder auf.

---

## 2. Ereignistypen (Event Types)

| Event                          | Auslöser                                                           | Payload                                                         | Zielgruppe                             |
| ------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------- |
| `ORDER_CREATED`                | Neue Bestellung erfolgreich aufgegeben                             | `{ orderId, orderNumber, tableName, totalCents, items: [...] }` | Küchenmonitore, Kassen, Runner         |
| `ORDER_STATUS_CHANGED`         | Statuswechsel (z. B. `READY`, `DELIVERED`, `CANCELLED`)            | `{ orderId, status, stationId, timestamp }`                     | Kellner, Runner, Küchenmonitore        |
| `PRODUCT_AVAILABILITY_CHANGED` | Produktverfügbarkeit geändert (`AVAILABLE`, `LOW`, `OUT_OF_STOCK`) | `{ productId, availability, eventId }`                          | Alle Kellner, Kassen & Stationen       |
| `PRINT_JOB_UPDATED`            | Statusänderung eines Druckauftrags                                 | `{ jobId, status, printerId, error }`                           | Admin-Diagnose, Kassen                 |
| `MAINTENANCE_MODE_CHANGED`     | Wartungsmodus aktiviert/deaktiviert                                | `{ active: boolean, reason: string }`                           | Alle Clients (erzwingt Wartungssperre) |

---

## 3. Client-Integration (React-Hook Beispiel)

```typescript
const eventSource = new EventSource(`/realtime/stream?eventId=${eventId}`);

eventSource.addEventListener("PRODUCT_AVAILABILITY_CHANGED", (event) => {
  const data = JSON.parse(event.data);
  updateProductAvailability(data.productId, data.availability);
});

eventSource.onerror = () => {
  // Automatischer Reconnect durch Browser EventSource
};
```
