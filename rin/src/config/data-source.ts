import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DbConfig } from './configuration';

/**
 * Build TypeORM options from config. The entity model is written to be
 * portable across both drivers (uuid PKs generated in-app, `simple-array`
 * instead of native array/jsonb), so the exact same code runs on Postgres
 * (production) and SQLite (demo/CI) without change.
 */
export function buildTypeOrmOptions(db: DbConfig): TypeOrmModuleOptions {
  const common = {
    autoLoadEntities: true,
    synchronize: db.synchronize,
  };

  if (db.driver === 'sqlite') {
    return {
      type: 'better-sqlite3',
      database: db.sqlitePath,
      ...common,
    } as TypeOrmModuleOptions;
  }

  return {
    type: 'postgres',
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database: db.database,
    ...common,
  } as TypeOrmModuleOptions;
}
