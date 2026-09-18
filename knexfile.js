require("ts-node/register");
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

/** @type {import('knex').Knex.Config} */
module.exports = {
  client: "pg",
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: "./migrations",
    extension: "ts",
    loadExtensions: [".ts"],
  },
};
