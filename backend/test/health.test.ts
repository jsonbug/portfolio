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
