import { sql } from 'kysely';

export const trimmed = (column: string) =>
  sql`${sql.ref(column)} = btrim(${sql.ref(column)}) and ${sql.ref(column)} <> ''`;

export const oneOf = (column: string, values: readonly string[]) =>
  sql`${sql.ref(column)} in (${sql.join(values.map((v) => sql.lit(v)))})`;

export const normalizedEmail = (column: string) =>
  sql`${sql.ref(column)} = lower(btrim(${sql.ref(column)})) and ${sql.ref(column)} <> ''`;
