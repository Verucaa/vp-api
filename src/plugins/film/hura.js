import { safeFetch } from "../../plugin-runtime.js";

const HURA_DOMAIN = "https://hurawatch.sx";
const FALLBACK_API_KEY = "9e7096a7575623aa30c66e9cc987e411";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

const GENRE_MAP = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
  10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics",
};

const SERVER_PATTERNS = {
  Server_1_VidCore: { movie: "https://vidcore.net/movie/", tv: "https://vidcore.net/tv/", suffix: "?autoPlay=true" },
  Server_2_VidGod: { movie: "https://vidgod.net/movie/", tv: "https://vidgod.net/tv/", suffix: "" },
  Server_3_VidNest: { movie: "https://vidnest.fun/movie/", tv: "https://vidnest.fun/tv/", suffix: "" },
  Server_4_VidFast: { movie: "https://vidfast.pro/movie/", tv: "https://vidfast.pro/tv/", suffix: "?autoPlay=true" },
  Server_5_VidSrcEmbed: { movie: "https://vidsrc-embed.ru/embed/movie/", tv: "https://vidsrc-embed.ru/embed/tv/", suffix: "" },
  Server_6_VidEasy: { movie: "https://player.videasy.net/movie/", tv: "https://player.videasy.net/tv/", suffix: "" },
};

let cachedApiKey = null;

