import { Test, TestingModule } from "@nestjs/testing";
import { Role } from "@vereinorder/database";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

describe("UsersController", () => {
  let controller: UsersController;
  const usersService = {
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updatePin: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("reicht die authentifizierte Administrator-ID beim Anlegen weiter", async () => {
    const body = { username: "kellner2", pin: "1234", role: Role.WAITER };
    usersService.create.mockResolvedValue({ id: "user-2", ...body });

    await controller.create({ user: { userId: "admin-1" } }, body);

    expect(usersService.create).toHaveBeenCalledWith(body, "admin-1");
  });

  it("reicht Benutzer-ID, Ziel-ID und PIN beim PIN-Wechsel weiter", async () => {
    usersService.updatePin.mockResolvedValue({ id: "user-2" });

    await controller.updatePin(
      { user: { userId: "admin-1" } },
      { id: "58c9f2f8-90e1-4ea8-b7b6-3e2a498a1ff1" },
      { pin: "9876" },
    );

    expect(usersService.updatePin).toHaveBeenCalledWith(
      "58c9f2f8-90e1-4ea8-b7b6-3e2a498a1ff1",
      "9876",
      "admin-1",
    );
  });
});
