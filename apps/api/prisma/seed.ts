import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    throw new Error('ADMIN_EMAIL is required to seed an initial admin Person');
  }

  const adminName = process.env.ADMIN_NAME ?? adminEmail.split('@')[0];

  const admin = await prisma.person.upsert({
    where: { email: adminEmail },
    update: { role: Role.PM, isAdmin: true },
    create: {
      email: adminEmail,
      name: adminName ?? adminEmail,
      role: Role.PM,
      isAdmin: true,
      defaultCapacityPct: 100,
    },
  });

  console.log(`Seeded admin Person: ${admin.email} (id=${admin.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
