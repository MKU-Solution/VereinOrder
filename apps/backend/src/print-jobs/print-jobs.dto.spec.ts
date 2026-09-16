import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CreatePrinterDto,
  ReportPrintOutcomeDto,
  TransitionPrintPhaseDto,
  UpdatePrinterDto,
} from "./print-jobs.dto";

describe("Druck-DTOs (Issue #69)", () => {
  async function validationErrors(
    Dto: new () => object,
    input: Record<string, unknown>,
  ) {
    return validate(plainToInstance(Dto, input));
  }

  it.each([
    [
      TransitionPrintPhaseDto,
      { leaseId: "nicht-uuid", phase: "SPOOLED", cupsJobId: 1 },
    ],
    [
      TransitionPrintPhaseDto,
      {
        leaseId: "10000000-0000-4000-8000-000000000001",
        phase: "SPOOLED",
        cupsJobId: 1.5,
      },
    ],
    [
      ReportPrintOutcomeDto,
      {
        leaseId: "10000000-0000-4000-8000-000000000001",
        outcome: "NOT_PRINTED",
        bytesWritten: -1,
      },
    ],
    [CreatePrinterDto, { name: "   ", type: "CONSOLE" }],
    [CreatePrinterDto, { name: "Bon", type: "CONSOLE", isActive: "false" }],
    // Issue #260: eine unbekannte Codepage-Geräteprofilbezeichnung darf
    // nicht klammheimlich als EPSON_STANDARD durchgehen.
    [
      CreatePrinterDto,
      { name: "Bon", type: "CONSOLE", codepageProfile: "GRIECHISCH" },
    ],
  ])("weist ungültige Worker-/Druckereingaben ab", async (Dto, input) => {
    expect(await validationErrors(Dto, input)).not.toHaveLength(0);
  });

  it("akzeptiert einen explizit typisierten Konsolendrucker", async () => {
    expect(
      await validate(
        plainToInstance(CreatePrinterDto, {
          name: "  Bon Hauptkasse  ",
          type: "CONSOLE",
          isActive: false,
        }),
      ),
    ).toHaveLength(0);
  });

  it("akzeptiert das MUNBYN-Geräteprofil (Issue #260) - das Feld muss dem DTO bekannt sein, sonst weist die globale Validierung (forbidNonWhitelisted) es mit 400 ab", async () => {
    expect(
      await validate(
        plainToInstance(CreatePrinterDto, {
          name: "Küche MUNBYN",
          type: "ESC_POS_NETWORK",
          ipAddress: "192.168.10.217",
          codepageProfile: "MUNBYN_CLONE",
        }),
      ),
    ).toHaveLength(0);
  });

  // Issue #263: Ein Konsolendrucker (CONSOLE) hat kein Adressfeld im
  // Formular. Das Formular schickt für "kein Wert" trotzdem einen leeren
  // String, nicht undefined/null - @IsOptional() überspringt aber nur
  // undefined/null, nicht "". Vor der Behebung verlangte @Matches wegen des
  // "+" mindestens ein Zeichen, wodurch "" durchfiel (400, Regel "matches").
  // Das ist der Rot-Beweis: dieser Test schlägt am unveränderten Stand
  // (ae82fa0) fehl, weil validationErrors dort nicht leer ist.
  it("akzeptiert einen leeren String für ipAddress (Issue #263) - das Formular schickt für Drucker ohne Adressfeld '', nicht null", async () => {
    expect(
      await validationErrors(CreatePrinterDto, {
        name: "Hauptkasse Drucker",
        type: "CONSOLE",
        ipAddress: "",
      }),
    ).toHaveLength(0);

    expect(
      await validationErrors(UpdatePrinterDto, {
        ipAddress: "",
      }),
    ).toHaveLength(0);
  });

  // Dieselbe Klasse wie oben, an queueName: @IsOptional() plus @Matches mit
  // "+" (siehe print-jobs.dto.ts). queueName wird heute vom Frontend zwar
  // schon als null statt "" geschickt, wenn kein CUPS_IPP-Drucker vorliegt -
  // ein anderer Aufrufer auf dieselbe Schnittstelle könnte aber ebenso einen
  // leeren String schicken; das DTO darf daran nicht scheitern.
  it("akzeptiert einen leeren String für queueName (dieselbe Klasse wie ipAddress, Issue #263)", async () => {
    expect(
      await validationErrors(CreatePrinterDto, {
        name: "Bon Hauptkasse",
        type: "CONSOLE",
        queueName: "",
      }),
    ).toHaveLength(0);
  });

  it("weist eine nicht-leere, aber ungültige ipAddress weiterhin ab (Issue #263 ändert nichts an echten Adressen)", async () => {
    expect(
      await validationErrors(CreatePrinterDto, {
        name: "Küche",
        type: "ESC_POS_NETWORK",
        ipAddress: "http://192.168.1.50/",
      }),
    ).not.toHaveLength(0);
  });
});
