import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "expo",
  schema: "./src/db/schema/schema.ts",
  out: "./src/db/migrations",
});
