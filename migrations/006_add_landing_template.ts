import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("agencies", (table) => {
    table.string("landing_template").notNullable().defaultTo("atelier");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("agencies", (table) => {
    table.dropColumn("landing_template");
  });
}
