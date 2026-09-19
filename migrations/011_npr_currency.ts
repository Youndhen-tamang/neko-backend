import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE products ALTER COLUMN currency SET DEFAULT 'npr'`);
  await knex.raw(`ALTER TABLE orders ALTER COLUMN currency SET DEFAULT 'npr'`);
  await knex("products").where({ currency: "usd" }).update({ currency: "npr" });
  await knex("orders").where({ currency: "usd" }).update({ currency: "npr" });
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE products ALTER COLUMN currency SET DEFAULT 'usd'`);
  await knex.raw(`ALTER TABLE orders ALTER COLUMN currency SET DEFAULT 'usd'`);
}
