const SITE_NAME = "MangaDex";
const API_URL = "https://api.mangadex.org";
const COVER_URL = "https://uploads.mangadex.org";
const SITE_URL = "https://mangadex.org";
const PAGE_SIZE = 20;
const FEED_PAGE_SIZE = 500;
const MIN_INTERVAL_MS = 220;
const MAX_ATTEMPTS = 3;
const DEFAULT_BLOCKED =
  "5fed0576-8b94-4f9a-b6a7-08eecd69800d,06a9fecb-b608-4f19-b93c-7caab06b7f44,8d8ecf83-8d42-4f8c-add8-60963f9f28d9,4f1de6a2-f0c5-4ac5-bce5-02c7dbb67deb,319c1b10-cbd0-4f55-a46e-c4ee17e65139";
const SORT_KEYS = ["latestUploadedChapter", "relevance", "followedCount", "createdAt", "updatedAt", "title"];
const CUSTOM_LISTS = [
  { id: "f66ebc10-ef89-46d1-be96-bb704559e04a", name: "Self-Published" },
  { id: "805ba886-dd99-4aa4-b460-4bd7c7b71352", name: "Staff Picks" },
  { id: "5c5e6e39-0b4b-413e-be59-27b1ba03d1b9", name: "Featured by Supporters" },
];
const LANGUAGE_MAP = {
  "zh-Hans": "zh",
  "zh-Hant": "zh-hk",
  fil: "tl",
  "pt-BR": "pt-br",
  "es-419": "es-la",
};

let lastRequestAt = 0;

function tag(name) {
  return `[${SITE_NAME}:${name}]`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  lastRequestAt = Math.max(Date.now(), lastRequestAt + MIN_INTERVAL_MS);
  if (wait > 0) await sleep(wait);
}

