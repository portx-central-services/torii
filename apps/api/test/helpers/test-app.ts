import type { Env } from '../../src/env.js';
import type { DB } from '../../src/db.js';
import { buildApp } from '../../src/app.js';

const baseEnv: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  SESSION_SECRET: 'test-test-test-test-test-test-test',
  SESSION_COOKIE_NAME: 'torii_sess',
  WEB_BASE_URL: 'http://localhost:3000',
  ALLOWED_EMAIL_DOMAINS: [],
  ADMIN_EMAILS: [],
  KEYCLOAK_ISSUER: '',
  KEYCLOAK_CLIENT_ID: '',
  KEYCLOAK_CLIENT_SECRET: '',
  KEYCLOAK_REDIRECT_URI: '',
  ENABLE_PREVIEW_ADMIN_BYPASS: false,
  MONDAY_CLIENT_ID: '',
  MONDAY_CLIENT_SECRET: '',
  MONDAY_REDIRECT_URI: '',
  HARVEST_CLIENT_ID: '',
  HARVEST_CLIENT_SECRET: '',
  HARVEST_REDIRECT_URI: '',
  TRACKER_TOKEN_KEY: '0'.repeat(64),
  ENABLE_SYNC_CRON: false,
  ANTHROPIC_API_KEY: '',
  INSIGHTS_CHAT_MODEL: 'claude-sonnet-4-6',
};

export function buildTestApp(db: Partial<DB>, envOverride: Partial<Env> = {}) {
  return buildApp({
    logger: false,
    db: db as DB,
    env: { ...baseEnv, ...envOverride },
  });
}

export const testEnv = baseEnv;
