import { GroupInput, saveOptionGroups } from "./product-option-groups";

describe("saveOptionGroups – Reihenfolge beim Vertauschen der Endpreis-Gruppe", () => {
  // Belegt Befund 1 aus der Pruefung der Projektleitung: Postgres prueft die
  // partiellen eindeutigen Indizes (hoechstens eine ABSOLUTE-Gruppe,
  // hoechstens eine quickSaleTiles-Gruppe je Produkt) je Anweisung, nicht
  // erst am Ende der Transaktion. Es gibt keine erreichbare PostgreSQL-
  // Instanz in dieser Umgebung, daher wird die Aufrufreihenfolge gegenueber
  // einem tx-Double nachgewiesen: die neutralisierende updateMany muss vor
  // jedem UPDATE liegen, das eine Gruppe auf ABSOLUTE/quickSaleTiles setzt.
  it("setzt bestehende Gruppen neutral, bevor eine andere Gruppe die Endpreis-/Kachelmarke übernimmt", async () => {
    const callOrder: string[] = [];

    const existingGroupA = {
      id: "group-a",
      name: "Größe",
      selectionType: "SINGLE",
      isRequired: true,
      minSelect: 1,
      maxSelect: 1,
      priceMode: "ABSOLUTE",
      quickSaleTiles: true,
      sortOrder: 0,
      productId: "product-1",
      options: [
        {
          id: "option-a1",
          name: "0,5 l",
          priceEffect: 350,
          isActive: true,
          sortOrder: 0,
          groupId: "group-a",
        },
      ],
    };
    const existingGroupB = {
      id: "group-b",
      name: "Beilage",
      selectionType: "SINGLE",
      isRequired: true,
      minSelect: 1,
      maxSelect: 1,
      priceMode: "SURCHARGE",
      quickSaleTiles: false,
      sortOrder: 1,
      productId: "product-1",
      options: [
        {
          id: "option-b1",
          name: "Pommes",
          priceEffect: 0,
          isActive: true,
          sortOrder: 0,
          groupId: "group-b",
        },
      ],
    };

    const tx: any = {
      productOptionGroup: {
        findMany: jest.fn().mockResolvedValue([existingGroupA, existingGroupB]),
        deleteMany: jest.fn().mockImplementation(async () => {
          callOrder.push("deleteMany");
          return { count: 0 };
        }),
        updateMany: jest.fn().mockImplementation(async (args: any) => {
          callOrder.push(
            `updateMany:${[...args.where.id.in].sort().join(",")}`,
          );
          return { count: args.where.id.in.length };
        }),
        update: jest.fn().mockImplementation(async (args: any) => {
          callOrder.push(
            `update:${args.where.id}:${args.data.priceMode}:${args.data.quickSaleTiles}`,
          );
          return {};
        }),
        create: jest.fn().mockResolvedValue({}),
      },
      productOption: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    // Die Verwaltung dreht die Rollen um: "Beilage" (B) übernimmt ABSOLUTE
    // und die Kachelmarke, "Größe" (A) wird zur reinen SURCHARGE-Gruppe. B
    // steht in der Nutzlast vor A -- die vom Bedienenden gepflegte
    // Sortierung, keine konstruierte Ausnahme.
    const payload: GroupInput[] = [
      {
        id: "group-b",
        name: "Beilage",
        selectionType: "SINGLE",
        isRequired: true,
        minSelect: 1,
        maxSelect: 1,
        priceMode: "ABSOLUTE",
        quickSaleTiles: true,
        sortOrder: 0,
        options: [
          { id: "option-b1", name: "Pommes", priceEffect: 0, sortOrder: 0 },
        ],
      },
      {
        id: "group-a",
        name: "Größe",
        selectionType: "SINGLE",
        isRequired: true,
        minSelect: 1,
        maxSelect: 1,
        priceMode: "SURCHARGE",
        quickSaleTiles: false,
        sortOrder: 1,
        options: [
          { id: "option-a1", name: "0,5 l", priceEffect: 350, sortOrder: 0 },
        ],
      },
    ];

    await saveOptionGroups(tx, "product-1", payload);

    expect(tx.productOptionGroup.updateMany).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining(["group-a", "group-b"]) } },
      data: { priceMode: "SURCHARGE", quickSaleTiles: false },
    });

    const neutralizeIndex = callOrder.findIndex((entry) =>
      entry.startsWith("updateMany:"),
    );
    const groupBTakesOverIndex = callOrder.indexOf(
      "update:group-b:ABSOLUTE:true",
    );

    expect(neutralizeIndex).toBeGreaterThanOrEqual(0);
    expect(groupBTakesOverIndex).toBeGreaterThan(neutralizeIndex);
    // Zum Zeitpunkt der Übernahme durch B war A bereits neutral -- sonst
    // hätte das reale UPDATE auf B den partiellen eindeutigen Index
    // verletzt, weil beide Zeilen kurzzeitig ABSOLUTE/quickSaleTiles
    // getragen hätten.
    const groupANeutralizedBeforeTakeover = callOrder
      .slice(0, groupBTakesOverIndex)
      .some(
        (entry) => entry.startsWith("updateMany:") && entry.includes("group-a"),
      );
    expect(groupANeutralizedBeforeTakeover).toBe(true);
  });
});
