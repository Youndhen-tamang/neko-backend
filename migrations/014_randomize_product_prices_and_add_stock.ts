import type { Knex } from "knex";

const BACKUP = "product_price_stock_backup_014";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable(BACKUP, (table) => {
    table.uuid("id").primary();
    table.integer("price_cents").notNullable();
    table.integer("stock").notNullable();
  });

  await knex.raw(`
    INSERT INTO ${BACKUP} (id, price_cents, stock)
    SELECT id, price_cents, stock FROM products
  `);

  // NPR 1,500–3,000 inclusive, stored as paisa in price_cents.
  await knex.raw(`
    UPDATE products
    SET
      price_cents = (1500 + floor(random() * 1501)::int) * 100,
      stock = stock + 5
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    UPDATE products AS p
    SET price_cents = b.price_cents, stock = b.stock
    FROM ${BACKUP} AS b
    WHERE p.id = b.id
  `);
  await knex.schema.dropTableIfExists(BACKUP);
}
