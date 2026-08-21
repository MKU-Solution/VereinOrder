import {
  CODEPAGE_COMMAND,
  decodeFromCodepage,
  encodeForCodepage,
  resolveCodepage,
} from "./charset";

describe("Codepage-Abbildung für Bondrucker", () => {
  it("bildet deutsche Umlaute auf die Bytes der Codepage ab", () => {
    const bytes = encodeForCodepage("äöüÄÖÜß", "CP858");

    expect(Array.from(bytes)).toEqual([
      0x84, 0x94, 0x81, 0x8e, 0x99, 0x9a, 0xe1,
    ]);
    expect(decodeFromCodepage(bytes, "CP858")).toBe("äöüÄÖÜß");
  });

  it("druckt Umlaute in allen unterstützten Codepages identisch", () => {
    const umlauts = "äöüÄÖÜß";
    const cp437 = encodeForCodepage(umlauts, "CP437");
    const cp850 = encodeForCodepage(umlauts, "CP850");

    expect(cp437.equals(cp850)).toBe(true);
    expect(cp437.equals(encodeForCodepage(umlauts, "CP858"))).toBe(true);
  });

  it("kennt das Eurozeichen nur in CP858 und ersetzt es sonst lesbar", () => {
    expect(Array.from(encodeForCodepage("€", "CP858"))).toEqual([0xd5]);
    expect(encodeForCodepage("€", "CP437").toString("ascii")).toBe("EUR");
    expect(CODEPAGE_COMMAND.CP858).toBe(19);
  });

  it("ersetzt typografische Sonderzeichen statt sie zu verschlucken", () => {
    const bytes = encodeForCodepage("Pommes – „groß“ …", "CP858");
    const text = decodeFromCodepage(bytes, "CP858");

    expect(text).toBe('Pommes - "groß" ...');
  });

  it("entfernt unbekannte Akzente auf den Grundbuchstaben", () => {
    // Zeichen, die keine der Codepages kennt: č und ě zerfallen zu c und e.
    expect(encodeForCodepage("Kč ě", "CP437").toString("ascii")).toBe("Kc e");
  });

  it("fällt bei unbekannter Konfiguration auf CP858 zurück", () => {
    expect(resolveCodepage("UTF-8")).toBe("CP858");
    expect(resolveCodepage(undefined)).toBe("CP858");
    expect(resolveCodepage("CP437")).toBe("CP437");
  });

  it("lässt reines ASCII unverändert", () => {
    const text = "Bestellung #42 - 1x Cola 2,50";
    expect(encodeForCodepage(text, "CP858").toString("ascii")).toBe(text);
  });
});
