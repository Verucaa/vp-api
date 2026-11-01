import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, ".worker-assets");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(path.join(projectRoot, "public"), outputDir, { recursive: true });
await cp(path.join(projectRoot, "src", "media"), path.join(outputDir, "media"), { recursive: true });
console.log(`Prepared Cloudflare static assets in ${outputDir}`);
