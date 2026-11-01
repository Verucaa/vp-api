import { safeFetch } from "../../plugin-runtime.js";

const BASE_URL = "https://7reels.cc";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

// Provider domains untuk resolusi "direct" (vidcore/vidup/vidfast).
const PLAYER_DOMAINS = [
  "vidcore.net",
  "vidup.to",
  "vidfast.vc",
  "vidfast.pro",
  "vidfast.to",
];

let cachedEmbedKey = null;

function playerAllowedHosts() {
  const hosts = ["enc-dec.app"];
  for (const d of PLAYER_DOMAINS) {
    hosts.push(d, `www.${d}`, `cdn.${d}`, `api.${d}`);
  }
  return hosts;
}

function assertDynamicPlayerUrl(urlStr) {
  const host = new URL(urlStr).hostname.toLowerCase();
  const ok = PLAYER_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  if (!ok) throw new Error(`Provider host tidak diizinkan: ${host}`);
  return urlStr;
}

async function getEmbedKey(signal) {
  if (cachedEmbedKey) return cachedEmbedKey;
  const headers = { "User-Agent": UA };
  try {
    const homeRes = await safeFetch(
      BASE_URL,
      { allowedHosts: ["7reels.cc"], headers, signal },
      8000
    );
    if (!homeRes.ok) throw new Error("homepage fetch failed");
    const homeText = await homeRes.text();
    const m1 =
      homeText.match(/src="(\/assets\/index-[a-zA-Z0-9]{8}\.js)"/) ||
      homeText.match(/href="(\/assets\/index-[a-zA-Z0-9]{8}\.js)"/);
    if (!m1) throw new Error("index bundle not found");

    const mainRes = await safeFetch(
      `${BASE_URL}${m1[1]}`,
      { allowedHosts: ["7reels.cc"], headers, signal },
      8000
    );
    if (!mainRes.ok) throw new Error("main bundle fetch failed");
    const mainText = await mainRes.text();

    const m2 = mainText.match(/([a-zA-Z0-9_-]*AdSafetyWarning-[a-zA-Z0-9]{8}\.js)/);
    if (!m2) throw new Error("AdSafetyWarning chunk not found");

    const chunkRes = await safeFetch(
      `${BASE_URL}/assets/${m2[1]}`,
      { allowedHosts: ["7reels.cc"], headers, signal },
      8000
    );
    if (!chunkRes.ok) throw new Error("warning chunk fetch failed");
    const chunkText = await chunkRes.text();

    const m3 = chunkText.match(/key_[a-f0-9]+/i);
    if (!m3) throw new Error("embedKey pattern not found");

    cachedEmbedKey = m3[0];
    return cachedEmbedKey;
  } catch {
    cachedEmbedKey = "key_c90081fa77254eb5";
    return cachedEmbedKey;
  }
}

async function apiGet(path, params, signal) {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await safeFetch(
    url.href,
    {
      allowedHosts: ["7reels.cc"],
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        Referer: `${BASE_URL}/`,
      },
      signal,
    },
    15000
  );
  if (!res.ok) throw new Error(`7reels API ${res.status} for ${path}`);
  return await res.json();
}

async function getHomepage(signal) {
  const [featured, topReels] = await Promise.all([
    apiGet("/api/featured", null, signal),
    apiGet("/api/top-reels", null, signal),
  ]);
  return {
    featured: featured.featured || {},
    topReels: {
      trending: topReels.trending || [],
      topOverall: topReels.topOverall || [],
      country: topReels.country || "",
    },
  };
}

async function doSearch(query, page, signal) {
  const data = await apiGet(
    "/api/search/smart",
    { q: query, page: String(page || 1) },
    signal
  );
  return {
    query,
    page: parseInt(page || 1, 10),
    total: (data.results || []).length,
    results: data.results || [],
  };
}

