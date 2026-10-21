// 启动期的生产配置校验（纯函数，便于单测）。
//
// 为什么需要：.env 里最容易出错的不是「漏填」，而是「填了但填坏」——
// 典型是 ADMIN_PASSWORD_HASH 被 compose 的变量插值吃掉 `$<hash>` 段（见
// docs/deployment.md §9），或者 AUTH_SECRET 直接用了短串/占位串。
// 这两种情况服务都能正常起来，但表现为「登录永远 401」或弱签名密钥，
// 排查成本很高。启动时直接失败并给出可操作的提示，比带着坏配置跑强。

/** 与 hash-password.mjs / lib/auth.ts 一致的格式：scrypt$<saltHex>$<hashHex> */
const PASSWORD_HASH_RE = /^scrypt\$[0-9a-f]{16,}\$[0-9a-f]{64,}$/;

/** dev 默认占位密钥（env.ts 里的 fallback），生产出现即为配置事故 */
export const DEV_PLACEHOLDER_SECRET = "dev-only-insecure-secret-change-me";

const MIN_SECRET_LENGTH = 32;

export interface SecretInput {
  authSecret?: string;
  adminPasswordHash?: string;
  authTtlSeconds?: number;
}

export interface EnvIssue {
  name: string;
  problem: string;
  hint: string;
}

/**
 * 校验配置值。`nodeEnv === "test"` 时放宽密钥长度（测试用短串），
 * 但口令摘要格式仍然校验（格式错了测试也该报出来）。
 */
export function checkSecrets(input: SecretInput, nodeEnv: string): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const isProd = nodeEnv === "production";

  if (isProd) {
    const secret = input.authSecret ?? "";
    if (secret === DEV_PLACEHOLDER_SECRET) {
      issues.push({
        name: "AUTH_SECRET",
        problem: "用的是开发占位串，生产环境禁止",
        hint: "openssl rand -base64 48 生成后写入 .env",
      });
    } else if (Buffer.byteLength(secret, "utf8") < MIN_SECRET_LENGTH) {
      issues.push({
        name: "AUTH_SECRET",
        problem: `太短（当前 ${Buffer.byteLength(secret, "utf8")} 字节，至少 ${MIN_SECRET_LENGTH}）`,
        hint: "openssl rand -base64 48 生成后写入 .env",
      });
    }

    if (input.authTtlSeconds !== undefined && !(Number.isInteger(input.authTtlSeconds) && input.authTtlSeconds > 0)) {
      issues.push({
        name: "AUTH_TTL_SECONDS",
        problem: `不是正整数（当前 ${String(input.authTtlSeconds)}）`,
        hint: "留空用默认 7 天，或填秒数，如 604800",
      });
    }
  }

  const hash = input.adminPasswordHash ?? "";
  if (!PASSWORD_HASH_RE.test(hash)) {
    issues.push({
      name: "ADMIN_PASSWORD_HASH",
      problem: "不是 scrypt$<salt>$<hash> 格式（常见原因：compose 把 `$` 后面的段插值吃掉了，或粘贴不完整）",
      hint: "node backend/scripts/hash-password.mjs '你的口令' 重新生成并整行粘贴；compose 的 env_file 必须保留 format: raw",
    });
  }

  return issues;
}

/** 把问题列表拼成一条可直接放进启动日志的错误信息 */
export function formatIssues(issues: EnvIssue[]): string {
  const lines = issues.map((i) => `  · ${i.name}：${i.problem}；处理：${i.hint}`);
  return `[env] 生产配置校验失败，拒绝启动：\n${lines.join("\n")}`;
}

// ---------- 环境相关的处理策略 ----------

/** 显式逃逸开关（生产环境用）：`ALLOW_WEAK_SECRET=1` 时降级为 WARN，但仍会打日志 */
export const ALLOW_WEAK_SECRET_ENV = "ALLOW_WEAK_SECRET";

export type SecretPolicy = "ok" | "warn" | "throw";

/**
 * 同一套校验在不同环境下后果不同：
 * - `production`：配置有问题 = 必然「登录永远 401」或弱签名密钥 → 硬拒启动。
 *   唯一例外是显式给了 `ALLOW_WEAK_SECRET=1`（应急/临时环境），降级为 WARN 且必须打日志；
 * - 非生产（test / development）：只 WARN。CI 与本地开发用的都是短密钥/测试口令，
 *   一起打死的结果是「下一个人把校验关掉」，反而回到静默失败。
 */
export function resolveSecretPolicy(
  issueCount: number,
  nodeEnv: string,
  allowWeakSecret: boolean,
): SecretPolicy {
  if (issueCount === 0) return "ok";
  if (nodeEnv !== "production") return "warn";
  return allowWeakSecret ? "warn" : "throw";
}

/** 非生产 / 逃逸开关下的启动告警（比错误信息多一句「本次不阻止启动」） */
export function formatIssuesWarning(issues: EnvIssue[], nodeEnv: string, allowedByOverride = false): string {
  const lines = issues.map((i) => `  · ${i.name}：${i.problem}；处理：${i.hint}`);
  const head = allowedByOverride
    ? `[env] 配置校验未通过，但 ${ALLOW_WEAK_SECRET_ENV}=1 已显式放行（生产环境请尽快修复）：`
    : `[env] 配置校验未通过（NODE_ENV=${nodeEnv}，不阻止启动）：`;
  const tail = nodeEnv === "production" ? "" : "\n  生产环境（NODE_ENV=production）下同样的配置会直接拒绝启动。";
  return `${head}\n${lines.join("\n")}${tail}`;
}

/**
 * 登录失败时附在 message 后的可读提示：只在「配置确实有问题」且「不是生产」时给。
 * 不给的话，「口令摘要被 compose 插值吃掉」表现为「用户名或密码错了几十遍」，
 * 是这套系统里最难自查的故障。
 *
 * 生产环境**恒返回 null**：即使 `ALLOW_WEAK_SECRET=1` 显式放行（那里只打 WARN 日志），
 * 401 响应体也必须与基线（“用户名或密码错误”）字节一致——响应体是对外接口，
 * 启动日志只对运维可见，两者的读者和风险面不一样。
 */
export function loginConfigHint(issues: EnvIssue[], nodeEnv: string): string | null {
  if (nodeEnv === "production") return null;
  if (issues.length === 0) return null;
  return `（服务端配置校验未通过：${issues.map((i) => i.name).join("、")}，登录可能始终失败；见启动日志）`;
}
