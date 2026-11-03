import { safeFetch } from "../../plugin-runtime.js";

/* ===== KONFIG ===== */
const BASE_URL = "https://animeinweb.com/api/proxy";
const ALLOWED_HOSTS = ["animeinweb.com", "www.animeinweb.com"];

function getProxySecret() {
  try {
    if (typeof process !== "undefined" && process.env && process.env.ANIMEIN_PROXY_SECRET) {
      return process.env.ANIMEIN_PROXY_SECRET;
    }
  } catch {}
  return "animein-secure-proxy-key-123";
}

function headers() {
  return {
    "Accept": "application/json",
    "Referer": "https://animeinweb.com/",
    "Origin": "https://animeinweb.com",
    "x-proxy-secret": getProxySecret(),
  };
}

/* ===== REQUEST INTI ===== */
async function apiRequest(path, params, signal) {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const res = await safeFetch(
    url.href,
    { allowedHosts: ALLOWED_HOSTS, headers: headers(), signal },
    20000
  );
  if (!res.ok) throw new Error(`AnimeIn HTTP ${res.status}`);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`AnimeIn non-JSON response (${res.status})`); }
  if (json?.error || json?.status !== 200) {
    throw new Error(json?.message || `AnimeIn status ${json?.status}`);
  }
  return json?.data;
}

/* ===== HELPER VALIDASI ID ===== */
function normalizeId(id) {
  return String(id ?? "").trim();
}

function assertIdMatch(kind, requested, actual, hint) {
  if (actual == null || actual === "") return;
  const req = normalizeId(requested);
  const act = normalizeId(actual);
  if (req !== act) {
    throw new Error(
      `AnimeIn mengembalikan ${kind} yang tidak cocok. ` +
      `Diminta id=${req}, diterima id=${act}. ${hint || ""}`.trim()
    );
  }
}

/* ===== ACTIONS ===== */
async function getHome(day, limit, signal) {
  return await apiRequest("/3/2/home/data", { day: day || "SENIN", limit: String(limit || 20) }, signal);
}

async function search(keyword, page, sort, genreIds, signal) {
  const params = { page: String(page ?? 0), sort: sort || "views", keyword: keyword || "" };
  if (Array.isArray(genreIds) && genreIds.length > 0) params.genre_in = genreIds.join(",");
  return await apiRequest("/3/2/explore/movie", params, signal);
}

async function getGenres(signal) {
  return await apiRequest("/3/2/explore/genre", null, signal);
}

async function getSchedule(day, signal) {
  return await apiRequest("/3/2/schedule/data", { day: day || "SENIN" }, signal);
}

async function getDetail(movieId, signal) {
  const requestedId = normalizeId(movieId);
  const data = await apiRequest(`/3/2/movie/detail/${encodeURIComponent(requestedId)}`, null, signal);
  assertIdMatch(
    "movie",
    requestedId,
    data?.movie?.id,
    "Pastikan 'id' adalah ID movie AnimeIn (bukan ID episode)."
  );
  return data;
}

async function getEpisodes(movieId, page, searchStr, signal) {
  const params = { page: String(page ?? 0) };
  if (searchStr) params.search = searchStr;
  return await apiRequest(`/3/2/movie/episode/${encodeURIComponent(normalizeId(movieId))}`, params, signal);
}

async function getAllEpisodes(movieId, maxPages, signal) {
  const all = [];
  const seen = new Set();
  const cap = Math.min(Math.max(Number(maxPages) || 20, 1), 50);
  for (let p = 0; p < cap; p++) {
    const res = await getEpisodes(movieId, p, "", signal);
    const list = res?.episode || [];
    if (list.length === 0) break;
    let added = 0;
    for (const item of list) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        all.push(item);
        added++;
      }
    }
    if (added === 0) break;
  }
  return all.sort((a, b) => Number(a.index) - Number(b.index));
}

async function getStream(episodeId, signal) {
  const requestedId = normalizeId(episodeId);
  const data = await apiRequest(
    `/3/2/episode/streamnew/${encodeURIComponent(requestedId)}`,
    null,
    signal
  );
  assertIdMatch(
    "episode",
    requestedId,
    data?.episode?.id,
    "Pastikan 'id' yang dikirim adalah ID episode (bukan ID movie). " +
    "Dapatkan ID episode lewat /anime/animein/episodes?id=<movieId>."
  );
  return data;
}

async function getTrailers(movieId, signal) {
  return await apiRequest("/data/movie/trailer/list", { id_movie: normalizeId(movieId) }, signal);
}

async function getAllComplete(movieId, opts, signal) {
  const withStreams = opts.withStreams === true;
  const maxStreams = Math.min(Math.max(Number(opts.maxStreams) || 20, 1), 100);

  const detail = await getDetail(movieId, signal);
  const episodes = await getAllEpisodes(movieId, 20, signal);

  let trailers = [];
  try {
    const t = await getTrailers(movieId, signal);
    trailers = t?.trailer || [];
  } catch {}

  if (!withStreams) {
    return {
      movie: detail.movie,
      seasons: detail.season || [],
      trailers,
      total_episodes: episodes.length,
      episodes,
    };
  }

  const limited = episodes.slice(0, maxStreams);
  const episodesWithStream = [];
  for (const ep of limited) {
    try {
      const stream = await getStream(ep.id, signal);
      episodesWithStream.push({ ...ep, streams: stream?.server || [] });
    } catch (err) {
      episodesWithStream.push({ ...ep, streams: [], stream_error: err.message });
    }
  }

  return {
    movie: detail.movie,
    seasons: detail.season || [],
    trailers,
    total_episodes: episodes.length,
    streams_fetched: episodesWithStream.length,
    episodes: episodesWithStream,
  };
}

