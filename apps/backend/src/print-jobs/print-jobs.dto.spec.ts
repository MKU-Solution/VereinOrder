import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CreatePrinterDto,
  ReportPrintOutcomeDto,
  TransitionPrintPhaseDto,
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
});
