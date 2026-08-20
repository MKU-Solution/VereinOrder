import { Test, TestingModule } from "@nestjs/testing";
import { UsersService } from "./users.service";
import { PRISMA_CLIENT } from "../prisma/prisma.module";

describe("UsersService", () => {
  let service: UsersService;
  const prisma = {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    authThrottle: { deleteMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PRISMA_CLIENT, useValue: prisma }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("liefert ausschließlich die freigegebenen Benutzerfelder", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.findAll();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  });
});
