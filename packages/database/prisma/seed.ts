import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminUsername = 'admin';
  const rawPin = '1234';
  const pinHash = await bcrypt.hash(rawPin, 10);

  const admin = await prisma.user.upsert({
    where: { username: adminUsername },
    update: {},
    create: {
      username: adminUsername,
      pinHash: pinHash,
      role: 'ADMINISTRATOR',
    },
  });
  console.log(`Initialer Admin-User erstellt: ${admin.username} / PIN: ${rawPin}`);

  const printer = await prisma.printer.create({
    data: {
      name: 'Hauptkasse Drucker',
      type: 'CONSOLE',
    }
  });
  console.log(`Drucker erstellt: ${printer.name}`);

  // Create Test Event
  const event = await prisma.event.create({
    data: {
      name: 'Sommerfest 2026',
      organizer: 'Musikverein Test',
      status: 'ACTIVE',
      testMode: true,
    }
  });
  console.log(`Test Event erstellt: ${event.name}`);

  // Create Stations
  const schank = await prisma.station.create({
    data: { name: 'Schank', shortName: 'SCH', eventId: event.id }
  });
  const kueche = await prisma.station.create({
    data: { name: 'Küche', shortName: 'KUE', eventId: event.id }
  });
  console.log(`Stationen erstellt: Schank, Küche`);

  // Create Categories
  const catGetraenke = await prisma.productCategory.create({
    data: { name: 'Getränke', sortOrder: 1, eventId: event.id }
  });
  const catSpeisen = await prisma.productCategory.create({
    data: { name: 'Speisen', sortOrder: 2, eventId: event.id }
  });
  console.log(`Kategorien erstellt: Getränke, Speisen`);

  // Create Products
  await prisma.product.createMany({
    data: [
      {
        name: 'Bier vom Fass',
        shortName: 'Bier',
        price: 450, // 4.50 EUR
        categoryId: catGetraenke.id,
        targetStationId: schank.id,
        eventId: event.id,
        sortOrder: 1,
      },
      {
        name: 'Cola',
        price: 350, // 3.50 EUR
        categoryId: catGetraenke.id,
        targetStationId: schank.id,
        eventId: event.id,
        sortOrder: 2,
      },
      {
        name: 'Wienerschnitzel mit Pommes',
        shortName: 'Schnitzel',
        price: 1200, // 12.00 EUR
        categoryId: catSpeisen.id,
        targetStationId: kueche.id,
        eventId: event.id,
        sortOrder: 1,
      },
      {
        name: 'Pommes Frites',
        shortName: 'Pommes',
        price: 450, // 4.50 EUR
        categoryId: catSpeisen.id,
        targetStationId: kueche.id,
        eventId: event.id,
        sortOrder: 2,
      }
    ]
  });
  console.log(`Test-Produkte erstellt.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
