import { safeFetch } from "../../plugin-runtime.js";
import { assertPublicHttpUrl } from "../../plugin-runtime.js";

const BASE_URL = "https://webappcreator.amethystlab.org";
const MAX_ICON_BYTES = 5 * 1024 * 1024;

const generatePackageName = (appName) => {
  const cleaned = appName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `com.${cleaned || "webapp"}.app`;
};

const getIconBlob = async (iconUrl, websiteUrl) => {
  const targetUrl = iconUrl || `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(websiteUrl)}`;
  await assertPublicHttpUrl(targetUrl);
  const response = await safeFetch(targetUrl, {}, 10_000);
  if (!response.ok) throw new Error("Gagal mengunduh ikon aplikasi");
  const contentType = response.headers.get("content-type") || "";
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_ICON_BYTES) throw new Error("Ukuran ikon melebihi batas 5 MB");
  if (contentType && !contentType.toLowerCase().startsWith("image/")) throw new Error("URL ikon harus menghasilkan file gambar");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_ICON_BYTES) throw new Error("Ukuran ikon melebihi batas 5 MB");
  return new Blob([buffer], { type: contentType.split(";")[0] || "image/png" });
};

export default {
  name: "Web to APK",
  category: "tools",
  description: "Convert a public HTTPS website URL into an installable Android APK",
  method: ["GET", "POST"],
  timeout: 130_000,
  params: {
    url: { type: "string", required: true, maxLength: 2048, description: "Public HTTPS target website URL" },
    name: { type: "string", required: true, maxLength: 60, description: "Application name (up to 60 characters)" },
    icon_url: { type: "string", required: false, maxLength: 2048, description: "Public HTTPS image URL for app icon (optional)" },
    package_name: { type: "string", required: false, maxLength: 255, description: "Android package name (for example com.example.app)" },
    version_name: { type: "string", required: false, maxLength: 30, description: "Version name (default: 1.0.0)" },
    version_code: { type: "number", required: false, minimum: 1, maximum: 2_100_000_000, description: "Version code (default: 1)" }
  },
  execute: async (_req, _res, { input }) => {
    const websiteUrl = input.url;
    const appName = input.name;
    const iconUrl = input.icon_url;
    const customPackage = input.package_name;
    const versionName = input.version_name || "1.0.0";
    const versionCode = input.version_code || 1;

    const parsedWebsite = await assertPublicHttpUrl(websiteUrl);
    if (iconUrl) await assertPublicHttpUrl(iconUrl);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/.test(appName)) throw new Error("Nama aplikasi hanya boleh berisi huruf, angka, titik, garis bawah, atau tanda hubung");

    const packageName = customPackage || generatePackageName(appName);
    if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*){1,}$/.test(packageName)) throw new Error("package_name tidak valid");
    const iconBlob = await getIconBlob(iconUrl, parsedWebsite.href);

    const form = new FormData();
    form.append("websiteUrl", parsedWebsite.href);
    form.append("appName", appName);
    form.append("icon", iconBlob, "icon.png");
    form.append("packageName", packageName);
    form.append("versionName", String(versionName));
    form.append("versionCode", String(versionCode));

    const response = await safeFetch(`${BASE_URL}/api/build-apk`, {
      method: "POST",
      body: form,
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Origin": BASE_URL,
        "Referer": `${BASE_URL}/`
      }
    }, 120_000);
    if (!response.ok) throw new Error(`Server builder gagal memproses permintaan (Status: ${response.status})`);

    const data = await response.json();
    if (!data.success) throw new Error(data.message || "Gagal membangun file APK");
    const download = new URL(data.downloadUrl || "", BASE_URL);
    if (download.origin !== BASE_URL || !download.pathname.startsWith("/")) throw new Error("Builder mengembalikan URL unduhan yang tidak valid");

    return {
      app_name: appName,
      package_name: packageName,
      version: `${versionName} (${versionCode})`,
      website_url: parsedWebsite.href,
      download_url: download.href,
      file_name: data.fileName || `${appName}.apk`,
      file_size: data.fileSize || null
    };
  }
};
