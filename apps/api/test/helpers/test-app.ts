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
  AUTH_PROVIDERS: [],
  ALLOWED_EMAIL_DOMAINS: [],
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  GOOGLE_REDIRECT_URI: '',
  OKTA_ISSUER: '',
  OKTA_CLIENT_ID: '',
  OKTA_CLIENT_SECRET: '',
  OKTA_REDIRECT_URI: '',
  MONDAY_CLIENT_ID: '',
  MONDAY_CLIENT_SECRET: '',
  MONDAY_REDIRECT_URI: '',
  TRACKER_TOKEN_KEY: '0'.repeat(64),
  ENABLE_SYNC_CRON: false,
};

export function buildTestApp(db: Partial<DB>, envOverride: Partial<Env> = {}) {
  return buildApp({
    logger: false,
    db: db as DB,
    env: { ...baseEnv, ...envOverride },
  });
}

export const testEnv = baseEnv;
