import { app } from "./app";
import { env } from "./config/env";
import { db } from "./db/knex";

async function start() {
  await db.raw("select 1");
  app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start API", error);
  process.exit(1);
});
