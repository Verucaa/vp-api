import film7reels from "../plugins/film/7reels.js";
import filmHura from "../plugins/film/hura.js";
import animein from "../plugins/anime/animein.js";
import ip from "../plugins/info/ip.js";
import ping from "../plugins/info/ping.js";

function expandRoutes(entries) {
  const out = [];
  for (const entry of entries) {
    const h = entry.handler || {};
    if (h.routes && typeof h.routes === "object" && typeof h.execute !== "function") {
      for (const [sub, def] of Object.entries(h.routes)) {
        out.push({
          endpoint: `${entry.endpoint}/${sub}`,
          handler: {
            name: def.name || `${h.name} ${sub}`,
            category: h.category,
            method: def.method || h.method || ["GET"],
            timeout: Math.min(Math.max(Number(def.timeout) || Number(h.timeout) || 45_000, 1000), 300_000),
            cache: typeof def.cache === "number" && def.cache > 0 ? def.cache : (h.cache || null),
            description: def.description || h.description || "",
            params: def.params || {},
            hidden: def.hidden === true || h.hidden === true,
            execute: def.execute,
          },
        });
      }
    } else {
      out.push({
        endpoint: entry.endpoint,
        handler: {
          ...h,
          hidden: h.hidden === true,
        },
      });
    }
  }
  return out;
}

export const activeWorkerPlugins = expandRoutes([
  { endpoint: "/info/ip", handler: ip },
  { endpoint: "/info/ping", handler: ping },
  { endpoint: "/film/7reels", handler: film7reels },
  { endpoint: "/film/hura", handler: filmHura },
  { endpoint: "/anime/animein", handler: animein },
]);

// Semua yang dihapus, tidak perlu di-disabled lagi — cukup hapus array ini
// kalau loader Worker Anda masih membaca `disabledWorkerPlugins`,
// set ke array kosong.
export const disabledWorkerPlugins = [];
