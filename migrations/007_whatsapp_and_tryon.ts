import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("agency_integrations", (table) => {
    table.uuid("id").primary();
    table
      .uuid("agency_id")
      .notNullable()
      .references("id")
      .inTable("agencies")
      .onDelete("CASCADE");
    table.string("provider").notNullable();
    table.boolean("enabled").notNullable().defaultTo(false);
    table.string("phone_number_id").unique();
    table.string("waba_id");
    table.string("display_phone");
    table.text("access_token_enc");
    table.string("access_token_last4");
    table.jsonb("meta");
    table.timestamps(true, true);
    table.unique(["agency_id", "provider"]);
  });

  await knex.schema.createTable("wa_conversations", (table) => {
    table.uuid("id").primary();
    table
      .uuid("agency_id")
      .notNullable()
      .references("id")
      .inTable("agencies")
      .onDelete("CASCADE");
    table.string("wa_user").notNullable();
    table.string("profile_name");
    table.string("checkout_session_id");
    table.timestamp("last_inbound_at");
    table.timestamp("last_outbound_at");
    table.timestamps(true, true);
    table.unique(["agency_id", "wa_user"]);
  });

  await knex.schema.createTable("wa_messages", (table) => {
    table.uuid("id").primary();
    table
      .uuid("conversation_id")
      .notNullable()
      .references("id")
      .inTable("wa_conversations")
      .onDelete("CASCADE");
    table
      .uuid("agency_id")
      .notNullable()
      .references("id")
      .inTable("agencies")
      .onDelete("CASCADE");
    table.string("direction").notNullable();
    table.string("wa_message_id").unique();
    table.string("type").notNullable().defaultTo("text");
    table.text("text");
    table.text("media_url");
    table.jsonb("meta");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["conversation_id", "created_at"]);
  });

  await knex.schema.createTable("tryon_sessions", (table) => {
    table.uuid("id").primary();
    table
      .uuid("agency_id")
      .notNullable()
      .references("id")
      .inTable("agencies")
      .onDelete("CASCADE");
    table.uuid("product_id").references("id").inTable("products").onDelete("SET NULL");
    table.string("channel").notNullable().defaultTo("web");
    table.string("phone");
    table.string("ip");
    table.text("input_photo_url").notNullable();
    table.integer("height_cm");
    table.integer("weight_kg");
    table.string("size_hint");
    table.text("result_url");
    table.string("status").notNullable().defaultTo("pending");
    table.text("error");
    table.string("model");
    table.timestamps(true, true);
    table.index(["agency_id", "created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("tryon_sessions");
  await knex.schema.dropTableIfExists("wa_messages");
  await knex.schema.dropTableIfExists("wa_conversations");
  await knex.schema.dropTableIfExists("agency_integrations");
}
