import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { seed } from './seed-data';

/**
 * Standalone seeder — run against a persistent DB (Postgres, or a SQLite file):
 *   DB_DRIVER=postgres npm run seed
 * Prints the merchant client credentials and the demo customer login so you can
 * drive the API from /docs or curl.
 */
async function main() {
  const log = new Logger('seed');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const result = await seed(app);
    log.log('Seeded successfully.');
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    log.log('Merchant token:  POST /oauth/token { grant_type: client_credentials, client_id, client_secret }');
    log.log('Consumer token:  POST /v1/auth/login { email, password }');
  } catch (err) {
    log.error(`Seed failed: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main();
