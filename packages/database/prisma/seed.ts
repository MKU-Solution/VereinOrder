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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
