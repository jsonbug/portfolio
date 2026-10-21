// SSRF 防护：只允许公网 http/https 目标
//   1. 协议白名单 http / https（其它一律拒绝）
//   2. 主机名解析为 IP 后逐个校验，命中环回 / 私网 / 链路本地 / 云元数据 → 拒绝
//   3. 连接时把 DNS 固定到已校验的 IP（见 link-check.ts），校验与连接用同一地址，
//      避免「校验时是公网、连接时变私网」的 DNS rebinding
//   4. 重定向每一跳都重新解析 + 重校验（同样在 link-check.ts 的循环里）
// 纯函数 + 可注入的解析器，便于测试不触碰真实网络。
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";

/** 目标不可用：原因会写进日志，不落库（库内只留 ok / failed） */
export class CheckFailure extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "CheckFailure";
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

// ---------- IPv4 ----------
function parseIpv4(input: string): number | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

// 拒绝段：这个网络 / 私网 / CGNAT / 环回 / 链路本地(含云元数据) / 文档与保留段 / 组播 / 保留
const V4_BLOCKED: Array<{ net: number; bits: number; label: string }> = [
  { net: parseIpv4("0.0.0.0")!, bits: 8, label: "0.0.0.0/8" },
  { net: parseIpv4("10.0.0.0")!, bits: 8, label: "10/8 私网" },
  { net: parseIpv4("100.64.0.0")!, bits: 10, label: "100.64/10 运营商级 NAT" },
  { net: parseIpv4("127.0.0.0")!, bits: 8, label: "127/8 环回" },
  { net: parseIpv4("169.254.0.0")!, bits: 16, label: "169.254/16 链路本地（含云元数据 169.254.169.254）" },
  { net: parseIpv4("172.16.0.0")!, bits: 12, label: "172.16/12 私网" },
  { net: parseIpv4("192.0.0.0")!, bits: 24, label: "192.0.0/24 保留" },
  { net: parseIpv4("192.0.2.0")!, bits: 24, label: "192.0.2/24 文档" },
  { net: parseIpv4("192.88.99.0")!, bits: 24, label: "192.88.99/24 6to4 中继" },
  { net: parseIpv4("192.168.0.0")!, bits: 16, label: "192.168/16 私网" },
  { net: parseIpv4("198.18.0.0")!, bits: 15, label: "198.18/15 基准测试" },
  { net: parseIpv4("198.51.100.0")!, bits: 24, label: "198.51.100/24 文档" },
  { net: parseIpv4("203.0.113.0")!, bits: 24, label: "203.0.113/24 文档" },
  { net: parseIpv4("224.0.0.0")!, bits: 4, label: "224/4 组播" },
  { net: parseIpv4("240.0.0.0")!, bits: 4, label: "240/4 保留" },
];

function inV4Range(value: number, net: number, bits: number): boolean {
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (value & mask) === (net & mask);
}

function blockedV4Label(value: number): string | null {
  for (const range of V4_BLOCKED) {
    if (inV4Range(value, range.net, range.bits)) return range.label;
  }
  return null;
}

// ---------- IPv6 ----------
function parseIpv6(input: string): number[] | null {
  let s = input.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zoneAt = s.indexOf("%");
  if (zoneAt !== -1) s = s.slice(0, zoneAt);
  if (!s.includes(":")) return null;

  // 末尾内嵌 IPv4（::ffff:1.2.3.4 / 64:ff9b::1.2.3.4）→ 折成两个 hextet
  const lastColon = s.lastIndexOf(":");
  if (s.slice(lastColon + 1).includes(".")) {
    const v4 = parseIpv4(s.slice(lastColon + 1));
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (head.length + tail.length > 8) return null;
  const groups =
    halves.length === 2
      ? [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail]
      : head;

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const v = Number.parseInt(group, 16);
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return bytes;
}

function bytesToV4(b: number[]): number {
  const [a = 0, c = 0, d = 0, e = 0] = b;
  return ((a << 24) | (c << 16) | (d << 8) | e) >>> 0;
}

function allZero(b: number[], from = 0, to = b.length): boolean {
  for (let i = from; i < to; i += 1) if (b[i] !== 0) return false;
  return true;
}

function blockedV6Label(b: number[]): string | null {
  const at = (i: number): number => b[i] ?? -1;
  if (allZero(b)) return ":: 未指定地址";
  if (allZero(b, 0, 15) && at(15) === 1) return "::1 环回";

  // IPv4 映射 / 兼容地址：按 IPv4 段判定
  if (allZero(b, 0, 10) && at(10) === 0xff && at(11) === 0xff) {
    const label = blockedV4Label(bytesToV4(b.slice(12)));
    return label ? `IPv4 映射地址（${label}）` : null;
  }
  if (allZero(b, 0, 12) && !allZero(b, 12)) {
    const label = blockedV4Label(bytesToV4(b.slice(12)));
    return label ? `IPv4 兼容地址（${label}）` : null;
  }
  // 64:ff9b::/96 NAT64
  if (at(0) === 0x00 && at(1) === 0x64 && at(2) === 0xff && at(3) === 0x9b) {
    const label = blockedV4Label(bytesToV4(b.slice(12)));
    return label ? `NAT64 映射地址（${label}）` : null;
  }
  // 2002::/16 6to4
  if (at(0) === 0x20 && at(1) === 0x02) {
    const label = blockedV4Label(bytesToV4(b.slice(2, 6)));
    return label ? `6to4 嵌入地址（${label}）` : null;
  }
  if ((at(0) & 0xfe) === 0xfc) return "fc00::/7 唯一本地地址";
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0x80) return "fe80::/10 链路本地";
  if (at(0) === 0xff) return "ff00::/8 组播";
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) === 0x0d && at(3) === 0xb8) return "2001:db8::/32 文档";
  if (at(0) === 0x01 && at(1) === 0x00 && allZero(b, 2, 8)) return "100::/64 丢弃前缀";
  return null;
}

/** 命中受限网段返回原因，公网地址返回 null。无法解析的字符串按受限处理（失败即关闭）。 */
export function blockedAddressReason(ip: string): string | null {
  const v4 = parseIpv4(ip);
  if (v4 !== null) return blockedV4Label(v4);
  const v6 = parseIpv6(ip);
  if (v6 !== null) return blockedV6Label(v6);
  return "无法识别的 IP";
}

export function isBlockedAddress(ip: string): boolean {
  return blockedAddressReason(ip) !== null;
}

/**
 * 解析主机名并校验全部结果。
 * 任何一个解析结果落在受限网段就整体拒绝（避免 A/AAAA 双栈里塞一个内网地址）。
 */
export async function resolvePublicAddress(hostname: string): Promise<ResolvedAddress> {
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "");
  const literal = isIP(host);
  if (literal !== 0) {
    const reason = blockedAddressReason(host);
    if (reason) throw new CheckFailure(`目标地址被拒绝：${reason}`);
    return { address: host, family: literal === 6 ? 6 : 4 };
  }

  let records: LookupAddress[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new CheckFailure("DNS 解析失败");
  }
  if (records.length === 0) throw new CheckFailure("DNS 无解析结果");

  for (const record of records) {
    const reason = blockedAddressReason(record.address);
    if (reason) throw new CheckFailure(`目标地址被拒绝：${reason}`);
  }
  const first = records[0];
  if (!first) throw new CheckFailure("DNS 无解析结果");
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}