async function getDetails(id, type, signal) {
  const cleanType = type === "tv" ? "tv" : "movie";
  const [details, credits] = await Promise.all([
    apiGet(`/api/tmdb/${cleanType}/${id}`, null, signal),
    apiGet(`/api/tmdb/${cleanType}/${id}/credits`, null, signal),
  ]);
  return {
    id: String(id),
    type: cleanType,
    title: details.title || details.name || "",
    originalTitle: details.original_title || details.original_name || "",
    overview: details.overview || "",
    poster: details.poster_path
      ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
      : null,
    backdrop: details.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}`
      : null,
    rating: details.vote_average || null,
    releaseDate: details.release_date || details.first_air_date || "",
    genres: details.genres || [],
    cast: credits.cast || [],
    crew: credits.crew || [],
  };
}

async function getEpisodes(tvId, seasonNum, signal) {
  const data = await apiGet(
    `/api/tmdb/tv/${tvId}/season/${seasonNum}`,
    null,
    signal
  );
  return {
    tvId: String(tvId),
    seasonNumber: parseInt(seasonNum, 10),
    episodes: (data.episodes || []).map((ep) => ({
      id: ep.id,
      episodeNumber: ep.episode_number,
      name: ep.name || "",
      overview: ep.overview || "",
      airDate: ep.air_date || "",
      rating: ep.vote_average || null,
      stillPath: ep.still_path
        ? `https://image.tmdb.org/t/p/w300${ep.still_path}`
        : null,
    })),
  };
}

async function getStreamUrls(id, type, seasonNum, episodeNum, language, signal) {
  const isTv = type === "tv";
  const subParam = language === "english" ? "&sub=en" : "";
  const embedKey = await getEmbedKey(signal);

  const players = [
    { key: "strigil", label: "Strigil", quality: "4K HDR" },
    { key: "videasy", label: "VidEasy", quality: "4K" },
    { key: "vidsuper", label: "VidSuper", quality: "4K" },
    { key: "vidcore", label: "VidCore", quality: "1080p" },
    { key: "vidrock", label: "AdRock", quality: "1080p" },
    { key: "vidsrc0", label: "VidSrc", quality: "1080p" },
    { key: "vidlink", label: "VidLink", quality: "1080p" },
    { key: "vidfast", label: "VidUp", quality: "1080p" },
    { key: "vidnest", label: "VidNest", quality: "1080p" },
    { key: "vidify", label: "Vidify", quality: "1080p" },
    { key: "vidzee", label: "VidZee", quality: "1080p" },
  ];

  const resolvedUrls = [];
  for (const player of players) {
    let streamUrl = "";
    if (!isTv) {
      switch (player.key) {
        case "strigil":
          streamUrl = `https://strigil.cc/embed/movie/${id}?embedKey=${embedKey}&autoPlay=true&theme=16A085${subParam}`;
          break;
        case "vidfast":
          streamUrl = `https://vidup.to/movie/${id}?autoPlay=true&theme=16A085${subParam}`;
          break;
        case "vidsuper":
          streamUrl = `https://vidsuper.net/movie/${id}?overlay=true&color=16A085`;
          break;
        case "videasy":
          streamUrl = `https://player.videasy.net/movie/${id}?overlay=true&color=16A085`;
          break;
        case "vidcore":
          streamUrl = `https://vidcore.net/movie/${id}?autoPlay=true${subParam}`;
          break;
        case "vidsrc0":
          streamUrl = `https://vidsrc.mov/embed/movie/${id}`;
          break;
        case "vidrock":
          streamUrl = `https://vidrock.net/movie/${id}`;
          break;
        case "vidnest":
          streamUrl = `https://vidnest.fun/movie/${id}`;
          break;
        case "vidlink":
          streamUrl = `https://vidlink.pro/movie/${id}`;
          break;
        case "vidify":
          streamUrl = `https://player.vidify.top/embed/movie/${id}`;
          break;
        case "vidzee":
          streamUrl = `https://player.vidzee.wtf/embed/movie/${id}`;
          break;
      }
    } else {
      if (seasonNum == null || episodeNum == null) continue;
      const s = seasonNum;
      const ep = episodeNum;
      switch (player.key) {
        case "strigil":
          streamUrl = `https://strigil.cc/embed/tv/${id}/${s}/${ep}?embedKey=${embedKey}&autoPlay=true&theme=16A085${subParam}`;
          break;
        case "vidfast":
          streamUrl = `https://vidup.to/tv/${id}/${s}/${ep}?autoPlay=true&theme=16A085&nextButton=true&autoNext=true${subParam}`;
          break;
        case "vidsuper":
          streamUrl = `https://vidsuper.net/tv/${id}/${s}/${ep}?nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true&overlay=true&skip_intro=true&color=16A085`;
          break;
        case "videasy":
          streamUrl = `https://player.videasy.net/tv/${id}/${s}/${ep}?nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true&overlay=true&color=16A085`;
          break;
        case "vidcore":
          streamUrl = `https://vidcore.net/tv/${id}/${s}/${ep}?autoPlay=true${subParam}`;
          break;
        case "vidsrc0":
          streamUrl = `https://vidsrc.mov/embed/tv/${id}/${s}/${ep}`;
          break;
        case "vidrock":
          streamUrl = `https://vidrock.net/tv/${id}/${s}/${ep}`;
          break;
        case "vidnest":
          streamUrl = `https://vidnest.fun/tv/${id}/${s}/${ep}`;
          break;
        case "vidlink":
          streamUrl = `https://vidlink.pro/tv/${id}/${s}/${ep}`;
          break;
        case "vidify":
          streamUrl = `https://player.vidify.top/embed/tv/${id}/${s}/${ep}`;
          break;
        case "vidzee":
          streamUrl = `https://player.vidzee.wtf/embed/tv/${id}/${s}/${ep}`;
          break;
      }
    }
    if (streamUrl) {
      resolvedUrls.push({
        server: player.label,
        quality: player.quality,
        url: streamUrl,
      });
    }
  }
  return resolvedUrls;
}

