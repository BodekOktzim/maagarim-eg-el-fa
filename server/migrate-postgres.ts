import { PostgresRepository } from "./postgres";

async function main() {
  const repository = new PostgresRepository();
  try { await repository.migrate(); console.log("PostgreSQL migrations applied"); } finally { await repository.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
