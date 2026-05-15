import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 chars'),
  SESSION_COOKIE_NAME: z.string().default('torii_sess'),
  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
  AUTH_PROVIDERS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ALLOWED_EMAIL_DOMAINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z.string().default(''),
  OKTA_ISSUER: z.string().default(''),
  OKTA_CLIENT_ID: z.string().default(''),
  OKTA_CLIENT_SECRET: z.string().default(''),
  OKTA_REDIRECT_URI: z.string().default(''),
  MONDAY_CLIENT_ID: z.string().default(''),
  MONDAY_CLIENT_SECRET: z.string().default(''),
  MONDAY_REDIRECT_URI: z.string().default(''),
  TRACKER_TOKEN_KEY: z.string().default(''),
  ENABLE_SYNC_CRON: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return EnvSchema.parse(source);
}
