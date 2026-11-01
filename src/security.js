import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicIp } from "./ip-utils.js";
export { isPublicIp } from "./ip-utils.js";
export { createRateLimiter, getRateLimitOptions } from "./rate-limit.js";

const hostAllowed = (hostname, allowedHosts) => {
  if (!allowedHosts?.length) return true;
  const host = hostname.toLowerCase();
  return allowedHosts.some((entry) => {
    const normalized = String(entry).toLowerCase().replace(/^\*\./, "");
    return host === normalized || host.endsWith(`.${normalized}`);
  });
};

export const assertPublicHttpUrl = async (value, options = {}) => {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error("URL tidak valid");
  }

  if (!options.allowHttp && url.protocol !== "https:") {
    throw new Error("URL harus menggunakan HTTPS");
  }
  if (options.allowHttp && !["https:", "http:"].includes(url.protocol)) {
    throw new Error("Skema URL tidak diizinkan");
  }
  if (url.username || url.password) throw new Error("URL tidak boleh memuat kredensial");

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Host lokal atau privat tidak diizinkan");
  }
  if (!hostAllowed(hostname, options.allowedHosts)) throw new Error("Host URL tidak diizinkan");

  const family = isIP(hostname);
  if (family) {
    if (!isPublicIp(hostname)) throw new Error("Alamat IP privat atau khusus tidak diizinkan");
    return url;
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Host URL tidak dapat ditemukan");
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new Error("Host URL mengarah ke alamat privat atau khusus");
  }
  return url;
};
