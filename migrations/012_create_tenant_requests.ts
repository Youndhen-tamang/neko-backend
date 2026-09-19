import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("tenant_requests", (table) => {
    table.uuid("id").primary();
    table.string("name").notNullable();
    table.string("slug").notNullable();
    table.string("brand_name").notNullable();
    table.string("email");
    table.string("phone");
    table.text("address");
    table.text("tagline");
    table.string("admin_name").notNullable();
    table.string("admin_email").notNullable();
    table.text("message");
    table.string("status").notNullable().defaultTo("pending");
    table.timestamps(true, true);
    table.index(["status", "created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("tenant_requests");
}
