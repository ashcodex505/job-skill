import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: `file:${process.env.DATABASE_PATH ?? "./data/resume-tracker.db"}`,
  },
});
