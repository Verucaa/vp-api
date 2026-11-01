import { safeFetch } from "../../plugin-runtime.js";

/* ===== CORE ===== */
const BASE_URL = "https://7reels.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const PLAYER_DOMAINS = ["vidcore.net", "vidup.to", "vidfast.vc", "vidfast.pro", "vidfast.to"];
let cachedEmbedKey = null;

function playerAllowedHosts() {
  const hosts = ["enc-dec.app"];
  for (const d of PLAYER_DOMAINS) hosts.push(d, `www.${d}`, `cdn.${d}`, `api.${d}`);
  return hosts;
}
function assertDynamicPlayerUrl(u) {
  const h = new URL(u).hostname.toLowerCase();
  if (!PLAYER_DOMAINS.some((d) => h === d || h.endsWith("." + d))) throw new Error(`Host tidak diizinkan: ${h}`);
  return u;
}

async function getEmbedKey(signal) {
  if (cachedEmbedKey) return cachedEmbedKey;
  const headers = { "User-Agent": UA };
  try {
    const h = await safeFetch(BASE_URL, { allowedHosts: ["7reels.cc"], headers, signal }, 8000);
    if (!h.ok) throw 0;
    const m1 = (await h.text()).match(/(?:\/assets\/index-[a-zA-Z0-9]{8}\.js)/);
    if (!m1) throw 0;
    const m = await safeFetch(`${BASE_URL}${m1[0]}`, { allowedHosts: ["7reels.cc"], headers, signal }, 8000);
    if (!m.ok) throw 0;
    const m2 = (await m.text()).match(/([a-zA-Z0-9_-]*AdSafetyWarning-[a-zA-Z0-9]{8}\.js)/);
    if (!m2) throw 0;
    const c = await safeFetch(`${BASE_URL}/assets/${m2[1]}`, { allowedHosts: ["7reels.cc"], headers, signal }, 8000);
    if (!c.ok) throw 0;
    const m3 = (await c.text()).match(/key_[a-f0-9]+/i);
    if (!m3) throw 0;
    cachedEmbedKey = m3[0];
  } catch { cachedEmbedKey = "key_c90081fa77254eb5"; }
  return cachedEmbedKey;
}

