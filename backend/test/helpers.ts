// 测试辅助：清库 + 登录取 token + 造数快捷方法
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";

// 子表先删（外键 CASCADE 也能兜住，显式顺序更利于排查残留）
export async function wipeDb(): Promise<void> {
  await prisma.projectMetadata.deleteMany();
  await prisma.noteTag.deleteMany();
  await prisma.projectLink.deleteMany();
  await prisma.projectTechStack.deleteMany();
  await prisma.note.deleteMany();
  await prisma.slugAlias.deleteMany();
  await prisma.project.deleteMany();
}

export async function getToken(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { username: "admin", password: "admin123" },
  });
  const body = res.json() as { token: string };
  return body.token;
}

export function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

type ProjectPayload = Record<string, unknown>;

/** 通过后台接口造项目（默认 draft，slug 由 name 派生） */
export async function createProject(
  app: FastifyInstance,
  token: string,
  payload: ProjectPayload,
): Promise<Record<string, unknown> & { id: string; slug: string }> {
  const name = typeof payload.name === "string" ? payload.name : "项目";
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/admin/projects",
    headers: auth(token),
    payload: { slug: `p-${Math.random().toString(36).slice(2, 10)}`, name, ...payload },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createProject failed: ${res.statusCode} ${res.body}`);
  }
  return res.json() as Record<string, unknown> & { id: string; slug: string };
}

/** 通过后台接口造笔记 */
export async function createNote(
  app: FastifyInstance,
  token: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> & { id: string; slug: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/admin/notes",
    headers: auth(token),
    payload: { slug: `n-${Math.random().toString(36).slice(2, 10)}`, title: "笔记", body_md: "正文", ...payload },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createNote failed: ${res.statusCode} ${res.body}`);
  }
  return res.json() as Record<string, unknown> & { id: string; slug: string };
}