/* ===== PLUGIN: 1 file → 9 sub-route ===== */
export default {
  name: "AnimeIn",
  category: "anime",
  method: ["GET", "POST"],
  timeout: 120_000,
  routes: {
    home: {
      description: "Beranda: fyp, hot, new, today, popular, waiting, random, slider.",
      timeout: 30_000,
      cache: 120,
      params: {
        day: { type: "string", enum: ["SENIN","SELASA","RABU","KAMIS","JUMAT","SABTU","MINGGU"], description: "Hari (default SENIN)" },
        limit: { type: "number", minimum: 1, maximum: 100, description: "Jumlah item (default 20)" },
      },
      execute: async (_r, _s, { input, signal }) => getHome(input.day, input.limit, signal),
    },

    search: {
      description: "Cari anime berdasarkan judul, atau filter genre/sort.",
      timeout: 30_000,
      params: {
        query: { type: "string", maxLength: 200, description: "Kata kunci (boleh kosong untuk browse)" },
        page: { type: "number", minimum: 0, maximum: 500, description: "Halaman (default 0)" },
        sort: { type: "string", enum: ["views", "latest", "popular"], description: "Sort (default views)" },
        genre: { type: "string", maxLength: 200, description: "ID genre dipisah koma, mis. 1,2,3" },
      },
      execute: async (_r, _s, { input, signal }) => {
        const genreIds = String(input.genre || "").split(",").map((s) => s.trim()).filter(Boolean);
        return await search(input.query || "", input.page ?? 0, input.sort, genreIds, signal);
      },
    },

    genres: {
      description: "Daftar seluruh genre yang tersedia.",
      timeout: 20_000,
      cache: 3600,
      params: {},
      execute: async (_r, _s, { signal }) => getGenres(signal),
    },

    schedule: {
      description: "Jadwal rilis mingguan per hari.",
      timeout: 20_000,
      cache: 1800,
      params: {
        day: { type: "string", enum: ["SENIN","SELASA","RABU","KAMIS","JUMAT","SABTU","MINGGU"], description: "Hari (default SENIN)" },
      },
      execute: async (_r, _s, { input, signal }) => getSchedule(input.day, signal),
    },

    detail: {
      description: "Detail anime (by ID movie AnimeIn, bukan ID episode). Movie/episode/season terkait.",
      timeout: 30_000,
      cache: 60,
      params: {
        id: { type: "string", required: true, maxLength: 100, description: "ID movie AnimeIn (string, bisa numeric panjang)" },
      },
      execute: async (_r, _s, { input, signal }) => getDetail(input.id, signal),
    },

    episodes: {
      description: "Seluruh daftar episode satu anime (auto-paginate). Pakai ID movie.",
      timeout: 60_000,
      cache: 60,
      params: {
        id: { type: "string", required: true, maxLength: 100, description: "ID movie AnimeIn" },
        maxPages: { type: "number", minimum: 1, maximum: 50, description: "Batas halaman fetch (default 20)" },
      },
      execute: async (_r, _s, { input, signal }) => {
        const list = await getAllEpisodes(input.id, input.maxPages ?? 20, signal);
        return { total: list.length, episode: list };
      },
    },

    stream: {
      description:
        "Server streaming & direct MP4 untuk SATU EPISODE. " +
        "PENTING: 'id' adalah ID EPISODE (bukan ID movie). " +
        "Ambil ID episode dulu lewat /anime/animein/episodes?id=<movieId>. " +
        "URL player butuh header Referer https://animeinweb.com/ saat diputar/diunduh.",
      timeout: 30_000,
      params: {
        id: { type: "string", required: true, maxLength: 100, description: "ID episode AnimeIn (string)" },
      },
      execute: async (_r, _s, { input, signal }) => getStream(input.id, signal),
    },

    trailers: {
      description: "Daftar trailer YouTube resmi untuk movie (by ID movie).",
      timeout: 20_000,
      cache: 300,
      params: {
        id: { type: "string", required: true, maxLength: 100, description: "ID movie AnimeIn" },
      },
      execute: async (_r, _s, { input, signal }) => getTrailers(input.id, signal),
    },

    all: {
      description: "Bundle: detail + seasons + semua episode + trailer. Set withStreams=true untuk menyertakan stream per episode (mahal).",
      timeout: 180_000,
      params: {
        id: { type: "string", required: true, maxLength: 100, description: "ID movie AnimeIn" },
        withStreams: { type: "boolean", description: "Sertakan streams per episode (default false)" },
        maxStreams: { type: "number", minimum: 1, maximum: 100, description: "Batas episode yang di-resolve stream (default 20)" },
      },
      execute: async (_r, _s, { input, signal }) =>
        getAllComplete(input.id, { withStreams: input.withStreams, maxStreams: input.maxStreams }, signal),
    },
  },
};
