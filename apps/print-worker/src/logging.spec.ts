import { createLogger, redact } from "./logging";

describe("Worker-Protokoll", () => {
  const token = "a".repeat(40);

  function capture() {
    const lines: string[] = [];
    const logger = createLogger({
      secrets: [token],
      write: (line) => lines.push(line),
      clock: () => new Date(Date.UTC(2026, 7, 21, 6, 0, 0)),
    });
    return { lines, logger };
  }

  it("schreibt eine strukturierte Zeile je Ereignis", () => {
    const { lines, logger } = capture();
    logger.info("job.printed", { jobId: "job-1", bytes: 128 });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      ts: "2026-08-21T06:00:00.000Z",
      level: "info",
      event: "job.printed",
      jobId: "job-1",
      bytes: 128,
    });
  });

  it("entfernt das Worker-Token aus Fremdmeldungen", () => {
    const { lines, logger } = capture();
    logger.error("backend.status_failed", {
      message: `Request failed with header x-print-worker-token: ${token}`,
    });

    expect(lines[0]).not.toContain(token);
    expect(lines[0]).toContain("***");
  });

  it("entschärft PIN- und Token-Angaben", () => {
    expect(redact("Anmeldung fehlgeschlagen, pin: 1234")).toBe(
      "Anmeldung fehlgeschlagen, pin=***",
    );
    expect(redact("token=deadbeefdeadbeefdeadbeefdeadbeef")).toBe("token=***");
  });

  it("kürzt überlange Meldungen", () => {
    const long = "x".repeat(500);
    expect(String(redact(long))).toHaveLength(301);
  });

  it("lässt Zahlen und Wahrheitswerte unverändert", () => {
    const { lines, logger } = capture();
    logger.warn("worker.started", { pollIntervalMs: 2500, simulator: false });

    const entry = JSON.parse(lines[0]);
    expect(entry.pollIntervalMs).toBe(2500);
    expect(entry.simulator).toBe(false);
  });
});