async function getDirectVideasy(id, type, seasonNum, episodeNum, signal) {
  const details = await apiGet(`/api/tmdb/${type}/${id}`, null, signal);
  const title = details.title || details.name || "";
  const releaseDate = details.release_date || details.first_air_date || "";
  const year = releaseDate ? releaseDate.split("-")[0] : "";
  const imdbId = details.imdb_id || "";
  const encTitle = encodeURIComponent(encodeURIComponent(title));

  const headers = {
    Accept: "*/*",
    Origin: "https://player.videasy.to",
    Referer: "https://player.videasy.to/",
    "User-Agent": UA,
  };

  const seedRes = await safeFetch(
    `https://api.wingsdatabase.com/seed?mediaId=${id}`,
    { allowedHosts: ["api.wingsdatabase.com"], headers, signal },
    15000
  );
  if (!seedRes.ok) throw new Error(`wingsdatabase seed ${seedRes.status}`);
  const seedData = await seedRes.json();
  const seed = seedData.seed;

  const server = "cdn";
  const sourcesUrl =
    type === "tv"
      ? `https://api.wingsdatabase.com/${server}/sources-with-title?title=${encTitle}&mediaType=tv&year=${year}&episodeId=${episodeNum}&seasonId=${seasonNum}&tmdbId=${id}&imdbId=${imdbId}&enc=2&seed=${seed}`
      : `https://api.wingsdatabase.com/${server}/sources-with-title?title=${encTitle}&mediaType=movie&year=${year}&tmdbId=${id}&imdbId=${imdbId}&enc=2&seed=${seed}`;

  const sourcesRes = await safeFetch(
    sourcesUrl,
    { allowedHosts: ["api.wingsdatabase.com"], headers, signal },
    15000
  );
  if (!sourcesRes.ok) throw new Error(`wingsdatabase sources ${sourcesRes.status}`);
  const encData = await sourcesRes.json();

  const decRes = await safeFetch(
    "https://enc-dec.app/api/dec-videasy",
    {
      allowedHosts: ["enc-dec.app"],
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ text: encData, id: String(id), seed }),
      signal,
    },
    15000
  );
  if (!decRes.ok) throw new Error(`enc-dec dec-videasy ${decRes.status}`);
  const decData = await decRes.json();
  if (decData.status !== 200) throw new Error(decData.error || "Decryption failed");
  return { status: "success", result: decData.result };
}

