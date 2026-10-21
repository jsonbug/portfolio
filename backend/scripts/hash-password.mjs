#!/usr/bin/env node
// 生成 ADMIN_PASSWORD_HASH（scrypt N=16384, r=8, p=1, keylen=64）。
// 用法：node scripts/hash-password.mjs <明文口令>
// 输出格式与 src/lib/auth.ts 的 hashPassword 一致：`scrypt$<saltHex>$<hashHex>`。
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("用法：node scripts/hash-password.mjs <明文口令>");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
console.log(`scrypt$${salt.toString("hex")}$${hash.toString("hex")}`);
