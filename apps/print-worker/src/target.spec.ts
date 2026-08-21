import { PrinterConfigurationError, resolveTarget } from "./target";

describe("Druckerkonfiguration", () => {
  it("übernimmt Netzwerkdrucker mit Standardwerten", () => {
    const target = resolveTarget({
      id: "p1",
      name: "Küche",
      type: "ESC_POS_NETWORK",
      ipAddress: "192.168.1.50",
    });

    expect(target).toMatchObject({
      kind: "escpos-network",
      host: "192.168.1.50",
      port: 9100,
      timeoutMs: 5000,
      codepage: "CP858",
      cutMode: "PARTIAL",
      copies: 1,
    });
    expect(target.profile.columns).toBe(48);
  });

  it("übernimmt abweichende Papierbreite, Kopien und Zeitlimit", () => {
    const target = resolveTarget({
      id: "p2",
      name: "Theke",
      type: "LAN",
      ipAddress: "drucker-theke",
      port: 9101,
      paperWidth: 58,
      codepage: "CP437",
      cutMode: "FULL",
      copies: 2,
      timeoutMs: 1500,
    });

    expect(target.profile.columns).toBe(32);
    expect(target.port).toBe(9101);
    expect(target.codepage).toBe("CP437");
    expect(target.cutMode).toBe("FULL");
    expect(target.copies).toBe(2);
    expect(target.timeoutMs).toBe(1500);
  });

  it("ersetzt unsinnige Werte durch sichere Vorgaben", () => {
    const target = resolveTarget({
      id: "p3",
      name: "Theke",
      type: "ESC_POS_NETWORK",
      ipAddress: "192.168.1.50",
      port: 0,
      paperWidth: 72,
      codepage: "UTF-8",
      cutMode: "SCHERE",
      copies: 99,
      timeoutMs: -5,
    });

    expect(target.port).toBe(9100);
    expect(target.profile.width).toBe(80);
    expect(target.codepage).toBe("CP858");
    expect(target.cutMode).toBe("PARTIAL");
    expect(target.copies).toBe(9);
    expect(target.timeoutMs).toBe(5000);
  });

  it("verlangt eine Adresse für Netzwerkdrucker", () => {
    expect(() =>
      resolveTarget({ id: "p4", name: "Küche", type: "ESC_POS_NETWORK" }),
    ).toThrow(PrinterConfigurationError);

    expect(() =>
      resolveTarget({
        id: "p4",
        name: "Küche",
        type: "ESC_POS_NETWORK",
        ipAddress: "http://192.168.1.50/print",
      }),
    ).toThrow(/ungültige Adresse/);
  });

  it("erkennt Konsolendrucker als Simulator", () => {
    expect(
      resolveTarget({ id: "p5", name: "Test", type: "CONSOLE" }),
    ).toMatchObject({ kind: "simulator" });
  });

  it("lenkt auf Wunsch alle Drucker auf den Simulator", () => {
    const target = resolveTarget(
      {
        id: "p6",
        name: "Küche",
        type: "ESC_POS_NETWORK",
        ipAddress: "192.168.1.50",
      },
      { forceSimulator: true },
    );

    expect(target.kind).toBe("simulator");
  });

  it("übernimmt CUPS_IPP mit Port-Vorgabe 631 und Pflicht-queueName", () => {
    const target = resolveTarget({
      id: "p9",
      name: "Theke",
      type: "CUPS_IPP",
      queueName: "theke-raw",
    });

    expect(target).toMatchObject({
      kind: "cups-ipp",
      port: 631,
      queueName: "theke-raw",
    });
    expect(target.host).toBeUndefined();
  });

  it("übernimmt bei CUPS_IPP einen abweichenden Host, wenn angegeben", () => {
    const target = resolveTarget({
      id: "p10",
      name: "Theke",
      type: "CUPS_IPP",
      ipAddress: "cups.verein.local",
      queueName: "theke-raw",
      port: 6310,
    });

    expect(target.host).toBe("cups.verein.local");
    expect(target.port).toBe(6310);
  });

  it("verlangt einen queueName für CUPS_IPP", () => {
    expect(() =>
      resolveTarget({ id: "p11", name: "Theke", type: "CUPS_IPP" }),
    ).toThrow(PrinterConfigurationError);
    expect(() =>
      resolveTarget({
        id: "p11",
        name: "Theke",
        type: "CUPS_IPP",
        queueName: "  ",
      }),
    ).toThrow(/queueName/);
  });

  it("weist unbekannte Druckertypen ab, statt still zu drucken", () => {
    expect(() =>
      resolveTarget({ id: "p7", name: "Alt", type: "ESC_POS_USB" }),
    ).toThrow(PrinterConfigurationError);
    expect(() =>
      resolveTarget({ id: "p8", name: "Alt", type: "WINDOWS_DRIVER" }),
    ).toThrow(/nicht unterstützt/);
  });
});
