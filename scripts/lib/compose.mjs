// Composes a publishable source (manifest + script + assets) from a folder in
// `sources/`. Plain sources are read as-is. A source whose source.json has a
// `"template"` key is assembled from `templates/<name>/` plus its own config,
// mirroring how Aidoku sources depend on shared template crates.
//
// Template layout:
//   templates/<name>/template.js    shared code; sees globals CONFIG and HOOKS,
//                                   must define a top-level `const source`
//   templates/<name>/template.json  manifest defaults (info, listings, settings,
//                                   config defaults, requiredConfig)
//   templates/<name>/filters.json   optional fallback filters
//   templates/<name>/icon.png       optional fallback icon
//
// Source layout (templated):
//   source.json   info + "template" + "config" (+ optional overrides)
//   index.js      optional; exports hooks that the template may call
//   filters.json, icon.png   optional; override the template's files

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const sourcesDir = join(root, "sources");
export const templatesDir = join(root, "templates");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Objects merge recursively; arrays and scalars from `over` replace `base`.
function deepMerge(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return over;
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    out[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return out;
}

// Replaces {{config.x}} / {{info.x}} in every string of the manifest. A string
// that is exactly one placeholder keeps the value's type (number, boolean...).
function substitute(node, scope, where) {
  const lookup = (path) => {
    const value = path
      .split(".")
      .reduce((acc, key) => (acc == null ? undefined : acc[key]), scope);
    if (value === undefined) {
      throw new Error(`${where}: unresolved placeholder {{${path}}}`);
    }
    return value;
  };
  if (typeof node === "string") {
    const whole = node.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    if (whole) return lookup(whole[1]);
    return node.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => String(lookup(path)));
  }
  if (Array.isArray(node)) return node.map((item) => substitute(item, scope, where));
  if (isPlainObject(node)) {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, substitute(value, scope, where)]),
    );
  }
  return node;
}

// Shallow-merges `overrides[id]` into the settings item with that id,
// searching nested groups. Every override id must exist.
function applySettingsOverrides(settings, overrides, where) {
  const pending = new Set(Object.keys(overrides));
  const visit = (items) =>
    items.map((item) => {
      let next = item;
      if (item.id && overrides[item.id]) {
        next = { ...item, ...overrides[item.id] };
        pending.delete(item.id);
      }
      if (Array.isArray(next.items)) next = { ...next, items: visit(next.items) };
      return next;
    });
  const result = visit(settings ?? []);
  if (pending.size > 0) {
    throw new Error(`${where}: settingsOverrides for unknown setting id(s): ${[...pending].join(", ")}`);
  }
  return result;
}

function pick(...paths) {
  return paths.find((path) => existsSync(path));
}

/**
 * @param {string} folderName directory name under `sources/`
 * @returns {{ manifest: object, script: string, filtersPath?: string,
 *             iconPath?: string, template?: string }}
 */
export function composeSource(folderName) {
  const dir = join(sourcesDir, folderName);
  const raw = readJson(join(dir, "source.json"));
  const scriptPath = join(dir, "index.js");
  const filtersPath = join(dir, "filters.json");
  const iconPath = join(dir, "icon.png");

  if (!raw.template) {
    return {
      manifest: raw,
      script: readFileSync(scriptPath, "utf8"),
      filtersPath: pick(filtersPath),
      iconPath: pick(iconPath),
    };
  }

  const where = `sources/${folderName}`;
  const tplDir = join(templatesDir, raw.template);
  if (!existsSync(join(tplDir, "template.js"))) {
    throw new Error(`${where}: unknown template "${raw.template}"`);
  }
  const tpl = readJson(join(tplDir, "template.json"));
  const { template, config: ownConfig = {}, settingsOverrides = {}, ...ownManifest } = raw;
  const { config: defaultConfig = {}, requiredConfig = [], ...tplManifest } = tpl;

  const config = { ...defaultConfig, ...ownConfig };
  for (const key of requiredConfig) {
    if (config[key] === undefined) {
      throw new Error(`${where}: template "${template}" requires config.${key}`);
    }
  }

  const merged = deepMerge(tplManifest, ownManifest);
  if (merged.settings && Object.keys(settingsOverrides).length > 0) {
    merged.settings = applySettingsOverrides(merged.settings, settingsOverrides, where);
  }
  const manifest = substitute(merged, { config, info: merged.info }, where);

  const hooksSource = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : "";
  const templateSource = readFileSync(join(tplDir, "template.js"), "utf8");
  // Three nested scopes keep names from the source's hooks, the template and
  // the final module from colliding. The runtime only sees `module.exports`.
  const script = [
    `// Generated by scripts/lib/compose.mjs from template "${template}". Do not edit.`,
    `const __config = ${JSON.stringify(config, null, 2)};`,
    `const __hooks = (function () {`,
    `  const module = { exports: {} };`,
    `  const exports = module.exports;`,
    hooksSource,
    `  return module.exports;`,
    `})();`,
    `const __source = (function (CONFIG, HOOKS) {`,
    templateSource,
    `  return source;`,
    `})(__config, __hooks);`,
    `module.exports = { source: __source };`,
    ``,
  ].join("\n");

  return {
    manifest,
    script,
    filtersPath: pick(filtersPath, join(tplDir, "filters.json")),
    iconPath: pick(iconPath, join(tplDir, "icon.png")),
    template,
  };
}
