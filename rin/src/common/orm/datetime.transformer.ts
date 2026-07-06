import { ValueTransformer } from 'typeorm';

/**
 * Stores a `Date` as an ISO-8601 string in a `varchar` column. This keeps
 * custom timestamp columns byte-identical across Postgres and SQLite (the
 * native `datetime`/`timestamp` types differ per driver), and ISO strings
 * still sort chronologically. `CreateDateColumn` is left to TypeORM, which
 * already picks the right native type per driver.
 */
export const DateTimeTransformer: ValueTransformer = {
  to: (value?: Date | null): string | null =>
    value instanceof Date ? value.toISOString() : (value ?? null),
  from: (value?: string | null): Date | null => (value ? new Date(value) : null),
};
