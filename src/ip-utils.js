import { isIP } from "node:net";

const ipv4ToInt = (address) => address.split(".").reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
const inCidr4 = (address, network, bits) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(address) & mask) === (ipv4ToInt(network) & mask);
};

export const isPublicIp = (address) => {
  const family = isIP(address);
  if (family === 4) {
    const blocked = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
      ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
    ];
    return !blocked.some(([network, bits]) => inCidr4(address, network, bits));
  }

  if (family === 6) {
    const normalized = address.toLowerCase().split("%")[0];
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice(7);
      if (isIP(mapped) === 4) return isPublicIp(mapped);
      const parts = mapped.split(":");
      if (parts.length === 2) {
        const value = (parseInt(parts[0], 16) * 0x10000 + parseInt(parts[1], 16)) >>> 0;
        return isPublicIp([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join("."));
      }
      return false;
    }

    // Only global-unicast 2000::/3 is allowed; this excludes loopback,
    // link-local, unique-local, multicast, unspecified and most special ranges.
    const firstHextet = parseInt(normalized.split(":")[0] || "0", 16);
    return firstHextet >= 0x2000 && firstHextet <= 0x3fff &&
      !normalized.startsWith("2001:db8:") && !normalized.startsWith("2001:0:") && firstHextet !== 0x2002;
  }
  return false;
};
