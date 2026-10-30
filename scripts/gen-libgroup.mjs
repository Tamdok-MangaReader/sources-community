import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const aidoku = path.resolve(root, "..", "aidoku-sources", "sources");
const template = fs.readFileSync(path.join(here, "libgroup.template.js"), "utf8");

const SITES = [
  { aidokuId: "ru.mangalib", id: "ru.mangalib", name: "MangaLib", siteId: 1, url: "https://mangalib.me", rating: 1 },
  { aidokuId: "ru.slashlib", id: "ru.slashlib", name: "SlashLib", siteId: 2, url: "https://slashlib.me", rating: 2 },
  { aidokuId: "ru.hentailib", id: "ru.hentailib", name: "HentaiLib", siteId: 4, url: "https://hentailib.me", rating: 2 },
];

const VERSION = 2;

function convertSettings(aidokuSettings, site) {
  const base = aidokuSettings[0].items;
  const byKey = Object.fromEntries(base.map((item) => [item.key, item]));
  const select = (item) => ({
    type: "select",
    id: item.key,
    title: item.title,
    options: item.values.map((value, index) => ({ id: value, label: item.titles[index] ?? value })),
    default: item.default,
  });
  return [
    {
      type: "group",
      title: "Настройки",
      items: [
        { type: "text", id: "baseUrl", title: "Веб домен", default: site.url },
        select(byKey.apiUrl),
        select(byKey.imageServerUrl),
        select(byKey.coverQuality),
      ],
    },
    {
      type: "group",
      title: "Аккаунт",
      footer:
        "Для доступа к закрытому контенту вставьте access_token (или значение auth из localStorage сайта) в поле ниже.",
      items: [
        { type: "text", id: "authToken", title: "Токен доступа", default: "", secure: true },
        { type: "link", id: "login", title: "Открыть сайт", url: site.url },
      ],
    },
  ];
}

for (const site of SITES) {
  const src = path.join(aidoku, site.aidokuId);
  const out = path.join(root, "sources", `${site.id}`);
  fs.mkdirSync(out, { recursive: true });
  const code = template
    .replaceAll("__SITE_ID__", String(site.siteId))
    .replaceAll("__SITE_NAME__", site.name)
    .replaceAll("__BASE_URL__", site.url);
  fs.writeFileSync(path.join(out, "index.js"), code);
  fs.copyFileSync(path.join(src, "res", "filters.json"), path.join(out, "filters.json"));
  fs.copyFileSync(path.join(src, "res", "icon.png"), path.join(out, "icon.png"));
  const aidokuSettings = JSON.parse(fs.readFileSync(path.join(src, "res", "settings.json"), "utf8"));
  const manifest = {
    info: {
      id: `${site.id}.tamdok`,
      name: site.name,
      version: VERSION,
      url: site.url,
      contentRating: site.rating,
      languages: ["ru"],
      minAppVersion: "0.1.3",
    },
    listings: [
      { id: "popular", name: "Популярное", kind: "list" },
      { id: "currently_reading", name: "Сейчас читают", kind: "list" },
      { id: "latest", name: "Последние обновления", kind: "list" },
    ],
    settings: convertSettings(aidokuSettings, site),
  };
  fs.writeFileSync(path.join(out, "source.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("generated", site.id);
}
