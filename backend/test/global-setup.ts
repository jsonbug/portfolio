import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// DATABASE_URL=`file:./test.db` 相对 schema.prisma 所在目录解析 → prisma/test.db
const testDbPath = resolve(backendDir, "prisma", "test.db");

// 每次测试运行前删除测试库，再用 migrate deploy 从头跑完整迁移链
// （不再用 db push：迁移脚本本身必须被测，包括 v1.2 的数据迁移）
export default function globalSetup(): void {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(`${testDbPath}${suffix}`, { force: true });
  }
  execSync("npx prisma migrate deploy", {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "inherit",
  });
}
