/**
 * Wird geworfen, wenn eine Operation gegen `leaseId` mit `409 Conflict`
 * abgewiesen wird: die Reservierung des Auftrags gehört diesem Worker nicht
 * mehr (abgelaufen oder von einem neuen Claim überschrieben). Der Auftrag
 * wird in diesem Fall still abgebrochen — kein weiterer Druckversuch, keine
 * Ergebnismeldung, nur das Ereignis `lease.lost`.
 */
export class LeaseLostError extends Error {
  constructor(message = "Die Reservierung wird nicht mehr gehalten.") {
    super(message);
    this.name = "LeaseLostError";
  }
}
