import { createApiValidationPipe } from "../common/validation/api-validation";
import { CreateUserDto } from "./users.dto";

describe("Benutzer-DTOs", () => {
  const pipe = createApiValidationPipe();

  it("lehnt PINs ausserhalb von vier bis zwoelf Ziffern ab", async () => {
    await expect(
      pipe.transform(
        { username: "kellner2", pin: "123", role: "WAITER" },
        { type: "body", metatype: CreateUserDto },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });

  it("lehnt nicht erlaubte Felder beim Benutzer-Anlegen ab", async () => {
    await expect(
      pipe.transform(
        {
          username: "kellner2",
          pin: "1234",
          role: "WAITER",
          pinHash: "injection",
        },
        { type: "body", metatype: CreateUserDto },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });
});
