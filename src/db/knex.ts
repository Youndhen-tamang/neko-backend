import knex, { Knex } from "knex";
import { env } from "../config/env";

export const db: Knex = knex({
  client: "pg",
  connection: env.databaseUrl,
});
