import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminUsername = "admin";
  const rawPin = "1234";
  const pinHash = await bcrypt.hash(rawPin, 10);

  const admin = await prisma.user.upsert({
    where: { username: adminUsername },
    update: {},
    create: {
      username: adminUsername,
      pinHash: pinHash,
      role: "ADMINISTRATOR",
    },
  });
  console.log(
    `Initialer Admin-User erstellt: ${admin.username} / PIN: ${rawPin}`,
  );

  const waiter = await prisma.user.upsert({
    where: { username: "kellner1" },
    update: {},
    create: {
      username: "kellner1",
      pinHash: pinHash,
      role: "WAITER",
    },
  });
  console.log(
    `Initialer Kellner-User erstellt: ${waiter.username} / PIN: ${rawPin}`,
  );

  const runner = await prisma.user.upsert({
    where: { username: "runner1" },
    update: {},
    create: {
      username: "runner1",
      pinHash: pinHash,
      role: "RUNNER",
    },
  });
  console.log(
    `Initialer Zusteller-User erstellt: ${runner.username} / PIN: ${rawPin}`,
  );

  const printer = await prisma.printer.create({
    data: {
      name: "Hauptkasse Drucker",
      type: "CONSOLE",
    },
  });
  console.log(`Drucker erstellt: ${printer.name}`);

  // Create Test Event
  const event = await prisma.event.create({
    data: {
      name: "Sommerfest 2026",
      organizer: "Musikverein Test",
      status: "TEST_MODE",
      testMode: true,
    },
  });
  console.log(`Test Event erstellt: ${event.name}`);

  // Create Stations
  const schank = await prisma.station.create({
    data: { name: "Schank", shortName: "SCH", eventId: event.id },
  });
  const kueche = await prisma.station.create({
    data: { name: "Küche", shortName: "KUE", eventId: event.id },
  });
  console.log(`Stationen erstellt: Schank, Küche`);

  // Create Categories
  const catGetraenke = await prisma.productCategory.create({
    data: { name: "Getränke", sortOrder: 1, eventId: event.id },
  });
  const catSpeisen = await prisma.productCategory.create({
    data: { name: "Speisen", sortOrder: 2, eventId: event.id },
  });
  console.log(`Kategorien erstellt: Getränke, Speisen`);

  // Create Products
  await prisma.product.create({
    data: {
      name: "Bier vom Fass",
      shortName: "Bier",
      price: 450, // default 0.5l price
      categoryId: catGetraenke.id,
      targetStationId: schank.id,
      eventId: event.id,
      sortOrder: 1,
      optionGroups: {
        create: [
          {
            name: "Größe",
            selectionType: "SINGLE",
            isRequired: true,
            minSelect: 1,
            maxSelect: 1,
            priceMode: "ABSOLUTE",
            quickSaleTiles: true,
            sortOrder: 0,
            options: {
              create: [
                { name: "0,3l", priceEffect: 350, sortOrder: 0 },
                { name: "0,5l", priceEffect: 450, sortOrder: 1 },
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.product.create({
    data: {
      name: "Cola",
      price: 350,
      categoryId: catGetraenke.id,
      targetStationId: schank.id,
      eventId: event.id,
      sortOrder: 2,
    },
  });

  await prisma.product.create({
    data: {
      name: "Wienerschnitzel mit Pommes",
      shortName: "Schnitzel",
      price: 1200,
      categoryId: catSpeisen.id,
      targetStationId: kueche.id,
      eventId: event.id,
      sortOrder: 1,
      optionGroups: {
        create: [
          {
            name: "Beilage",
            selectionType: "SINGLE",
            isRequired: true,
            minSelect: 1,
            maxSelect: 1,
            priceMode: "SURCHARGE",
            quickSaleTiles: false,
            sortOrder: 0,
            options: {
              create: [
                { name: "Pommes", priceEffect: 0, sortOrder: 0 },
                { name: "Reis", priceEffect: 0, sortOrder: 1 },
              ],
            },
          },
          {
            name: "Extras",
            selectionType: "MULTIPLE",
            isRequired: false,
            minSelect: 0,
            maxSelect: null,
            priceMode: "SURCHARGE",
            quickSaleTiles: false,
            sortOrder: 1,
            options: {
              create: [
                { name: "ohne Beilage", priceEffect: -200, sortOrder: 0 },
                { name: "Ketchup", priceEffect: 50, sortOrder: 1 },
                { name: "Zitrone extra", priceEffect: 0, sortOrder: 2 },
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.product.create({
    data: {
      name: "Pommes Frites",
      shortName: "Pommes",
      price: 450,
      categoryId: catSpeisen.id,
      targetStationId: kueche.id,
      eventId: event.id,
      sortOrder: 2,
      optionGroups: {
        create: [
          {
            name: "Extras",
            selectionType: "MULTIPLE",
            isRequired: false,
            minSelect: 0,
            maxSelect: null,
            priceMode: "SURCHARGE",
            quickSaleTiles: false,
            sortOrder: 0,
            options: {
              create: [
                { name: "Ketchup", priceEffect: 50, sortOrder: 0 },
                { name: "Mayo", priceEffect: 50, sortOrder: 1 },
              ],
            },
          },
        ],
      },
    },
  });
  console.log(`Test-Produkte mit Auswahlgruppen erstellt.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
