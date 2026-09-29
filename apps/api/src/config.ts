import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  /** Connection as the application role (simorgh_app): no owner rights, no BYPASSRLS. */
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('simorgh-erp'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('simorgh'),
  S3_ACCESS_KEY: z.string().default('simorgh'),
  S3_SECRET_KEY: z.string().default('simorgh-dev-secret'),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
  UPLOAD_URL_TTL_SEC: z.coerce.number().int().positive().default(900),
});

export type Config = z.infer<typeof Env>;
export const CONFIG = Symbol('CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`invalid configuration:\n${lines}`);
  }
  return parsed.data;
}
