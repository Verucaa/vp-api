import { safeFetch } from "../../plugin-runtime.js";

/* ===== KONFIG ===== */
const BASE_URL = "https://h5-api.aoneroom.com";
const PLAY_HOST = "https://themoviebox.xyz";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const ALLOWED_HOSTS = [
  "h5-api.aoneroom.com",
  "themoviebox.xyz",
  "www.themoviebox.xyz",
];

let cachedToken = null;

export const RANKING_LISTS = {
  TRENDING_NOW: "872031290915189720",
  TRENDING_MOVIE: "8821254238245470240",
  TRENDING_DRAMA: "8617025562613270856",
  TRENDING_ANIME: "567783349092340776",
  INDO_FILM: "6528093688173053896",
  K_DRAMA: "4380734070238626200",
  INDO_DRAMA: "5283462032510044280",
  ANIME: "8617025562613270856",
  HOLLYWOOD: "1469286917119311888",
  C_DRAMA: "8624142774394406504",
  INDO_HORROR: "5848753831881965888",
  THAI_DRAMA: "1164329479448281992",
  SHORT_TV: "567783349092340776",
  FUNNY_HORROR_CRIME: "3528002473103362040",
  INDO_DUBBED: "5549742004948601072",
  RECENTLY_ADDED: "4019055174353407000",
  INDONESIAN_KILLERS: "5863917898430924656",
  HAPPY_LIFE: "4993310637209048808",
  RUN_ESCAPE_DEATH: "8703838933408530536",
  BAD_ROMANCE: "4539350473970797944",
  CYBERPUNK: "3766111568753312664",
  MONSTER_TITAN: "1653005382303864120",
  SEA_ADVENTURE: "6708972608207443352"
};

/* ===== HELPERS ===== */
async function initToken(signal) {
  const homeUrl = `${BASE_URL}/wefeed-h5api-bff/home?host=themoviebox.xyz`;
  const res = await safeFetch(homeUrl, {
    allowedHosts: ALLOWED_HOSTS,
    headers: { "User-Agent": UA },
    signal
  }, 15000);

  if (!res.ok) {
    throw new Error(`Failed to contact Moviebox Home API. Status: ${res.status}`);
  }

  // 1. Coba ambil dari Set-Cookie
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const match = setCookie.match(/token=([^;]+)/);
    if (match) {
      cachedToken = match[1];
      return cachedToken;
    }
  }

  // 2. Coba ambil dari header X-User
  const xUser = res.headers.get("x-user");
  if (xUser) {
    try {
      const parsed = JSON.parse(xUser);
      if (parsed.token) {
        cachedToken = parsed.token;
        return cachedToken;
      }
    } catch (e) {}
  }

  throw new Error("Failed to retrieve token from Home API response headers");
}

