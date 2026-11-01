import capcut from "../plugins/downloader/capcut.js";
import instagram from "../plugins/downloader/instagram.js";
import youtube from "../plugins/downloader/youtube.js";
import gempa from "../plugins/info/gempa.js";
import ip from "../plugins/info/ip.js";
import ping from "../plugins/info/ping.js";
import pinterest from "../plugins/search/pinterest.js";
import soundcloud from "../plugins/search/soundcloud.js";
import tempmail from "../plugins/tools/tempmail.js";
import film7reels from "../plugins/film/7reels.js";
import filmHura from "../plugins/film/hura.js";

export const activeWorkerPlugins = [
  { endpoint: "/downloader/capcut", handler: capcut },
  { endpoint: "/downloader/instagram", handler: instagram },
  { endpoint: "/downloader/youtube", handler: youtube },
  { endpoint: "/info/gempa", handler: gempa },
  { endpoint: "/info/ip", handler: ip },
  { endpoint: "/info/ping", handler: ping },
  { endpoint: "/search/pinterest", handler: pinterest },
  { endpoint: "/search/soundcloud", handler: soundcloud },
  { endpoint: "/tools/tempmail", handler: tempmail },
  { endpoint: "/film/7reels", handler: film7reels },
  { endpoint: "/film/hura", handler: filmHura }
];

export const disabledWorkerPlugins = [
  {
    name: "Linkvertise & Ad-Link Bypasser",
    category: "bypass",
    endpoint: "/bypass/skiplink",
    method: ["GET", "POST"],
    description: "Bypass shorteners, countdowns, and ad-link redirects",
    enabled: false,
    unavailable_reason: "Nonaktif di Workers: URL tujuan arbitrer diteruskan ke layanan pihak ketiga dan validasi DNS tidak dapat dipin ke alamat koneksi pada runtime Workers."
  },
  {
    name: "YouTube Search",
    category: "search",
    endpoint: "/search/ytsearch",
    method: ["GET", "POST"],
    description: "Search and retrieve video metadata from YouTube",
    enabled: false,
    unavailable_reason: "Nonaktif di Workers: dependency yt-search bergantung pada pola jaringan Node.js dan tidak lolos batas runtime Worker yang digunakan proyek ini."
  },
  {
    name: "Web to APK",
    category: "tools",
    endpoint: "/tools/web2apk",
    method: ["GET", "POST"],
    description: "Convert a public HTTPS website URL into an installable Android APK",
    enabled: false,
    unavailable_reason: "Nonaktif di Workers: proses mengambil website dan ikon dari URL arbitrer; Workers tidak menyediakan socket DNS pinning yang dibutuhkan untuk mempertahankan perlindungan SSRF yang sama."
  }
];