function csv(value) {
  return String(value ?? "")
    .split(/[,\s;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function languages(ctx) {
  const list = csv(ctx.defaults.get("languages", "en")).map((lang) => LANGUAGE_MAP[lang] ?? lang);
  return list.length ? list : ["en"];
}

function contentRatings(ctx) {
  const ratings = ["safe"];
  if (ctx.defaults.get("ratingSuggestive", true) !== false) ratings.push("suggestive");
  if (ctx.defaults.get("ratingErotica", false) === true) ratings.push("erotica");
  if (ctx.defaults.get("ratingPornographic", false) === true) ratings.push("pornographic");
  return ratings;
}

function query(params) {
  return params
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
}

async function apiGet(ctx, path, params = []) {
  const qs = query(params);
  const url = `${API_URL}${path}${qs ? `?${qs}` : ""}`;
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await throttle();
      const response = await ctx.request.get(url, {
        headers: { "User-Agent": "Tamdok", Referer: `${SITE_URL}/`, Accept: "application/json" },
      });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (response.status >= 400) {
        const error = new Error(`${SITE_NAME}: HTTP ${response.status}`);
        error.fatal = true;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error.fatal || attempt === MAX_ATTEMPTS) break;
      await sleep(700 * attempt);
    }
  }
  console.error(tag("api"), path, lastError?.message ?? String(lastError));
  throw lastError;
}

function firstValue(map) {
  if (!map || typeof map !== "object") return undefined;
  const values = Object.values(map);
  return values.length ? values[0] : undefined;
}

function altMap(attrs) {
  const merged = {};
  for (const item of [...(attrs.altTitles ?? [])].reverse()) Object.assign(merged, item);
  return merged;
}

function pickTitle(ctx, attrs) {
  const primary = firstValue(attrs.title) ?? "";
  const preference = ctx.defaults.get("titlePreference", "");
  if (!preference) return primary;
  const alt = altMap(attrs);
  switch (preference) {
    case "select": {
      for (const lang of languages(ctx)) {
        if (alt[lang]) return alt[lang];
      }
      return primary;
    }
    case "en":
      return alt.en || primary;
    case "ro":
      return alt["ja-ro"] || alt["ko-ro"] || primary;
    case "ja":
      return alt.ja || primary;
    default:
      return primary;
  }
}

function coverOf(ctx, item) {
  const rel = (item.relationships ?? []).find((r) => r.type === "cover_art");
  const file = rel?.attributes?.fileName;
  if (!file) return undefined;
  return `${COVER_URL}/covers/${item.id}/${file}${ctx.defaults.get("coverQuality", ".512.jpg")}`;
}

function namesOf(item, type) {
  return (item.relationships ?? [])
    .filter((r) => r.type === type)
    .map((r) => r.attributes?.name)
    .filter(Boolean);
}

function mapStatus(status) {
  switch (status) {
    case "ongoing":
      return "ongoing";
    case "completed":
      return "completed";
    case "hiatus":
      return "hiatus";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

function mapRating(rating) {
  switch (rating) {
    case "safe":
      return "safe";
    case "suggestive":
      return "suggestive";
    case "erotica":
    case "pornographic":
      return "nsfw";
    default:
      return undefined;
  }
}

function localized(map) {
  if (!map) return undefined;
  return map.en || map["ja-ro"] || map.ja || firstValue(map);
}

function toEntry(ctx, item) {
  if (!item?.id) return null;
  const attrs = item.attributes ?? {};
  return {
    key: item.id,
    title: pickTitle(ctx, attrs),
    cover: coverOf(ctx, item),
    url: `${SITE_URL}/title/${item.id}`,
    status: mapStatus(attrs.status),
    contentRating: mapRating(attrs.contentRating),
    description: localized(attrs.description) || undefined,
    tags: (attrs.tags ?? []).map((t) => localized(t.attributes?.name)).filter(Boolean),
  };
}

function toSeconds(value) {
  const ms = Date.parse(value ?? "");
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function toNumber(value) {
  const number = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) ? number : undefined;
}

function chapterOf(item) {
  const attrs = item.attributes ?? {};
  const chapter = toNumber(attrs.chapter);
  const volume = toNumber(attrs.volume);
  const title =
    (volume == null || volume === 0) && chapter == null && !attrs.title
      ? "Oneshot"
      : attrs.title || undefined;
  const groups = (item.relationships ?? [])
    .filter((r) => r.type === "scanlation_group")
    .map((r) => r.attributes?.name)
    .filter(Boolean);
  const scanlators = groups.length
    ? groups
    : (item.relationships ?? [])
        .filter((r) => r.type === "user")
        .map((r) => r.attributes?.username)
        .filter(Boolean);
  return {
    key: item.id,
    title,
    chapterNumber: chapter,
    volumeNumber: volume,
    dateUploaded: toSeconds(attrs.publishAt),
    language: attrs.translatedLanguage,
    scanlators: scanlators.length ? scanlators : undefined,
    locked: attrs.isUnavailable ? true : undefined,
    url: `${SITE_URL}/chapter/${item.id}`,
  };
}

function applyFilters(filters, ctx) {
  const params = [];
  let defaultRating = true;
  let hasChapters = true;
  for (const filter of filters ?? []) {
    if (!filter) continue;
    switch (filter.type) {
      case "text":
        break;
      case "sort": {
        const key = SORT_KEYS[filter.index ?? 0];
        if (key) params.push([`order[${key}]`, filter.ascending ? "asc" : "desc"]);
        break;
      }
      case "multiSelect": {
        switch (filter.id) {
          case "lang":
            for (const value of filter.included ?? []) {
              for (const lang of csv(value.replace(/,/g, " "))) params.push(["originalLanguage[]", lang]);
            }
            for (const value of filter.excluded ?? []) {
              for (const lang of csv(value.replace(/,/g, " "))) params.push(["excludedOriginalLanguage[]", lang]);
            }
            break;
          case "rating":
            defaultRating = false;
            for (const value of filter.included ?? []) params.push(["contentRating[]", value]);
            break;
          case "status":
            for (const value of filter.included ?? []) params.push(["status[]", value]);
            break;
          case "demographic":
            for (const value of filter.included ?? []) params.push(["publicationDemographic[]", value]);
            break;
          default:
            for (const value of filter.included ?? []) params.push(["includedTags[]", value]);
            for (const value of filter.excluded ?? []) params.push(["excludedTags[]", value]);
        }
        break;
      }
      case "check":
        if (filter.id === "hasChapters" && filter.value === false) hasChapters = false;
        break;
      case "select":
        if (filter.id === "includedTagsMode" || filter.id === "excludedTagsMode") {
          params.push([filter.id, filter.value]);
        }
        break;
      default:
        break;
    }
  }
  if (defaultRating) for (const rating of contentRatings(ctx)) params.push(["contentRating[]", rating]);
  if (hasChapters) {
    params.push(["hasAvailableChapters", "true"]);
    for (const lang of languages(ctx)) params.push(["availableTranslatedLanguage[]", lang]);
  }
  return params;
}

async function authorIds(ctx, name) {
  const json = await apiGet(ctx, "/author", [["name", name]]);
  return (json?.data ?? []).map((item) => item.id);
}

async function search(ctx, text, page, filters) {
  const offset = (page - 1) * PAGE_SIZE;
  const params = [["includes[]", "cover_art"], ["limit", PAGE_SIZE], ["offset", offset]];
  for (const filter of filters ?? []) {
    if (filter?.type === "text" && (filter.id === "author" || filter.id === "artist") && filter.value) {
      const ids = await authorIds(ctx, filter.value);
      if (ids[0]) params.push(["authorOrArtist", ids[0]]);
    }
  }
  params.push(...applyFilters(filters, ctx));
  if (text && text.trim()) params.push(["title", text.trim()]);
  const json = await apiGet(ctx, "/manga", params);
  const entries = (json?.data ?? []).map((item) => toEntry(ctx, item)).filter(Boolean);
  return { entries, hasNextPage: json?.total != null && offset + PAGE_SIZE < json.total };
}

async function mangaByIds(ctx, ids) {
  if (!ids.length) return [];
  const params = [["includes[]", "cover_art"], ["limit", 100]];
  for (const rating of ["safe", "suggestive", "erotica", "pornographic"]) {
    if (contentRatings(ctx).includes(rating)) params.push(["contentRating[]", rating]);
  }
  for (const id of ids) params.push(["ids[]", id]);
  const json = await apiGet(ctx, "/manga", params);
  const byId = new Map((json?.data ?? []).map((item) => [item.id, item]));
  return ids.map((id) => toEntry(ctx, byId.get(id))).filter(Boolean);
}

async function latestUpdates(ctx, page) {
  const offset = (page - 1) * PAGE_SIZE;
  const params = [["limit", PAGE_SIZE], ["offset", offset], ["order[readableAt]", "desc"]];
  for (const rating of contentRatings(ctx)) params.push(["contentRating[]", rating]);
  for (const lang of languages(ctx)) params.push(["translatedLanguage[]", lang]);
  const json = await apiGet(ctx, "/chapter", params);
  const seen = new Set();
  const ids = [];
  for (const chapter of json?.data ?? []) {
    const id = (chapter.relationships ?? []).find((r) => r.type === "manga")?.id;
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return { entries: await mangaByIds(ctx, ids), hasNextPage: ids.length > 0 };
}

async function customList(ctx, id) {
  const json = await apiGet(ctx, `/list/${id}`);
  const ids = (json?.data?.relationships ?? []).filter((r) => r.type === "manga").map((r) => r.id);
  return { entries: await mangaByIds(ctx, ids.slice(0, 100)), hasNextPage: false };
}

function scroller(title, id, entries, kind = "scroller") {
  return { kind, title, entries, ...(id ? { listing: { id, name: title } } : {}) };
}

const source = {
  async getHome(ctx) {
    const tasks = [
      { title: "Popular", id: "popular", kind: "bigScroller", run: () => search(ctx, "", 1, [{ type: "sort", index: 2, ascending: false }]) },
      { title: "Latest Updates", id: "latest", run: () => latestUpdates(ctx, 1) },
      { title: "Recently Added", id: "recent", run: () => search(ctx, "", 1, [{ type: "sort", index: 3, ascending: false }]) },
      ...CUSTOM_LISTS.map((list) => ({
        title: list.name,
        id: `list-${list.id}`,
        run: () => customList(ctx, list.id),
      })),
    ];
    const results = await Promise.allSettled(tasks.map((task) => task.run()));
    const components = [];
    results.forEach((result, index) => {
      if (result.status !== "fulfilled" || !result.value.entries.length) return;
      const task = tasks[index];
      components.push(scroller(task.title, task.id, result.value.entries.slice(0, 12), task.kind));
    });
    if (!components.length) {
      const reason = results.find((item) => item.status === "rejected")?.reason;
      throw reason ?? new Error(`${SITE_NAME}: home is empty`);
    }
    return { components };
  },

  async getMangaList(listing, page, ctx) {
    const id = listing?.id ?? "";
    if (id === "popular") return search(ctx, "", page, [{ type: "sort", index: 2, ascending: false }]);
    if (id === "recent") return search(ctx, "", page, [{ type: "sort", index: 3, ascending: false }]);
    if (id === "latest") return latestUpdates(ctx, page);
    if (id.startsWith("list-")) return customList(ctx, id.slice(5));
    return { entries: [], hasNextPage: false };
  },

  async getSearchMangaList({ query: text, page, filters }, ctx) {
    return search(ctx, text, page ?? 1, filters);
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const updated = { ...manga, url: `${SITE_URL}/title/${manga.key}` };
    const detailsTask = needsDetails
      ? apiGet(ctx, `/manga/${manga.key}`, [
          ["includes[]", "cover_art"],
          ["includes[]", "author"],
          ["includes[]", "artist"],
        ])
      : Promise.resolve(null);
    const chaptersTask = needsChapters ? fetchChapters(ctx, manga.key) : Promise.resolve(null);
    const [details, chapters] = await Promise.all([detailsTask, chaptersTask]);

    if (details?.data) {
      const item = details.data;
      const attrs = item.attributes ?? {};
      const tags = (attrs.tags ?? []).map((t) => localized(t.attributes?.name)).filter(Boolean);
      updated.title = pickTitle(ctx, attrs) || manga.title;
      updated.altTitles = Object.values(altMap(attrs)).filter((name) => name && name !== updated.title);
      updated.cover = coverOf(ctx, item) ?? manga.cover;
      updated.authors = namesOf(item, "author");
      updated.artists = namesOf(item, "artist");
      updated.description = localized(attrs.description);
      updated.tags = tags;
      updated.status = mapStatus(attrs.status);
      updated.contentRating = mapRating(attrs.contentRating);
      updated.viewer =
        tags.includes("Long Strip") || attrs.originalLanguage === "ko" || attrs.originalLanguage === "zh"
          ? "webtoon"
          : "rtl";
    }
    if (chapters) updated.chapters = chapters;
    return updated;
  },

  async getPageList(manga, chapter, ctx) {
    const forcePort = ctx.defaults.get("standardHttpsPort", false) === true;
    const json = await apiGet(
      ctx,
      `/at-home/server/${chapter.key}`,
      forcePort ? [["forcePort443", "true"]] : [],
    );
    const dataSaver = ctx.defaults.get("dataSaver", false) === true;
    const files = dataSaver ? json?.chapter?.dataSaver : json?.chapter?.data;
    if (!files?.length) throw new Error(`${SITE_NAME}: chapter data is missing`);
    const base = `${json.baseUrl}/${dataSaver ? "data-saver" : "data"}/${json.chapter.hash}`;
    return files.map((file) => ({ url: `${base}/${file}` }));
  },
};

async function fetchChapters(ctx, id) {
  const blocked = csv(ctx.defaults.get("blockedGroups", DEFAULT_BLOCKED));
  const showUnavailable = ctx.defaults.get("lockedChapters", true) !== false;
  const base = [
    ["order[volume]", "desc"],
    ["order[chapter]", "desc"],
    ["limit", FEED_PAGE_SIZE],
    ["contentRating[]", "pornographic"],
    ["contentRating[]", "erotica"],
    ["contentRating[]", "suggestive"],
    ["contentRating[]", "safe"],
    ["includeUnavailable", showUnavailable ? "1" : "0"],
    ["includes[]", "user"],
    ["includes[]", "scanlation_group"],
    ...languages(ctx).map((lang) => ["translatedLanguage[]", lang]),
    ...blocked.flatMap((uuid) => [
      ["excludedGroups[]", uuid],
      ["excludedUploaders[]", uuid],
    ]),
  ];
  const chapters = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const json = await apiGet(ctx, `/manga/${id}/feed`, [...base, ["offset", offset]]);
    total = json?.total ?? 0;
    for (const item of json?.data ?? []) {
      if (item.attributes?.externalUrl) continue;
      chapters.push(chapterOf(item));
    }
    if (!(json?.data ?? []).length) break;
    offset += FEED_PAGE_SIZE;
  }
  return chapters;
}

if (typeof module !== "undefined") {
  module.exports = { source };
}
