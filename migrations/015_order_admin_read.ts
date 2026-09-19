import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders", (table) => {
    table.boolean("read").notNullable().defaultTo(false);
    table.index(["agency_id", "read"]);
  });

  // Existing orders have already been seen in the portal; only new ones should badge.
  await knex("orders").update({ read: true });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders", (table) => {
    table.dropIndex(["agency_id", "read"]);
    table.dropColumn("read");
  });
}
