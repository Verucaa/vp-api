(() => {
  "use strict";
  const config = window.WOLF_CONFIG || {};
  const api = config.api || {};
  const announcement = config.announcement || {};
  const isDemo = api.enabled === false;
  const apiBase = (typeof api.baseUrl === "string" ? api.baseUrl.trim() : "").replace(/\/+$/, "") || window.location.origin;
  const exampleBase = isDemo ? "https://api.example.com" : apiBase;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const safeConfig = (value, fallback = "") => typeof value === "string" ? value : fallback;
  const normalizeCategory = value => String(value || "general").toLowerCase();
  const formatCategory = value => String(value || "general").replace(/[-_]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
  const isSensitive = name => /token|secret|password|api[_-]?key/i.test(name);
  const setText = (id, text) => { const element = document.getElementById(id); if (element) element.textContent = text; };
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let endpoints = [];
  let activeCategory = "all";
  let backendReady = false;
  let toastTimer;

  function create(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function rateDefaults() {
    const configuredLimit = Number(api.rateLimitMax) || 100;
    const limit = Math.min(100, Math.max(1, configuredLimit));
    const windowMs = 60000;
    const period = windowMs === 60000 ? "menit" : `${Math.round(windowMs / 1000)} detik`;
    return { limit, windowMs, period };
  }

  function applyConfig() {
    const theme = config.theme || {};
    for (const [key, cssVar] of Object.entries({ primary: "--blue", primaryStrong: "--blue-strong", accent: "--accent", page: "--page", surface: "--surface", ink: "--ink" })) {
      if (typeof theme[key] === "string" && /^#[\da-f]{3,8}$/i.test(theme[key])) document.documentElement.style.setProperty(cssVar, theme[key]);
    }
    const siteName = safeConfig(config.siteName, "VP API");
    const pageTitles = { home: safeConfig(config.pageTitle, `${siteName} — REST API tanpa API key`), docs: `Docs — ${siteName}`, "how-to": `Cara Menggunakan — ${siteName}` };
    document.title = pageTitles[document.body.dataset.page] || pageTitles.home;
    const description = safeConfig(config.description);
    if (description && $('meta[name="description"]')) $('meta[name="description"]').content = description;
    setText("brand-name", siteName); setText("footer-brand-name", siteName); setText("footer-copyright-name", siteName);
    setText("hero-description", safeConfig(config.tagline, "API praktis untuk proyekmu. Temukan endpoint yang kamu butuhkan dan mulai integrasi."));
    setText("footer-text", safeConfig(config.footerText, "Dibuat untuk integrasi yang lebih sederhana."));
    setText("footer-year", String(config.copyrightYear || new Date().getFullYear()));
    setText("eyebrow-text", safeConfig(config.eyebrow, "REST API · TANPA API KEY"));
    const { limit, period } = rateDefaults();
    setText("hero-rate-limit", `Batas default ${limit} request/${period} per IP`);
    setText("feature-limit", `Default ${limit} request/${period} per IP; dapat diatur di backend`);
    const openapi = $("#openapi-link");
    if (openapi) {
      const link = safeConfig(config.links?.openApi, "/openapi.json");
      openapi.href = /^https?:\/\//i.test(link) ? link : `${apiBase}${link.startsWith("/") ? link : `/${link}`}`;
      openapi.hidden = isDemo || !link;
    }
    const syncMotion = () => document.body.classList.toggle("motion-off", config.animation?.enabled === false || motionPreference.matches);
    syncMotion(); motionPreference.addEventListener("change", syncMotion);
    if (config.animation?.animatedBackground === false) $$(".ambient,.grid-glow,.bubble-field").forEach(element => { element.hidden = true; });
    if (document.body.dataset.page === "how-to") renderTutorialExamples();
  }

  function setupBanner() {
    const video = $("#docs-banner-video");
    const banner = $(".docs-banner");
    const button = $("#banner-motion");
    if (!video || !banner || !button) return;
    video.muted = true; video.loop = true; video.playsInline = true;
    const reduced = () => motionPreference.matches || config.animation?.enabled === false;
    const fallback = () => { video.pause(); video.hidden = true; banner.classList.remove("has-video"); button.hidden = true; };
    const load = () => {
      if (reduced()) { fallback(); return; }
      if (!video.getAttribute("src")) video.src = "/assets/image/banner.mp4";
      else if (video.readyState >= 2) showVideo();
    };
    const showVideo = async () => {
      if (reduced()) { fallback(); return; }
      video.hidden = false; banner.classList.add("has-video"); button.hidden = false;
      try { await video.play(); button.textContent = "Jeda video"; button.setAttribute("aria-label", "Jeda video banner"); }
      catch { button.textContent = "Putar video"; button.setAttribute("aria-label", "Putar video banner"); }
    };
    video.addEventListener("loadeddata", showVideo);
    video.addEventListener("error", fallback);
    button.addEventListener("click", async () => {
      if (video.paused) {
        try { await video.play(); button.textContent = "Jeda video"; button.setAttribute("aria-label", "Jeda video banner"); } catch { fallback(); }
      } else { video.pause(); button.textContent = "Putar video"; button.setAttribute("aria-label", "Putar video banner"); }
    });
    motionPreference.addEventListener("change", load);
    load();
  }

  function setupNavigation() {
    const button = $(".menu-toggle"); const nav = $("#primary-nav");
    if (!button || !nav) return;
    const close = () => { button.setAttribute("aria-expanded", "false"); button.setAttribute("aria-label", "Buka menu navigasi"); nav.classList.remove("is-open"); };
    button.addEventListener("click", () => {
      const opening = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(opening)); button.setAttribute("aria-label", opening ? "Tutup menu navigasi" : "Buka menu navigasi");
      nav.classList.toggle("is-open", opening);
    });
    nav.addEventListener("click", event => { if (event.target.closest("a")) close(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    document.addEventListener("click", event => { if (!event.target.closest(".site-header")) close(); });
  }

  function announceIfNeeded() {
    if (!announcement.enabled || !announcement.title || !announcement.message) return;
    const storeKey = `vp-api-announcement:${safeConfig(announcement.id, "default")}`;
    try { if (localStorage.getItem(storeKey) === "1") return; } catch { /* storage mungkin dinonaktifkan */ }
    setText("announcement-title", announcement.title); setText("announcement-message", announcement.message);
    const action = $("#announcement-action"); if (action) action.textContent = safeConfig(announcement.buttonText, "Mengerti");
    const dialog = $("#announcement-dialog"); if (dialog?.showModal) window.setTimeout(() => dialog.showModal(), 220);
  }

  function closeAnnouncement() {
    const dialog = $("#announcement-dialog");
    if (!dialog?.open || dialog.classList.contains("closing")) return;
    if ($("#announcement-suppress")?.checked) {
      try { localStorage.setItem(`vp-api-announcement:${safeConfig(announcement.id, "default")}`, "1"); } catch { /* storage tidak tersedia */ }
    }
    dialog.classList.add("closing");
    window.setTimeout(() => { dialog.classList.remove("closing"); if (dialog.open) dialog.close(); }, document.body.classList.contains("motion-off") ? 0 : 220);
  }

  function showToast(message) {
    const toast = $("#toast"); if (!toast) return;
    toast.textContent = message; toast.classList.add("visible"); clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3000);
  }

  async function copyText(value, success = "Disalin") {
    try { await navigator.clipboard.writeText(value); showToast(success); }
    catch {
      const input = document.createElement("textarea"); input.value = value; input.style.position = "fixed"; input.style.opacity = "0"; document.body.append(input); input.select();
      try { document.execCommand("copy"); showToast(success); } catch { showToast("Gagal menyalin teks"); }
      input.remove();
    }
  }

  function updateRateFromResponse(response, root = document) {
    const rawLimit = response.headers.get("RateLimit-Limit");
    const rawRemaining = response.headers.get("RateLimit-Remaining");
    const limit = Number(rawLimit); const remaining = Number(rawRemaining);
    const { period } = rateDefaults();
    if (rawLimit !== null && rawRemaining !== null && Number.isFinite(limit) && limit > 0 && Number.isFinite(remaining)) {
      setText("stat-limit", `${remaining} / ${limit}`);
      setText("stat-limit-note", `Tersisa pada respons terakhir · jendela ${period}`);
      setText("hero-rate-limit", `${remaining} dari ${limit} tersisa per ${period}/IP`);
      $$("[data-rate-note]", root).forEach(element => { element.textContent = `${remaining} / ${limit} request tersisa pada respons ini per ${period}/IP`; });
    }
  }

  function setApiStatus(message, state) {
    setText("connection-label", message); setText("connection-code", state === "online" ? "LIVE" : isDemo ? "DEMO" : "OFFLINE");
    const led = $(".status-led"); if (led) led.classList.toggle("offline", state !== "online");
    const mode = $("#status-mode");
    if (mode) { mode.replaceChildren(create("span", "count-pulse"), document.createTextNode(message)); mode.classList.toggle("is-offline", state !== "online"); }
  }

  function showBackendNotice(message) {
    const notice = $("#backend-notice"); if (notice) { setText("backend-notice-text", message); notice.hidden = false; }
  }

  function updateClock() {
    const now = new Date();
    setText("stat-time", new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now));
    setText("stat-timezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "Zona waktu perangkat");
  }

  async function checkHomeStatus() {
    if (!$("#stat-limit")) return;
    updateClock(); window.setInterval(updateClock, 1000);
    const { limit, period } = rateDefaults();
    if (isDemo) {
      setText("stat-limit", `${limit} / ${period}`); setText("stat-limit-note", "Batas backend (belum terukur di demo)");
      setText("stat-ip", "Tidak tersedia"); setText("stat-ip-note", "Demo offline · tanpa layanan pihak ketiga");
      setText("stat-ping", "Offline"); setText("stat-ping-note", "Backend tidak dihubungi oleh demo statis");
      setApiStatus("Demo statis · tanpa backend", "offline");
      showBackendNotice("Demo UI statis — semua request API dinonaktifkan. Kuota, IP, dan ping live tidak tersedia."); return;
    }
    try {
      const registryResponse = await fetch(`${apiBase}/api/endpoints`, { cache: "no-store" }); updateRateFromResponse(registryResponse);
      if (!registryResponse.ok) throw new Error(`HTTP ${registryResponse.status}`);
      const registry = await registryResponse.json(); backendReady = Boolean(registry?.status && registry?.result?.endpoints);
      if (!backendReady) throw new Error("Format registry tidak dikenali");
      setApiStatus("Backend terhubung", "online");
      const [health, ip] = await Promise.all([
        (async () => { const start = performance.now(); const response = await fetch(`${apiBase}/health`, { cache: "no-store" }); updateRateFromResponse(response); if (!response.ok) throw new Error("health check gagal"); return Math.round(performance.now() - start); })(),
        (async () => { const response = await fetch(`${apiBase}/info/ip`, { cache: "no-store" }); updateRateFromResponse(response); if (!response.ok) throw new Error("IP check gagal"); const body = await response.json(); return body?.result?.client_ip || "Tidak diketahui"; })()
      ]);
      setText("stat-ping", `${health} ms`); setText("stat-ping-note", "Waktu round-trip ke /health");
      setText("stat-ip", ip); setText("stat-ip-note", "Dari backend ini saja, bukan pihak ketiga");
    } catch (error) {
      backendReady = false; setApiStatus("Backend offline", "offline");
      setText("stat-limit", "—"); setText("stat-limit-note", "Header kuota muncul saat backend aktif");
      setText("stat-ip", "Tidak tersedia"); setText("stat-ip-note", "Tidak meminta IP ke layanan pihak ketiga");
      setText("stat-ping", "Offline"); setText("stat-ping-note", "Tidak dapat terhubung ke backend");
      showBackendNotice(`Backend API belum terhubung (${error.message}). Informasi live hanya tersedia saat API aktif.`);
    }
  }

  function renderCategoryTabs() {
    const container = $("#category-tabs"); if (!container) return;
    const categories = [...new Set(endpoints.map(item => normalizeCategory(item.category)))].sort();
    container.replaceChildren(...[["all", "Semua"], ...categories.map(category => [category, formatCategory(category)])].map(([key, label]) => {
      const button = create("button", `category-tab${activeCategory === key ? " active" : ""}`, label);
      button.type = "button"; button.dataset.category = key; button.setAttribute("aria-pressed", String(activeCategory === key));
      button.addEventListener("click", () => {
        activeCategory = key;
        $$(".category-tab", container).forEach(tab => { const selected = tab.dataset.category === key; tab.classList.toggle("active", selected); tab.setAttribute("aria-pressed", String(selected)); });
        renderCatalog();
      }); return button;
    }));
  }

  function filteredEndpoints() {
    const query = $("#search-input")?.value.trim().toLowerCase() || "";
    return endpoints.filter(item => (activeCategory === "all" || normalizeCategory(item.category) === activeCategory) && `${item.name || ""} ${item.endpoint || ""} ${item.description || ""} ${item.category || ""}`.toLowerCase().includes(query));
  }

  function blockedReason(item) {
    if (item.enabled === false) return item.unavailable_reason || "Nonaktif di Cloudflare Workers (501). Gunakan adapter Node/Vercel untuk endpoint ini.";
    if (isDemo) return "Demo UI statis: Confirm dinonaktifkan dan tidak ada request backend yang dikirim.";
    if (!backendReady) return "Backend belum terhubung. Confirm dinonaktifkan; jalankan backend atau periksa config.js.";
    return "";
  }

  function makeEndpointAccordion(item, index) {
    const id = `endpoint-${index}`;
    const article = create("article", "endpoint-item"); article.dataset.route = item.endpoint;
    const summary = create("div", "endpoint-summary");
    const toggle = create("button", "endpoint-toggle"); toggle.type = "button"; toggle.id = `${id}-toggle`; toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", `${id}-panel`);
    const ident = create("span", "endpoint-ident"); ident.append(create("span", "endpoint-name", item.name || item.endpoint), create("code", "endpoint-path", item.endpoint)); toggle.append(ident);
    const methods = Array.isArray(item.method) && item.method.length ? item.method : ["GET"];
    const method = create("span", "method-pill", methods.includes("GET") ? "GET" : methods[0]); method.title = `Metode tersedia: ${methods.join(", ")}`;
    const category = create("span", "endpoint-category", formatCategory(item.category));
    const runtime = create("span", `runtime-pill${item.enabled === false ? " unavailable" : ""}`, item.enabled === false ? "501 · Workers" : isDemo || !backendReady ? "Preview" : "Aktif");
    const tryButton = create("button", "try-button"); tryButton.type = "button"; tryButton.setAttribute("aria-expanded", "false"); tryButton.setAttribute("aria-controls", `${id}-panel`); tryButton.setAttribute("aria-label", `Try it: ${item.name || item.endpoint}`);
    tryButton.append(document.createTextNode("Try it"), create("span", "try-chevron", "⌄"));
    summary.append(toggle, category, method, runtime, tryButton);
    const panel = create("div", "endpoint-panel"); panel.id = `${id}-panel`; panel.hidden = true; panel.setAttribute("role", "region"); panel.setAttribute("aria-labelledby", `${id}-toggle`);
    panel.append(create("p", "endpoint-description", item.description || "Tidak ada deskripsi tambahan."));
    if (item.enabled === false) { const support = create("p", "endpoint-support", blockedReason(item)); support.setAttribute("role", "note"); panel.append(support); }
    panel.append(makeRequestForm(item, id));
    const expand = () => {
      const opening = panel.hidden;
      panel.hidden = !opening; article.classList.toggle("is-open", opening);
      toggle.setAttribute("aria-expanded", String(opening)); tryButton.setAttribute("aria-expanded", String(opening));
    };
    toggle.addEventListener("click", expand); tryButton.addEventListener("click", expand);
    article.addEventListener("keydown", event => {
      if (event.key === "Escape" && !panel.hidden) { panel.hidden = true; article.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); tryButton.setAttribute("aria-expanded", "false"); tryButton.focus(); }
    });
    article.append(summary, panel); return article;
  }

  function makeRequestForm(item, id) {
    const form = create("form", "endpoint-form"); form.id = `${id}-form`;
    const methods = Array.isArray(item.method) && item.method.length ? item.method : ["GET"];
    const heading = create("div", "form-heading"); heading.append(create("h3", "", "Request playground"));
    const methodLabel = create("label", "method-control", "METHOD"); methodLabel.htmlFor = `${id}-method`;
    const select = create("select", "request-method"); select.id = `${id}-method`; select.name = "request-method";
    select.replaceChildren(...methods.map(method => { const option = create("option", "", method); option.value = method; return option; }));
    select.value = methods.includes("GET") ? "GET" : methods[0]; methodLabel.append(select); heading.append(methodLabel);
    form.append(heading);
    const inputs = create("div", "request-inputs");
    for (const [key, raw] of Object.entries(item.params || {})) {
      const detail = raw && typeof raw === "object" ? raw : {};
      const row = create("div", "input-row"); const label = create("label"); label.htmlFor = `${id}-input-${key}`;
      label.append(create("span", "", `${key}${detail.required ? " *" : " (opsional)"}`));
      const hint = create("small", "input-hint", detail.description || ""); hint.id = `${id}-hint-${key}`;
      const input = create(Array.isArray(detail.enum) ? "select" : "input"); input.id = `${id}-input-${key}`; input.name = key; input.dataset.param = "true";
      input.autocomplete = "off"; input.spellcheck = false; input.required = Boolean(detail.required); input.setAttribute("aria-describedby", hint.id);
      if (Array.isArray(detail.enum)) {
        const empty = create("option", "", detail.required ? `Pilih ${key}` : "Default backend"); empty.value = "";
        input.append(empty, ...detail.enum.map(value => { const option = create("option", "", String(value)); option.value = String(value); return option; }));
      } else {
        input.type = isSensitive(key) ? "password" : ["number", "integer"].includes(detail.type) ? "number" : "text";
        input.placeholder = `Masukkan ${key}…`;
        if (detail.minimum !== undefined) input.min = detail.minimum;
        if (detail.maximum !== undefined) input.max = detail.maximum;
        if (detail.maxLength !== undefined) input.maxLength = detail.maxLength;
        if (input.type === "number") input.step = detail.type === "integer" ? "1" : "any";
      }
      row.append(label, input, hint); inputs.append(row);
    }
    if (!Object.keys(item.params || {}).length) inputs.append(create("div", "no-params", "Tidak memerlukan parameter. Pilih Confirm untuk mengirim GET request."));
    form.append(inputs);
    const reason = blockedReason(item);
    const note = create("p", "playground-note", reason || "Akses publik, tanpa API key. Parameter sensitif seperti token hanya boleh dikirim dengan POST."); form.append(note);
    const rate = create("p", "playground-rate"); rate.dataset.rateNote = "true"; const { limit, period } = rateDefaults(); rate.textContent = `Batas default ${limit} request per ${period} per IP.`; form.append(rate);
    const feedback = create("p", "request-feedback"); feedback.hidden = true; feedback.setAttribute("role", "status"); feedback.setAttribute("aria-live", "polite"); form.append(feedback);
    const actions = create("div", "request-actions");
    const confirm = create("button", "button button-primary confirm-request", "Confirm →"); confirm.type = "submit"; confirm.disabled = Boolean(reason); if (reason) confirm.title = reason;
    const curl = create("button", "button button-outline copy-curl", "Salin cURL"); curl.type = "button";
    curl.addEventListener("click", () => { const request = buildRequest(form, item); if (request) copyText(request.curl, "Contoh cURL disalin"); });
    actions.append(confirm, curl); form.append(actions);
    const response = create("section", "response-panel"); response.hidden = true; response.setAttribute("aria-live", "polite"); response.setAttribute("aria-label", "Hasil request");
    const head = create("div", "response-head"); const meta = create("div"); meta.append(create("span", "response-status"), create("span", "response-duration"), create("h3", "", "Respons JSON"));
    const copy = create("button", "copy-button", "Salin JSON"); copy.type = "button"; copy.addEventListener("click", () => copyText($(".response-body", form).textContent, "JSON disalin"));
    const responseBody = create("pre", "response-body"); responseBody.tabIndex = 0; responseBody.setAttribute("aria-label", "Respons JSON");
    head.append(meta, copy); response.append(head, responseBody); form.append(response);
    form.addEventListener("submit", event => executeRequest(event, item)); return form;
  }

  function renderCatalog() {
    const container = $("#endpoint-container"); if (!container) return;
    const items = filteredEndpoints();
    if (!items.length) container.replaceChildren(create("div", "empty-state", endpoints.length ? "Tidak ada endpoint yang cocok. Coba kata kunci lain." : "Katalog endpoint belum tersedia."));
    else container.replaceChildren(...items.map((item, index) => makeEndpointAccordion(item, index)));
    const unavailable = endpoints.filter(item => item.enabled === false).length;
    setText("catalog-status", `${items.length} / ${endpoints.length} endpoint${unavailable ? ` · ${unavailable} nonaktif di Workers` : ""}`);
    setText("docs-intro", isDemo || !backendReady ? "Katalog pratinjau. Buka Try it untuk menjelajahi parameter; Confirm nonaktif sampai backend terhubung." : "Registry langsung dari backend. Buka Try it, isi parameter, lalu pilih Confirm untuk mengirim request.");
  }

  async function loadEndpoints() {
    if (!$("#endpoint-container")) return;
    if (isDemo) {
      endpoints = Array.isArray(config.previewEndpoints) ? config.previewEndpoints : [];
      backendReady = false; showBackendNotice("Demo UI statis — semua request API dinonaktifkan. Form, pencarian, filter, dan contoh cURL tetap dapat dijelajahi.");
    } else {
      try {
        const response = await fetch(`${apiBase}/api/endpoints?_t=${Date.now()}`, { cache: "no-store" }); updateRateFromResponse(response);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json(); if (!payload?.status || !payload?.result?.endpoints) throw new Error("Format registry tidak dikenali");
        endpoints = Object.entries(payload.result.endpoints).flatMap(([category, items]) => (items || []).map(item => ({ ...item, category: item.category || category }))); backendReady = true;
      } catch (error) {
        endpoints = Array.isArray(config.previewEndpoints) ? config.previewEndpoints : []; backendReady = false;
        showBackendNotice(`Backend API belum terhubung (${error.message}). Menampilkan katalog pratinjau; Confirm dinonaktifkan.`);
      }
    }
    renderCategoryTabs(); renderCatalog();
  }

  function buildRequest(form, item) {
    const feedback = $(".request-feedback", form); feedback.hidden = true;
    if (!form.reportValidity()) return null;
    const method = $(".request-method", form).value || "GET";
    const fields = $$("[data-param]", form);
    const values = Object.fromEntries(fields.filter(field => field.value.trim()).map(field => [field.name, field.type === "number" ? Number(field.value) : field.value.trim()]));
    if (method === "GET" && Object.keys(values).some(isSensitive)) { feedback.textContent = "Pilih POST agar token atau parameter sensitif tidak masuk ke URL."; feedback.hidden = false; $(".request-method", form).focus(); return null; }
    const query = new URLSearchParams(); if (method === "GET") for (const [key, value] of Object.entries(values)) query.append(key, String(value));
    const url = `${exampleBase}${item.endpoint || "/"}${method === "GET" && query.size ? `?${query}` : ""}`;
    const options = { method, headers: {} }; if (method !== "GET") { options.headers["Content-Type"] = "application/json"; options.body = JSON.stringify(values); }
    const safeValues = { ...values }; for (const key of Object.keys(safeValues)) if (isSensitive(key)) safeValues[key] = `[REPLACE_${key.toUpperCase()}]`;
    const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
    const curl = `curl --request ${method} ${quote(url)}${method === "GET" ? "" : ` --header ${quote("Content-Type: application/json")} --data ${quote(JSON.stringify(safeValues))}`}`;
    return { url, options, curl };
  }

  async function executeRequest(event, item) {
    event.preventDefault(); const form = event.currentTarget; const feedback = $(".request-feedback", form);
    const reason = blockedReason(item);
    if (reason) { feedback.textContent = reason; feedback.hidden = false; return; }
    const button = $(".confirm-request", form); if (button.disabled) return;
    const request = buildRequest(form, item); if (!request) return;
    button.disabled = true; button.textContent = "Mengirim…"; form.setAttribute("aria-busy", "true");
    const started = performance.now(); const panel = $(".response-panel", form); const status = $(".response-status", form);
    try {
      const response = await fetch(request.url, request.options); updateRateFromResponse(response, form);
      const text = await response.text(); let result; try { result = JSON.parse(text); } catch { result = { status: false, message: text || response.statusText }; }
      status.textContent = `${response.status} ${response.statusText || (response.ok ? "OK" : "Error")}`; status.classList.toggle("error", !response.ok);
      $(".response-body", form).textContent = JSON.stringify(result, null, 2);
      if (response.status === 429) { feedback.textContent = `Batas request tercapai. Coba lagi setelah ${response.headers.get("Retry-After") || "beberapa"} detik.`; feedback.hidden = false; }
    } catch (error) {
      status.textContent = "Koneksi gagal"; status.classList.add("error"); $(".response-body", form).textContent = JSON.stringify({ status: false, message: error.message }, null, 2);
      feedback.textContent = "Periksa koneksi backend dan konfigurasi CORS. Request tidak berhasil."; feedback.hidden = false;
    } finally {
      $(".response-duration", form).textContent = `${Math.round(performance.now() - started)} ms`; panel.hidden = false;
      form.removeAttribute("aria-busy"); button.disabled = Boolean(blockedReason(item)); button.textContent = "Confirm →";
    }
  }

  function renderTutorialExamples() {
    const base = exampleBase;
    const examples = {
      "code-curl": `curl '${base}/info/ping'`,
      "code-javascript": `const response = await fetch("${base}/info/ping");\nconst data = await response.json();\nconsole.log(data.result);`,
      "code-typescript": `type ApiResponse<T> = { status: boolean; creator: string; result: T };\ntype PingResult = { uptime: string; memory: string; timestamp: string };\n\nconst response = await fetch("${base}/info/ping");\nconst data = await response.json() as ApiResponse<PingResult>;\nconsole.log(data.result);`,
      "code-python": `import requests\n\nresponse = requests.get("${base}/info/ping", timeout=15)\nresponse.raise_for_status()\ndata = response.json()\nprint(data["result"])`,
      "code-go": `package main\n\nimport (\n\t"fmt"\n\t"io"\n\t"net/http"\n)\n\nfunc main() {\n\tresp, err := http.Get("${base}/info/ping")\n\tif err != nil { panic(err) }\n\tdefer resp.Body.Close()\n\tbody, err := io.ReadAll(resp.Body)\n\tif err != nil { panic(err) }\n\tfmt.Println(string(body))\n}`,
      "code-php": `<?php\n$ch = curl_init("${base}/info/ping");\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n$response = curl_exec($ch);\nif ($response === false) { throw new RuntimeException(curl_error($ch)); }\ncurl_close($ch);\n$data = json_decode($response, true);\nprint_r($data["result"]);`,
      "code-ruby": `require "net/http"\nrequire "json"\n\nuri = URI("${base}/info/ping");\nresponse = Net::HTTP.get_response(uri)\ndata = JSON.parse(response.body)\nputs data["result"]`,
      "code-java": `import java.net.URI;\nimport java.net.http.HttpClient;\nimport java.net.http.HttpRequest;\nimport java.net.http.HttpResponse;\n\npublic class Main {\n  public static void main(String[] args) throws Exception {\n    var client = HttpClient.newHttpClient();\n    var request = HttpRequest.newBuilder()\n        .uri(URI.create("${base}/info/ping"))\n        .GET().build();\n    var response = client.send(request, HttpResponse.BodyHandlers.ofString());\n    System.out.println(response.body());\n  }\n}`
    };
    for (const [id, code] of Object.entries(examples)) {
      const element = document.getElementById(id);
      if (!element) continue;
      element.textContent = code;
      element.parentElement.tabIndex = 0;
      element.parentElement.setAttribute("aria-label", `Contoh kode ${element.closest(".language-card").querySelector("h3").textContent}`);
    }
    setText("tutorial-base-url", base);
  }

  function setupEvents() {
    setupNavigation(); setupBanner();
    $("#announcement-action")?.addEventListener("click", closeAnnouncement);
    $("[data-close-announcement]")?.addEventListener("click", closeAnnouncement);
    $("#announcement-dialog")?.addEventListener("click", event => { if (event.target === event.currentTarget) closeAnnouncement(); });
    $("#search-input")?.addEventListener("input", renderCatalog);
    document.addEventListener("keydown", event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && $("#search-input")) { event.preventDefault(); $("#search-input").focus(); } });
    $$('[data-copy-target]').forEach(button => button.addEventListener("click", () => { const code = document.getElementById(button.dataset.copyTarget); if (code) copyText(code.textContent, "Contoh kode disalin"); }));
    $("#copy-base-url")?.addEventListener("click", () => copyText(exampleBase, "Base URL disalin"));
  }

  function setupReveal() {
    if (config.animation?.revealOnScroll === false || !("IntersectionObserver" in window) || motionPreference.matches || config.animation?.enabled === false) { $$(".reveal").forEach(element => element.classList.add("is-visible")); return; }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); } }), { threshold: 0.08 });
    $$(".reveal").forEach(element => observer.observe(element));
  }

  document.addEventListener("DOMContentLoaded", async () => {
    applyConfig(); setupEvents(); setupReveal();
    await Promise.all([checkHomeStatus(), loadEndpoints()]); announceIfNeeded();
  });
})();
