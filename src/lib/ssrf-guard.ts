/**
 * SSRF 防护 —— 用户可控 URL（商品链接 ingest、抓取页里的 og:image）在服务端被 fetch 前必须过这里，
 * 否则可被构造成 http://169.254.169.254/（云元数据）、http://127.0.0.1:6379/（内网服务）等打内网。
 * 做法：校验协议 + DNS 解析主机的所有 IP 都不在私网/回环/链路本地/保留段；并手动跟随重定向、每一跳都重校验。
 */
import { lookup } from "dns/promises";
import net from "net";

/** 判断 IP 是否落在禁止访问的私网/回环/链路本地/保留段（IPv4 + IPv6）。纯函数可单测。 */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    if (p[0] === 0) return true; // 0.0.0.0/8 当前网络
    if (p[0] === 10) return true; // 10/8 私网
    if (p[0] === 127) return true; // 127/8 回环
    if (p[0] === 169 && p[1] === 254) return true; // 169.254/16 链路本地 + 云元数据
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16/12 私网
    if (p[0] === 192 && p[1] === 168) return true; // 192.168/16 私网
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // 100.64/10 CGNAT
    // 注意：198.18/15(RFC2544 基准段)不拦——Cloudflare WARP 等会把它当作转发公网的透明代理地址，拦了会误伤正常用户
    if (p[0] >= 224) return true; // 224+ 组播/保留
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true; // 回环 / 未指定
    if (low.startsWith("fe80")) return true; // 链路本地
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // fc00::/7 ULA
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // 非法 IP 一律拦
}

/** 校验 URL：必须 http/https、主机解析出的所有 IP 都为公网，否则抛错。 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("非法 URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("仅支持 http/https");
  // 去掉 IPv6 字面量的方括号（new URL 的 hostname 对 [::1] 会保留括号 → net.isIP 失败误走 DNS）
  const host = u.hostname.replace(/^\[/, "").replace(/\]$/, "");
  let ips: string[];
  if (net.isIP(host)) {
    ips = [host];
  } else {
    const records = await lookup(host, { all: true });
    ips = records.map((r) => r.address);
  }
  if (ips.length === 0) throw new Error("无法解析主机");
  for (const ip of ips) {
    if (isBlockedIp(ip)) throw new Error(`目标地址被拒绝（内网/保留地址 ${ip}）`);
  }
}

/** SSRF 安全的 fetch：禁用自动重定向，手动逐跳跟随且每一跳都重新校验目标为公网。 */
export async function safeFetch(url: string, init: RequestInit = {}, maxRedirects = 4): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);
    // 每一跳加 15s 超时（除非调用方已自带 signal），避免慢/恶意响应的服务器无限拖住请求
    const res = await fetch(current, { ...init, redirect: "manual", signal: init.signal ?? AbortSignal.timeout(15000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).href; // 解析可能的相对跳转
      continue;
    }
    return res;
  }
  throw new Error("重定向次数过多");
}
