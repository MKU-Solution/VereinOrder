import { createApiValidationPipe } from "../common/validation/api-validation";
import { CreateSetupAdminDto } from "./setup.dto";
import { CreateUserDto, PIN_PATTERN } from "../users/users.dto";

/**
 * Eingabepruefung der Ersteinrichtung (Issue #173), im Zuschnitt von
 * `users.dto.spec.ts`. Die Pruefung laeuft ueber dieselbe Pipe, die `main.ts`
 * global setzt - eine Abweichung zwischen Test und Betrieb ist damit
 * ausgeschlossen.
 */
describe("Setup-DTOs (Issue #173)", () => {
  const pipe = createApiValidationPipe();

  const transform = (value: unknown) =>
    pipe.transform(value, { type: "body", metatype: CreateSetupAdminDto });

  it("nimmt eine gueltige Eingabe an und trimmt den Benutzernamen", async () => {
    await expect(
      transform({ username: "  betreiber  ", pin: "13570" }),
    ).resolves.toMatchObject({ username: "betreiber", pin: "13570" });
  });

  it("beurteilt jede PIN genauso wie die Benutzerverwaltung", async () => {
    // Der Kern der Zusage aus #173: Ein hier angelegtes Konto muss sich
    // anmelden koennen. `AuthService.validateUser` prueft gegen dasselbe
    // Muster wie `CreateUserDto`. Statt das nur zu behaupten, wird jede
    // Kandidaten-PIN durch BEIDE DTOs geschickt und auf Gleichstand geprueft.
    expect(PIN_PATTERN.source).toBe("^\\d{4,12}$");

    const kandidaten = [
      "1234",
      "0000",
      "123456789012",
      "123",
      "1234567890123",
      "abcd",
      "12 34",
      "12.34",
      "",
      "1234\n",
      "١٢٣٤",
    ];

    for (const pin of kandidaten) {
      const setup = await transform({ username: "betreiber", pin }).then(
        () => "angenommen",
        () => "abgelehnt",
      );
      const verwaltung = await pipe
        .transform(
          { username: "betreiber", pin, role: "ADMINISTRATOR" },
          { type: "body", metatype: CreateUserDto },
        )
        .then(
          () => "angenommen",
          () => "abgelehnt",
        );
      expect(`${pin}: ${setup}`).toBe(`${pin}: ${verwaltung}`);
    }
  });

  it.each([
    ["zu kurz", "123"],
    ["zu lang", "1234567890123"],
    ["nicht numerisch", "abcd"],
    ["mit Leerzeichen", "12 34"],
    ["leer", ""],
  ])("lehnt eine PIN ab, die %s ist", async (_beschreibung, pin) => {
    await expect(
      transform({ username: "betreiber", pin }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });

  it.each([
    ["leer", ""],
    ["nur Leerzeichen", "   "],
    ["laenger als 64 Zeichen", "b".repeat(65)],
  ])("lehnt einen Benutzernamen ab, der %s ist", async (_b, username) => {
    await expect(transform({ username, pin: "13570" })).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });

  it("lehnt einen fehlenden Benutzernamen und eine fehlende PIN ab", async () => {
    await expect(transform({ pin: "13570" })).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
    await expect(transform({ username: "betreiber" })).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });

  it("lehnt eine mitgeschickte Rolle ab, statt sie still zu verwerfen", async () => {
    // Der Weg ist unangemeldet erreichbar. Ein still verworfenes `role`
    // saehe fuer den Anrufer wie ein Erfolg aus; 400 macht den Versuch
    // sichtbar - und auditierbar an der Stelle, an der er scheitert.
    await expect(
      transform({ username: "betreiber", pin: "13570", role: "WAITER" }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });

  it("lehnt einen mitgeschickten PIN-Hash und ein mitgeschicktes isActive ab", async () => {
    await expect(
      transform({
        username: "betreiber",
        pin: "13570",
        pinHash: "$2a$10$injection",
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
    await expect(
      transform({ username: "betreiber", pin: "13570", isActive: false }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });
});
