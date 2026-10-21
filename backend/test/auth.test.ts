import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { signToken } from "../src/lib/auth.js";
import { env } from "../src/env.js";
import { auth, getToken } from "./helpers.js";

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  app = buildApp();
  token = await getToken(app);
});

afterAll(async () => {
  await app.close();
});

describe("2.1 登录认证", () => {
  it("正确凭据返回 token 与 expiresAt", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "admin", password: "admin123" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; expiresAt: string };
    expect(body.token).toBeTruthy();
    expect(Number.isNaN(Date.parse(body.expiresAt))).toBe(false);
  });

  it("token payload 的 sub 为 admin（单管理员）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "admin", password: "admin123" },
    });
    const { token: t } = res.json() as { token: string };
    const payload = JSON.parse(
      Buffer.from(t.split(".")[1]!, "base64url").toString(),
    ) as { sub: string };
    expect(payload.sub).toBe("admin");
  });

  it("错误口令返回 401 UNAUTHORIZED", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "admin", password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("缺失字段返回 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "admin" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("后台鉴权钩子", () => {
  it("无令牌访问后台返回 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/projects" });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("伪造令牌返回 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects",
      headers: { authorization: "Bearer not.a.valid-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("过期令牌返回 401", async () => {
    const expired = signToken("admin", env.authSecret, -1); // exp 已过期
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects",
      headers: auth(expired),
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("有效令牌可访问后台", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/projects",
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
  });
});
