import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { Prisma } from "@prisma/client";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { technologyRoutes } from "./routes/technologies.js";
import { projectRoutes } from "./routes/projects.js";
import { noteRoutes } from "./routes/notes.js";
import { adminProjectRoutes } from "./routes/admin/projects.js";
import { adminLinkRoutes } from "./routes/admin/links.js";
import { adminNoteRoutes } from "./routes/admin/notes.js";
import { verifyToken } from "./lib/auth.js";
import { env } from "./env.js";
import {
  AppError,
  errorStatusMap,
  toErrorEnvelope,
  type ErrorCode,
} from "./lib/errors.js";

// 4xx 兜底映射：框架层错误（非法 JSON body、payload 过大、限流等）不带契约 code，
// 按状态码落到 §1.3 值域里最接近的一个；表里没有的 4xx 也归 VALIDATION_ERROR（仍是 4xx 语义）。
//
// `405` 这行**保留**：它是「框架层 4xx → 契约值域」的映射表，不是「本服务会产生 405」的声明。
// 未知方法当前统一由 notFoundHandler 返回 404 NOT_FOUND（`test/health.test.ts:32-49` 已钉住），
// 所以这行暂时不会被命中；删掉反而有害——将来真有 405 冒出来（插件/反向代理层、fastify 版本行为变化），
// 它会落到 VALIDATION_ERROR 这种语义错位的码上。
const CLIENT_ERROR_CODES: Partial<Record<number, ErrorCode>> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "CONFLICT",
};

// 后台 /admin/* 鉴权钩子（2.1 登录认证）
async function requireAuth(req: FastifyRequest): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new AppError("UNAUTHORIZED", "缺少认证令牌");
  }
  verifyToken(header.slice("Bearer ".length).trim(), env.authSecret);
}

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: env.nodeEnv !== "test" });

  // 全局错误处理器：所有错误统一为契约中的错误信封
  app.setErrorHandler(
    (err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
      if (err instanceof AppError) {
        return reply
          .status(errorStatusMap[err.code])
          .send(toErrorEnvelope(err, req.id));
      }
      // Prisma 已知错误 → 契约错误码
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2025") {
          return reply
            .status(404)
            .send({ error: { code: "NOT_FOUND", message: "资源不存在", requestId: req.id } });
        }
        if (err.code === "P2002") {
          return reply
            .status(409)
            .send({ error: { code: "CONFLICT", message: "唯一约束冲突", requestId: req.id } });
        }
      }
      // 非 AppError 的兜底：先按 statusCode 分类（4xx 映射到契约 error.code 值域，见 §1.3），
      // 再兜到 INTERNAL_ERROR + 500。顺序不能反：把 400 的框架错误（如非法 JSON body）
      // 统一报成 INTERNAL_ERROR 会让客户端把一个自己能修的错误当成服务端故障。
      const status = err.statusCode ?? 500;
      const mapped = status >= 400 && status < 500 ? CLIENT_ERROR_CODES[status] : undefined;
      if (!mapped) {
        // 5xx 与非 4xx 一律 INTERNAL_ERROR + 500：code 是分类维度，不允许与非 500 状态错配。
        req.log.error(err);
        return reply.status(500).send({
          error: { code: "INTERNAL_ERROR", message: "服务器内部错误", requestId: req.id },
        });
      }
      return reply.status(status).send({
        error: { code: mapped, message: err.message, requestId: req.id },
      });
    },
  );

  // 未知路由：统一 404 信封
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: "资源不存在", requestId: req.id },
    });
  });

  // 公开路由
  app.register(healthRoutes, { prefix: "/api/v1" });
  app.register(authRoutes, { prefix: "/api/v1" });
  app.register(technologyRoutes, { prefix: "/api/v1" });
  app.register(projectRoutes, { prefix: "/api/v1" });
  app.register(noteRoutes, { prefix: "/api/v1" });

  // 后台路由（统一鉴权）
  app.register(
    async (admin) => {
      admin.addHook("onRequest", requireAuth);
      admin.register(adminProjectRoutes);
      admin.register(adminLinkRoutes);
      admin.register(adminNoteRoutes);
    },
    { prefix: "/api/v1/admin" },
  );

  return app;
}
