import { cp, mkdir, readFile, rm, access, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".demo-static");
// An explicit asset allowlist keeps backend, .env files, caches and auth out of previews.
const files = ["index.html", "docs.html", "how-to.html", "styles.css", "theme.css", "app.js"];
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) await cp(path.join(root, "public", file), path.join(output, file));
const context = vm.createContext({ window: {} });
vm.runInContext(await readFile(path.join(root, "public/config.js"), "utf8"), context, { timeout: 1000 });
const config = JSON.parse(JSON.stringify(context.window.WOLF_CONFIG));
config.api = { ...config.api, enabled: false, baseUrl: "" };
config.announcement = { ...config.announcement, enabled: false };
config.links = { ...config.links, openApi: "" };
await writeFile(path.join(output, "config.js"), `/* Static UI preview. All backend requests are disabled. No secrets belong here. */\nwindow.WOLF_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
const image = path.join(root, "public/assets/image/dropdown-background.jpg");
const demoImage = path.join(output, "assets/image/dropdown-background.jpg");
await mkdir(path.dirname(demoImage), { recursive: true });
await cp(image, demoImage);
const banner = path.join(root, "public/assets/image/banner.mp4");
try {
  await access(banner);
  await mkdir(path.join(output, "assets/image"), { recursive: true });
  await cp(banner, path.join(output, "assets/image/banner.mp4"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
console.log(`Static-only UI preview prepared at ${output}; backend requests disabled.`);
