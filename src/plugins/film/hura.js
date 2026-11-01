import { safeFetch } from "../../plugin-runtime.js";

/* ===== CORE ===== */
const HURA = "https://hurawatch.sx";
const FALLBACK_KEY = "9e7096a7575623aa30c66e9cc987e411";
const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

const GENRE = { 28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western", 10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics" };

const SRV = {
  Server_1_VidCore: { movie: "https://vidcore.net/movie/", tv: "https://vidcore.net/tv/", suffix: "?autoPlay=true", domain: "vidcore.net", direct: true },
  Server_2_VidGod: { movie: "https://vidgod.net/movie/", tv: "https://vidgod.net/tv/", suffix: "", domain: "vidgod.net", direct: false },
  Server_3_VidNest: { movie: "https://vidnest.fun/movie/", tv: "https://vidnest.fun/tv/", suffix: "", domain: "vidnest.fun", direct: false },
  Server_4_VidFast: { movie: "https://vidfast.pro/movie/", tv: "https://vidfast.pro/tv/", suffix: "?autoPlay=true", domain: "vidfast.pro", direct: true },
  Server_5_VidSrcEmbed: { movie: "https://vidsrc-embed.ru/embed/movie/", tv: "https://vidsrc-embed.ru/embed/tv/", suffix: "", domain: "vidsrc-embed.ru", direct: false },
  Server_6_VidEasy: { movie: "https://player.videasy.net/movie/", tv: "https://player.videasy.net/tv/", suffix: "", domain: "player.videasy.net", direct: true },
};

const PLAYER_DOMAINS = ["vidcore.net", "vidfast.pro", "vidfast.vc"];
function playerAllowedHosts() {
  const h = ["enc-dec.app"];
  for (const d of PLAYER_DOMAINS) h.push(d, `www.${d}`, `cdn.${d}`, `api.${d}`);
  return h;
}
function assertDyn(u) {
  const h = new URL(u).hostname.toLowerCase();
  if (!PLAYER_DOMAINS.some((d) => h === d || h.endsWith("." + d))) throw new Error(`Host tidak diizinkan: ${h}`);
  return u;
}

