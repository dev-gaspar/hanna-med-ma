import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const e = await prisma.encounter.findUnique({ where: { id: 28 } });
  console.log(JSON.stringify(e, null, 2));
  await prisma.$disconnect();
})();
