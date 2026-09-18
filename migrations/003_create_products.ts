import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("products", (table) => {
    table.uuid("id").primary();
    table
      .uuid("agency_id")
      .notNullable()
      .references("id")
      .inTable("agencies")
      .onDelete("CASCADE");
    table.string("name").notNullable();
    table.text("description");
    table.string("category");
    table.jsonb("tags").notNullable().defaultTo("[]");
    table.jsonb("images").notNullable().defaultTo("[]");
    table.integer("price_cents").notNullable().defaultTo(0);
    table.string("currency").notNullable().defaultTo("usd");
    table.integer("stock").notNullable().defaultTo(0);
    table.integer("low_stock_threshold").notNullable().defaultTo(5);
    table.string("status").notNullable().defaultTo("draft");
    table.jsonb("ai_draft");
    table.timestamps(true, true);
    table.index(["agency_id", "status"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("products");
}
