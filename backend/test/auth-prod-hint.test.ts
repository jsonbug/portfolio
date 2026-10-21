// 逃逸开关的真实后果：`NODE_ENV=production` + `ALLOW_WEAK_SECRET=1` + 弱 `AUTH_SECRET`
// → 服务**能起来**（策略降为 warn，启动日志留痕），于是「生产根本起不来，所以生产不可能
// 返回带提示的 401」这个论证是漏的：这里就是能返回的那个分支。
//
// 定论：401 响应体是**对外接口**，不得承载部署状态；变量名也不行（未认证的人能借此探测
// 服务端配置）。启动日志那行 WARN 才是给运维看的，必须照旧打。
//
// 这个文件的 env 用动态 import 建立：`backend/test/setup.ts` 默认 NODE_ENV=test，
// 而这里的全部意义就在 production 分支。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../src/lib/auth.js";

const BASELINE = "用户名或密码错误";

let app: FastifyInstance;
const warnings: string[] = [];

beforeAll(async () => {
  process.env.NODE_ENV = "production";
  process.env.AUTH_SECRET = "short"; // 32 字以下 → checkSecrets 报 AUTH_SECRET
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = hashPassword("admin123");
  process.env.ALLOW_WEAK_SECRET = "1"; // 显式逃逸：生产也不 throw，只 WARN

  const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  const { buildApp } = await import("../src/app.js");
  app = buildApp();
  spy.mockRestore();
});

afterAll(async () => {
  await app?.close();
  delete process.env.ALLOW_WEAK_SECRET;
  process.env.NODE_ENV = "test";
  process.env.AUTH_SECRET = "test-secret";
});

describe("production + ALLOW_WEAK_SECRET=1（能起来，但对外不汇报带病）", () => {
  it("启动日志留痕：WARN 里点名 AUTH_SECRET 与逃逸开关", () => {
    const line = warnings.join("\n");
    expect(line).toContain("AUTH_SECRET");
    expect(line).toContain("ALLOW_WEAK_SECRET=1");
    expect(line).toContain("显式放行");
  });

  it("未认证登录失败：401 message 与基线字节一致，不含配置信息", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "admin", password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBe(BASELINE);
    expect(body.error.message.length).toBe(BASELINE.length);
    expect(res.body).not.toContain("AUTH_SECRET");
    expect(res.body).not.toContain("配置校验");
  });

  it("未认证后台请求：401 只说缺令牌，同样不带配置信息", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/projects" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe("缺少认证令牌");
    expect(res.body).not.toContain("AUTH_SECRET");
  });

  it("同样的配置没有逃逸开关 → 直接拒绝启动（生产硬拒没被逃逸开关削弱）", async () => {
    delete process.env.ALLOW_WEAK_SECRET;
    vi.resetModules();
    await expect(import("../src/env.js")).rejects.toThrow(/AUTH_SECRET/);
    process.env.ALLOW_WEAK_SECRET = "1"; // 还原，避免影响本文件后续
  });
});