let cachedKey = null;
async function getApiKey(signal) {
  if (cachedKey) return cachedKey;
  try {
    const r = await safeFetch(`${HURA}/config.js`, { allowedHosts: ["hurawatch.sx"], headers: { "User-Agent": UA }, signal }, 5000);
    if (!r.ok) throw 0;
    const m = (await r.text()).match(/TMDB_API_KEY\s*:\s*['"]([a-f0-9]+)['"]/i);
    if (m && m[1]) { cachedKey = m[1]; return cachedKey; }
  } catch {}
  cachedKey = FALLBACK_KEY;
  return cachedKey;
}

async function tmdb(path, params, key, signal) {
  const u = new URL(`${TMDB}/${path}`);
  u.searchParams.set("api_key", key);
  if (params) for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  const r = await safeFetch(u.href, { allowedHosts: ["api.themoviedb.org"], headers: { "User-Agent": UA, Accept: "application/json" }, signal }, 15000);
  if (!r.ok) throw new Error(`TMDB ${path} ${r.status}`);
  return await r.json();
}

function genStreams(id, type, s = 1, e = 1) {
  const o = {};
  for (const [k, p] of Object.entries(SRV)) o[k] = type === "movie" ? `${p.movie}${id}${p.suffix}` : `${p.tv}${id}/${s}/${e}${p.suffix}`;
  return o;
}

function fmt(it, ov = null) {
  const t = ov || it.media_type || (it.title ? "movie" : "tv");
  const title = it.title || it.name || "Untitled";
  const year = (it.release_date || it.first_air_date || "").split("-")[0] || "N/A";
  return {
    id: it.id, title, original_title: it.original_title || it.original_name || title, type: t, year,
    rating: it.vote_average ? parseFloat(it.vote_average.toFixed(1)) : 0.0,
    genres: (it.genre_ids || []).map((g) => GENRE[g] || g),
    overview: it.overview || "",
    poster_url: it.poster_path ? `${IMG}${it.poster_path}` : null,
    backdrop_url: it.backdrop_path ? `${IMG.replace("w500", "original")}${it.backdrop_path}` : null,
    streams: genStreams(it.id, t),
  };
}

async function getHome(signal) {
  const k = await getApiKey(signal);
  const [tv, mv, tw, sw, tr, up] = await Promise.all([
    tmdb("trending/tv/day", null, k, signal), tmdb("trending/movie/day", null, k, signal),
    tmdb("trending/movie/week", null, k, signal), tmdb("trending/tv/week", null, k, signal),
    tmdb("movie/top_rated", { page: 1 }, k, signal), tmdb("movie/upcoming", { page: 1 }, k, signal),
  ]);
  const banner = [...tv.results.slice(0, 3).map((i) => ({ ...i, media_type: "tv" })), ...mv.results.slice(0, 3).map((i) => ({ ...i, media_type: "movie" }))].map((i) => fmt(i));
  return { hero_banner: banner, trending_movies: tw.results.slice(0, 20).map((i) => fmt(i, "movie")), trending_series: sw.results.slice(0, 20).map((i) => fmt(i, "tv")), all_time_best: tr.results.slice(0, 20).map((i) => fmt(i, "movie")), upcoming: up.results.slice(0, 20).map((i) => fmt(i, "movie")) };
}

async function getMovies(filter, page, signal) {
  const ok = ["popular", "top_rated", "now_playing", "upcoming"];
  if (!ok.includes(filter)) throw new Error(`Filter movies tidak valid. Pilih: ${ok.join(", ")}`);
  const k = await getApiKey(signal), d = await tmdb(`movie/${filter}`, { page }, k, signal);
  return { filter, page: d.page, total_pages: Math.min(d.total_pages, 500), total_results: d.total_results, results: d.results.map((i) => fmt(i, "movie")) };
}

async function getTV(filter, page, signal) {
  const ok = ["popular", "top_rated", "on_the_air", "airing_today"];
  let f = filter;
  if (filter === "on_air" || filter === "on-air") f = "on_the_air";
  if (filter === "airing_today" || filter === "airing-today") f = "airing_today";
  if (!ok.includes(f)) throw new Error(`Filter TV tidak valid. Pilih: ${ok.join(", ")}`);
  const k = await getApiKey(signal), d = await tmdb(`tv/${f}`, { page }, k, signal);
  return { filter: f, page: d.page, total_pages: Math.min(d.total_pages, 500), total_results: d.total_results, results: d.results.map((i) => fmt(i, "tv")) };
}

async function getTopIMDb(type, page, signal) {
  if (!["movie", "tv"].includes(type)) throw new Error(`type harus movie/tv`);
  const k = await getApiKey(signal), d = await tmdb(`${type}/top_rated`, { page }, k, signal);
  return { media_type: type, page: d.page, total_pages: Math.min(d.total_pages, 500), total_results: d.total_results, results: d.results.map((it, i) => { const f = fmt(it, type); f.imdb_rank = (page - 1) * 20 + i + 1; return f; }) };
}

async function doSearch(query, page, signal) {
  const k = await getApiKey(signal), d = await tmdb("search/multi", { query, page }, k, signal);
  return { query, page: d.page, total_pages: d.total_pages, total_results: d.total_results, results: d.results.filter((i) => i.media_type !== "person").map((i) => fmt(i)) };
}

async function getDetail(id, type, signal) {
  const k = await getApiKey(signal);
  if (type === "tv") {
    const [dt, cr, sm] = await Promise.all([tmdb(`tv/${id}`, null, k, signal), tmdb(`tv/${id}/credits`, null, k, signal), tmdb(`tv/${id}/similar`, null, k, signal)]);
    const seasons = [];
    for (let s = 1; s <= (dt.number_of_seasons || 0); s++) {
      try {
        const sd = await tmdb(`tv/${id}/season/${s}`, null, k, signal);
        seasons.push({ season_number: s, name: sd.name || `Season ${s}`, overview: sd.overview || "", air_date: sd.air_date || "N/A", poster_url: sd.poster_path ? `${IMG}${sd.poster_path}` : null, episodes: (sd.episodes || []).map((e) => ({ id: e.id, episode_number: e.episode_number, name: e.name, overview: e.overview || "", air_date: e.air_date || "N/A", rating: e.vote_average ? parseFloat(e.vote_average.toFixed(1)) : 0.0, still_path: e.still_path ? `${IMG}${e.still_path}` : null, streams: genStreams(id, "tv", s, e.episode_number) })) });
      } catch {}
    }
    const f = fmt(dt, "tv");
    f.genres = (dt.genres || []).map((g) => g.name);
    f.cast = (cr.cast || []).slice(0, 10).map((c) => ({ name: c.name, character: c.character, profile_url: c.profile_path ? `${IMG}${c.profile_path}` : null }));
    f.creators = (dt.created_by || []).map((c) => c.name);
    f.similar_shows = (sm.results || []).slice(0, 10).map((i) => fmt(i, "tv"));
    f.number_of_seasons = dt.number_of_seasons || 0;
    f.number_of_episodes = dt.number_of_episodes || 0;
    f.status = dt.status || "";
    f.seasons = seasons;
    return f;
  }
  const [dt, cr, sm] = await Promise.all([tmdb(`movie/${id}`, null, k, signal), tmdb(`movie/${id}/credits`, null, k, signal), tmdb(`movie/${id}/similar`, null, k, signal)]);
  const f = fmt(dt, "movie");
  f.genres = (dt.genres || []).map((g) => g.name);
  f.cast = (cr.cast || []).slice(0, 10).map((c) => ({ name: c.name, character: c.character, profile_url: c.profile_path ? `${IMG}${c.profile_path}` : null }));
  f.directors = (cr.crew || []).filter((c) => c.job === "Director").map((c) => c.name);
  f.similar_movies = (sm.results || []).slice(0, 10).map((i) => fmt(i, "movie"));
  f.tagline = dt.tagline || "";
  f.status = dt.status || "";
  f.budget = dt.budget || 0;
  f.revenue = dt.revenue || 0;
  f.runtime_minutes = dt.runtime || 0;
  return f;
}

function getStreams(id, type, s, e) {
  const srv = [];
  for (const [name, p] of Object.entries(SRV)) srv.push({ server: name, domain: p.domain, supportsDirect: p.direct, url: type === "movie" ? `${p.movie}${id}${p.suffix}` : `${p.tv}${id}/${s}/${e}${p.suffix}` });
  return { id: String(id), type, season: type === "tv" ? s : null, episode: type === "tv" ? e : null, total: srv.length, servers: srv };
}

async function getDirectVideasy(id, type, s, e, signal) {
  const k = await getApiKey(signal), det = await tmdb(`${type}/${id}`, null, k, signal);
  const title = det.title || det.name || "", year = (det.release_date || det.first_air_date || "").split("-")[0] || "", imdb = det.imdb_id || "";
  const encT = encodeURIComponent(encodeURIComponent(title));
  const hdr = { Accept: "*/*", Origin: "https://player.videasy.to", Referer: "https://player.videasy.to/", "User-Agent": UA };
  const sr = await safeFetch(`https://api.wingsdatabase.com/seed?mediaId=${id}`, { allowedHosts: ["api.wingsdatabase.com"], headers: hdr, signal }, 15000);
  if (!sr.ok) throw new Error(`seed ${sr.status}`);
  const seed = (await sr.json()).seed;
  const sUrl = type === "tv"
    ? `https://api.wingsdatabase.com/cdn/sources-with-title?title=${encT}&mediaType=tv&year=${year}&episodeId=${e}&seasonId=${s}&tmdbId=${id}&imdbId=${imdb}&enc=2&seed=${seed}`
    : `https://api.wingsdatabase.com/cdn/sources-with-title?title=${encT}&mediaType=movie&year=${year}&tmdbId=${id}&imdbId=${imdb}&enc=2&seed=${seed}`;
  const src = await safeFetch(sUrl, { allowedHosts: ["api.wingsdatabase.com"], headers: hdr, signal }, 15000);
  if (!src.ok) throw new Error(`src ${src.status}`);
  const enc = await src.json();
  const dec = await safeFetch("https://enc-dec.app/api/dec-videasy", { allowedHosts: ["enc-dec.app"], method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify({ text: enc, id: String(id), seed }), signal }, 15000);
  if (!dec.ok) throw new Error(`dec ${dec.status}`);
  const j = await dec.json();
  if (j.status !== 200) throw new Error(j.error || "Decrypt failed");
  return { player: "videasy", status: "success", result: j.result };
}

async function resolvePage(cfg, id, type, s, e, signal) {
  const base = type === "tv" ? `https://${cfg.domain}/tv/${id}/${s}/${e}/` : `https://${cfg.domain}/movie/${id}/`;
  const pg = await safeFetch(base, { allowedHosts: playerAllowedHosts(), headers: { "User-Agent": UA }, signal }, 15000);
  if (!pg.ok) throw new Error(`page ${pg.status}`);
  const m = (await pg.text()).match(/\\"en\\":\\"(.*?)\\"/) || (await pg.text()).match(/"en":"(.*?)"/);
  if (!m) throw new Error(`enc content tidak ada di ${cfg.domain}`);
  const parts = await safeFetch(`https://enc-dec.app/api/enc-${cfg.key}?text=${encodeURIComponent(m[1])}`, { allowedHosts: ["enc-dec.app"], headers: { "User-Agent": UA }, signal }, 15000);
  if (!parts.ok) throw new Error(`enc ${parts.status}`);
  const pd = await parts.json();
  if (pd.status !== 200) throw new Error(pd.error || "enc fail");
  const { servers, stream, token } = pd.result;
  const hdr = { "User-Agent": UA, Referer: `https://${cfg.domain}/`, "X-Requested-With": "XMLHttpRequest", "X-CSRF-Token": token, "Content-Type": "application/json" };
  assertDyn(servers);
  const sE = await safeFetch(servers, { allowedHosts: playerAllowedHosts(), method: "POST", headers: hdr, body: "{}", signal }, 15000);
  if (!sE.ok) throw new Error(`srv ${sE.status}`);
  const sD = await safeFetch(`https://enc-dec.app/api/dec-${cfg.key}`, { allowedHosts: ["enc-dec.app"], method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify({ text: await sE.text() }), signal }, 15000);
  if (!sD.ok) throw new Error(`dec-srv ${sD.status}`);
  const sJ = await sD.json();
  if (sJ.status !== 200) throw new Error("dec srv fail");
  const stUrl = `${stream}/${sJ.result[0].data}`;
  assertDyn(stUrl);
  const stE = await safeFetch(stUrl, { allowedHosts: playerAllowedHosts(), method: "POST", headers: hdr, body: "{}", signal }, 15000);
  if (!stE.ok) throw new Error(`st ${stE.status}`);
  const stD = await safeFetch(`https://enc-dec.app/api/dec-${cfg.key}`, { allowedHosts: ["enc-dec.app"], method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify({ text: await stE.text() }), signal }, 15000);
  if (!stD.ok) throw new Error(`dec-st ${stD.status}`);
  const stJ = await stD.json();
  if (stJ.status !== 200) throw new Error("dec st fail");
  return { player: cfg.key, status: "success", result: stJ.result };
}

async function getDirect(id, type, s, e, player, signal) {
  const p = String(player || "videasy").toLowerCase(), t = type === "tv" ? "tv" : "movie";
  if (t === "tv" && (s == null || e == null)) throw new Error("season dan episode wajib untuk TV");
  if (p === "videasy") return await getDirectVideasy(id, t, s, e, signal);
  const map = { vidcore: { key: "vidcore", domain: "vidcore.net" }, vidfast: { key: "vidfast", domain: "vidfast.pro" } };
  if (!map[p]) throw new Error(`Player tidak didukung untuk direct: ${player}. Pilih videasy, vidcore, vidfast.`);
  return await resolvePage(map[p], id, t, s, e, signal);
}

/* ===== PLUGIN: 1 file → 8 sub-route ===== */
export default {
  name: "Hura",
  category: "film",
  method: ["GET", "POST"],
  timeout: 120_000,
  routes: {
    home: { description: "Home sections: hero banner, trending, top rated, upcoming.", params: {}, execute: async (_r, _s, { signal }) => getHome(signal) },
    movies: {
      description: "Katalog movies.",
      timeout: 60_000,
      params: { filter: { type: "string", enum: ["popular", "top_rated", "now_playing", "upcoming"], description: "Filter (default popular)" }, page: { type: "number", minimum: 1, maximum: 500 } },
      execute: async (_r, _s, { input, signal }) => getMovies(input.filter || "popular", input.page || 1, signal),
    },
    tv: {
      description: "Katalog TV shows.",
      timeout: 60_000,
      params: { filter: { type: "string", enum: ["popular", "top_rated", "on_the_air", "airing_today"], description: "Filter (default popular)" }, page: { type: "number", minimum: 1, maximum: 500 } },
      execute: async (_r, _s, { input, signal }) => getTV(input.filter || "popular", input.page || 1, signal),
    },
    "top-imdb": {
      description: "Chart Top IMDb dengan nomor peringkat.",
      timeout: 60_000,
      params: { type: { type: "string", enum: ["movie", "tv"], description: "Tipe (default movie)" }, page: { type: "number", minimum: 1, maximum: 500 } },
      execute: async (_r, _s, { input, signal }) => getTopIMDb(input.type || "movie", input.page || 1, signal),
    },
    search: {
      description: "Pencarian multi (movie & TV) via TMDB.",
      timeout: 60_000,
      params: { query: { type: "string", required: true, maxLength: 200 }, page: { type: "number", minimum: 1, maximum: 500 } },
      execute: async (_r, _s, { input, signal }) => doSearch(input.query, input.page || 1, signal),
    },
    detail: {
      description: "Detail lengkap + seasons/episodes + URL stream per server.",
      timeout: 120_000,
      params: { id: { type: "number", required: true, minimum: 1 }, type: { type: "string", enum: ["movie", "tv"], description: "Tipe (default movie)" } },
      execute: async (_r, _s, { input, signal }) => getDetail(input.id, input.type === "tv" ? "tv" : "movie", signal),
    },
    streams: {
      description: "URL embed 6 server + flag supportsDirect.",
      timeout: 30_000,
      params: { id: { type: "number", required: true, minimum: 1 }, type: { type: "string", enum: ["movie", "tv"] }, season: { type: "number", minimum: 1, maximum: 100 }, episode: { type: "number", minimum: 1, maximum: 2000 } },
      execute: async (_r, _s, { input }) => {
        const t = input.type || "movie";
        if (t === "tv" && (input.season == null || input.episode == null)) throw new Error("season dan episode wajib untuk TV");
        return getStreams(input.id, t, input.season, input.episode);
      },
    },
    direct: {
      description: "Resolusi direct .m3u8 (videasy/vidcore/vidfast).",
      timeout: 120_000,
      params: { id: { type: "number", required: true, minimum: 1 }, type: { type: "string", enum: ["movie", "tv"] }, season: { type: "number", minimum: 1, maximum: 100 }, episode: { type: "number", minimum: 1, maximum: 2000 }, player: { type: "string", enum: ["videasy", "vidcore", "vidfast"], description: "Player (default videasy)" } },
      execute: async (_r, _s, { input, signal }) => {
        const t = input.type || "movie";
        if (t === "tv" && (input.season == null || input.episode == null)) throw new Error("season dan episode wajib untuk TV");
        return getDirect(input.id, t, input.season, input.episode, input.player || "videasy", signal);
      },
    },
  },
};
