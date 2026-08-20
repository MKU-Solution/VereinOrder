import { ForbiddenException } from "@nestjs/common";
import { AuthController } from "./auth.controller";

describe("AuthController – schneller Benutzerwechsel", () => {
  const authService = {
    validateUser: jest.fn(),
    login: jest.fn(),
  };
  let controller: AuthController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new AuthController(authService as any);
  });

  it("verwendet die Identität aus dem JWT als vorherigen Benutzer", async () => {
    authService.validateUser.mockResolvedValue({
      id: "waiter-2",
      username: "kellner2",
      role: "WAITER",
    });
    authService.login.mockResolvedValue({ access_token: "new-token" });

    await controller.switchUser(
      { user: { userId: "waiter-1" } },
      { username: "kellner2", pin: "1234" },
    );

    expect(authService.login).toHaveBeenCalledWith(
      expect.objectContaining({ id: "waiter-2" }),
      "USER_SWITCH",
      "waiter-1",
    );
  });

  it("auditiert das Entsperren desselben Benutzers getrennt", async () => {
    authService.validateUser.mockResolvedValue({
      id: "waiter-1",
      username: "kellner1",
      role: "WAITER",
    });

    await controller.switchUser(
      { user: { userId: "waiter-1" } },
      { username: "kellner1", pin: "1234" },
    );

    expect(authService.login).toHaveBeenCalledWith(
      expect.anything(),
      "SCREEN_UNLOCK",
      "waiter-1",
    );
  });

  it("gibt bei falscher PIN keine Benutzerinformationen preis", async () => {
    authService.validateUser.mockResolvedValue(null);

    await expect(
      controller.switchUser(
        { user: { userId: "waiter-1" } },
        { username: "kellner2", pin: "0000" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
