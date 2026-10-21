// 每个测试文件导入前预设环境变量（loadEnvFile 不会覆盖已存在的变量）
import { hashPassword } from "../src/lib/auth.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "file:./test.db";
process.env.AUTH_SECRET = "test-secret";
process.env.AUTH_TTL_SECONDS = "3600";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD_HASH = hashPassword("admin123");
