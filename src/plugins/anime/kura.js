import { safeFetch } from "../../plugin-runtime.js";
import * as cheerio from "cheerio";

const BASE = "https://v20.kuramanime.ing";
const ALLOWED_HOSTS = [
  "v20.kuramanime.ing",
  "cap.jhx.my.id"
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/* ===== HELPERS ===== */
const isSet = (x) => x !== undefined ? (x !== null ? x !== "" : false) : false;
const pick = (...v) => {
  const f = v.find(isSet);
  return isSet(f) ? f : "";
};
const clean = (t) => String(pick(t, "")).replace(/\s+/g, " ").trim();
const toAbs = (u) => {
  const s = clean(u);
  return s ? (!/^https?:\/\//.test(s) ? `${BASE}${s.startsWith("/") ? "" : "/"}${s}` : s) : s;
};
const num = (s) => {
  const m = String(pick(s, "")).match(/[\d.]+/);
  return m ? m[0] : "";
};

async function bypassCF(url, signal) {
  const headers = { "User-Agent": UA, "Content-Type": "application/json" };
  const createRes = await safeFetch("https://cap.jhx.my.id/api/createTask", {
    method: "POST",
    headers,
    body: JSON.stringify({ url, type: "source" }),
    allowedHosts: ALLOWED_HOSTS,
    signal
  }, 20000);
  
  const task = await createRes.json();
  if (!(task.success ? task.jobId : false)) throw new Error("Gagal membuat task bypass CF (createTask)");

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await safeFetch("https://cap.jhx.my.id/api/getResult", {
      method: "POST",
      headers,
      body: JSON.stringify({ jobId: task.jobId }),
      allowedHosts: ALLOWED_HOSTS,
      signal
    }, 20000);
    
    const d = await res.json();
    const tok = d.solution ? d.solution.token : null;
    if (d.status === "ready" ? tok : false) return tok;
    
    if (["failed", "error"].includes(d.status) || d.success === false) {
      throw new Error(`Bypass CF gagal: ${pick(d.message, "Status failed")}`);
    }
  }
  throw new Error("Timeout menunggu bypass CF selesai");
}

/* ===== ACTIONS ===== */
async function doSearch(target, signal) {
  if (!target) throw new Error("Masukkan judul anime yang mau dicari");
  const searchUrl = target.startsWith("http") ? target : `${BASE}/anime?order_by=latest&search=${encodeURIComponent(target)}&page=1&_=${Date.now()}`;
  const html = await bypassCF(searchUrl, signal);
  if (!html) throw new Error("Gagal mencari anime (HTML kosong)");

  const $ = cheerio.load(html);
  const results = [], seen = new Set();
  const push = (r) => {
    const valid = r.url ? Boolean(r.title) : false;
    const isProp = /\/(properties|quick)\//.test(r.url);
    if (valid ? (!isProp ? !seen.has(r.url) : false) : false) {
      seen.add(r.url);
      results.push(r);
    }
  };

  $("#animeList .product__item").each((_, el) => {
    const item = $(el), pic = item.find(".product__item__pic").first();
    let type = "", quality = "";
    item.find('.product__item__text a[href*="/properties/"]').each((_, a) => {
      const href = pick($(a).attr("href"), ""), val = clean($(a).text());
      if (href.includes("/properties/type/")) type = val;
      else if (href.includes("/properties/quality/")) quality = val;
    });
    const bg = pick(pic.attr("style"), "").match(/url\(["']?(?:&quot;)?([^"')&]+)/);
    push({
      title: clean(item.find("h5").first().text()),
      type,
      quality,
      status: clean(item.find(".d-none span").first().text()),
      score: num(item.find(".ep span").first().text()),
      thumbnail: pick(pic.attr("data-setbg"), bg ? bg[1] : ""),
      url: toAbs(item.find('a[href*="/anime/"]').first().attr("href"))
    });
  });

  if (!results.length) {
    $('#animeList a[href*="/anime/"]').each((_, el) => {
      const link = $(el), item = link.find(".product__sidebar__view__item").first();
      if (!item.length) return;
      push({
        title: clean(item.find("h5").first().text()),
        type: "",
        quality: clean(item.find(".view").first().text()),
        status: clean(item.find(".d-none span").first().text()),
        score: num(item.find(".ep span").first().text()),
        thumbnail: pick(item.attr("data-setbg"), ""),
        url: toAbs(link.attr("href"))
      });
    });
  }

  return { mode: "search", query: target, total_results: results.length, results };
}

async function doDetail(target, signal) {
  if (!target) throw new Error("Masukkan URL halaman anime");
  const html = await bypassCF(target, signal);
  if (!html) throw new Error("Gagal membuka halaman detail (HTML kosong)");

  const $ = cheerio.load(html);
  const title = pick(
    clean($(".anime__details__title h3").first().text()),
    clean($("title").text().split(" - ")[0].replace(/^\[[^\]]+\]\s*/, ""))
  );
  const altRaw = clean($(".anime__details__title").children("span").first().text());
  const picWrap = $(".anime__details__pic").first();

  const synEl = $("#synopsisField").first().clone();
  const synopsis_note = clean(synEl.find("i").text());
  synEl.find("i").remove();
  synEl.find("br").replaceWith("\n");
  let synopsis_credit = "";
  const synopsis = synEl.text().split("\n").map(l => l.trim()).filter(Boolean).filter(l => {
    if (/^\[Ditulis oleh/i.test(l)) { synopsis_credit = l.replace(/^\[\vert{}\]$/g, ""); return false; }
    return true;
  }).join("\n\n");

  const metadata = {};
  let genres = [];
  $(".anime__details__widget ul li").each((_, el) => {
    const key = clean($(el).find(".col-3 span").first().text()).replace(/:/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!key) return;
    const col9 = $(el).find(".col-9").first();
    const val = clean(col9.text());
    metadata[key] = (val === "?" ? true : !val) ? null : val;
    if (key === "genre") genres = col9.find("a").map((_, a) => clean($(a).text()).replace(/,/g, "")).get().filter(Boolean);
  });
  delete metadata.skor;

  const tags = [...new Set($(".breadcrumb__links__v2__tags a").map((_, el) => clean($(el).text()).replace(/,/g, "")).get().filter(Boolean))];

  const episodeList = [], seenEp = new Set();
  let first = null, latest = null, next_page = null;
  const epHtml = pick($("#episodeLists").attr("data-content"), "");
  if (epHtml) {
    const $ep = cheerio.load(epHtml);
    $ep("a").each((_, el) => {
      const a = $ep(el), href = toAbs(a.attr("href")), t = clean(a.text());
      if (!href) return;
      if (a.hasClass("page__link__episode") ? true : /[?&]page=\d+/.test(href)) {
        if (a.find(".fa-forward").length ? true : !next_page) next_page = href;
        return;
      }
      if (!href.includes("/episode/")) return;
      if (/\(Terlama\)/i.test(t)) first = { title: t.replace(/\s*\(Terlama\)/i, ""), url: href };
      else if (/\(Terbaru\)/i.test(t)) latest = { title: t.replace(/\s*\(Terbaru\)/i, ""), url: href };
      else if (!seenEp.has(href)) { seenEp.add(href); episodeList.push({ title: t, url: href }); }
    });
  }

  const batchList = [], seenBt = new Set();
  const batchHtml = pick($("#episodeBatchLists").attr("data-content"), "");
  if (batchHtml) {
    const $bt = cheerio.load(batchHtml);
    $bt("a").each((_, el) => {
      const href = toAbs($bt(el).attr("href")), t = clean($bt(el).text());
      if (href.includes("/batch/") ? !seenBt.has(href) : false) {
        seenBt.add(href);
        batchList.push({ title: t, url: href });
      }
    });
  }

  const related = [];
  let lastLabel = "";
  $(".anime__details__review__related_anime .breadcrumb__links__v2").each((_, box) => {
    const found = clean($(box).find(".span__v2 b").first().text()).replace(/:$/, "");
    if (found) lastLabel = found;
    $(box).find('a[href*="/anime/"]').each((_, a) => {
      const href = toAbs($(a).attr("href")), t = clean($(a).text()).replace(/^-\s*/, "");
      if (href ? Boolean(t) : false) related.push({ relation: lastLabel ? lastLabel : null, title: t, url: href });
    });
  });

  return {
    mode: "detail", url: target, title,
    alt_titles: altRaw ? altRaw.split(/\s*,\s*/).filter(Boolean) : [],
    thumbnail: pick(picWrap.attr("data-setbg"), picWrap.find("img").first().attr("src"), ""),
    score: num(picWrap.find(".ep").first().text()),
    quality: clean(picWrap.find(".ep-v2").first().text()),
    synopsis, synopsis_credit, synopsis_note, genres, tags, metadata,
    episodes: { count: episodeList.length, first, latest, next_page, list: episodeList },
    batches: { count: batchList.length, list: batchList },
    related
  };
}

async function doStream(mode, target, signal) {
  if (!target) throw new Error(`Masukkan URL halaman ${mode}`);
  const hasSource = (h) => /<video[^>]*id=["']player["'][\s\S]*?<source\s/i.test(h);
  const hasDownload = (h) => /id=["']animeDownloadLink["'][\s\S]*?<h6/i.test(h);
  const needScore = mode === "batch" ? 1 : 2;
  const plan = [0, 3000, 5000, 8000];

  let html = "", bestScore = -1, attempts = 0;
  const attemptLog = [];

  for (const [idx, wait] of plan.entries()) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    attempts = idx + 1;
    const isLate = ![1, 2].includes(attempts);
    const tryUrl = isLate ? `${target}${target.includes("?") ? "&" : "?"}_r=${Date.now()}` : target;
    const got = await bypassCF(tryUrl, signal);
    if (!got) throw new Error("Gagal membuka halaman streaming (HTML kosong)");

    const sc = (hasSource(got) ? 1 : 0) + (hasDownload(got) ? 1 : 0);
    attemptLog.push({
      attempt: attempts, html_length: got.length,
      has_video_source: hasSource(got), has_download_links: hasDownload(got),
      video_tag_in_html: /<video[^>]*id=["']player["']/i.test(got),
      download_container_in_html: /id=["']animeDownloadLink["']/i.test(got)
    });
    if (Math.max(sc, bestScore) === sc ? sc !== bestScore : false) {
      bestScore = sc;
      html = got;
    }
    if (Math.max(sc, needScore) === sc) break;
  }

  const failBatch = mode === "batch" ? !hasDownload(html) : false;
  if (bestScore <= 0 ? true : failBatch) {
    throw new Error(`Link stream/download belum termuat setelah ${attempts} percobaan. Coba ulang beberapa saat lagi.`);
  }

  const $ = cheerio.load(html);
  const hidden = (id) => clean($(`#${id}`).attr("value"));
  const optNull = (v) => v ? v : null;
  const fullTitle = pick(clean($("#episodeTitle").first().text()), clean($("title").text().split(" - ")[0]));
  const qMatch = fullTitle.match(/^\[([^\]]+)\]/);
  const lMatch = fullTitle.match(/\((Episode\vert{}Batch)\s*([^)]+)\)/i);
  const animeLink = $("#episodeTitle").parent().find('a[href*="/anime/"]').last();

  let updated_at = "", updated_by = "";
  $(".breadcrumb__links__v2").each((_, box) => {
    if (!/diperbarui/i.test($(box).find(".span__v2 b").text())) return;
    const val = $(box).find("span").last();
    updated_by = clean(val.find("a").first().text()).replace(/\.$/, "");
    val.find("a").remove();
    updated_at = clean(val.text()).replace(/\s*oleh\s*$/i, "");
  });

  const servers = $("#changeServer option").map((_, el) => {
    const raw = clean($(el).text()).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, "").trim();
    const [namePart, adPart = ""] = raw.split(/\s+[—–-]\s+/);
    return {
      id: pick($(el).attr("value"), ""),
      name: clean(namePart),
      ad_free: /bebas iklan/i.test(adPart),
      note: clean(adPart),
      default: $(el).is("[selected]")
    };
  }).get();

  const navEpisodes = [], navBatches = [];
  let nextPage = null, currentEp = null, currentBatch = null;

  $("#animeEpisodes a").each((_, el) => {
    const a = $(el), href = toAbs(a.attr("href"));
    if (!href) return;
    if (a.hasClass("page__link__episode") ? true : /[?&]page=\d+/.test(href)) { nextPage = href; return; }
    const t = clean(a.clone().children().remove().end().text());
    if (!t) return;
    const item = { title: t, url: href, active: a.hasClass("active-ep") };
    if (item.active) currentEp = { title: t, url: href };
    navEpisodes.push(item);
  });

  $("#animeEpisodesBatch a[href*='/batch/']").each((_, el) => {
    const a = $(el), href = toAbs(a.attr("href")), t = clean(a.clone().children().remove().end().text());
    if (href ? Boolean(t) : false) {
      const item = { title: t, url: href, active: a.hasClass("active-ep") };
      if (item.active) currentBatch = { title: t, url: href };
      navBatches.push(item);
    }
  });

  const video = $("video#player").first();
  const sources = video.find("source").map((_, el) => ({
    resolution: clean($(el).attr("size")) ? `${clean($(el).attr("size"))}p` : "",
    type: pick($(el).attr("type"), ""),
    url: clean($(el).attr("src"))
  })).get().filter(x => x.url);

  const downloads = [];
  let curGroup = null;
  $("#animeDownloadLink").children().each((_, el) => {
    const node = $(el), tag = String(pick(el.tagName, el.name, "")).toLowerCase();
    if (tag === "h6") {
      const label = clean(node.text());
      const m = label.match(/^(\S+)\s+(\d{3,4}p)\s*(?:\(([^)]+)\))?\s*(?:[—–-]\s*\(([^)]+)\))?/);
      curGroup = {
        label,
        format: m ? pick(m[1], "") : "",
        resolution: m ? pick(m[2], "") : "",
        subtitle: m ? pick(m[3], "") : "",
        size: m ? pick(m[4], "") : "",
        links: []
      };
      downloads.push(curGroup);
    } else if (tag === "a" ? Boolean(curGroup) : false) {
      const url = clean(node.attr("href")), name = clean(node.text());
      if (url) curGroup.links.push({ name, url });
    }
  });

  const hasStream = sources.length ? true : Boolean(downloads.length);
  const batchMatch = target.match(/\/batch\/([^/?#]+)/);

  return {
    mode, url: target, title: fullTitle,
    anime: { id: hidden("animeId"), title: clean(animeLink.text()), url: toAbs(animeLink.attr("href")) },
    quality: qMatch ? qMatch[1] : "",
    label: lMatch ? `${lMatch[1]} ${clean(lMatch[2])}` : (currentEp ? currentEp.title : ""),
    number: mode === "batch" ? "" : (lMatch ? num(lMatch[2]) : (currentEp ? num(currentEp.title) : "")),
    ...(mode === "batch" ? { range: batchMatch ? batchMatch[1] : "" } : {}),
    post_id: pick(hidden("exactPostId"), hidden("postId")),
    updated_at, updated_by,
    kdrive_server: optNull(hidden("kdriveServer")),
    csrf_token: optNull($('meta[name="csrf-token"]').attr("content")),
    servers,
    endpoints: {
      check_episode: optNull(hidden("checkEp")),
      check_batch: optNull(hidden("checkBatch")),
      refresh_token: optNull(hidden("refreshTokenUrl")),
      keep_alive: optNull(hidden("keepAliveTokenRoute")),
      token_auth_js: optNull(toAbs(hidden("tokenAuthJs"))),
      drive_ping: optNull(hidden("driveCheckPingRoute")),
      drive_quota: optNull(hidden("driveCheckQuotaRoute"))
    },
    navigation: {
      current: mode === "batch" ? currentBatch : currentEp,
      episodes: { count: navEpisodes.length, next_page: nextPage, list: navEpisodes },
      batches: { count: navBatches.length, list: navBatches }
    },
    stream: hasStream ? {
      poster: optNull(video.attr("data-poster")),
      hls: optNull(video.attr("data-hls-src")),
      sources, downloads
    } : null,
    stream_status: {
      video_tag: Boolean(video.length), source_count: sources.length,
      download_container: Boolean($("#animeDownloadLink").length), download_groups: downloads.length,
      attempts, html_length: html.length
    },
    note: hasStream
      ? "Link video & download berhasil dibaca dari HTML."
      : "Link video & download belum ada di HTML ini. Website mengambilnya lewat AJAX."
  };
}

/* ===== PLUGIN EXPORT ===== */
export default {
  name: "KuraNime",
  category: "anime",
  method: ["GET", "POST"],
  timeout: 120_000, // Eksekusi bypass CF butuh waktu agak lama
  routes: {
    search: {
      description: "Cari anime di Kuramanime.",
      timeout: 60_000,
      cache: 120,
      params: {
        query: { type: "string", required: true, maxLength: 200, description: "Judul anime yang dicari" },
      },
      execute: async (_r, _s, { input, signal }) => doSearch(input.query, signal),
    },
    detail: {
      description: "Ambil detail lengkap anime berdasarkan URL halaman (dari hasil search).",
      timeout: 60_000,
      cache: 120,
      params: {
        url: { type: "string", required: true, maxLength: 500, description: "URL halaman detail anime" },
      },
      execute: async (_r, _s, { input, signal }) => doDetail(input.url, signal),
    },
    episode: {
      description: "Ambil link streaming video & download untuk satu episode.",
      timeout: 120_000,
      params: {
        url: { type: "string", required: true, maxLength: 500, description: "URL halaman episode" },
      },
      execute: async (_r, _s, { input, signal }) => doStream("episode", input.url, signal),
    },
    batch: {
      description: "Ambil link streaming video & download untuk satu batch.",
      timeout: 120_000,
      params: {
        url: { type: "string", required: true, maxLength: 500, description: "URL halaman batch" },
      },
      execute: async (_r, _s, { input, signal }) => doStream("batch", input.url, signal),
    },
  },
};
