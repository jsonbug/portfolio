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
import { AppError, errorStatusMap, toErrorEnvelope } from "./lib/errors.js";

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
      req.log.error(err);
      const status = err.statusCode ?? 500;
      const code =
        status === 404
          ? "NOT_FOUND"
          : status === 405
            ? "METHOD_NOT_ALLOWED"
            : "INTERNAL_ERROR";
      return reply.status(status).send({
        error: { code, message: err.message, requestId: req.id },
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
