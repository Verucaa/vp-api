/* Konfigurasi tampilan publik. Jangan menaruh rahasia/API key di frontend. */
window.WOLF_CONFIG = {
  siteName: "VP API",
  pageTitle: "VP API — REST API tanpa API key",
  description: "API praktis untuk proyekmu. Dokumentasi endpoint dan contoh penggunaan lintas bahasa.",
  tagline: "API praktis untuk proyekmu. Temukan endpoint yang kamu butuhkan dan mulai integrasi dengan bahasa favoritmu.",
  eyebrow: "REST API · TANPA API KEY",
  footerText: "Dibuat untuk integrasi yang lebih sederhana.",
  copyrightYear: 2026,
  theme: { primary: "#88d4ff", primaryStrong: "#56b8f5", accent: "#7ce8f5", page: "#06101f", surface: "#0c1a2d", ink: "#eaf4ff" },
  animation: { enabled: true, animatedBackground: true, revealOnScroll: true },
  announcement: {
    enabled: true,
    id: "welcome-nov-2026-v3",
    title: "Selamat datang di VP API!",
    message: "Jelajahi dokumentasi dan coba endpoint tanpa API key. Batas default adalah 100 request per menit per alamat IP untuk semua endpoint gabungan. Status IP dan kuota live hanya ditampilkan jika backend aktif.",
    buttonText: "Mengerti"
  },
  api: { enabled: true, baseUrl: "", rateLimitMax: 100, rateLimitWindowMs: 60000 },
  links: { openApi: "/openapi.json" },
  /* Fallback untuk docs/demo statis. Registry live tetap menjadi sumber utama saat API aktif. */
  previewEndpoints: [
    { name: "Linkvertise & Ad-Link Bypasser", category: "bypass", endpoint: "/bypass/skiplink", enabled: false, unavailable_reason: "Nonaktif di Cloudflare Workers (501): URL arbitrer memerlukan DNS socket pinning yang tidak tersedia di Workers. Gunakan adapter Node/Vercel untuk endpoint ini.", method: ["GET", "POST"], description: "Bypass shorteners, countdowns, and ad-link redirects", params: { url: { type: "string", required: true, maxLength: 2048, description: "Shortlink / ad-link URL to bypass" } } },
    { name: "CapCut Downloader", category: "downloader", endpoint: "/downloader/capcut", method: ["GET", "POST"], description: "Download video template and extract metadata from CapCut", params: { url: { type: "string", required: true, maxLength: 2048, description: "CapCut template URL" } } },
    { name: "Instagram Downloader", category: "downloader", endpoint: "/downloader/instagram", method: ["GET", "POST"], description: "Download reels, posts, stories, and profile media from Instagram", params: { url: { type: "string", required: true, maxLength: 2048, description: "Instagram URL (reels, post, story, or username)" } } },
    { name: "YouTube Downloader", category: "downloader", endpoint: "/downloader/youtube", method: ["GET", "POST"], description: "Download YouTube video as MP3 audio or MP4 video", params: { url: { type: "string", required: true, maxLength: 2048, description: "YouTube video or shorts URL" }, format: { type: "string", required: false, enum: ["mp3", "mp4"], description: "Output format: mp3 or mp4 (default: mp3)" } } },
    { name: "Gempa Terkini", category: "info", endpoint: "/info/gempa", method: ["GET"], description: "Menampilkan data gempa bumi terbaru secara real-time dari BMKG", params: {} },
    { name: "Server Status", category: "info", endpoint: "/info/ping", method: ["GET"], description: "Check server latency, uptime, and memory usage", params: {} },
    { name: "IP Pengunjung", category: "info", endpoint: "/info/ip", method: ["GET"], description: "Mengembalikan alamat IP koneksi yang dilihat oleh backend ini saja.", params: {} },
    { name: "Pinterest Search", category: "search", endpoint: "/search/pinterest", method: ["GET", "POST"], description: "Search and retrieve image URLs from Pinterest", params: { query: { type: "string", required: true, description: "Search keyword" }, limit: { type: "number", required: false, description: "Maximum images to return (default 5, max 20)" } } },
    { name: "SoundCloud Search & Downloader", category: "search", endpoint: "/search/soundcloud", method: ["GET", "POST"], description: "Search tracks or extract direct stream URL from SoundCloud", params: { query: { type: "string", required: true, maxLength: 2048, description: "Search keyword or direct SoundCloud track URL" } } },
    { name: "YouTube Search", category: "search", endpoint: "/search/ytsearch", enabled: false, unavailable_reason: "Nonaktif di Cloudflare Workers (501): yt-search membutuhkan pola jaringan Node yang tidak didukung adapter Worker. Gunakan adapter Node/Vercel untuk endpoint ini.", method: ["GET", "POST"], description: "Search and retrieve video metadata from YouTube", params: { query: { type: "string", required: true, description: "Search keyword" }, limit: { type: "number", required: false, description: "Maximum results to return (default 10, max 20)" } } },
    { name: "Temp Mail Generator & Inbox", category: "tools", endpoint: "/tools/tempmail", method: ["GET", "POST"], description: "Membuat email sementara baru atau membaca pesan masuk menggunakan token", params: { token: { type: "string", required: false, maxLength: 2048, description: "Token akses inbox untuk mengecek pesan masuk (kosongkan jika ingin membuat email baru)" } } },
    { name: "Web to APK", category: "tools", endpoint: "/tools/web2apk", enabled: false, unavailable_reason: "Nonaktif di Cloudflare Workers (501): target website arbitrer tidak dapat diamankan dengan DNS socket pinning pada Workers. Gunakan adapter Node/Vercel untuk endpoint ini.", method: ["GET", "POST"], description: "Convert a public HTTPS website URL into an installable Android APK", params: { url: { type: "string", required: true, maxLength: 2048, description: "Public HTTPS target website URL" }, name: { type: "string", required: true, maxLength: 60, description: "Application name (up to 60 characters)" }, icon_url: { type: "string", required: false, maxLength: 2048, description: "Public HTTPS image URL for app icon (optional)" }, package_name: { type: "string", required: false, maxLength: 255, description: "Android package name (for example com.example.app)" }, version_name: { type: "string", required: false, maxLength: 30, description: "Version name (default: 1.0.0)" }, version_code: { type: "number", required: false, minimum: 1, maximum: 2100000000, description: "Version code (default: 1)" } } },
    {
    path: "/film/7reels",
    category: "film",
    method: ["GET", "POST"],
    description: "Scraper 7reels.cc — homepage/search/detail/streams/direct.",
    params: ["action", "query", "page", "id", "type", "season", "episode", "language", "player"],
  },
  {
    path: "/film/hura",
    category: "film",
    method: ["GET", "POST"],
    description: "Scraper hurawatch.sx via TMDB — home/movies/tv/top-imdb/search/detail.",
    params: ["action", "query", "page", "filter", "type", "id"],
  }
  ]
};
