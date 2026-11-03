import { safeFetch } from "../../plugin-runtime.js";
import * as cheerio from "cheerio";

/* ===== KONFIG ===== */
const BASE_URL = "https://komikindo.ch";
const ALLOWED_HOSTS = ["komikindo.ch", "www.komikindo.ch"];

/* ===== HELPERS ===== */
async function fetchHTML(url, signal, retries = 3) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await safeFetch(
        url,
        {
          allowedHosts: ALLOWED_HOSTS,
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
            Referer: BASE_URL + "/",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
          signal,
        },
        30000
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (
        html &&
        html.length > 500 &&
        !html.includes("403 Forbidden") &&
        !html.includes("Access to this resource")
      ) {
        return html;
      }
      lastError = new Error("Response tidak valid (mungkin diblokir)");
    } catch (err) {
      lastError = err;
    }
    if (i < retries - 1) await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Gagal fetch: " + (lastError?.message || "unknown"));
}

function cleanText(text) {
  return text ? text.replace(/\s+/g, " ").trim() : null;
}

function buildResponse(page, url, pagination, data) {
  const result = { creator: "rynaqrtz", page, url };
  if (
    pagination &&
    (pagination.total !== null || pagination.current !== 1 || pagination.hasNext)
  ) {
    result.pagination = pagination;
  }
  result.data = data;
  return result;
}

function parsePagination($) {
  const result = { current: 1, total: null, hasNext: false };
  const active = $(".pagination .page-numbers.current");
  if (active.length) {
    const t = active.text().trim();
    if (/^\d+$/.test(t)) result.current = parseInt(t, 10);
  }
  const allPages = $(".pagination .page-numbers:not(.dots):not(.next):not(.prev)");
  let maxPage = 0;
  allPages.each((i, el) => {
    const t = $(el).text().trim();
    if (/^\d+$/.test(t)) {
      const num = parseInt(t, 10);
      if (num > maxPage) maxPage = num;
    }
  });
  if (maxPage > 0) {
    result.total = maxPage;
    result.hasNext = result.current < maxPage;
  }
  const nextLink = $(".pagination .next.page-numbers");
  if (nextLink.length && !result.hasNext) result.hasNext = true;
  return result;
}

function parseComicItem($el) {
  const item = {};
  const title =
    $el.find(".tt h3").text().trim() || $el.find(".poster-title").text().trim();
  if (title) item.title = title;
  const link =
    $el.find('a[href^="/komik/"]').first().attr("href") ||
    $el.find("a").first().attr("href");
  if (link) item.url = link.startsWith("http") ? link : BASE_URL + link;
  const poster =
    $el.find(".limit img").attr("src") ||
    $el.find(".limit img").attr("data-src") ||
    $el.find("img").attr("src") ||
    $el.find("img").attr("data-src");
  if (poster) item.poster = poster;
  const rating =
    $el.find(".rating i").text().trim() ||
    $el.find(".rtg i").text().trim() ||
    $el.find(".archiveanime-rating i").text().trim();
  if (rating) item.rating = parseFloat(rating);
  const type =
    $el.find(".typeflag").text().trim() || $el.find(".type-flag").text().trim();
  if (type) item.type = type;
  const format = $el.find(".warnalabel").text().trim();
  if (format) item.format = format;
  const status = $el.find(".status-skroep").text().trim();
  if (status) item.status = status;
  const latestChapter = $el.find(".lsch a").first().attr("href");
  if (latestChapter) {
    item.latestChapter = latestChapter.startsWith("http")
      ? latestChapter
      : BASE_URL + latestChapter;
  }
  const latestChapterTitle = $el.find(".lsch a").first().text().trim();
  if (latestChapterTitle) item.latestChapterTitle = latestChapterTitle;
  const date = $el.find(".datech").text().trim();
  if (date) item.date = date;
  return item;
}

function parseComicList($, selector = ".animepost") {
  const items = [];
  $(selector).each((i, el) => {
    const item = parseComicItem($(el));
    if (item.title && item.url) items.push(item);
  });
  if (items.length === 0) {
    $(".film-list .animepost").each((i, el) => {
      const item = parseComicItem($(el));
      if (item.title && item.url) items.push(item);
    });
  }
  if (items.length === 0) {
    $(".listupd .animepost").each((i, el) => {
      const item = parseComicItem($(el));
      if (item.title && item.url) items.push(item);
    });
  }
  return items;
}

function parseDetailInfo($) {
  const info = {};
  $(".spe span").each((i, el) => {
    const text = cleanText($(el).text());
    if (text && text.includes(":")) {
      const parts = text.split(":");
      const key = cleanText(parts[0]);
      const value = cleanText(parts.slice(1).join(":"));
      if (key && value) info[key] = value;
    }
  });
  return info;
}

