import { BadRequestException } from "@nestjs/common";
import { PrismaClient } from "@vereinorder/database";
import { ProductsService } from "./products.service";
import { UpdateProductDto } from "./dto/product.dto";

describe("ProductsService – Eventgrenzen und Allowlists", () => {
  const eventId = "11111111-1111-4111-8111-111111111111";
  const foreignEventId = "22222222-2222-4222-8222-222222222222";

  function createService(categoryEventId = eventId) {
    const tx = {
      product: {
        update: jest
          .fn()
          .mockResolvedValue({ id: "product", name: "Wasser", price: 300 }),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: "product",
          eventId,
          categoryId: "category-own",
          price: 300,
        }),
        update: jest.fn(),
      },
      productCategory: {
        findUnique: jest.fn().mockResolvedValue({ eventId: categoryEventId }),
      },
      station: { findUnique: jest.fn() },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const realtime = { broadcast: jest.fn() };
    return {
      service: new ProductsService(
        prisma as unknown as PrismaClient,
        realtime as never,
      ),
      prisma,
      tx,
    };
  }

  it("weist beim Produktupdate eine Kategorie einer fremden Veranstaltung vor dem Write ab", async () => {
    const { service, tx } = createService(foreignEventId);

    await expect(
      service.updateProduct(
        "product",
        { categoryId: "33333333-3333-4333-8333-333333333333" },
        "user",
      ),
    ).rejects.toEqual(expect.any(BadRequestException));

    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it("reicht eventId aus einer manipulierten Update-Nutzlast nicht an Prisma weiter", async () => {
    const { service, tx } = createService();
    const manipulatedPayload = {
      name: "Wasser still",
      eventId: foreignEventId,
    } as unknown as UpdateProductDto;

    await service.updateProduct("product", manipulatedPayload);

    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: "Wasser still" },
      }),
    );
  });
});
