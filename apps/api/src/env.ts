import { z } from 'zod';

const csvList = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const boolFlag = (v: string): boolean => v === 'true' || v === '1';

const EnvSchema = z
  .object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().default(3001),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 chars'),
    SESSION_COOKIE_NAME: z.string().default('torii_sess'),
    WEB_BASE_URL: z.string().url().default('http://localhost:3000'),

    ALLOWED_EMAIL_DOMAINS: z.string().default('').transform(csvList),
    ADMIN_EMAILS: z.string().default('').transform(csvList),

    // Keycloak (the sole IdP; Google is federated upstream inside the realm).
    KEYCLOAK_ISSUER: z.string().default(''),
    KEYCLOAK_CLIENT_ID: z.string().default(''),
    KEYCLOAK_CLIENT_SECRET: z.string().default(''),
    KEYCLOAK_REDIRECT_URI: z.string().default(''),

    // Dev-only synthetic admin session. MUST be false in production.
    ENABLE_PREVIEW_ADMIN_BYPASS: z.string().default('false').transform(boolFlag),

    MONDAY_CLIENT_ID: z.string().default(''),
    MONDAY_CLIENT_SECRET: z.string().default(''),
    MONDAY_REDIRECT_URI: z.string().default(''),

    HARVEST_CLIENT_ID: z.string().default(''),
    HARVEST_CLIENT_SECRET: z.string().default(''),
    HARVEST_REDIRECT_URI: z.string().default(''),

    TRACKER_TOKEN_KEY: z.string().default(''),
    ENABLE_SYNC_CRON: z.string().default('false').transform(boolFlag),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.KEYCLOAK_ISSUER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['KEYCLOAK_ISSUER'],
          message: 'KEYCLOAK_ISSUER is required in production',
        });
      }
      if (env.ENABLE_PREVIEW_ADMIN_BYPASS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ENABLE_PREVIEW_ADMIN_BYPASS'],
          message: 'ENABLE_PREVIEW_ADMIN_BYPASS must not be true in production',
        });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return EnvSchema.parse(source);
}
