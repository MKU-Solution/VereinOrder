import * as crypto from "crypto";

/**
 * Läuft VOR dem Laden der Testdatei (`setupFiles`, nicht `setupFilesAfterEnv`)
 * — und das ist hier zwingend (#175).
 *
 * Die Integrationstests importieren `AuthModule` und `MaintenanceModule`
 * statisch. Beide lesen `JWT_SECRET` in ihren Decorator-Argumenten, also zur
 * MODUL-Ladezeit; seit #175 gibt es dort keinen Rückfall auf einen festen
 * Wert mehr, sondern einen Startfehler. Ein `beforeAll` käme zu spät, weil
 * die Importe der Testdatei vorher ausgewertet werden.
 *
 * Im Festbetrieb erledigt das `apps/backend/docker-entrypoint.sh`, ausserhalb
 * von Docker `ensureBackendSecrets()` in `main.ts`. Für Tests genügt ein
 * flüchtiger Wert je Lauf; er wird bewusst NICHT auf die Platte geschrieben,
 * damit kein Testlauf ein Zustandsverzeichnis hinterlässt.
 */
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
}
if (!process.env.PRINT_WORKER_TOKEN) {
  process.env.PRINT_WORKER_TOKEN = crypto.randomBytes(32).toString("hex");
}
