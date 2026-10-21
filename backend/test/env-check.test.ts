// 启动期配置校验：坏配置必须在启动时失败，而不是表现为「登录永远 401」。
import { describe, expect, it } from "vitest";
import {
  ALLOW_WEAK_SECRET_ENV,
  DEV_PLACEHOLDER_SECRET,
  checkSecrets,
  formatIssues,
  formatIssuesWarning,
  loginConfigHint,
  resolveSecretPolicy,
} from "../src/lib/env-check.js";

const GOOD_HASH =
  "scrypt$0c018e1a47e4503e5f8b52c79cb7f7f9$6286fb06632109c6e98a2f5e2b3799290883f88ae4a17db8c35a6606a8e2fdb6dc330f7631437a77660a1a9fcf63993f54d55d5c6391f5919f17cdb8767198db";
const GOOD_SECRET = "x".repeat(48);

const names = (issues: ReturnType<typeof checkSecrets>) => issues.map((i) => i.name);

describe("checkSecrets", () => {
  it("生产：合法配置零问题", () => {
    expect(checkSecrets({ authSecret: GOOD_SECRET, adminPasswordHash: GOOD_HASH }, "production")).toEqual([]);
  });

  it("生产：AUTH_SECRET 过短被拒（边界 31/32）", () => {
    expect(names(checkSecrets({ authSecret: "x".repeat(31), adminPasswordHash: GOOD_HASH }, "production"))).toContain(
      "AUTH_SECRET",
    );
    expect(
      names(checkSecrets({ authSecret: "x".repeat(32), adminPasswordHash: GOOD_HASH }, "production")),
    ).not.toContain("AUTH_SECRET");
  });

  it("生产：AUTH_SECRET 用开发占位串被拒", () => {
    const issues = checkSecrets({ authSecret: DEV_PLACEHOLDER_SECRET, adminPasswordHash: GOOD_HASH }, "production");
    expect(names(issues)).toEqual(["AUTH_SECRET"]);
    expect(issues[0].problem).toContain("占位串");
  });

  it("生产：AUTH_TTL_SECONDS 非正整数被拒", () => {
    for (const ttl of [0, -1, 12.5, Number.NaN]) {
      expect(
        names(checkSecrets({ authSecret: GOOD_SECRET, adminPasswordHash: GOOD_HASH, authTtlSeconds: ttl }, "production")),
      ).toContain("AUTH_TTL_SECONDS");
    }
    expect(
      names(
        checkSecrets({ authSecret: GOOD_SECRET, adminPasswordHash: GOOD_HASH, authTtlSeconds: 604800 }, "production"),
      ),
    ).not.toContain("AUTH_TTL_SECONDS");
  });

  it("口令摘要被 compose 插值吃掉（$ 后半段丢失）时被拒", () => {
    // 真实事故形态：scrypt$<salt>$<hash> 里的 $<hash> 被替换成空串
    const mangled = "scrypt$0c018e1a47e4503e5f8b52c79cb7f7f9$";
    const issues = checkSecrets({ authSecret: GOOD_SECRET, adminPasswordHash: mangled }, "production");
    expect(names(issues)).toEqual(["ADMIN_PASSWORD_HASH"]);
    expect(issues[0].hint).toContain("format: raw");
  });

  it("口令摘要格式错（前缀/长度/非十六进制）被拒", () => {
    for (const bad of ["", "plain-text", "bcrypt$aa$bb", "scrypt$aa$bb", `scrypt$${"ab".repeat(32)}`, `scrypt$${"zz".repeat(16)}$${"ab".repeat(32)}`]) {
      expect(names(checkSecrets({ authSecret: GOOD_SECRET, adminPasswordHash: bad }, "production"))).toContain(
        "ADMIN_PASSWORD_HASH",
      );
    }
  });

  it("test 环境放宽密钥长度，但口令摘要格式仍校验", () => {
    expect(checkSecrets({ authSecret: "test-secret", adminPasswordHash: GOOD_HASH }, "test")).toEqual([]);
    expect(names(checkSecrets({ authSecret: "test-secret", adminPasswordHash: "bad" }, "test"))).toEqual([
      "ADMIN_PASSWORD_HASH",
    ]);
  });

  it("一次报出所有问题，并带可操作提示", () => {
    const text = formatIssues(checkSecrets({ authSecret: "short", adminPasswordHash: "bad" }, "production"));
    expect(text).toContain("[env] 生产配置校验失败");
    expect(text).toContain("AUTH_SECRET");
    expect(text).toContain("ADMIN_PASSWORD_HASH");
    expect(text).toContain("openssl rand -base64 48");
  });
});

describe("resolveSecretPolicy：同一套校验，不同环境不同后果", () => {
  const issue = [{ name: "AUTH_SECRET", problem: "太短", hint: "openssl rand -base64 48" }];

  it("生产 + 有问题 + 无逃逸开关 → 拒绝启动", () => {
    expect(resolveSecretPolicy(1, "production", false)).toBe("throw");
  });

  it("生产 + 显式 ALLOW_WEAK_SECRET=1 → 降级为 warn（开关必须留痕）", () => {
    expect(resolveSecretPolicy(1, "production", true)).toBe("warn");
  });

  it("非生产（development / test）→ warn，不打死本地开发与 CI", () => {
    expect(resolveSecretPolicy(1, "development", false)).toBe("warn");
    expect(resolveSecretPolicy(1, "test", false)).toBe("warn");
  });

  it("没有问题 → ok（任何环境）", () => {
    for (const env of ["production", "development", "test"]) {
      expect(resolveSecretPolicy(0, env, false)).toBe("ok");
    }
  });

  it("告警文案含逐项原因与「生产会拒绝启动」提示", () => {
    const text = formatIssuesWarning(issue, "development");
    expect(text).toContain("不阻止启动");
    expect(text).toContain("AUTH_SECRET");
    expect(text).toContain("生产环境");
    const prod = formatIssuesWarning(issue, "production", true);
    expect(prod).toContain(ALLOW_WEAK_SECRET_ENV);
    expect(prod).toContain("放行");
  });

  it("登录接口的附加提示：只在配置有问题时给，且点名是哪几个变量", () => {
    expect(loginConfigHint([])).toBeNull();
    const hint = loginConfigHint(issue.concat([{ name: "ADMIN_PASSWORD_HASH", problem: "格式错", hint: "重新生成" }]));
    expect(hint).toContain("AUTH_SECRET");
    expect(hint).toContain("ADMIN_PASSWORD_HASH");
    expect(hint).toContain("启动日志");
  });
});
