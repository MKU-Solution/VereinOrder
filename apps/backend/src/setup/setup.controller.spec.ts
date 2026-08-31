import { Test, TestingModule } from "@nestjs/testing";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { SetupController } from "./setup.controller";
import { SetupService } from "./setup.service";
import { MAINTENANCE_PUBLIC_KEY } from "../maintenance/maintenance.decorator";

/**
 * Waechtertest fuer die beiden bewussten Entscheidungen am Setup-Controller
 * (Issue #173). Beide sind Entscheidungen, die spaeter lautlos kippen
 * koennten: Ein `@UseGuards(JwtAuthGuard)` "der Ordnung halber" machte die
 * Ersteinrichtung unerreichbar, ein entferntes `@MaintenancePublic()`
 * sperrte sie bei beschaedigter Zustandsdatei aus.
 */
describe("SetupController (Issue #173)", () => {
  let controller: SetupController;
  const setupService = {
    getStatus: jest.fn(),
    createFirstAdministrator: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SetupController],
      providers: [{ provide: SetupService, useValue: setupService }],
    })
      .overrideProvider(SetupService)
      .useValue(setupService)
      .compile();

    controller = module.get<SetupController>(SetupController);
  });

  it("traegt weder am Controller noch an einer Route einen Guard", () => {
    // Ohne Benutzer kann es kein Token geben - ein JwtAuthGuard hier waere
    // eine Tuer, die sich nur von innen oeffnen laesst.
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SetupController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SetupController.prototype.getStatus),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        SetupController.prototype.createAdministrator,
      ),
    ).toBeUndefined();
  });

  it("ist vom Wartungsguard ausgenommen (Entscheidung, siehe Klassenkommentar)", () => {
    // Der Wartungsguard laeuft als APP_GUARD vor jedem controllergebundenen
    // Guard. Ohne diese Markierung sperrte eine beschaedigte Zustandsdatei
    // (read() liefert dann LOCKED) auch die Ersteinrichtung - und der
    // einzige Ausstieg, POST /maintenance/end, verlangt ein Token, das ohne
    // Benutzer nicht existieren kann.
    expect(Reflect.getMetadata(MAINTENANCE_PUBLIC_KEY, SetupController)).toBe(
      true,
    );
  });

  it("reicht den Status unveraendert durch", async () => {
    setupService.getStatus.mockResolvedValue({ setupRequired: true });

    await expect(controller.getStatus()).resolves.toEqual({
      setupRequired: true,
    });
    expect(setupService.getStatus).toHaveBeenCalledTimes(1);
  });

  it("uebergibt die geprueften Eingaben an den Dienst und stellt kein Token aus", async () => {
    setupService.createFirstAdministrator.mockResolvedValue({
      id: "admin-1",
      username: "betreiber",
      role: "ADMINISTRATOR",
      isActive: true,
    });

    const result: any = await controller.createAdministrator({
      username: "betreiber",
      pin: "13570",
    });

    expect(setupService.createFirstAdministrator).toHaveBeenCalledWith({
      username: "betreiber",
      pin: "13570",
    });
    // Token entstehen ausschliesslich ueber POST /auth/login - samt
    // Fehlversuchszaehler und Auditeintrag.
    expect(result.access_token).toBeUndefined();
    expect(result.pinHash).toBeUndefined();
  });
});
