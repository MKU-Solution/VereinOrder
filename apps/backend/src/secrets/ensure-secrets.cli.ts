import { ensureBackendSecrets } from "./ensure-secrets";

/**
 * Aufrufbares Programm für `apps/backend/docker-entrypoint.sh` (#175).
 *
 * Legt fehlende Geheimnisse unter `STATE_DIR` an, bevor der Entrypoint die
 * Anwendung startet. Es gibt die Werte NICHT auf stdout aus: der Entrypoint
 * liest sie anschliessend selbst aus den Dateien, damit kein Geheimnis
 * durch eine Prozessausgabe wandert, die jemand mitschneiden könnte. Auf
 * stderr erscheint höchstens die Meldung, DASS erzeugt wurde.
 *
 * Ein eigener Prozessschritt statt eines Aufrufs in der Anwendung ist hier
 * Absicht: `JWT_SECRET` wird zur Modul-Ladezeit gelesen (siehe Kopf von
 * `ensure-secrets.ts`), und ein separater Prozess kann durch keine
 * Umsortierung von Importen zu spät kommen.
 */
ensureBackendSecrets();
