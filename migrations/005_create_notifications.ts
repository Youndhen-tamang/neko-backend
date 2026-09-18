import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("notifications", (table) => {
    table.uuid("id").primary();
    table
      .uuid("agency_id")
      .notNullable()
      .references("id")
      .inTable("agencies")
      .onDelete("CASCADE");
    table.string("type").notNullable();
    table.string("title").notNullable();
    table.text("body").notNullable();
    table.boolean("read").notNullable().defaultTo(false);
    table.jsonb("meta");
    table.timestamps(true, true);
    table.index(["agency_id", "read"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("notifications");
}
