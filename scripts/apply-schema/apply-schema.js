// Applies supabase/schema.sql directly to the project's Postgres database,
// so schema changes don't require a manual paste into the Supabase SQL
// editor. schema.sql is written to be safe to re-run (every statement is
// "if not exists" / "or replace" / "drop ... if exists"), so running it
// again after it's already applied is a no-op.
//
// Usage: node apply-schema.js
// Requires SUPABASE_DB_URL to be set -- either in the environment already,
// or in a .env.local file at the repo root (SUPABASE_DB_URL=postgres://...).
"use strict";

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const repoRoot = path.resolve(__dirname, "..", "..");
loadEnvLocal(path.join(repoRoot, ".env.local"));

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("SUPABASE_DB_URL is not set. Add it to a .env.local file at the repo root, or export it before running this script.");
  process.exit(1);
}

const schemaPath = path.join(repoRoot, "supabase", "schema.sql");
const sql = fs.readFileSync(schemaPath, "utf8");

const client = new Client({ connectionString: dbUrl });

client.connect()
  .then(() => client.query(sql))
  .then(() => {
    console.log("supabase/schema.sql applied successfully.");
    return client.end();
  })
  .catch((err) => {
    console.error("Failed to apply schema.sql:", err.message);
    return client.end().finally(() => process.exit(1));
  });

function loadEnvLocal(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.indexOf("#") === 0) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  });
}
