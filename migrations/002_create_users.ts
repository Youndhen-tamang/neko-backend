import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("users", (table) => {
    table.uuid("id").primary();
    table
      .uuid("agency_id")
      .notNullable()
      .references("id")
      .inTable("agencies")
      .onDelete("CASCADE");
    table.string("email").notNullable();
    table.string("password_hash").notNullable();
    table.string("name").notNullable();
    table.string("role").notNullable().defaultTo("agency_admin");
    table.timestamps(true, true);
    table.unique(["agency_id", "email"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("users");
}
