import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "./index";

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