function parseGenres($) {
  const genres = [];
  $(".genre-info a").each((i, el) => {
    const text = cleanText($(el).text());
    if (text) genres.push(text);
  });
  return genres;
}

function toArray(v) {
  if (typeof v !== "string") return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function safeSlug(slug) {
  const s = String(slug || "").replace(/^\/+/, "").trim();
  if (!s || s.includes("..")) throw new Error("Slug tidak valid");
  return s;
}

/* ===== ACTIONS ===== */
async function getHome(signal) {
  const url = BASE_URL + "/";
  const html = await fetchHTML(url, signal);
  const $ = cheerio.load(html);
  const popular = parseComicList($, ".listupd.customslider .animepost");
  const latest = parseComicList($, ".chapterbaru .animepost");
  if (latest.length === 0) {
    const alt = parseComicList($, ".widget-body .animepost");
    if (alt.length > 0) latest.push(...alt);
  }
  const pagination = { current: 1, total: null, hasNext: false };
  return buildResponse("home", url, pagination, { popular, latest });
}

async function getTerbaru(page = 1, signal) {
  const url =
    page === 1
      ? BASE_URL + "/komik-terbaru/"
      : BASE_URL + `/komik-terbaru/page/${page}/`;
  const html = await fetchHTML(url, signal);
  const $ = cheerio.load(html);
  const items = parseComicList($, ".film-list .animepost");
  return buildResponse("komik-terbaru", url, parsePagination($), items);
}

async function getPopuler(page = 1, signal) {
  const url =
    page === 1
      ? BASE_URL + "/komik-populer/"
      : BASE_URL + `/komik-populer/page/${page}/`;
  const html = await fetchHTML(url, signal);
  const $ = cheerio.load(html);
  const items = parseComicList($, ".film-list .animepost");
  return buildResponse("komik-populer", url, parsePagination($), items);
}

async function getBerwarna(page = 1, signal) {
  const url =
    page === 1
      ? BASE_URL + "/komik-berwarna/"
      : BASE_URL + `/komik-berwarna/page/${page}/`;
  const html = await fetchHTML(url, signal);
  const $ = cheerio.load(html);
  const items = parseComicList($, ".film-list .animepost");
  return buildResponse("komik-berwarna", url, parsePagination($), items);
}

async function getManhwa(page = 1, signal) {
  const url = page === 1 ? BASE_URL + "/manhwa/" : BASE_URL + `/manhwa/page/${page}/`;
  const html = await fetchHTML(url, signal);
  const $ = cheerio.load(html);
  const items = parseComicList($, ".film-list .animepost");
  return buildResponse("manhwa", url, parsePagination($), items);
}

async function getManga(page = 1, signal) {
  const url = page === 1 ? BASE_URL + "/manga/" : BASE_URL + `/manga/page/${page}/`;
  const html = await fetchHTML(url, signal);
  const $ = cheerio.load(html);
  const items = parseComicList($, ".film-list .animepost");
  return buildResponse("manga", url, parsePagination($), items);
}

async function getDaftar(filters, page, signal) {
  const query = new URLSearchParams();
  if (filters.status) query.append("status", filters.status);
  if (filters.type) query.append("type", filters.type);
  if (filters.format) query.append("format", filters.format);
  if (filters.order) query.append("order", filters.order);
  if (filters.title) query.append("title", filters.title);
  for (const g of filters.genre || []) query.append("genre[]", g);
  for (const d of filters.demografis || []) query.append("demografis[]", d);
  for (const k of filters.konten || []) query.append("konten[]", k);
  for (const t of filters.tema || []) query.append("tema[]", t);

  const baseUrl = BASE_URL + "/daftar-manga/";
  const pageUrl = page > 1 ? `page/${page}/` : "";
  const queryStr = query.toString();
  const url = baseUrl + pageUrl + (queryStr ? "?" + queryStr : "");
  const html = await fetchHTML(url, signal);
  const $ = cheerio.load(html);
  const items = parseComicList($, ".film-list .animepost");
  return buildResponse("daftar-manga", url, parsePagination($), items);
}

async function getSearch(query, page, signal) {
  const url =
    BASE_URL +
    `/?s=${encodeURIComponent(query)}` +
    (page > 1 ? `&page=${page}` : "");
  const html = await fetchHTML(url, signal);
  const $ = cheerio.load(html);
  const items = parseComicList($, ".film-list .animepost");
  const pagination = parsePagination($);
  if (items.length > 0 && pagination.total === null) {
    const lastPageLink = $(
      ".pagination .page-numbers:not(.dots):not(.next):not(.prev)"
    ).last();
    if (lastPageLink.length) {
      const t = lastPageLink.text().trim();
      if (/^\d+$/.test(t)) pagination.total = parseInt(t, 10);
    }
    const nextLink = $(".pagination .next.page-numbers");
    if (nextLink.length && !pagination.hasNext) pagination.hasNext = true;
  }
  return buildResponse("search", url, pagination, items);
}

async function getDetail(slug, signal) {
  const clean = safeSlug(slug);
  const url = BASE_URL + "/komik/" + clean;
  const html = await fetchHTML(url, signal);
  const $ = cheerio.load(html);

  const title =
    cleanText($(".entry-title").text()) ||
    cleanText($("h1.entry-title").text()) ||
    cleanText($("h1").first().text()) ||
    null;

  const ratingText =
    cleanText($(".rtg i").text()) ||
    cleanText($(".rating i").text()) ||
    cleanText($(".archiveanime-rating i").text());
  const rating = ratingText ? parseFloat(ratingText) : null;

  const poster =
    $(".thumb img").attr("src") ||
    $(".thumb img").attr("data-src") ||
    $('img[itemprop="image"]').attr("src") ||
    null;

  const synopsis =
    cleanText($(".entry-content p").text()) ||
    cleanText($(".shortcsc.sht2 p").text()) ||
    cleanText($(".desc p").text()) ||
    null;

  const info = parseDetailInfo($);
  const genres = parseGenres($);

  const chapters = [];
  const pushChapter = (link, chapter, date) => {
    if (link && chapter) {
      chapters.push({
        chapter,
        url: link.startsWith("http") ? link : BASE_URL + link,
        date: date || null,
      });
    }
  };

  $(".eps_lst .listeps ul li").each((i, el) => {
    const $el = $(el);
    const link = $el.find(".lchx a").attr("href");
    const chapter =
      $el.find("chapter").text().trim() ||
      $el.find(".lchx a").text().trim().replace(/Chapter\s*/i, "").trim() ||
      null;
    const date =
      $el.find(".dt a").text().trim() || $el.find(".dt").text().trim() || null;
    pushChapter(link, chapter, date);
  });

  if (chapters.length === 0) {
    $(".listeps ul li").each((i, el) => {
      const $el = $(el);
      const link = $el.find("a").attr("href");
      const chapter =
        $el.find("chapter").text().trim() ||
        $el.find("a").text().trim().replace(/Chapter\s*/i, "").trim() ||
        null;
      const date = $el.find(".dt").text().trim() || null;
      pushChapter(link, chapter, date);
    });
  }

  const related = [];
  $(".miripmanga .serieslist li").each((i, el) => {
    const $el = $(el);
    const link =
      $el.find(".imgseries a").attr("href") || $el.find("a").first().attr("href");
    const t =
      cleanText($el.find(".leftseries h3 a").text()) ||
      cleanText($el.find(".leftseries h3").text()) ||
      null;
    const p =
      $el.find(".imgseries img").attr("src") ||
      $el.find(".imgseries img").attr("data-src") ||
      null;
    if (link && t) {
      related.push({
        title: t,
        url: link.startsWith("http") ? link : BASE_URL + link,
        poster: p || null,
      });
    }
  });

  const data = { title, rating, poster, synopsis, info, genres, chapters, related };
  const pagination = { current: 1, total: null, hasNext: false };
  return buildResponse("detail", url, pagination, data);
}

async function getChapter(slug, signal) {
  const clean = safeSlug(slug);
  const url = BASE_URL + "/" + clean;
  const html = await fetchHTML(url, signal);
  const $ = cheerio.load(html);

  const title =
    cleanText($(".entry-title").text()) ||
    cleanText($("h1.entry-title").text()) ||
    cleanText($("h1").first().text()) ||
    null;

  const images = [];
  $("#chimg-auh img").each((i, el) => {
    const src = $(el).attr("src");
    if (src) images.push(src);
  });
  if (images.length === 0) {
    $(".chapter-image img, .img-landmine img, #Baca_Komik img").each((i, el) => {
      const src = $(el).attr("src");
      if (src) images.push(src);
    });
  }

  const nav = { daftarChapter: null, next: null, prev: null };
  $(".navig .nextprev a, .nextprev a").each((i, el) => {
    const text = cleanText($(el).text());
    const href = $(el).attr("href");
    if (text && href) {
      const abs = href.startsWith("http") ? href : BASE_URL + href;
      if (/Daftar Chapter|Daftar|Chapter List/i.test(text)) nav.daftarChapter = abs;
      else if (/Chapter Selanjutnya|Next|Selanjutnya/i.test(text)) nav.next = abs;
      else if (/Chapter Sebelumnya|Prev|Sebelumnya/i.test(text)) nav.prev = abs;
    }
  });

  const data = { title, images, navigation: nav };
  const pagination = { current: 1, total: null, hasNext: !!nav.next };
  return buildResponse("chapter", url, pagination, data);
}

/* ===== PLUGIN: 1 file → 10 sub-route ===== */
export default {
  name: "KomikIndo",
  category: "comic",
  method: ["GET", "POST"],
  timeout: 60_000,
  routes: {
    home: {
      description: "Homepage KomikIndo: popular (custom slider) + latest updates.",
      timeout: 40_000,
      cache: 300,
      params: {},
      execute: async (_r, _s, { signal }) => getHome(signal),
    },
    terbaru: {
      description: "Daftar komik terbaru per halaman.",
      timeout: 40_000,
      cache: 120,
      params: {
        page: { type: "number", minimum: 1, maximum: 500, description: "Halaman (default 1)" },
      },
      execute: async (_r, _s, { input, signal }) => getTerbaru(input.page || 1, signal),
    },
    populer: {
      description: "Daftar komik populer per halaman.",
      timeout: 40_000,
      cache: 120,
      params: {
        page: { type: "number", minimum: 1, maximum: 500, description: "Halaman (default 1)" },
      },
      execute: async (_r, _s, { input, signal }) => getPopuler(input.page || 1, signal),
    },
    berwarna: {
      description: "Daftar komik berwarna (colorized).",
      timeout: 40_000,
      cache: 120,
      params: {
        page: { type: "number", minimum: 1, maximum: 500, description: "Halaman (default 1)" },
      },
      execute: async (_r, _s, { input, signal }) => getBerwarna(input.page || 1, signal),
    },
    manhwa: {
      description: "Daftar manhwa.",
      timeout: 40_000,
      cache: 120,
      params: {
        page: { type: "number", minimum: 1, maximum: 500, description: "Halaman (default 1)" },
      },
      execute: async (_r, _s, { input, signal }) => getManhwa(input.page || 1, signal),
    },
    manga: {
      description: "Daftar manga.",
      timeout: 40_000,
      cache: 120,
      params: {
        page: { type: "number", minimum: 1, maximum: 500, description: "Halaman (default 1)" },
      },
      execute: async (_r, _s, { input, signal }) => getManga(input.page || 1, signal),
    },
    daftar: {
      description:
        "Daftar manga dengan filter. Filter array (genre/demografis/konten/tema) dipisah koma.",
      timeout: 40_000,
      cache: 120,
      params: {
        page: { type: "number", minimum: 1, maximum: 500, description: "Halaman (default 1)" },
        status: { type: "string", maxLength: 30, description: "completed | ongoing" },
        type: { type: "string", maxLength: 30, description: "manga | manhwa | manhua" },
        format: { type: "string", maxLength: 30, description: "bw | colorized" },
        order: { type: "string", maxLength: 30, description: "popular | update | latest" },
        title: { type: "string", maxLength: 200, description: "Filter judul (substring)" },
        genre: { type: "string", maxLength: 500, description: "Slug genre dipisah koma, mis. action,comedy" },
        demografis: { type: "string", maxLength: 200, description: "Demografis dipisah koma" },
        konten: { type: "string", maxLength: 200, description: "Konten dipisah koma" },
        tema: { type: "string", maxLength: 500, description: "Tema dipisah koma" },
      },
      execute: async (_r, _s, { input, signal }) => {
        const filters = {
          status: input.status,
          type: input.type,
          format: input.format,
          order: input.order,
          title: input.title,
          genre: toArray(input.genre),
          demografis: toArray(input.demografis),
          konten: toArray(input.konten),
          tema: toArray(input.tema),
        };
        return getDaftar(filters, input.page || 1, signal);
      },
    },
    search: {
      description: "Pencarian komik berdasarkan judul.",
      timeout: 40_000,
      params: {
        query: { type: "string", required: true, maxLength: 200, description: "Kata kunci pencarian" },
        page: { type: "number", minimum: 1, maximum: 500, description: "Halaman (default 1)" },
      },
      execute: async (_r, _s, { input, signal }) =>
        getSearch(input.query, input.page || 1, signal),
    },
    detail: {
      description:
        "Detail komik: judul, rating, poster, sinopsis, info, genre, daftar chapter, related.",
      timeout: 40_000,
      cache: 120,
      params: {
        slug: {
          type: "string",
          required: true,
          maxLength: 300,
          description: "Slug komik, mis. 'mato-seihei-no-slave'",
        },
      },
      execute: async (_r, _s, { input, signal }) => getDetail(input.slug, signal),
    },
    chapter: {
      description: "Baca chapter: daftar gambar + navigasi (daftar/next/prev).",
      timeout: 40_000,
      cache: 60,
      params: {
        slug: {
          type: "string",
          required: true,
          maxLength: 300,
          description: "Slug chapter lengkap, mis. 'mato-seihei-no-slave-chapter-1'",
        },
      },
      execute: async (_r, _s, { input, signal }) => getChapter(input.slug, signal),
    },
  },
};
