// Creates (or promotes) the first Simorgh platform administrator.
//   PLATFORM_ADMIN_EMAIL=… PLATFORM_ADMIN_PASSWORD=… pnpm --filter @simorgh/api seed:platform-admin
import { hash } from '@node-rs/argon2';
import { createDb, createPool, inPlatform, users } from '@simorgh/db';
import { eq } from 'drizzle-orm';

const url = process.env.DATABASE_URL;
const email = process.env.PLATFORM_ADMIN_EMAIL;
const password = process.env.PLATFORM_ADMIN_PASSWORD;
if (!url || !email || !password || password.length < 10) {
  console.error('Need DATABASE_URL, PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD (10+ characters).');
  process.exit(1);
}

const pool = createPool(url, 1);
const db = createDb(pool);
const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
await inPlatform(db, null, async (tx) => {
  const [existing] = await tx.select().from(users).where(eq(users.email, email));
  if (existing) {
    await tx.update(users).set({ isPlatformAdmin: true, passwordHash, isActive: true }).where(eq(users.id, existing.id));
    console.log(`promoted ${email} to platform administrator`);
  } else {
    await tx.insert(users).values({ email, displayName: 'Simorgh Admin', passwordHash, isPlatformAdmin: true });
    console.log(`created platform administrator ${email}`);
  }
});
await pool.end();