async function resolvePagePlayer(cfg, id, type, seasonNum, episodeNum, signal) {
  const isTv = type === "tv";
  const baseUrl = isTv
    ? `https://${cfg.domain}/tv/${id}/${seasonNum}/${episodeNum}/`
    : `https://${cfg.domain}/movie/${id}/`;

  const pageRes = await safeFetch(
    baseUrl,
    { allowedHosts: playerAllowedHosts(), headers: { "User-Agent": UA }, signal },
    15000
  );
  if (!pageRes.ok) throw new Error(`Player page ${cfg.domain} ${pageRes.status}`);
  const html = await pageRes.text();
  const match = html.match(/\\"en\\":\\"(.*?)\\"/) || html.match(/"en":"(.*?)"/);
  if (!match) throw new Error(`Encrypted content tidak ditemukan di ${cfg.domain}`);
  const text = match[1];

  const partsRes = await safeFetch(
    `https://enc-dec.app/api/enc-${cfg.key}?text=${encodeURIComponent(text)}`,
    { allowedHosts: ["enc-dec.app"], headers: { "User-Agent": UA }, signal },
    15000
  );
  if (!partsRes.ok) throw new Error(`enc-dec enc-${cfg.key} ${partsRes.status}`);
  const partsData = await partsRes.json();
  if (partsData.status !== 200) throw new Error(partsData.error || "Encryption failed");
  const { servers, stream, token } = partsData.result;

  const hdr = {
    "User-Agent": UA,
    Referer: `https://${cfg.domain}/`,
    "X-Requested-With": "XMLHttpRequest",
    "X-CSRF-Token": token,
    "Content-Type": "application/json",
  };

  assertDynamicPlayerUrl(servers);
  const serversEncRes = await safeFetch(
    servers,
    {
      allowedHosts: playerAllowedHosts(),
      method: "POST",
      headers: hdr,
      body: "{}",
      signal,
    },
    15000
  );
  if (!serversEncRes.ok) throw new Error(`servers fetch ${serversEncRes.status}`);
  const serversEncText = await serversEncRes.text();

  const decServersRes = await safeFetch(
    `https://enc-dec.app/api/dec-${cfg.key}`,
    {
      allowedHosts: ["enc-dec.app"],
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ text: serversEncText }),
      signal,
    },
    15000
  );
  if (!decServersRes.ok) throw new Error(`enc-dec dec-servers ${decServersRes.status}`);
  const decServers = await decServersRes.json();
  if (decServers.status !== 200) throw new Error("Failed to decrypt servers");

  const serverData = decServers.result[0].data;
  const streamEncUrl = `${stream}/${serverData}`;
  assertDynamicPlayerUrl(streamEncUrl);
  const streamEncRes = await safeFetch(
    streamEncUrl,
    {
      allowedHosts: playerAllowedHosts(),
      method: "POST",
      headers: hdr,
      body: "{}",
      signal,
    },
    15000
  );
  if (!streamEncRes.ok) throw new Error(`stream fetch ${streamEncRes.status}`);
  const streamEncText = await streamEncRes.text();

  const decStreamRes = await safeFetch(
    `https://enc-dec.app/api/dec-${cfg.key}`,
    {
      allowedHosts: ["enc-dec.app"],
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ text: streamEncText }),
      signal,
    },
    15000
  );
  if (!decStreamRes.ok) throw new Error(`enc-dec dec-stream ${decStreamRes.status}`);
  const decStream = await decStreamRes.json();
  if (decStream.status !== 200) throw new Error("Failed to decrypt stream");
  return { status: "success", result: decStream.result };
}

