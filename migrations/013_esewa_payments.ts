import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("esewa_payments", (table) => {
    // Primary key doubles as the eSewa transaction_uuid.
    table.uuid("id").primary();
    table
      .uuid("agency_id")
      .notNullable()
      .references("id")
      .inTable("agencies")
      .onDelete("CASCADE");
    table.integer("amount_cents").notNullable();
    // pending | processing | complete | failed
    table.string("status").notNullable().defaultTo("pending");
    table.string("ref_id");
    table.uuid("order_id");
    table.jsonb("payload").notNullable();
    table.timestamps(true, true);
    table.index(["agency_id", "status"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("esewa_payments");
}
