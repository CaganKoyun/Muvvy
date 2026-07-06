/**
 * Central typed configuration, loaded once at boot from environment variables.
 * Defaults are tuned so `npm run demo` / tests work with zero setup (SQLite).
 */
export interface AppConfig {
  env: string;
  port: number;
  db: DbConfig;
  jwt: JwtConfig;
  webhook: WebhookConfig;
}

export interface DbConfig {
  driver: 'postgres' | 'sqlite';
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  sqlitePath: string;
  synchronize: boolean;
}

export interface JwtConfig {
  secret: string;
  consumerTtl: number;
  merchantTtl: number;
  identityRequestTtl: number;
}

export interface WebhookConfig {
  timeoutMs: number;
  maxAttempts: number;
}

const int = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : fallback;
};

const bool = (v: string | undefined, fallback: boolean): boolean =>
  v === undefined ? fallback : v === 'true' || v === '1';

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 3000),
  db: {
    driver: (process.env.DB_DRIVER as DbConfig['driver']) ?? 'sqlite',
    host: process.env.DB_HOST ?? 'localhost',
    port: int(process.env.DB_PORT, 5432),
    username: process.env.DB_USERNAME ?? 'rin',
    password: process.env.DB_PASSWORD ?? 'rin',
    database: process.env.DB_DATABASE ?? 'rin',
    sqlitePath: process.env.DB_SQLITE_PATH ?? ':memory:',
    synchronize: bool(process.env.DB_SYNCHRONIZE, true),
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-only-change-me-in-production',
    consumerTtl: int(process.env.CONSUMER_TOKEN_TTL, 3600),
    merchantTtl: int(process.env.MERCHANT_TOKEN_TTL, 3600),
    identityRequestTtl: int(process.env.IDENTITY_REQUEST_TTL, 300),
  },
  webhook: {
    timeoutMs: int(process.env.WEBHOOK_TIMEOUT_MS, 5000),
    maxAttempts: int(process.env.WEBHOOK_MAX_ATTEMPTS, 5),
  },
});
