const SITE_NAME = "nhentai";
const BASE_URL = "https://nhentai.net";
const API_URL = "https://nhentai.net/api/v2";
const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/300.0.598994205 Mobile/15E148 Safari/604";
const MAX_ATTEMPTS = 3;
const SORTS = ["date", "popular-today", "popular-week", "popular"];
const LISTINGS = {
  "popular-today": { name: "Popular Today", sort: 1 },
  "popular-week": { name: "Popular This Week", sort: 2 },
  popular: { name: "Popular All Time", sort: 3 },
  latest: { name: "Latest", sort: 0 },
};
const LANGUAGES = { all: "", en: "english", ja: "japanese", zh: "chinese" };

function tag(name) {
  return `[${SITE_NAME}:${name}]`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cookieHeader(ctx) {
  let cookies;
  try {
    cookies = await ctx.cookies;
  } catch {
    cookies = null;
  }
  if (!cookies || typeof cookies !== "object") return "";
  return Object.entries(cookies)
    .filter(([, value]) => value != null && value !== "")
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function apiGet(ctx, path) {
  const cookie = await cookieHeader(ctx);
  const headers = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    Referer: `${BASE_URL}/`,
    ...(cookie ? { Cookie: cookie } : {}),
  };
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await ctx.request.get(`${API_URL}${path}`, { headers });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (response.status === 403) {
        const error = new Error(
          `${SITE_NAME}: доступ закрыт Cloudflare (403). Откройте настройки источника → «Открыть сайт», пройдите проверку и повторите`,
        );
        error.fatal = true;
        throw error;
      }
      if (response.status >= 400) {
        const error = new Error(`${SITE_NAME}: HTTP ${response.status}`);
        error.fatal = true;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error.fatal || error.name === "AbortError" || attempt === MAX_ATTEMPTS) break;
      await sleep(600 * attempt);
    }
  }
  console.log(tag("api"), path, lastError?.message ?? String(lastError));
  throw lastError;
}

function imageUrl(path, cover) {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  const host = cover ? "https://t.nhentai.net" : "https://i.nhentai.net";
  return `${host}${path.startsWith("/") ? "" : "/"}${path}`;
}

function csv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function useJapanese(ctx) {
  return ctx.defaults.get("titlePreference", "english") === "japanese";
}

function listTitle(ctx, item) {
  const english = item.english_title || "";
  const japanese = item.japanese_title || "";
  if (useJapanese(ctx)) return japanese || english || `#${item.id}`;
  return english || japanese || `#${item.id}`;
}

function toEntry(ctx, item) {
  return {
    key: String(item.id),
    title: listTitle(ctx, item),
    cover: imageUrl(item.thumbnail, true),
    url: `${BASE_URL}/g/${item.id}`,
    status: "completed",
    contentRating: "nsfw",
    viewer: "rtl",
  };
}

function sortedNames(tags, type, exclude = []) {
  return tags
    .filter((item) => item.type === type && !exclude.includes(item.name))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .map((item) => item.name);
}

function detailOf(ctx, gallery) {
  const tags = gallery.tags ?? [];
  const names = sortedNames(tags, "tag");
  const artists = sortedNames(tags, "artist");
  const groups = sortedNames(tags, "group");
  const parodies = sortedNames(tags, "parody", ["original", "various"]);
  const characters = sortedNames(tags, "character");
  const lines = [`#${gallery.id}`];
  if (parodies.length) lines.push(`Parodies: ${parodies.join(", ")}`);
  if (characters.length) lines.push(`Characters: ${characters.join(", ")}`);
  lines.push(`Pages: ${gallery.num_pages}`);
  if (gallery.num_favorites > 0) lines.push(`Favorited by: ${gallery.num_favorites}`);
  const title = gallery.title ?? {};
  const english = title.english || title.pretty || "";
  const japanese = title.japanese || "";
  const mainTitle = useJapanese(ctx) ? japanese || english : english || japanese;
  return {
    title: mainTitle || `#${gallery.id}`,
    altTitles: [english, japanese, title.pretty].filter((name) => name && name !== mainTitle),
    cover: imageUrl(gallery.cover?.path, true),
    description: lines.join("\n\n"),
    authors: [...new Set([...groups, ...artists])],
    artists,
    tags: names,
    viewer: names.includes("webtoon") ? "webtoon" : "rtl",
  };
}

