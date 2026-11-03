import { safeFetch } from "../../plugin-runtime.js";
import crypto from "node:crypto";

/* ===== KONFIG ===== */
const H5 = "https://h5-api.aoneroom.com/wefeed-h5api-bff";
const MOBILE = "https://api3.aoneroom.com";
const HOST = "officialmoviebox.com";
const GATEWAY_KEY = Buffer.from("76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O", "base64");

const ALLOWED_HOSTS = [
  "h5-api.aoneroom.com",
  "api3.aoneroom.com",
  "officialmoviebox.com",
  "www.officialmoviebox.com",
];

const UA_H5 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const UA_MOB =
  "com.community.oneroom/50020126 (Linux; U; Android 14; en_US; Pixel 6; Build/UQ1A)";

let guestJwt = null;

/* ===== HELPER ===== */
function md5hex(s) {
  return crypto.createHash("md5").update(s).digest("hex");
}

function clientToken() {
  const ts = String(Date.now());
  return ts + "," + md5hex(ts.split("").reverse().join(""));
}

function clientInfo() {
  return JSON.stringify({
    package_name: "com.community.oneroom",
    version_name: "4.0.02",
    version_code: 50020126,
    os: "android",
    os_version: "14",
    device_id: "868203051234567",
    brand: "Google",
    model: "Pixel 6",
    system_language: "en",
    net: "wifi",
    region: "IN",
    timezone: "Asia/Kolkata",
    sp_code: "404",
  });
}