async function getDirect(id, type, seasonNum, episodeNum, player, signal) {
  const pKey = String(player || "videasy").toLowerCase();
  const cleanType = type === "tv" ? "tv" : "movie";

  if (pKey === "videasy") {
    return await getDirectVideasy(id, cleanType, seasonNum, episodeNum, signal);
  }

  const configs = {
    vidcore: { key: "vidcore", domain: "vidcore.net" },
    vidup: { key: "vidup", domain: "vidup.to" },
    vidfast: { key: "vidfast", domain: "vidfast.vc" },
  };
  const cfg = configs[pKey];
  if (!cfg) {
    throw new Error(
      `Player tidak didukung: ${player}. Pilih videasy, vidcore, vidup, atau vidfast.`
    );
  }
  if (cleanType === "tv" && (seasonNum == null || episodeNum == null)) {
    throw new Error("season dan episode wajib untuk TV pada action=direct");
  }
  return await resolvePagePlayer(cfg, id, cleanType, seasonNum, episodeNum, signal);
}

export default {
  name: "7reels Film",
  category: "film",
  description:
    "Scraper 7reels.cc — homepage, search, detail TMDB, episode, kumpulan URL player, dan direct stream (.m3u8) untuk videasy/vidcore/vidup/vidfast.",
  method: ["GET", "POST"],
  timeout: 120_000,
  params: {
    action: {
      type: "string",
      required: true,
      enum: ["homepage", "search", "details", "episodes", "streams", "direct"],
      description:
        "Aksi: homepage | search | details | episodes | streams | direct",
    },
    query: {
      type: "string",
      maxLength: 200,
      description: "Kata kunci (wajib untuk action=search).",
    },
    page: {
      type: "number",
      minimum: 1,
      maximum: 500,
      description: "Halaman hasil (default 1, hanya action=search).",
    },
    id: {
      type: "number",
      minimum: 1,
      description: "TMDB ID (wajib untuk details/episodes/streams/direct).",
    },
    type: {
      type: "string",
      enum: ["movie", "tv"],
      description: "Tipe media (default movie).",
    },
    season: {
      type: "number",
      minimum: 1,
      maximum: 100,
      description: "Nomor season (wajib untuk TV: episodes/streams/direct).",
    },
    episode: {
      type: "number",
      minimum: 1,
      maximum: 2000,
      description: "Nomor episode (wajib untuk TV: streams/direct).",
    },
    language: {
      type: "string",
      enum: ["english", "other"],
      description: "Preferensi subtitle (default english), hanya streams.",
    },
    player: {
      type: "string",
      enum: ["videasy", "vidcore", "vidup", "vidfast"],
      description: "Player untuk action=direct (default videasy).",
    },
  },
  execute: async (_req, _res, { input, signal }) => {
    switch (input.action) {
      case "homepage":
        return await getHomepage(signal);

      case "search":
        if (!input.query) throw new Error("query wajib untuk action=search");
        return await doSearch(input.query, input.page || 1, signal);

      case "details":
        if (input.id == null) throw new Error("id wajib untuk action=details");
        return await getDetails(input.id, input.type || "movie", signal);

      case "episodes":
        if (input.id == null) throw new Error("id wajib untuk action=episodes");
        if (input.season == null) throw new Error("season wajib untuk action=episodes");
        return await getEpisodes(input.id, input.season, signal);

      case "streams":
        if (input.id == null) throw new Error("id wajib untuk action=streams");
        return await getStreamUrls(
          input.id,
          input.type || "movie",
          input.season,
          input.episode,
          input.language || "english",
          signal
        );

      case "direct":
        if (input.id == null) throw new Error("id wajib untuk action=direct");
        return await getDirect(
          input.id,
          input.type || "movie",
          input.season,
          input.episode,
          input.player || "videasy",
          signal
        );

      default:
        throw new Error(`action tidak dikenal: ${input.action}`);
    }
  },
};
