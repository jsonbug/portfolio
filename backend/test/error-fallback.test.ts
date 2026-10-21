// 非 AppError 的兜底映射（feat/backend-contract-fixes）：
// 先分类（4xx → §1.3 值域），再兜底（其余一律 INTERNAL_ERROR + 500）。
// 这一组测的是「框架层错误」——它们不经过任何路由代码，所以只能从 HTTP 面验。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AppError, errorStatusMap, toErrorEnvelope } from "../src/lib/errors.js";

let app: FastifyInstance;

beforeAll(() => {
  app = buildApp();
  // 两个只用于本文件的探针路由：一个抛非 AppError 的 400（模拟框架层非法请求），
  // 一个抛非 AppError 的非 4xx（模拟真正的内部故障）。
  app.post("/probe/bad-request", async () => {
    const err = new Error("请求体格式不对") as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  });
  app.get("/probe/crash", async () => {
    const err = new Error("数据库连接池炸了") as Error & { statusCode: number };
    err.statusCode = 500;
    throw err;
  });
});

afterAll(async () => {
  await app.close();
});

describe("兜底映射：先分类，再兜底", () => {
  it("非法 JSON body → 400 + VALIDATION_ERROR（不是 INTERNAL_ERROR）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: '{"username": "admin",',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    // 客户端能自己修的错误，不能被报成服务端故障
    expect(res.json().error.code).not.toBe("INTERNAL_ERROR");
  });

  it("非 AppError 的 4xx 按状态码落值域（400 → VALIDATION_ERROR）", async () => {
    const res = await app.inject({ method: "POST", url: "/probe/bad-request" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("非 4xx 的非 AppError → INTERNAL_ERROR 且状态必为 500", async () => {
    const res = await app.inject({ method: "GET", url: "/probe/crash" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL_ERROR");
    // 原始 message 不外泄（只进服务端日志）
    expect(res.json().error.message).toBe("服务器内部错误");
  });

  it("INTERNAL_ERROR 永远不可能带非 500 状态（值域表自证）", () => {
    for (const [code, status] of Object.entries(errorStatusMap)) {
      if (code === "INTERNAL_ERROR") expect(status).toBe(500);
    }
    expect(toErrorEnvelope(new AppError("INTERNAL_ERROR", "x")).error.code).toBe("INTERNAL_ERROR");
  });
});
