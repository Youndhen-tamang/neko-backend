import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("agencies", (table) => {
    table.uuid("id").primary();
    table.string("name").notNullable();
    table.string("slug").notNullable().unique();
    table.string("brand_name").notNullable();
    table.text("logo_url");
    table.string("primary_color").notNullable().defaultTo("#1f6b4a");
    table.string("email");
    table.string("phone");
    table.text("address");
    table.text("tagline");
    table.string("status").notNullable().defaultTo("active");
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("agencies");
}
