import { PrismaClient } from "@prisma/client";

// 单例，避免开发环境热重载时重复实例化连接
export const prisma = new PrismaClient();