async function getApiKey(signal) {
  if (cachedApiKey) return cachedApiKey;
  try {
    const res = await safeFetch(
      `${HURA_DOMAIN}/config.js`,
      { allowedHosts: ["hurawatch.sx"], headers: { "User-Agent": UA }, signal },
      5000
    );
    if (!res.ok) throw new Error(`config.js ${res.status}`);
    const text = await res.text();
    const m = text.match(/TMDB_API_KEY\s*:\s*['"]([a-f0-9]+)['"]/i);
    if (m && m[1]) {
      cachedApiKey = m[1];
      return cachedApiKey;
    }
  } catch {
    /* fallback */
  }
  cachedApiKey = FALLBACK_API_KEY;
  return cachedApiKey;
}

async function tmdbFetch(path, params, apiKey, signal) {
  const url = new URL(`${TMDB_BASE_URL}/${path}`);
  url.searchParams.set("api_key", apiKey);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await safeFetch(
    url.href,
    {
      allowedHosts: ["api.themoviedb.org"],
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal,
    },
    15000
  );
  if (!res.ok) throw new Error(`TMDB ${path} ${res.status}`);
  return await res.json();
}

function generateStreams(id, type, season = 1, episode = 1) {
  const streams = {};
  for (const [server, p] of Object.entries(SERVER_PATTERNS)) {
    streams[server] =
      type === "movie"
        ? `${p.movie}${id}${p.suffix}`
        : `${p.tv}${id}/${season}/${episode}${p.suffix}`;
  }
  return streams;
}

function formatItem(item, typeOverride = null) {
  const mediaType = typeOverride || item.media_type || (item.title ? "movie" : "tv");
  const title = item.title || item.name || "Untitled";
  const originalTitle = item.original_title || item.original_name || title;
  const year = (item.release_date || item.first_air_date || "").split("-")[0] || "N/A";
  const rating = item.vote_average ? parseFloat(item.vote_average.toFixed(1)) : 0.0;
  const genres = (item.genre_ids || []).map((id) => GENRE_MAP[id] || id);
  const poster = item.poster_path ? `${IMAGE_BASE_URL}${item.poster_path}` : null;
  const backdrop = item.backdrop_path
    ? `${IMAGE_BASE_URL.replace("w500", "original")}${item.backdrop_path}`
    : null;
  return {
    id: item.id,
    title,
    original_title: originalTitle,
    type: mediaType,
    year,
    rating,
    genres,
    overview: item.overview || "",
    poster_url: poster,
    backdrop_url: backdrop,
    streams: generateStreams(item.id, mediaType),
  };
}

async function scrapeHome(signal) {
  const apiKey = await getApiKey(signal);

  const [tvTrendingDay, movieTrendingDay] = await Promise.all([
    tmdbFetch("trending/tv/day", null, apiKey, signal),
    tmdbFetch("trending/movie/day", null, apiKey, signal),
  ]);
  const bannerItems = [
    ...tvTrendingDay.results.slice(0, 3).map((i) => ({ ...i, media_type: "tv" })),
    ...movieTrendingDay.results.slice(0, 3).map((i) => ({ ...i, media_type: "movie" })),
  ].map((i) => formatItem(i));

  const [trendingMovies, trendingSeries, topRated, upcoming] = await Promise.all([
    tmdbFetch("trending/movie/week", null, apiKey, signal),
    tmdbFetch("trending/tv/week", null, apiKey, signal),
    tmdbFetch("movie/top_rated", { page: 1 }, apiKey, signal),
    tmdbFetch("movie/upcoming", { page: 1 }, apiKey, signal),
  ]);

  return {
    hero_banner: bannerItems,
    trending_movies: trendingMovies.results.slice(0, 20).map((i) => formatItem(i, "movie")),
    trending_series: trendingSeries.results.slice(0, 20).map((i) => formatItem(i, "tv")),
    all_time_best: topRated.results.slice(0, 20).map((i) => formatItem(i, "movie")),
    upcoming: upcoming.results.slice(0, 20).map((i) => formatItem(i, "movie")),
  };
}

async function scrapeMovies(filter, page, signal) {
  const valid = ["popular", "top_rated", "now_playing", "upcoming"];
  if (!valid.includes(filter)) {
    throw new Error(`Filter movies tidak valid. Pilih: ${valid.join(", ")}`);
  }
  const apiKey = await getApiKey(signal);
  const data = await tmdbFetch(`movie/${filter}`, { page }, apiKey, signal);
  return {
    filter,
    page: data.page,
    total_pages: data.total_pages > 500 ? 500 : data.total_pages,
    total_results: data.total_results,
    results: data.results.map((i) => formatItem(i, "movie")),
  };
}

async function scrapeTV(filter, page, signal) {
  const valid = ["popular", "top_rated", "on_the_air", "airing_today"];
  let actualFilter = filter;
  if (filter === "on_air" || filter === "on-air") actualFilter = "on_the_air";
  if (filter === "airing_today" || filter === "airing-today") actualFilter = "airing_today";
  if (!valid.includes(actualFilter)) {
    throw new Error(`Filter TV tidak valid. Pilih: ${valid.join(", ")}`);
  }
  const apiKey = await getApiKey(signal);
  const data = await tmdbFetch(`tv/${actualFilter}`, { page }, apiKey, signal);
  return {
    filter: actualFilter,
    page: data.page,
    total_pages: data.total_pages > 500 ? 500 : data.total_pages,
    total_results: data.total_results,
    results: data.results.map((i) => formatItem(i, "tv")),
  };
}

async function scrapeTopIMDb(type, page, signal) {
  const valid = ["movie", "tv"];
  if (!valid.includes(type)) throw new Error(`type harus salah satu: ${valid.join(", ")}`);
  const apiKey = await getApiKey(signal);
  const data = await tmdbFetch(`${type}/top_rated`, { page }, apiKey, signal);
  return {
    media_type: type,
    page: data.page,
    total_pages: data.total_pages > 500 ? 500 : data.total_pages,
    total_results: data.total_results,
    results: data.results.map((item, index) => {
      const f = formatItem(item, type);
      f.imdb_rank = (page - 1) * 20 + index + 1;
      return f;
    }),
  };
}

async function performSearch(query, page, signal) {
  const apiKey = await getApiKey(signal);
  const data = await tmdbFetch("search/multi", { query, page }, apiKey, signal);
  return {
    query,
    page: data.page,
    total_pages: data.total_pages,
    total_results: data.total_results,
    results: data.results
      .filter((i) => i.media_type !== "person")
      .map((i) => formatItem(i)),
  };
}

async function scrapeMovieDetail(id, signal) {
  const apiKey = await getApiKey(signal);
  const [details, credits, similar] = await Promise.all([
    tmdbFetch(`movie/${id}`, null, apiKey, signal),
    tmdbFetch(`movie/${id}/credits`, null, apiKey, signal),
    tmdbFetch(`movie/${id}/similar`, null, apiKey, signal),
  ]);
  const cast = (credits.cast || []).slice(0, 10).map((c) => ({
    name: c.name,
    character: c.character,
    profile_url: c.profile_path ? `${IMAGE_BASE_URL}${c.profile_path}` : null,
  }));
  const directors = (credits.crew || []).filter((c) => c.job === "Director").map((c) => c.name);
  const formatted = formatItem(details, "movie");
  formatted.genres = (details.genres || []).map((g) => g.name);
  formatted.cast = cast;
  formatted.directors = directors;
  formatted.similar_movies = (similar.results || []).slice(0, 10).map((i) => formatItem(i, "movie"));
  formatted.tagline = details.tagline || "";
  formatted.status = details.status || "";
  formatted.budget = details.budget || 0;
  formatted.revenue = details.revenue || 0;
  formatted.runtime_minutes = details.runtime || 0;
  return formatted;
}

async function scrapeTVDetail(id, signal) {
  const apiKey = await getApiKey(signal);
  const [details, credits, similar] = await Promise.all([
    tmdbFetch(`tv/${id}`, null, apiKey, signal),
    tmdbFetch(`tv/${id}/credits`, null, apiKey, signal),
    tmdbFetch(`tv/${id}/similar`, null, apiKey, signal),
  ]);
  const cast = (credits.cast || []).slice(0, 10).map((c) => ({
    name: c.name,
    character: c.character,
    profile_url: c.profile_path ? `${IMAGE_BASE_URL}${c.profile_path}` : null,
  }));

  const seasons = [];
  const numSeasons = details.number_of_seasons || 0;
  for (let s = 1; s <= numSeasons; s++) {
    try {
      const sd = await tmdbFetch(`tv/${id}/season/${s}`, null, apiKey, signal);
      const episodes = (sd.episodes || []).map((ep) => ({
        id: ep.id,
        episode_number: ep.episode_number,
        name: ep.name,
        overview: ep.overview || "",
        air_date: ep.air_date || "N/A",
        rating: ep.vote_average ? parseFloat(ep.vote_average.toFixed(1)) : 0.0,
        still_path: ep.still_path ? `${IMAGE_BASE_URL}${ep.still_path}` : null,
        streams: generateStreams(id, "tv", s, ep.episode_number),
      }));
      seasons.push({
        season_number: s,
        name: sd.name || `Season ${s}`,
        overview: sd.overview || "",
        air_date: sd.air_date || "N/A",
        poster_url: sd.poster_path ? `${IMAGE_BASE_URL}${sd.poster_path}` : null,
        episodes,
      });
    } catch {
      /* skip season yang gagal */
    }
  }

  const formatted = formatItem(details, "tv");
  formatted.genres = (details.genres || []).map((g) => g.name);
  formatted.cast = cast;
  formatted.creators = (details.created_by || []).map((c) => c.name);
  formatted.similar_shows = (similar.results || []).slice(0, 10).map((i) => formatItem(i, "tv"));
  formatted.number_of_seasons = details.number_of_seasons || 0;
  formatted.number_of_episodes = details.number_of_episodes || 0;
  formatted.status = details.status || "";
  formatted.seasons = seasons;
  return formatted;
}

export default {
  name: "HuraWatch Film",
  category: "film",
  description:
    "Scraper hurawatch.sx via TMDB — home, movies, tv, top-imdb, search, detail (movie/tv lengkap dengan season/episode & URL stream).",
  method: ["GET", "POST"],
  timeout: 120_000,
  params: {
    action: {
      type: "string",
      required: true,
      enum: ["home", "movies", "tv", "top-imdb", "search", "detail"],
      description: "Aksi: home | movies | tv | top-imdb | search | detail",
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
      description: "Halaman hasil (default 1; untuk movies/tv/top-imdb/search).",
    },
    filter: {
      type: "string",
      enum: [
        "popular",
        "top_rated",
        "now_playing",
        "upcoming",
        "on_the_air",
        "airing_today",
      ],
      description:
        "Filter movies: popular|top_rated|now_playing|upcoming. Filter tv: popular|top_rated|on_the_air|airing_today. Default popular.",
    },
    type: {
      type: "string",
      enum: ["movie", "tv"],
      description: "Tipe media (top-imdb & detail; default movie).",
    },
    id: {
      type: "number",
      minimum: 1,
      description: "TMDB ID (wajib untuk action=detail).",
    },
  },
  execute: async (_req, _res, { input, signal }) => {
    switch (input.action) {
      case "home":
        return await scrapeHome(signal);
      case "movies":
        return await scrapeMovies(input.filter || "popular", input.page || 1, signal);
      case "tv":
        return await scrapeTV(input.filter || "popular", input.page || 1, signal);
      case "top-imdb":
        return await scrapeTopIMDb(input.type || "movie", input.page || 1, signal);
      case "search":
        if (!input.query) throw new Error("query wajib untuk action=search");
        return await performSearch(input.query, input.page || 1, signal);
      case "detail": {
        if (input.id == null) throw new Error("id wajib untuk action=detail");
        const type = input.type === "tv" ? "tv" : "movie";
        return type === "tv"
          ? await scrapeTVDetail(input.id, signal)
          : await scrapeMovieDetail(input.id, signal);
      }
      default:
        throw new Error(`action tidak dikenal: ${input.action}`);
    }
  },
};
