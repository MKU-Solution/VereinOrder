import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MaintenanceStateService } from "./maintenance-state.service";
import { MaintenanceState } from "./maintenance.types";

describe("MaintenanceStateService (Issue #67, Entwurf Abschnitt 6)", () => {
  let stateDir: string;
  let previousStateDir: string | undefined;

  beforeEach(() => {
    previousStateDir = process.env.STATE_DIR;
    stateDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vereinorder-maintenance-state-"),
    );
    process.env.STATE_DIR = stateDir;
  });

  afterEach(() => {
    if (previousStateDir === undefined) delete process.env.STATE_DIR;
    else process.env.STATE_DIR = previousStateDir;
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("liefert OPEN, wenn die Zustandsdatei fehlt", () => {
    const service = new MaintenanceStateService();
    expect(service.read()).toEqual({
      phase: "OPEN",
      since: null,
      byUserId: null,
      byUsername: null,
      reason: null,
      expectedUntil: null,
    });
  });

  it("schreibt und liest denselben Zustand zurück", () => {
    const service = new MaintenanceStateService();
    const state: MaintenanceState = {
      phase: "LOCKED",
      since: "2026-08-23T10:00:00.000Z",
      byUserId: "admin-1",
      byUsername: "admin",
      reason: "Wiederherstellung",
      expectedUntil: "2026-08-23T10:30:00.000Z",
    };
    service.write(state);
    expect(service.read()).toEqual(state);
  });

  it("kommt nach einem simulierten Absturz IM Wartungsmodus wieder hoch, nicht offen", () => {
    // Simuliert restart: always - eine neue Prozessinstanz (neue Instanz
    // dieser Klasse) liest dieselbe Datei, die die vorherige geschrieben hat.
    const before = new MaintenanceStateService();
    before.write({
      phase: "LOCKED",
      since: "2026-08-23T10:00:00.000Z",
      byUserId: "admin-1",
      byUsername: "admin",
      reason: "Wiederherstellung läuft",
      expectedUntil: null,
    });

    const afterRestart = new MaintenanceStateService();
    expect(afterRestart.read().phase).toBe("LOCKED");
  });

  it("räumt keine halb geschriebene temporäre Datei im Zustandsverzeichnis übrig", () => {
    const service = new MaintenanceStateService();
    service.write({
      phase: "DRAINING",
      since: new Date().toISOString(),
      byUserId: "admin-1",
      byUsername: "admin",
      reason: null,
      expectedUntil: null,
    });

    const files = fs.readdirSync(stateDir);
    expect(files).toEqual(["maintenance.json"]);
  });

  it("liefert nach clear() wieder OPEN", () => {
    const service = new MaintenanceStateService();
    service.write({
      phase: "LOCKED",
      since: new Date().toISOString(),
      byUserId: "admin-1",
      byUsername: "admin",
      reason: null,
      expectedUntil: null,
    });

    service.clear();

    expect(service.read().phase).toBe("OPEN");
  });

  it("wirft nicht, wenn clear() auf eine bereits fehlende Datei trifft", () => {
    const service = new MaintenanceStateService();
    expect(() => service.clear()).not.toThrow();
  });

  it("öffnet den Betrieb nicht stillschweigend, wenn die Datei beschädigt ist", () => {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "maintenance.json"),
      "{ das ist kein gueltiges JSON",
      "utf-8",
    );
    const service = new MaintenanceStateService();
    expect(service.read().phase).toBe("LOCKED");
  });
});
