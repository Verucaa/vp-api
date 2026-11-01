import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);
const imagePath = "assets/image/dropdown-background.jpg";

async function filesIn(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files.sort();
}

test("dropdown artwork is scoped to open panels with a responsive CSS fallback", async () => {
  const css = await readFile(path.join(root, "public/theme.css"), "utf8");
  assert.match(css, /\.endpoint-item\.is-open\s*>\s*\.endpoint-panel:not\(\[hidden\]\)/);
  assert.match(css, /background-color:\s*#071523/);
  assert.match(css, /url\("\/assets\/image\/dropdown-background\.jpg"\)/);
  assert.match(css, /background-size:\s*cover/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("static UI demo includes the dropdown image but excludes backend and secrets", async () => {
  await run(process.execPath, ["scripts/prepare-demo.js"], { cwd: root });
  const output = path.join(root, ".demo-static");
  const sandbox = { window: {} };
  vm.runInNewContext(await readFile(path.join(output, "config.js"), "utf8"), sandbox, { timeout: 1000 });
  const config = sandbox.window.WOLF_CONFIG;
  assert.equal(config.api.enabled, false);
  assert.equal(config.api.baseUrl, "");
  assert.equal(config.announcement.enabled, false);
  assert.equal(config.links.openApi, "");
  const files = await filesIn(output);
  const allowed = new Set(["index.html", "docs.html", "how-to.html", "styles.css", "theme.css", "app.js", "config.js", imagePath, "assets/image/banner.mp4"]);
  assert.ok(files.includes(imagePath));
  assert.deepEqual(files.filter(file => !allowed.has(file)), []);
  assert.deepEqual(await readFile(path.join(output, imagePath)), await readFile(path.join(root, "public", imagePath)));
});
