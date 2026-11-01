import { safeFetch } from "../../plugin-runtime.js";

const BASE_URL = "https://a.ymcdn.org/api/v1";
const ALLOWED_HOSTS = ["a.ymcdn.org"];
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://id.ytmp3.mobi/"
};

const extractVideoId = (value) => {
  let url;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"].includes(host)) return null;
  if (host.endsWith("youtu.be")) return url.pathname.split("/").filter(Boolean)[0]?.match(/^[A-Za-z0-9_-]{11}$/)?.[0] || null;
  const id = url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1];
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
};

const providerUrl = (value) => {
  const url = new URL(value, BASE_URL);
  if (url.hostname.toLowerCase() !== "a.ymcdn.org" || url.protocol !== "https:") throw new Error("URL server konversi tidak valid");
  return url;
};

const initSession = async () => {
  const url = `${BASE_URL}/init?p=y&23=1llum1n471&_=${Math.random()}`;
  const response = await safeFetch(url, { headers: HEADERS, allowedHosts: ALLOWED_HOSTS }, 15_000);
  if (!response.ok) throw new Error("Gagal menginisialisasi sesi konversi");
  return response.json();
};

const startConversion = async (convertURL, videoId, format) => {
  const url = providerUrl(convertURL);
  url.searchParams.set("v", videoId);
  url.searchParams.set("f", format);
  url.searchParams.set("_", String(Math.random()));
  const response = await safeFetch(url.href, { headers: HEADERS, allowedHosts: ALLOWED_HOSTS }, 15_000);
  if (!response.ok) throw new Error("Gagal memulai konversi video");
  return response.json();
};

const checkProgress = async (progressURL, maxRetries = 30) => {
  for (let retry = 0; retry < maxRetries; retry++) {
    const url = providerUrl(progressURL);
    const response = await safeFetch(url.href, { headers: HEADERS, allowedHosts: ALLOWED_HOSTS }, 10_000);
    if (!response.ok) throw new Error("Gagal memeriksa status proses konversi");
    const data = await response.json();
    if (data.error !== 0) throw new Error(`Terjadi error pada konversi (Error Code: ${data.error})`);
    if (data.progress === 3) return data;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Waktu proses konversi melebihi batas (Timeout)");
};

export default {
  name: "YouTube Downloader",
  category: "downloader",
  description: "Download YouTube video as MP3 audio or MP4 video",
  method: ["GET", "POST"],
  timeout: 45_000,
  params: {
    url: { type: "string", required: true, maxLength: 2048, description: "YouTube video or shorts URL" },
    format: { type: "string", required: false, enum: ["mp3", "mp4"], description: "Output format: mp3 or mp4 (default: mp3)" }
  },
  execute: async (req) => {
    const url = req.query.url || req.body?.url;
    const rawFormat = (req.query.format || req.body?.format || "mp3").toLowerCase();
    const format = ["mp3", "mp4"].includes(rawFormat) ? rawFormat : "mp3";
    if (!url) throw new Error("Parameter 'url' wajib disertakan");
    const videoId = extractVideoId(url);
    if (!videoId) throw new Error("URL YouTube tidak valid atau Video ID tidak ditemukan");

    const startTime = Date.now();
    const initData = await initSession();
    if (initData.error !== 0) throw new Error(`Inisialisasi gagal dengan kode: ${initData.error}`);
    const convertData = await startConversion(initData.convertURL, videoId, format);
    if (convertData.error !== 0) throw new Error(`Konversi gagal dengan kode: ${convertData.error}`);
    await checkProgress(convertData.progressURL);
    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    return {
      video_id: videoId,
      title: convertData.title || "YouTube Media",
      format,
      download_url: convertData.downloadURL,
      process_time: elapsed
    };
  }
};
