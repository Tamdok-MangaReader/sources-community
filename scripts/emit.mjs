// Writes the composed index.js/source.json of one source to `.build/<id>/`
// so it can be run in test.js or inspected. Usage: node scripts/emit.mjs <folder>
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { composeSource } from "./lib/compose.mjs";

const folder = process.argv[2];
if (!folder) {
  console.error("usage: node scripts/emit.mjs <source-folder>");
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), "..", ".build", folder);
mkdirSync(out, { recursive: true });
const { manifest, script } = composeSource(folder);
writeFileSync(join(out, "index.js"), script);
writeFileSync(join(out, "source.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${out}`);
