// 测试辅助：清库 + 登录取 token
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";

export async function wipeDb(): Promise<void> {
  await prisma.projectTechnology.deleteMany();
  await prisma.note.deleteMany();
  await prisma.link.deleteMany();
  await prisma.technology.deleteMany();
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
