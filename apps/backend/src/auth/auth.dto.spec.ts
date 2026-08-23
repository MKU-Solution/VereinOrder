import { createApiValidationPipe } from "../common/validation/api-validation";
import { LoginDto } from "./auth.dto";

describe("Auth-DTOs", () => {
  const pipe = createApiValidationPipe();

  it("lehnt unbekannte Login-Felder ab", async () => {
    await expect(
      pipe.transform(
        { username: "admin", pin: "1234", role: "ADMINISTRATOR" },
        { type: "body", metatype: LoginDto },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });

  it("laesst eine nichtnumerische PIN bis zum AuthService passieren", async () => {
    await expect(
      pipe.transform(
        { username: "admin", pin: "not-a-pin" },
        { type: "body", metatype: LoginDto },
      ),
    ).resolves.toMatchObject({ pin: "not-a-pin" });
  });
});
