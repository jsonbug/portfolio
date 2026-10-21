// 链接健康检查（B16，阶段 2.6）
//   保存链接 / 改 url 后异步检查（不阻塞响应）；POST /admin/links/:id/check 立即重检并等待结果。
//   判定口径（冻结见 docs/api-contract.md §4.4）：
//     2xx                    → ok
//     非 2xx（含 3xx 无 Location）、超时、DNS 失败、连接失败、被 SSRF 拦截 → failed
//     从未检查（库内 null）  → wire 上序列化为 unknown
//   安全：每跳重新解析 + 重校验，连接固定到已校验 IP（防 DNS rebinding），重定向 ≤ 3 跳。
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { prisma } from "./prisma.js";
import { toLink } from "./serialize.js";
import type { Link } from "../contract/schemas.js";
import { CheckFailure, resolvePublicAddress, type ResolvedAddress } from "./ssrf.js";

export interface LinkCheckOptions {
  /** 最多跟随的重定向跳数 */
  maxRedirects: number;
  /** 单跳超时（连接 + 响应头） */
  hopTimeoutMs: number;
  /** 整体超时（含全部重定向跳） */
  totalTimeoutMs: number;
  userAgent: string;
  /** 解析器（测试可注入；生产固定为 resolvePublicAddress） */
  resolve: (hostname: string) => Promise<ResolvedAddress>;
}

const positiveInt = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export const defaultLinkCheckOptions: LinkCheckOptions = {
  maxRedirects: positiveInt(process.env.LINK_CHECK_MAX_REDIRECTS, 3),
  hopTimeoutMs: positiveInt(process.env.LINK_CHECK_TIMEOUT_MS, 5000),
  totalTimeoutMs: positiveInt(process.env.LINK_CHECK_TOTAL_TIMEOUT_MS, 8000),
  userAgent: "portfolio-link-check/1.0",
  resolve: resolvePublicAddress,
};

/** 运行时依赖持有者：生产默认值即严格实现，测试在此注入 mock 解析器 */
export const linkCheckRuntime: { options: LinkCheckOptions } = {
  options: { ...defaultLinkCheckOptions },
};

export interface CheckOutcome {
  status: "ok" | "failed";
  httpStatus: number | null;
  /** 失败原因，仅用于日志 */
  reason: string | null;
}

function describeError(err: unknown): string {
  if (err instanceof CheckFailure) return err.reason;
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case "ECONNREFUSED":
      return "连接被拒绝";
    case "ECONNRESET":
      return "连接被重置";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "网络不可达";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "DNS 解析失败";
    case "ETIMEDOUT":
      return "请求超时";
    case "ERR_TLS_CERT_ALTNAME_INVALID":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return "TLS 证书校验失败";
    default:
      return err instanceof Error ? err.message : "未知错误";
  }
}

interface HopResult {
  status: number;
  location: string | null;
}

// 单跳请求：DNS 固定到已校验的 IP，只取响应头（不读 body），超时即断开
function requestOnce(
  url: URL,
  address: ResolvedAddress,
  timeoutMs: number,
  userAgent: string,
): Promise<HopResult> {
  return new Promise<HopResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    const isHttps = url.protocol === "https:";
    const port = url.port ? Number(url.port) : isHttps ? 443 : 80;

    // 连接用固定 IP，Host / SNI 仍用原域名
    const pinnedLookup = ((
      _hostname: string,
      options: { all?: boolean },
      callback: (
        err: NodeJS.ErrnoException | null,
        addr: string | ResolvedAddress[],
        family?: number,
      ) => void,
    ): void => {
      if (options?.all) callback(null, [address]);
      else callback(null, address.address, address.family);
    }) as unknown as LookupFunction;

    const requestFn = isHttps ? httpsRequest : httpRequest;
    const req = requestFn(
      {
        method: "GET",
        host: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        headers: {
          host: url.host,
          "user-agent": userAgent,
          accept: "*/*",
          "accept-encoding": "identity",
          connection: "close",
        },
        agent: false,
        timeout: timeoutMs,
        lookup: pinnedLookup,
        ...(isHttps ? { servername: url.hostname } : {}),
      },
      (res) => {
        const headers: IncomingHttpHeaders = res.headers;
        res.resume();
        res.destroy();
        finish(() =>
          resolve({
            status: res.statusCode ?? 0,
            location: typeof headers.location === "string" ? headers.location : null,
          }),
        );
      },
    );

    req.on("timeout", () => {
      req.destroy();
      finish(() => reject(new CheckFailure("请求超时")));
    });
    req.on("error", (err) => finish(() => reject(new CheckFailure(describeError(err)))));
    req.end();
  });
}