async function search(ctx, text, page, filters) {
  const trimmed = (text ?? "").trim();
  if (/^\d+$/.test(trimmed)) {
    const gallery = await apiGet(ctx, `/galleries/${trimmed}`);
    return {
      entries: [
        {
          key: String(gallery.id),
          title: detailOf(ctx, gallery).title,
          cover: imageUrl(gallery.cover?.path, true),
          url: `${BASE_URL}/g/${gallery.id}`,
          status: "completed",
          contentRating: "nsfw",
          viewer: "rtl",
        },
      ],
      hasNextPage: false,
    };
  }
  const parts = [];
  if (trimmed) parts.push(trimmed);
  let sort = "date";
  for (const filter of filters ?? []) {
    if (!filter) continue;
    if (filter.type === "text" && filter.value?.trim()) {
      const value = filter.value.trim();
      if (filter.id === "author") parts.push(`artist:"${value}"`);
      else if (filter.id === "groups") parts.push(`group:"${value}"`);
    } else if (filter.type === "sort") {
      sort = SORTS[filter.index ?? 0] ?? "date";
    } else if (filter.type === "multiSelect" && filter.id === "tags") {
      for (const value of filter.included ?? []) parts.push(`tag:"${value}"`);
      for (const value of filter.excluded ?? []) parts.push(`-tag:"${value}"`);
    }
  }
  const language = LANGUAGES[ctx.defaults.get("language", "all")] ?? "";
  if (language) parts.push(`language:${language}`);
  for (const blocked of csv(ctx.defaults.get("blocklist", ""))) parts.push(`-tag:"${blocked}"`);
  const queryText = parts.length ? parts.join(" ") : " ";
  const json = await apiGet(
    ctx,
    `/search?query=${encodeURIComponent(queryText)}&page=${page}&sort=${sort}`,
  );
  const entries = (json?.result ?? []).map((item) => toEntry(ctx, item));
  return { entries, hasNextPage: page < (json?.num_pages ?? 0) };
}

function scroller(title, id, entries, kind = "scroller") {
  return { kind, title, entries, listing: { id, name: title } };
}

const source = {
  async getHome(ctx) {
    const ids = ["popular-today", "popular-week", "latest"];
    const results = await Promise.allSettled(
      ids.map((id) => search(ctx, "", 1, [{ type: "sort", index: LISTINGS[id].sort }])),
    );
    const components = [];
    results.forEach((result, index) => {
      if (result.status !== "fulfilled" || !result.value.entries.length) return;
      const id = ids[index];
      const kind = index === 0 ? "bigScroller" : "scroller";
      components.push(scroller(LISTINGS[id].name, id, result.value.entries.slice(0, 12), kind));
    });
    if (!components.length) {
      const reason = results.find((item) => item.status === "rejected")?.reason;
      throw reason ?? new Error(`${SITE_NAME}: home is empty`);
    }
    return { components };
  },

  async getMangaList(listing, page, ctx) {
    const config = LISTINGS[listing?.id];
    if (!config) return { entries: [], hasNextPage: false };
    return search(ctx, "", page, [{ type: "sort", index: config.sort }]);
  },

  async getSearchMangaList({ query, page, filters }, ctx) {
    return search(ctx, query, page ?? 1, filters);
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const updated = { ...manga, url: `${BASE_URL}/g/${manga.key}`, status: "completed", contentRating: "nsfw" };
    if (!needsDetails && !needsChapters) return updated;
    const gallery = await apiGet(ctx, `/galleries/${manga.key}`);
    if (needsDetails) Object.assign(updated, detailOf(ctx, gallery));
    if (needsChapters) {
      const languages = (gallery.tags ?? [])
        .filter((item) => item.type === "language" && item.name !== "translated" && item.name !== "rewrite")
        .map((item) => item.name);
      updated.chapters = [
        {
          key: String(gallery.id),
          title: detailOf(ctx, gallery).title,
          chapterNumber: 1,
          dateUploaded: gallery.upload_date,
          url: `${BASE_URL}/g/${gallery.id}`,
          scanlators: languages.length ? [languages.join(", ")] : undefined,
        },
      ];
    }
    return updated;
  },

  async getPageList(manga, chapter, ctx) {
    const gallery = await apiGet(ctx, `/galleries/${chapter.key}`);
    const pages = (gallery.pages ?? [])
      .map((page) => {
        const url = imageUrl(page.path, false);
        if (!url) return null;
        const width = Number(page.width);
        const height = Number(page.height);
        return { url, ...(width > 0 && height > 0 ? { width, height } : {}) };
      })
      .filter(Boolean);
    if (!pages.length) throw new Error(`${SITE_NAME}: страницы недоступны`);
    return pages;
  },
};

if (typeof module !== "undefined") {
  module.exports = { source };
}
