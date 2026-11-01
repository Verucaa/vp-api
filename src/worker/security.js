import dns from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicIp } from "../ip-utils.js";

const hostAllowed = (hostname, allowedHosts) => {
  if (!allowedHosts?.length) return true;
  const host = hostname.toLowerCase();
  return allowedHosts.some((entry) => {
    const normalized = String(entry).toLowerCase().replace(/^\*\./, "");
    return host === normalized || host.endsWith(`.${normalized}`);
  });
};

const resolvePublicAddresses = async (hostname) => {
  const results = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
  const addresses = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const address of result.value) addresses.push(address);
    }
  }
  if (!addresses.length) throw new Error("Host URL tidak dapat ditemukan melalui DNS-over-HTTPS");
  if (addresses.some((address) => !isPublicIp(address))) {
    throw new Error("Host URL mengarah ke alamat privat atau khusus");
  }
  return addresses;
};

export const assertPublicHttpUrl = async (value, options = {}) => {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error("URL tidak valid");
  }

  if (!options.allowHttp && url.protocol !== "https:") throw new Error("URL harus menggunakan HTTPS");
  if (options.allowHttp && !["https:", "http:"].includes(url.protocol)) throw new Error("Skema URL tidak diizinkan");
  if (url.username || url.password) throw new Error("URL tidak boleh memuat kredensial");

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Host lokal atau privat tidak diizinkan");
  }
  if (!hostAllowed(hostname, options.allowedHosts)) throw new Error("Host URL tidak diizinkan");

  if (isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new Error("Alamat IP privat atau khusus tidak diizinkan");
    return url;
  }
  await resolvePublicAddresses(hostname);
  return url;
};

export { isPublicIp };
