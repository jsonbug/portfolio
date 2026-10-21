// 2.1 登录认证：POST /api/v1/auth/login
import type { FastifyInstance } from "fastify";
import { configWarnings, env } from "../env.js";
import { signToken, verifyPassword } from "../lib/auth.js";
import { loginConfigHint } from "../lib/env-check.js";
import { AppError } from "../lib/errors.js";
import { validate } from "../lib/zod.js";
import { LoginSchema } from "../contract/schemas.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req) => {
    const { username, password } = validate(LoginSchema, req.body);
    if (username !== env.adminUsername || !verifyPassword(password, env.adminPasswordHash)) {
      // 统一提示，不暴露是用户名错还是口令错；
      // 但配置本身有问题时附一句，否则「摘要被插值吃掉」会被当成口令记错了
      throw new AppError("UNAUTHORIZED", `用户名或密码错误${loginConfigHint(configWarnings, env.nodeEnv) ?? ""}`);
    }
    // 单管理员：sub 恒为 "admin"
    const token = signToken("admin", env.authSecret, env.authTtlSeconds);
    const expiresAt = new Date(Date.now() + env.authTtlSeconds * 1000).toISOString();
    return { token, expiresAt };
  });
}
