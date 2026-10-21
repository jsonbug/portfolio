// 环境变量加载：用 Node 内置 loadEnvFile，零第三方依赖（Node ≥ 20.12）
// 注意：loadEnvFile 不会覆盖 process.env 中已存在的变量（测试可在导入前预设）。
import { loadEnvFile } from "node:process";
import { checkSecrets, formatIssues } from "./lib/env-check.js";

try {
  loadEnvFile();
} catch {
  // .env 不存在时忽略（生产环境由部署平台注入环境变量）
}

const nodeEnv = process.env.NODE_ENV ?? "development";

function required(name: string, fallback?: string): string {
  const v = process.env[name];
  if (!v) {
    if (fallback !== undefined) {
      if (nodeEnv !== "test") {
        console.warn(`[env] 未设置 ${name}，使用默认值（生产环境请显式配置）`);
      }
      return fallback;
    }
    throw new Error(`缺少必需环境变量 ${name}`);
  }
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  nodeEnv,

  // 认证（2.1 登录）
  authSecret: required(
    "AUTH_SECRET",
    nodeEnv === "production" ? undefined : "dev-only-insecure-secret-change-me",
  ),
  authTtlSeconds: Number(process.env.AUTH_TTL_SECONDS ?? 7 * 24 * 3600),
  adminUsername: required("ADMIN_USERNAME", "admin"),
  adminPasswordHash: required(
    "ADMIN_PASSWORD_HASH",
    nodeEnv === "production"
      ? undefined
      : // dev-only 默认口令 hash（scrypt 对 "admin123"），生产必须显式设置
        "scrypt$0c018e1a47e4503e5f8b52c79cb7f7f9$6286fb06632109c6e98a2f5e2b3799290883f88ae4a17db8c35a6606a8e2fdb6dc330f7631437a77660a1a9fcf63993f54d55d5c6391f5919f17cdb8767198db",
  ),
};

// 启动期校验：配置缺失由 required() 兜，配置填坏（短密钥、被插值吃掉的口令摘要）在这里兜。
// 宁可起不来，也不要带着会一直 401 的配置对外服务。
const issues = checkSecrets(
  { authSecret: env.authSecret, adminPasswordHash: env.adminPasswordHash, authTtlSeconds: env.authTtlSeconds },
  env.nodeEnv,
);
if (issues.length > 0) {
  throw new Error(formatIssues(issues));
}
