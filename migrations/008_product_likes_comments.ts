import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("product_likes", (table) => {
    table.uuid("id").primary();
    table
      .uuid("agency_id")
      .notNullable()
      .references("id")
      .inTable("agencies")
      .onDelete("CASCADE");
    table
      .uuid("product_id")
      .notNullable()
      .references("id")
      .inTable("products")
      .onDelete("CASCADE");
    table.string("session_id").notNullable();
    table.timestamps(true, true);
    table.unique(["product_id", "session_id"]);
    table.index(["agency_id", "product_id"]);
  });

  await knex.schema.createTable("product_comments", (table) => {
    table.uuid("id").primary();
    table
      .uuid("agency_id")
      .notNullable()
      .references("id")
      .inTable("agencies")
      .onDelete("CASCADE");
    table
      .uuid("product_id")
      .notNullable()
      .references("id")
      .inTable("products")
      .onDelete("CASCADE");
    table
      .uuid("parent_id")
      .nullable()
      .references("id")
      .inTable("product_comments")
      .onDelete("CASCADE");
    table.string("session_id").notNullable();
    table.string("invoice_number").notNullable();
    table.string("author_name").notNullable();
    table.text("body").notNullable();
    table.timestamps(true, true);
    table.index(["product_id", "created_at"]);
    table.index(["agency_id", "created_at"]);
    table.index(["product_id", "session_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("product_comments");
  await knex.schema.dropTableIfExists("product_likes");
}
