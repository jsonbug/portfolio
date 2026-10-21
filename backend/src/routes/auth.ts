// 2.1 登录认证：POST /api/v1/auth/login
import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { signToken, verifyPassword } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { validate } from "../lib/zod.js";
import { LoginSchema } from "../contract/schemas.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req) => {
    const { username, password } = validate(LoginSchema, req.body);
    if (username !== env.adminUsername || !verifyPassword(password, env.adminPasswordHash)) {
      // 统一提示，不暴露是用户名错还是口令错
      throw new AppError("UNAUTHORIZED", "用户名或密码错误");
    }
    // 单管理员：sub 恒为 "admin"
    const token = signToken("admin", env.authSecret, env.authTtlSeconds);
    const expiresAt = new Date(Date.now() + env.authTtlSeconds * 1000).toISOString();
    return { token, expiresAt };
  });
}
