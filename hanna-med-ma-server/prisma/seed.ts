import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.warn('🗑️  Cleaning database...');
  await prisma.doctor.deleteMany({});
  await prisma.user.deleteMany({});

  console.warn('👤 Creating admin user...');

  // Create admin user
  const hashedPassword = await bcrypt.hash('Admin123!', 10);

  const adminUser = await prisma.user.create({
    data: {
      name: 'admin',
      rol: 'admin',
      username: 'admin',
      password: hashedPassword,
      email: 'admin@axiasmedia.com',
    },
  });

  console.warn(`✅ Admin user created: ${adminUser.username}`);

  console.warn('🏥 Creating doctor...');

  /* Create doctor with hashed password
  const doctorPassword = await bcrypt.hash('Doctor123!', 10);

  const doctor = await prisma.doctor.create({
    data: {
      name: 'Dr. Jhon',
      username: 'dr.jhon',
      password: doctorPassword,
    },
  });

  console.warn(`✅ Doctor created: ${doctor.name}`);
  */

  console.warn('🎉 Seed completed successfully!');
  console.warn('\n📝 Login credentials:');
  console.warn('   Admin - username: admin, password: Admin123!');
  console.warn('   Email: admin@axiasmedia.com');
  console.warn('   Doctor - username: dr.jhon, password: Doctor123!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.warn('📡 Connection closed');
  });
