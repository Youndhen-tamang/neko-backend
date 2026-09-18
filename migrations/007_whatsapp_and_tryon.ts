import type { Knex } from "knex";

/** Already applied in the database; kept so Knex can validate migration history. */
export async function up(_knex: Knex): Promise<void> {}

export async function down(_knex: Knex): Promise<void> {}