/** 检查一个 URL：2xx = ok，其余一律 failed（含拒绝访问的私网目标，绝不发起连接） */
export async function checkUrl(
  rawUrl: string,
  overrides: Partial<LinkCheckOptions> = {},
): Promise<CheckOutcome> {
  const options: LinkCheckOptions = { ...linkCheckRuntime.options, ...overrides };
  const deadline = Date.now() + options.totalTimeoutMs;
  const failed = (httpStatus: number | null, reason: string): CheckOutcome => ({
    status: "failed",
    httpStatus,
    reason,
  });

  let current = rawUrl;
  let lastStatus: number | null = null;

  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      return failed(lastStatus, "URL 无法解析");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return failed(lastStatus, `不支持的协议 ${url.protocol}`);
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return failed(lastStatus, "整体超时");

    let response: HopResult;
    let address: ResolvedAddress;
    try {
      // 每一跳都重新解析 + 重校验（重定向到内网同样被拦）
      address = await options.resolve(url.hostname);
      response = await requestOnce(url, address, Math.min(options.hopTimeoutMs, remaining), options.userAgent);
    } catch (err) {
      return failed(lastStatus, describeError(err));
    }

    lastStatus = response.status;
    if (response.status >= 200 && response.status < 300) {
      return { status: "ok", httpStatus: response.status, reason: null };
    }
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) return failed(response.status, "重定向缺少 Location");
      try {
        current = new URL(response.location, url).toString();
      } catch {
        return failed(response.status, "重定向目标无法解析");
      }
      continue;
    }
    return failed(response.status, `HTTP ${response.status}`);
  }

  return failed(lastStatus, `重定向超过 ${options.maxRedirects} 跳`);
}

/**
 * 检查并落库。链接已被删除时返回 null。
 * 只写服务端维护的三个字段，不碰 url / type / label / sort。
 */
export async function runLinkCheck(
  linkId: string,
  overrides: Partial<LinkCheckOptions> = {},
): Promise<Link | null> {
  const link = await prisma.projectLink.findUnique({
    where: { id: linkId },
    select: { id: true, url: true },
  });
  if (!link) return null;

  const outcome = await checkUrl(link.url, overrides);
  if (outcome.reason) {
    console.warn(`[link-check] ${linkId} ${link.url} → ${outcome.status}：${outcome.reason}`);
  }

  try {
    const updated = await prisma.projectLink.update({
      where: { id: linkId },
      data: {
        last_status: outcome.status,
        last_http_status: outcome.httpStatus,
        last_checked_at: new Date(),
      },
    });
    return toLink(updated);
  } catch {
    // 检查期间链接被删除（P2025）：当作不存在处理
    return null;
  }
}

/** 保存链接后的自动检查开关；测试环境默认关闭，避免真实网络请求 */
export function isAutoCheckEnabled(): boolean {
  const raw = process.env.LINK_CHECK_ENABLED;
  if (raw === "0" || raw === "false") return false;
  if (raw === "1" || raw === "true") return true;
  return process.env.NODE_ENV !== "test";
}

// 同一链接同时只跑一次；测试用 waitForLinkChecks 等所有在途检查结束
const inFlight = new Map<string, Promise<void>>();

export function scheduleLinkCheck(linkId: string): void {
  if (!isAutoCheckEnabled() || inFlight.has(linkId)) return;
  const task = runLinkCheck(linkId)
    .then(() => undefined)
    .catch((err: unknown) => {
      console.warn(`[link-check] ${linkId} 异常`, err);
    })
    .finally(() => {
      inFlight.delete(linkId);
    });
  inFlight.set(linkId, task);
}

/** 等待所有在途自动检查结束（测试用；生产无人调用） */
export async function waitForLinkChecks(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.all([...inFlight.values()]);
  }
}
