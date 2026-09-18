import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("orders", (table) => {
    table.uuid("id").primary();
    table
      .uuid("agency_id")
      .notNullable()
      .references("id")
      .inTable("agencies")
      .onDelete("CASCADE");
    table.string("invoice_number").notNullable().unique();
    table.string("status").notNullable().defaultTo("lead");
    table.string("customer_name").notNullable();
    table.string("customer_email").notNullable();
    table.string("customer_phone");
    table.text("shipping_address");
    table.integer("subtotal_cents").notNullable().defaultTo(0);
    table.integer("total_cents").notNullable().defaultTo(0);
    table.string("currency").notNullable().defaultTo("usd");
    table.string("stripe_checkout_session_id");
    table.string("stripe_payment_intent_id");
    table.boolean("email_sent").notNullable().defaultTo(false);
    table.timestamps(true, true);
    table.index(["agency_id", "status"]);
  });

  await knex.schema.createTable("order_items", (table) => {
    table.uuid("id").primary();
    table
      .uuid("order_id")
      .notNullable()
      .references("id")
      .inTable("orders")
      .onDelete("CASCADE");
    table.uuid("product_id");
    table.string("name").notNullable();
    table.integer("quantity").notNullable();
    table.integer("unit_price_cents").notNullable();
    table.text("image_url");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("order_items");
  await knex.schema.dropTableIfExists("orders");
}
