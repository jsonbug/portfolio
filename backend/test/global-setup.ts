import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 每次测试运行前，把 schema 推到独立的 test.db（先清空）
export default function globalSetup(): void {
  execSync("npx prisma db push --skip-generate --force-reset --accept-data-loss", {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "inherit",
  });
}
