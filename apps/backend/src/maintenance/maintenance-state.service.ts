import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { MaintenanceState, OPEN_MAINTENANCE_STATE } from "./maintenance.types";

/**
 * Der Wartungszustand ist eine Datei außerhalb der Datenbank, kein
 * Datenbankfeld (Entwurf Abschnitt 6, tragendes Argument):
 *
 * Eine Wiederherstellung ERSETZT die Datenbank. Ein Feld darin würde von der
 * Wiederherstellung selbst auf den Wert überschrieben, den die Sicherung
 * zufällig trug — der Wartungsmodus fiele mitten im gefährlichsten
 * Augenblick weg, und zwar auf einen Wert, den niemand gesetzt hat.
 *
 * Auch keine Umgebungsvariable: er muss zur Laufzeit umschaltbar sein, ohne
 * Neustart.
 *
 * Auch nicht nur ein Prozesszustand: das Backend läuft mit `restart: always`.
 * Stürzt es während einer Wiederherstellung ab, muss es IM WARTUNGSMODUS
 * wieder hochkommen, nicht offen. Eine Datei in einem eigenen Volume
 * (`STATE_DIR`, Vorgabe `/app/state`) ist genau das: ausfallsicher
 * geschlossen. Fehlt die Datei (erster Start, oder nach `clear()`), gilt
 * OPEN.
 */
@Injectable()
export class MaintenanceStateService {
  private readonly stateDir: string;
  private readonly filePath: string;

  constructor() {
    this.stateDir = process.env.STATE_DIR || path.join(process.cwd(), "state");
    this.filePath = path.join(this.stateDir, "maintenance.json");
  }

  /**
   * Liest den aktuellen Zustand synchron von der Platte. Bewusst ohne
   * In-Prozess-Zwischenspeicher: der Zustand muss auch dann korrekt sein,
   * wenn eine andere Instanz oder ein Neustart die Datei zwischenzeitlich
   * verändert hat, und die Zugriffshäufigkeit (Guard je Anfrage) ist für
   * einen synchronen Dateizugriff auf einem Vereinsfest unproblematisch.
   */
  read(): MaintenanceState {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf-8");
    } catch {
      // Fehlt die Datei (oder ist sie aus einem anderen Grund nicht lesbar):
      // OPEN, wörtlich wie im Entwurf gefordert.
      return { ...OPEN_MAINTENANCE_STATE };
    }

    try {
      const parsed = JSON.parse(raw);
      const phase =
        parsed?.phase === "DRAINING" || parsed?.phase === "LOCKED"
          ? parsed.phase
          : "OPEN";
      return {
        phase,
        since: typeof parsed?.since === "string" ? parsed.since : null,
        byUserId: typeof parsed?.byUserId === "string" ? parsed.byUserId : null,
        byUsername:
          typeof parsed?.byUsername === "string" ? parsed.byUsername : null,
        reason: typeof parsed?.reason === "string" ? parsed.reason : null,
        expectedUntil:
          typeof parsed?.expectedUntil === "string"
            ? parsed.expectedUntil
            : null,
      };
    } catch {
      // Eine beschädigte Datei darf den Betrieb nicht unbemerkt öffnen: im
      // Zweifel gilt der sicherere Zustand, nicht OPEN. Eine unlesbare Datei
      // bei laufendem Betrieb ist ein Zeichen für eine kaputte Platte, kein
      // Grund, den Wartungsmodus stillschweigend zu verlassen.
      return {
        phase: "LOCKED",
        since: null,
        byUserId: null,
        byUsername: null,
        reason: "Zustandsdatei beschädigt — sicherheitshalber gesperrt.",
        expectedUntil: null,
      };
    }
  }

  /**
   * Schreibt den Zustand atomar: erst in eine temporäre Datei im selben
   * Verzeichnis, dann per `rename` an den endgültigen Platz. `rename` ist auf
   * demselben Dateisystem atomar — ein Absturz mitten im Schreiben darf keine
   * halb geschriebene Datei hinterlassen, denn genau diese Datei entscheidet
   * nach einem Absturz während der Wartung, ob im Wartungsmodus oder offen
   * gestartet wird.
   */
  write(state: MaintenanceState): void {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
    const tmpPath = path.join(
      this.stateDir,
      `.maintenance.json.tmp-${process.pid}-${Date.now()}`,
    );
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.filePath);
  }

  /** Entfernt die Datei. Ab dann gilt wieder OPEN (siehe `read()`). */
  clear(): void {
    try {
      fs.unlinkSync(this.filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    }
  }
}