async function request(path, options = {}, signal, retryCount = 0) {
  if (!cachedToken) {
    await initToken(signal);
  }

  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": UA,
    Authorization: `Bearer ${cachedToken}`,
    ...(options.headers || {})
  };

  const fetchOptions = {
    ...options,
    method: options.method || "GET",
    headers,
    allowedHosts: ALLOWED_HOSTS,
    signal
  };

  const res = await safeFetch(url, fetchOptions, 20000);
  const text = await res.text();
  
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON response: ${text.substring(0, 200)}`);
  }

  // Auto re-authenticate jika token expired (hanya 1x percobaan)
  if (data && (data.code === 400 || data.message === "invalid token") && retryCount === 0) {
    cachedToken = null; // Reset cache
    return request(path, options, signal, 1); // Retry
  }

  return data;
}

async function apiGet(path, searchParams = {}, headers = {}, signal) {
  const query = new URLSearchParams(searchParams).toString();
  const fullPath = query ? `${path}?${query}` : path;
  return request(fullPath, { method: "GET", headers }, signal);
}

async function apiPost(path, body = {}, headers = {}, signal) {
  return request(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  }, signal);
}

/* ===== ACTIONS ===== */
async function getHome(signal) {
  return apiGet("/wefeed-h5api-bff/home", { host: "themoviebox.xyz" }, {}, signal);
}

async function getTrending(page = 0, perPage = 18, isMovie = false, signal) {
  const params = { page, perPage };
  if (isMovie) params.tabId = "ONEROOM_MOVIE";
  return apiGet("/wefeed-h5api-bff/subject/trending", params, {}, signal);
}

async function search(keyword, page = 1, perPage = 10, subjectType = 0, signal) {
  return apiPost("/wefeed-h5api-bff/subject/search", { keyword, page, perPage, subjectType }, {}, signal);
}

async function getDetail(detailPath, signal) {
  return apiGet("/wefeed-h5api-bff/detail", { detailPath }, {}, signal);
}

async function getDetailRec(subjectId, page = 1, perPage = 12, signal) {
  return apiGet("/wefeed-h5api-bff/subject/detail-rec", { subjectId, page, perPage }, {}, signal);
}

async function getStream(subjectId, detailPath, se = 0, ep = 0, signal) {
  const slug = detailPath.split("/").filter(Boolean).pop() || detailPath;
  const referer = `${PLAY_HOST}/movies/${slug}`;
  const playUrl = `${PLAY_HOST}/wefeed-h5api-bff/subject/play`;

  return apiGet(playUrl, {
    subjectId,
    se,
    ep,
    detailPath,
    streamSignType: 1
  }, {
    Referer: referer
  }, signal);
}

async function filterMovie(opts, signal) {
  const payload = {
    page: opts.page || 1,
    perPage: opts.perPage || 28,
    channelId: 1,
    genre: opts.genre || "All",
    country: opts.country || "All",
    year: opts.year || "All",
    sort: opts.sort || "ForYou",
    classify: opts.classify || "All"
  };
  return apiPost("/wefeed-h5api-bff/subject/filter", payload, {}, signal);
}

async function filterTv(opts, signal) {
  const payload = {
    page: opts.page || 1,
    perPage: opts.perPage || 28,
    channelId: 2,
    country: opts.country || "All",
    sort: opts.sort || "ForYou",
    rate: opts.rate || ["0", "10"],
    classify: opts.classify || "All"
  };
  return apiPost("/wefeed-h5api-bff/subject/filter", payload, {}, signal);
}

async function filterAnimation(opts, signal) {
  const payload = {
    page: opts.page || 1,
    perPage: opts.perPage || 28,
    channelId: 1006,
    country: opts.country || "All",
    year: opts.year || "All",
    sort: opts.sort || "ForYou"
  };
  return apiPost("/wefeed-h5api-bff/subject/filter", payload, {}, signal);
}

async function getRankingList(rankingListId, page = 1, perPage = 12, signal) {
  const id = RANKING_LISTS[rankingListId] || rankingListId;
  return apiGet("/wefeed-h5api-bff/ranking-list/content", { id, page, perPage }, {}, signal);
}

async function getMovieTab(signal) {
  return apiGet("/wefeed-h5api-bff/tab-operating", { tabId: "ONEROOM_MOVIE", host: "themoviebox.xyz" }, {}, signal);
}

/* ===== PLUGIN ===== */
export default {
  name: "MovieBox",
  category: "film",
  method: ["GET", "POST"],
  timeout: 60_000,
  routes: {
    home: {
      description: "Homepage MovieBox: banners, platforms, popular sections.",
      cache: 300,
      params: {},
      execute: async (_r, _s, { signal }) => getHome(signal),
    },
    trending: {
      description: "Trending items (movie atau all).",
      cache: 120,
      params: {
        page: { type: "number", minimum: 0, maximum: 500, description: "Halaman (default 0)" },
        perPage: { type: "number", minimum: 1, maximum: 100, description: "Item per halaman (default 18)" },
        type: { type: "string", enum: ["all", "movie"], description: "Tipe trending (default all)" },
      },
      execute: async (_r, _s, { input, signal }) =>
        getTrending(input.page || 0, input.perPage || 18, input.type === "movie", signal),
    },
    search: {
      description: "Cari film/series MovieBox.",
      params: {
        query: { type: "string", required: true, maxLength: 200, description: "Kata kunci" },
        page: { type: "number", minimum: 1, maximum: 500, description: "Halaman (default 1)" },
        perPage: { type: "number", minimum: 1, maximum: 100, description: "Item per halaman (default 10)" },
        type: { type: "number", minimum: 0, maximum: 6, description: "0=All, 1=Movies, 2=Series, 6=Music" },
      },
      execute: async (_r, _s, { input, signal }) =>
        search(input.query, input.page || 1, input.perPage || 10, input.type || 0, signal),
    },
    detail: {
      description: "Detail film/series berdasarkan detailPath.",
      cache: 120,
      params: {
        path: { type: "string", required: true, maxLength: 255, description: "detailPath dari hasil search/trending" },
      },
      execute: async (_r, _s, { input, signal }) => getDetail(input.path, signal),
    },
    stream: {
      description: "Link streaming/play. Butuh subjectId dan detailPath.",
      params: {
        id: { type: "string", required: true, maxLength: 100, description: "subjectId" },
        path: { type: "string", required: true, maxLength: 255, description: "detailPath" },
        se: { type: "number", minimum: 0, maximum: 100, description: "Season (default 0)" },
        ep: { type: "number", minimum: 0, maximum: 2000, description: "Episode (default 0)" },
      },
      execute: async (_r, _s, { input, signal }) =>
        getStream(input.id, input.path, input.se || 0, input.ep || 0, signal),
    },
    ranking: {
      description: "Daftar ranking (Trending, Indo Film, dll).",
      cache: 300,
      params: {
        id: { type: "string", required: true, maxLength: 100, description: "Nama ranking (mis. TRENDING_NOW) atau ID" },
        page: { type: "number", minimum: 1, maximum: 500, description: "Halaman (default 1)" },
      },
      execute: async (_r, _s, { input, signal }) =>
        getRankingList(input.id, input.page || 1, 12, signal),
    },
    filter_movie: {
      description: "Filter daftar film.",
      params: {
        genre: { type: "string", description: "Genre (default All)" },
        country: { type: "string", description: "Negara (default All)" },
        page: { type: "number", minimum: 1, description: "Halaman (default 1)" },
      },
      execute: async (_r, _s, { input, signal }) =>
        filterMovie({ genre: input.genre, country: input.country, page: input.page }, signal),
    },
    filter_tv: {
      description: "Filter daftar TV shows.",
      params: {
        country: { type: "string", description: "Negara (default All)" },
        sort: { type: "string", description: "Urutan (default ForYou)" },
        page: { type: "number", minimum: 1, description: "Halaman (default 1)" },
      },
      execute: async (_r, _s, { input, signal }) =>
        filterTv({ country: input.country, sort: input.sort, page: input.page }, signal),
    },
    filter_animation: {
      description: "Filter daftar animasi.",
      params: {
        country: { type: "string", description: "Negara (default All)" },
        year: { type: "string", description: "Tahun (default All)" },
        page: { type: "number", minimum: 1, description: "Halaman (default 1)" },
      },
      execute: async (_r, _s, { input, signal }) =>
        filterAnimation({ country: input.country, year: input.year, page: input.page }, signal),
    },
    home_tabs: {
      description: "Ambil tab list (ONEROOM_MOVIE).",
      cache: 3600,
      params: {},
      execute: async (_r, _s, { signal }) => getMovieTab(signal),
    }
  },
};
