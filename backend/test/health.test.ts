import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("GET /api/v1/health", () => {
  it("返回 200 与 ok 状态", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("portfolio-backend");
    await app.close();
  });

  it("未知路由返回契约规定的 404 错误信封", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/nope" });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    await app.close();
  });
});

// 冻结「未知方法 → 404 NOT_FOUND」，与契约 §1.3 一致：
// METHOD_NOT_ALLOWED 是**保留值**，当前实现不产生（契约 v1.2.7）。
// Fastify 默认的 405 行为在这里被显式钉住：将来谁「顺手开启 405」（比如加
// `exposeHeadRoutes` 之外的方法级路由或框架升级改变默认），这条会立刻红，
// 而不是悄悄改掉一个已冻结值域的语义。
// 理由（结论在契约里）：让 Fastify 枚举每个路径上合法的方法，等于把信息面从
// 「路径存在与否」扩到「路径存在但方法不对」，对客户端几乎无收益，却要新造一套响应。
describe("未知方法 → 404 NOT_FOUND（不是 405 METHOD_NOT_ALLOWED）", () => {
  it.each([
    { method: "PUT" as const, url: "/api/v1/projects" },
    { method: "DELETE" as const, url: "/api/v1/health" },
    { method: "PATCH" as const, url: "/api/v1/auth/login" },
    { method: "POST" as const, url: "/api/v1/technologies" },
    { method: "PUT" as const, url: "/api/v1/admin/projects/p1" },
  ])("$method $url → 404 NOT_FOUND", async ({ method, url }) => {
    const app = buildApp();
    const res = await app.inject({ method, url, payload: {} });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    // 值域里保留、但不得产生：这条比状态码更严格，改 405 映射也会被挡住
    expect(body.error.code).not.toBe("METHOD_NOT_ALLOWED");
    expect(typeof body.error.message).toBe("string");
    expect(typeof body.error.requestId).toBe("string");
    await app.close();
  });
});
