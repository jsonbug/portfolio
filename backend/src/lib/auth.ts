// 认证工具：HMAC 签名令牌 + 口令哈希校验。零第三方依赖（Node 内置 crypto）。
//
// 令牌格式：`<base64url header>.<base64url payload>.<base64url sig>`
//   header  = {"alg":"HS256","typ":"JWT"}
//   payload = {"sub":"admin", "iat": 秒级时间戳, "exp": 秒级时间戳}   ← 单管理员，sub 恒为 "admin"
//   sig     = HMAC-SHA256(secret, `${header}.${payload}`)
//
// 口令哈希：scrypt(N=16384, r=8, p=1, keylen=64)，存储格式 `scrypt$<saltHex>$<hashHex>`。
// 口令来自环境变量 ADMIN_PASSWORD_HASH（散列），用 `node scripts/hash-password.mjs` 生成；
// 校验时从存储串解析 salt 重算 scrypt 后 timingSafeEqual 比较。

import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { AppError } from "./errors.js";

export interface TokenPayload {
  sub: string;
  iat: number;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signToken(sub: string, secret: string, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(
    Buffer.from(JSON.stringify({ sub, iat: now, exp: now + ttlSeconds })),
  );
  const sig = b64url(
    createHmac("sha256", secret).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${sig}`;
}

export function verifyToken(token: string, secret: string): TokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AppError("UNAUTHORIZED", "认证令牌无效");
  }
  const [header = "", payload = "", sig = ""] = parts;
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new AppError("UNAUTHORIZED", "认证令牌无效");
  }

  let parsed: TokenPayload;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as TokenPayload;
  } catch {
    throw new AppError("UNAUTHORIZED", "认证令牌无效");
  }
  if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) {
    throw new AppError("UNAUTHORIZED", "认证令牌已过期");
  }
  return parsed;
}

const SCRYPT_KEYLEN = 64;

/** 生成 scrypt 口令哈希（salt 可选，缺省随机 16 字节）。格式 `scrypt$<saltHex>$<hashHex>`。 */
export function hashPassword(password: string, salt?: Buffer): string {
  const s = salt ?? randomBytes(16);
  const hash = scryptSync(password, s, SCRYPT_KEYLEN);
  return `scrypt$${s.toString("hex")}$${hash.toString("hex")}`;
}

/** 校验明文口令与存储的 scrypt 哈希是否匹配（恒时比较）。 */
export function verifyPassword(input: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  const got = scryptSync(input, salt, expected.length);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