function trSignature(method, fullUrl, body) {
  const ts = Date.now();
  const u = new URL(fullUrl);
  const params = [...u.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const qs = params.map(([k, v]) => k + "=" + v).join("&");
  const resource = u.pathname + (qs ? "?" + qs : "");
  const bodyStr = body || "";
  const bodyMd5 = bodyStr ? md5hex(bodyStr.slice(0, 0x19000)) : "";
  const canon = [
    method.toUpperCase(),
    "application/json",
    "application/json;charset=UTF-8",
    bodyStr ? String(bodyStr.length) : "",
    String(ts),
    bodyMd5,
    resource,
  ].join("\n");
  const dig = crypto.createHmac("md5", GATEWAY_KEY).update(canon).digest("base64");
  return ts + "|2|" + dig;
}

async function httpGet(url, headers, signal) {
  const res = await safeFetch(
    url,
    { allowedHosts: ALLOWED_HOSTS, headers, signal },
    25000
  );
  const body = await res.text();
  return { status: res.status, response: res, body };
}

async function mobileGet(path, signal) {
  const url = MOBILE + path;
  const headers = {
    "User-Agent": UA_MOB,
    Accept: "application/json",
    "Content-Type": "application/json;charset=UTF-8",
    "X-M-Version": "4.0.02",
    "X-Client-Token": clientToken(),
    "X-Client-Info": clientInfo(),
    "X-Client-Status": "0",
    "x-tr-signature": trSignature("GET", url),
  };
  if (guestJwt) headers.Authorization = "Bearer " + guestJwt;
  return httpGet(url, headers, signal);
}

async function ensureGuest(signal) {
  if (guestJwt) return guestJwt;
  const r = await mobileGet("/wefeed-mobile-bff/tab-operating?page=1&tabId=0", signal);
  const raw =
    r.response.headers.get("x-user") ||
    r.response.headers.get("X-User") ||
    "";
  try {
    guestJwt = JSON.parse(raw).token;
  } catch {
    guestJwt = raw.startsWith("ey") ? raw : null;
  }
  if (!guestJwt) throw new Error("guest bootstrap failed");
  return guestJwt;
}

async function h5Get(path, signal) {
  const url = path.startsWith("http") ? path : H5 + path;
  const r = await httpGet(
    url,
    {
      "User-Agent": UA_H5,
      Accept: "application/json",
      Referer: "https://" + HOST + "/",
      Origin: "https://" + HOST,
    },
    signal
  );
  try {
    return JSON.parse(r.body);
  } catch {
    throw new Error("bad json");
  }
}

function decodeSignCookie(sc) {
  if (!sc) return null;
  const m = String(sc).match(/urlprefix=([^:]+)/);
  if (!m) return null;
  try {
    const prefix = Buffer.from(m[1], "base64").toString("utf8");
    return {
      prefix,
      mpd: prefix.replace(/\/?$/, "/") + "index.mpd",
      m3u8: prefix.replace(/\/?$/, "/") + "index.m3u8",
    };
  } catch {
    return null;
  }
}

/* ===== ACTIONS ===== */
async function getHome(signal) {
  const j = await h5Get("/home?host=" + HOST, signal);
  if (j.code !== 0) throw new Error(j.message || "api error");
  const ops = (j.data && j.data.operatingList) || [];
  const out = {
    platforms: (j.data && j.data.platformList) || [],
    sections: [],
  };
  for (const sec of ops) {
    const items = [];
    if (sec.banner && sec.banner.items) {
      for (const b of sec.banner.items) {
        const s = b.subject || {};
        items.push({
          subjectId: s.subjectId || b.subjectId,
          title: s.title || b.title,
          type: s.subjectType,
          cover: (s.cover && s.cover.url) || (b.image && b.image.url),
          imdb: s.imdbRatingValue,
          genre: s.genre,
          releaseDate: s.releaseDate,
        });
      }
    }
    if (sec.subjects) {
      for (const s of sec.subjects) {
        items.push({
          subjectId: s.subjectId,
          title: s.title,
          type: s.subjectType,
          cover: s.cover && s.cover.url,
          imdb: s.imdbRatingValue,
          genre: s.genre,
          releaseDate: s.releaseDate,
        });
      }
    }
    out.sections.push({
      type: sec.type,
      title: sec.title,
      position: sec.position,
      items,
    });
  }
  return out;
}

async function getTrending(page, signal) {
  const j = await h5Get(
    "/subject/trending?page=" + (page || 0) + "&perPage=18",
    signal
  );
  if (j.code !== 0) throw new Error(j.message || "api error");
  return ((j.data && j.data.subjectList) || []).map((s) => ({
    subjectId: s.subjectId,
    title: s.title,
    type: s.subjectType,
    cover: s.cover && s.cover.url,
    imdb: s.imdbRatingValue,
    genre: s.genre,
    releaseDate: s.releaseDate,
    country: s.countryName,
    hasResource: s.hasResource,
  }));
}

async function getDetail(id, signal) {
  const j = await h5Get("/detail?subjectId=" + encodeURIComponent(String(id)), signal);
  if (j.code !== 0) throw new Error(j.message || "api error");
  const s = (j.data && j.data.subject) || {};
  return {
    subjectId: s.subjectId,
    title: s.title,
    type: s.subjectType,
    description: s.description,
    releaseDate: s.releaseDate,
    duration: s.duration,
    genre: s.genre,
    cover: s.cover && s.cover.url,
    country: s.countryName,
    imdb: s.imdbRatingValue,
    subtitles: s.subtitles,
    hasResource: s.hasResource,
    trailer: s.trailer && s.trailer.videoAddress && s.trailer.videoAddress.url,
  };
}

async function getPlay(id, se, ep, signal) {
  se = se === undefined || se === null ? 0 : Number(se);
  ep = ep === undefined || ep === null ? 0 : Number(ep);
  await ensureGuest(signal);

  const path =
    "/wefeed-mobile-bff/subject-api/play-info?subjectId=" +
    encodeURIComponent(String(id)) +
    "&se=" + se +
    "&ep=" + ep;
  const r = await mobileGet(path, signal);
  let j;
  try {
    j = JSON.parse(r.body);
  } catch {
    throw new Error("play bad json " + r.body.slice(0, 100));
  }
  if (j.code !== 0) throw new Error(j.message || "play error " + r.status);

  const d = j.data || {};
  const streams = [];
  for (const s of d.streams || []) {
    const decoded = decodeSignCookie(s.signCookie);
    streams.push({
      format: s.format,
      id: s.id,
      resolutions: s.resolutions,
      size: s.size,
      duration: s.duration,
      codec: s.codecName,
      trapUrl: s.url, // dummy — jangan dipakai
      signCookie: s.signCookie,
      dash: decoded && decoded.mpd,
      hls: decoded && decoded.m3u8,
      prefix: decoded && decoded.prefix,
      cookieHeader: s.signCookie
        ? "Edge-Cache-Cookie=" + String(s.signCookie).replace(/^Edge-Cache-Cookie=/, "")
        : null,
    });
  }

  return {
    subjectId: id,
    se,
    ep,
    title: d.title,
    streams,
    playUrl: streams[0] && streams[0].dash,
    playHls: streams[0] && streams[0].hls,
    note: streams.length
      ? "pakai dash/hls + Cookie header dari cookieHeader. trapUrl = dummy jangan dipakai"
      : "no streams",
  };
}

/* ===== PLUGIN: 1 file → 4 sub-route ===== */
export default {
  name: "MovieBox",
  category: "film",
  method: ["GET", "POST"],
  timeout: 60_000,
  routes: {
    home: {
      description: "Home sections MovieBox: platforms + operating list (banner/subjects).",
      timeout: 30_000,
      cache: 300,
      params: {},
      execute: async (_r, _s, { signal }) => getHome(signal),
    },
    trending: {
      description: "Daftar trending MovieBox (perPage=18).",
      timeout: 30_000,
      cache: 120,
      params: {
        page: { type: "number", minimum: 0, maximum: 500, description: "Halaman (default 0)" },
      },
      execute: async (_r, _s, { input, signal }) => getTrending(input.page || 0, signal),
    },
    detail: {
      description: "Detail subject MovieBox (movie/TV) berdasarkan subjectId.",
      timeout: 30_000,
      cache: 120,
      params: {
        id: { type: "string", required: true, maxLength: 100, description: "subjectId MovieBox (string numerik panjang)" },
      },
      execute: async (_r, _s, { input, signal }) => getDetail(input.id, signal),
    },
    play: {
      description: "Resolve stream (DASH .mpd / HLS .m3u8) untuk subject/episode. Pemutaran butuh header Cookie: Edge-Cache-Cookie=<signCookie>.",
      timeout: 60_000,
      params: {
        id: { type: "string", required: true, maxLength: 100, description: "subjectId MovieBox" },
        se: { type: "number", minimum: 0, maximum: 100, description: "Season index (0 untuk movie / default TV)" },
        ep: { type: "number", minimum: 0, maximum: 2000, description: "Episode index (0 untuk movie / default TV)" },
      },
      execute: async (_r, _s, { input, signal }) =>
        getPlay(input.id, input.se ?? 0, input.ep ?? 0, signal),
    },
  },
};
