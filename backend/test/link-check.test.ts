// 链接健康检查（B16）单元测试：SSRF 拒绝段、判定口径、重定向与超时
// 全部基于本地 mock server + 注入解析器，不对公网发任何请求。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CheckFailure, blockedAddressReason, isBlockedAddress, resolvePublicAddress } from "../src/lib/ssrf.js";
import { checkUrl, defaultLinkCheckOptions, linkCheckRuntime } from "../src/lib/link-check.js";

let server: Server;
let base: string;
let hits: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    hits.push(url);
    switch (url) {
      case "/ok":
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
      case "/404":
        res.writeHead(404);
        res.end();
        return;
      case "/500":
        res.writeHead(500);
        res.end();
        return;
      case "/to-ok":
        res.writeHead(302, { location: "/ok" });
        res.end();
        return;
      case "/r1":
        res.writeHead(301, { location: "/r2" });
        res.end();
        return;
      case "/r2":
        res.writeHead(302, { location: "/r3" });
        res.end();
        return;
      case "/r3":
        res.writeHead(307, { location: "/r4" });
        res.end();
        return;
      case "/r4":
        res.writeHead(302, { location: "/ok" });
        res.end();
        return;
      case "/to-private":
        res.writeHead(302, { location: "http://internal.example.com/ok" });
        res.end();
        return;
      case "/no-location":
        res.writeHead(302);
        res.end();
        return;
      case "/slow":
        // 永不响应，用于超时
        return;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// 默认把 mock server 的 127.0.0.1 视作已校验目标（仅测试：生产 resolver 会拒绝环回）
const stubResolve = async (): Promise<{ address: string; family: 4 | 6 }> => ({
  address: "127.0.0.1",
  family: 4,
});

beforeEach(() => {
  hits = [];
  linkCheckRuntime.options = {
    ...defaultLinkCheckOptions,
    hopTimeoutMs: 400,
    totalTimeoutMs: 3000,
    resolve: stubResolve,
  };
});

afterEach(() => {
  linkCheckRuntime.options = { ...defaultLinkCheckOptions };
});

describe("SSRF 拒绝段", () => {
  it("环回 / 私网 / 链路本地 / 云元数据 / 保留段一律拒绝", () => {
    const blocked = [
      "127.0.0.1",
      "127.255.255.254",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // 云元数据
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "198.18.0.1",
      "192.0.2.1",
    ];
    for (const ip of blocked) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("IPv6：环回 / 唯一本地 / 链路本地 / 组播 / 映射地址一律拒绝", () => {
    const blocked = [
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::ffff:169.254.169.254",
      "64:ff9b::a9fe:a9fe", // NAT64 → 169.254.169.254
      "2002:7f00:1::1", // 6to4 → 127.0.0.1
      "2001:db8::1",
      "[::1]",
    ];
    for (const ip of blocked) {
      expect(blockedAddressReason(ip), ip).not.toBeNull();
    }
  });

  it("公网地址放行", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "2a00:1450:4001:80f::200e"]) {
      expect(blockedAddressReason(ip), ip).toBeNull();
    }
  });

  it("非法 IP 字符串按拒绝处理（失败即关闭）", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("1.2.3.256")).toBe(true);
    expect(isBlockedAddress(":::1")).toBe(true);
  });

  it("resolvePublicAddress 拒绝 IP 字面量与私网域名", async () => {
    await expect(resolvePublicAddress("127.0.0.1")).rejects.toBeInstanceOf(CheckFailure);
    await expect(resolvePublicAddress("[::1]")).rejects.toBeInstanceOf(CheckFailure);
    await expect(resolvePublicAddress("169.254.169.254")).rejects.toBeInstanceOf(CheckFailure);
  });
});

describe("checkUrl 判定口径", () => {
  it("2xx → ok，记录 HTTP 状态码", async () => {
    const outcome = await checkUrl(`${base}/ok`);
    expect(outcome).toEqual({ status: "ok", httpStatus: 200, reason: null });
  });

  it("非 2xx（404 / 500）→ failed，仍记录 HTTP 状态码", async () => {
    await expect(checkUrl(`${base}/404`)).resolves.toMatchObject({ status: "failed", httpStatus: 404 });
    await expect(checkUrl(`${base}/500`)).resolves.toMatchObject({ status: "failed", httpStatus: 500 });
  });

  it("跟随重定向：1 跳以内 ok", async () => {
    await expect(checkUrl(`${base}/to-ok`)).resolves.toMatchObject({ status: "ok", httpStatus: 200 });
    expect(hits).toEqual(["/to-ok", "/ok"]);
  });

  it("重定向超过 3 跳 → failed（共发 4 次请求后放弃）", async () => {
    const outcome = await checkUrl(`${base}/r1`);
    expect(outcome.status).toBe("failed");
    expect(outcome.httpStatus).toBe(302);
    expect(outcome.reason).toContain("重定向超过");
    expect(hits).toEqual(["/r1", "/r2", "/r3", "/r4"]);
  });

  it("重定向缺少 Location → failed", async () => {
    await expect(checkUrl(`${base}/no-location`)).resolves.toMatchObject({ status: "failed", httpStatus: 302 });
  });

  it("重定向到私网：第二跳被重新校验拦截，绝不再发请求", async () => {
    linkCheckRuntime.options = {
      ...linkCheckRuntime.options,
      resolve: async (hostname: string) => {
        if (hostname === "internal.example.com") throw new CheckFailure("目标地址被拒绝：10/8 私网");
        return stubResolve();
      },
    };
    const outcome = await checkUrl(`${base}/to-private`);
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toContain("目标地址被拒绝");
    expect(outcome.httpStatus).toBe(302); // 记录最后收到的状态码
    expect(hits).toEqual(["/to-private"]); // 没有打到 /ok
  });

  it("超时 → failed，无 HTTP 状态码", async () => {
    const outcome = await checkUrl(`${base}/slow`, { hopTimeoutMs: 120 });
    expect(outcome.status).toBe("failed");
    expect(outcome.httpStatus).toBeNull();
    expect(outcome.reason).toContain("超时");
  });

  it("整体超时预算生效：单跳超时被整体预算截短，不会等满 hopTimeoutMs", async () => {
    const started = Date.now();
    const outcome = await checkUrl(`${base}/slow`, { hopTimeoutMs: 5000, totalTimeoutMs: 60 });
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toContain("超时");
    // 实际按 60ms 截止，而不是单跳 5000ms
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("DNS 失败 → failed，无 HTTP 状态码", async () => {
    linkCheckRuntime.options = {
      ...linkCheckRuntime.options,
      resolve: async () => {
        throw new CheckFailure("DNS 解析失败");
      },
    };
    const outcome = await checkUrl("http://no-such-host.invalid/");
    expect(outcome).toMatchObject({ status: "failed", httpStatus: null });
    expect(outcome.reason).toBe("DNS 解析失败");
  });

  it("非 http/https 协议 → failed", async () => {
    await expect(checkUrl("file:///etc/passwd")).resolves.toMatchObject({ status: "failed" });
    await expect(checkUrl("ftp://example.com/x")).resolves.toMatchObject({ status: "failed" });
  });

  it("默认 resolver（生产口径）拦下私网目标，且一次请求都不发", async () => {
    linkCheckRuntime.options = { ...defaultLinkCheckOptions, hopTimeoutMs: 400 };
    const outcome = await checkUrl(`${base}/ok`);
    expect(outcome.status).toBe("failed");
    expect(outcome.httpStatus).toBeNull();
    expect(outcome.reason).toContain("目标地址被拒绝");
    expect(hits).toEqual([]);
  });
});