async function apiGet(path, params, signal) {
  const u = new URL(`${BASE_URL}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  const r = await safeFetch(u.href, { allowedHosts: ["7reels.cc"], headers: { "User-Agent": UA, Accept: "application/json", Referer: `${BASE_URL}/` }, signal }, 15000);
  if (!r.ok) throw new Error(`7reels API ${r.status} ${path}`);
  return await r.json();
}

async function getHomepage(signal) {
  const [f, t] = await Promise.all([apiGet("/api/featured", null, signal), apiGet("/api/top-reels", null, signal)]);
  return { featured: f.featured || {}, topReels: { trending: t.trending || [], topOverall: t.topOverall || [], country: t.country || "" } };
}

async function doSearch(query, page, signal) {
  const d = await apiGet("/api/search/smart", { q: query, page: String(page || 1) }, signal);
  return { query, page: parseInt(page || 1, 10), total: (d.results || []).length, results: d.results || [] };
}

async function getDetails(id, type, signal) {
  const t = type === "tv" ? "tv" : "movie";
  const [dt, cr] = await Promise.all([apiGet(`/api/tmdb/${t}/${id}`, null, signal), apiGet(`/api/tmdb/${t}/${id}/credits`, null, signal)]);
  return { id: String(id), type: t, title: dt.title || dt.name || "", originalTitle: dt.original_title || dt.original_name || "", overview: dt.overview || "", poster: dt.poster_path ? `https://image.tmdb.org/t/p/w500${dt.poster_path}` : null, backdrop: dt.backdrop_path ? `https://image.tmdb.org/t/p/w1280${dt.backdrop_path}` : null, rating: dt.vote_average || null, releaseDate: dt.release_date || dt.first_air_date || "", genres: dt.genres || [], cast: cr.cast || [], crew: cr.crew || [] };
}

async function getEpisodes(id, season, signal) {
  const d = await apiGet(`/api/tmdb/tv/${id}/season/${season}`, null, signal);
  return { tvId: String(id), seasonNumber: parseInt(season, 10), episodes: (d.episodes || []).map((e) => ({ id: e.id, episodeNumber: e.episode_number, name: e.name || "", overview: e.overview || "", airDate: e.air_date || "", rating: e.vote_average || null, stillPath: e.still_path ? `https://image.tmdb.org/t/p/w300${e.still_path}` : null })) };
}

async function getStreamUrls(id, type, s, e, lang, signal) {
  const isTv = type === "tv", sub = lang === "english" ? "&sub=en" : "", k = await getEmbedKey(signal);
  const defs = [
    { key: "strigil", label: "Strigil", q: "4K HDR" }, { key: "videasy", label: "VidEasy", q: "4K" },
    { key: "vidsuper", label: "VidSuper", q: "4K" }, { key: "vidcore", label: "VidCore", q: "1080p" },
    { key: "vidrock", label: "AdRock", q: "1080p" }, { key: "vidsrc0", label: "VidSrc", q: "1080p" },
    { key: "vidlink", label: "VidLink", q: "1080p" }, { key: "vidfast", label: "VidUp", q: "1080p" },
    { key: "vidnest", label: "VidNest", q: "1080p" }, { key: "vidify", label: "Vidify", q: "1080p" },
    { key: "vidzee", label: "VidZee", q: "1080p" },
  ];
  const out = [];
  for (const p of defs) {
    let u = "";
    if (!isTv) {
      u = {
        strigil: `https://strigil.cc/embed/movie/${id}?embedKey=${k}&autoPlay=true&theme=16A085${sub}`,
        vidfast: `https://vidup.to/movie/${id}?autoPlay=true&theme=16A085${sub}`,
        vidsuper: `https://vidsuper.net/movie/${id}?overlay=true&color=16A085`,
        videasy: `https://player.videasy.net/movie/${id}?overlay=true&color=16A085`,
        vidcore: `https://vidcore.net/movie/${id}?autoPlay=true${sub}`,
        vidsrc0: `https://vidsrc.mov/embed/movie/${id}`, vidrock: `https://vidrock.net/movie/${id}`,
        vidnest: `https://vidnest.fun/movie/${id}`, vidlink: `https://vidlink.pro/movie/${id}`,
        vidify: `https://player.vidify.top/embed/movie/${id}`, vidzee: `https://player.vidzee.wtf/embed/movie/${id}`,
      }[p.key] || "";
    } else if (s != null && e != null) {
      u = {
        strigil: `https://strigil.cc/embed/tv/${id}/${s}/${e}?embedKey=${k}&autoPlay=true&theme=16A085${sub}`,
        vidfast: `https://vidup.to/tv/${id}/${s}/${e}?autoPlay=true&theme=16A085&nextButton=true&autoNext=true${sub}`,
        vidsuper: `https://vidsuper.net/tv/${id}/${s}/${e}?nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true&overlay=true&skip_intro=true&color=16A085`,
        videasy: `https://player.videasy.net/tv/${id}/${s}/${e}?nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true&overlay=true&color=16A085`,
        vidcore: `https://vidcore.net/tv/${id}/${s}/${e}?autoPlay=true${sub}`,
        vidsrc0: `https://vidsrc.mov/embed/tv/${id}/${s}/${e}`, vidrock: `https://vidrock.net/tv/${id}/${s}/${e}`,
        vidnest: `https://vidnest.fun/tv/${id}/${s}/${e}`, vidlink: `https://vidlink.pro/tv/${id}/${s}/${e}`,
        vidify: `https://player.vidify.top/embed/tv/${id}/${s}/${e}`, vidzee: `https://player.vidzee.wtf/embed/tv/${id}/${s}/${e}`,
      }[p.key] || "";
    }
    if (u) out.push({ server: p.label, quality: p.q, url: u });
  }
  return out;
}

async function getDirectVideasy(id, type, s, e, signal) {
  const det = await apiGet(`/api/tmdb/${type}/${id}`, null, signal);
  const title = det.title || det.name || "", year = (det.release_date || det.first_air_date || "").split("-")[0] || "", imdb = det.imdb_id || "";
  const encT = encodeURIComponent(encodeURIComponent(title));
  const hdr = { Accept: "*/*", Origin: "https://player.videasy.to", Referer: "https://player.videasy.to/", "User-Agent": UA };
  const sRes = await safeFetch(`https://api.wingsdatabase.com/seed?mediaId=${id}`, { allowedHosts: ["api.wingsdatabase.com"], headers: hdr, signal }, 15000);
  if (!sRes.ok) throw new Error(`seed ${sRes.status}`);
  const seed = (await sRes.json()).seed;
  const sUrl = type === "tv"
    ? `https://api.wingsdatabase.com/cdn/sources-with-title?title=${encT}&mediaType=tv&year=${year}&episodeId=${e}&seasonId=${s}&tmdbId=${id}&imdbId=${imdb}&enc=2&seed=${seed}`
    : `https://api.wingsdatabase.com/cdn/sources-with-title?title=${encT}&mediaType=movie&year=${year}&tmdbId=${id}&imdbId=${imdb}&enc=2&seed=${seed}`;
  const src = await safeFetch(sUrl, { allowedHosts: ["api.wingsdatabase.com"], headers: hdr, signal }, 15000);
  if (!src.ok) throw new Error(`sources ${src.status}`);
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
  const html = await pg.text();
  const m = html.match(/\\"en\\":\\"(.*?)\\"/) || html.match(/"en":"(.*?)"/);
  if (!m) throw new Error(`enc content tidak ada di ${cfg.domain}`);
  const parts = await safeFetch(`https://enc-dec.app/api/enc-${cfg.key}?text=${encodeURIComponent(m[1])}`, { allowedHosts: ["enc-dec.app"], headers: { "User-Agent": UA }, signal }, 15000);
  if (!parts.ok) throw new Error(`enc ${parts.status}`);
  const pd = await parts.json();
  if (pd.status !== 200) throw new Error(pd.error || "enc fail");
  const { servers, stream, token } = pd.result;
  const hdr = { "User-Agent": UA, Referer: `https://${cfg.domain}/`, "X-Requested-With": "XMLHttpRequest", "X-CSRF-Token": token, "Content-Type": "application/json" };
  assertDynamicPlayerUrl(servers);
  const sE = await safeFetch(servers, { allowedHosts: playerAllowedHosts(), method: "POST", headers: hdr, body: "{}", signal }, 15000);
  if (!sE.ok) throw new Error(`srv ${sE.status}`);
  const sD = await safeFetch(`https://enc-dec.app/api/dec-${cfg.key}`, { allowedHosts: ["enc-dec.app"], method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify({ text: await sE.text() }), signal }, 15000);
  if (!sD.ok) throw new Error(`dec-srv ${sD.status}`);
  const sJ = await sD.json();
  if (sJ.status !== 200) throw new Error("dec srv fail");
  const stUrl = `${stream}/${sJ.result[0].data}`;
  assertDynamicPlayerUrl(stUrl);
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
  const map = { vidcore: { key: "vidcore", domain: "vidcore.net" }, vidup: { key: "vidup", domain: "vidup.to" }, vidfast: { key: "vidfast", domain: "vidfast.vc" } };
  if (!map[p]) throw new Error(`Player tidak didukung: ${player}. Pilih videasy, vidcore, vidup, vidfast.`);
  return await resolvePage(map[p], id, t, s, e, signal);
}

/* ===== PLUGIN: 1 file → 6 sub-route ===== */
export default {
  name: "7reels",
  category: "film",
  method: ["GET", "POST"],
  timeout: 120_000,
  routes: {
    homepage: {
      description: "Homepage featured & top reels 7reels.cc.",
      params: {},
      execute: async (_req, _res, { signal }) => getHomepage(signal),
    },
    search: {
      description: "Cari film/TV di 7reels.cc.",
      timeout: 60_000,
      params: {
        query: { type: "string", required: true, maxLength: 200, description: "Kata kunci" },
        page: { type: "number", minimum: 1, maximum: 500, description: "Halaman (default 1)" },
      },
      execute: async (_req, _res, { input, signal }) => doSearch(input.query, input.page || 1, signal),
    },
    details: {
      description: "Detail film/TV dari TMDB via 7reels.",
      timeout: 60_000,
      params: {
        id: { type: "number", required: true, minimum: 1, description: "TMDB ID" },
        type: { type: "string", enum: ["movie", "tv"], description: "Tipe (default movie)" },
      },
      execute: async (_req, _res, { input, signal }) => getDetails(input.id, input.type || "movie", signal),
    },
    episodes: {
      description: "Daftar episode satu season TV.",
      timeout: 60_000,
      params: {
        id: { type: "number", required: true, minimum: 1, description: "TMDB TV ID" },
        season: { type: "number", required: true, minimum: 1, maximum: 100, description: "Nomor season" },
      },
      execute: async (_req, _res, { input, signal }) => getEpisodes(input.id, input.season, signal),
    },
    streams: {
      description: "Daftar URL embed semua player 7reels.",
      timeout: 60_000,
      params: {
        id: { type: "number", required: true, minimum: 1, description: "TMDB ID" },
        type: { type: "string", enum: ["movie", "tv"], description: "Tipe (default movie)" },
        season: { type: "number", minimum: 1, maximum: 100, description: "Season (wajib TV)" },
        episode: { type: "number", minimum: 1, maximum: 2000, description: "Episode (wajib TV)" },
        language: { type: "string", enum: ["english", "other"], description: "Subtitle (default english)" },
      },
      execute: async (_req, _res, { input, signal }) => {
        const t = input.type || "movie";
        if (t === "tv" && (input.season == null || input.episode == null)) throw new Error("season dan episode wajib untuk TV");
        return getStreamUrls(input.id, t, input.season, input.episode, input.language || "english", signal);
      },
    },
    direct: {
      description: "Resolusi direct .m3u8 (videasy/vidcore/vidup/vidfast).",
      timeout: 120_000,
      params: {
        id: { type: "number", required: true, minimum: 1, description: "TMDB ID" },
        type: { type: "string", enum: ["movie", "tv"], description: "Tipe (default movie)" },
        season: { type: "number", minimum: 1, maximum: 100, description: "Season (wajib TV)" },
        episode: { type: "number", minimum: 1, maximum: 2000, description: "Episode (wajib TV)" },
        player: { type: "string", enum: ["videasy", "vidcore", "vidup", "vidfast"], description: "Player (default videasy)" },
      },
      execute: async (_req, _res, { input, signal }) => {
        const t = input.type || "movie";
        if (t === "tv" && (input.season == null || input.episode == null)) throw new Error("season dan episode wajib untuk TV");
        return getDirect(input.id, t, input.season, input.episode, input.player || "videasy", signal);
      },
    },
  },
};
