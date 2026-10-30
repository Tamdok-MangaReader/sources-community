const SITE_NAME = "ReManga";
const SITE_URL = "https://remanga.org";
const API_V2 = "https://remanga.org/api/v2";
const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const PAGE_SIZE = 30;
const CHAPTER_PAGE_SIZE = 50;
const MAX_CHAPTER_PAGES = 400;
const MAX_ATTEMPTS = 3;
const TOKEN_COOKIES = ["token", "serverTokenV2", "serverToken", "server-token", "server_token", "access_token"];
const ORDER_FIELDS = ["chapter_date", "avg_rating", "score", "views", "votes", "count_chapters", "id"];

const LISTINGS = {
  latest: { name: "Обновления", ordering: "-chapter_date" },
  popular: { name: "Популярное", ordering: "-views" },
  "top-rated": { name: "Лучшие по рейтингу", ordering: "-avg_rating" },
  "new-titles": { name: "Новинки", ordering: "-id" },
};

function tag(name) {
  return `[${SITE_NAME}:${name}]`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeToken(raw) {
  const text = String(raw ?? "").trim().replace(/^Bearer\s+/i, "").trim();
  if (!text || text.startsWith("{")) return "";
  return text;
}

async function resolveToken(ctx) {
  const manual = normalizeToken(ctx.defaults.get("accessToken", ""));
  if (manual) return manual;
  let cookies;
  try {
    cookies = await ctx.cookies;
  } catch {
    cookies = null;
  }
  if (!cookies || typeof cookies !== "object") return "";
  for (const name of TOKEN_COOKIES) {
    const value = normalizeToken(cookies[name]);
    if (value) return value;
  }
  return "";
}

async function headers(ctx) {
  const token = await resolveToken(ctx);
  return {
    Accept: "application/json",
    Origin: SITE_URL,
    Referer: `${SITE_URL}/`,
    "User-Agent": USER_AGENT,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function query(params) {
  return params
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
}

async function apiGet(ctx, path, params = []) {
  const qs = query(params);
  const url = `${API_V2}${path}${qs ? `?${qs}` : ""}`;
  const requestHeaders = await headers(ctx);
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await ctx.request.get(url, { headers: requestHeaders });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (response.status >= 400) {
        const error = new Error(`${SITE_NAME}: HTTP ${response.status}`);
        error.fatal = true;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error.fatal || error.name === "AbortError" || attempt === MAX_ATTEMPTS) break;
      await sleep(500 * attempt);
    }
  }
  console.log(tag("api"), path, lastError?.message ?? String(lastError));
  throw lastError;
}

function mediaUrl(path) {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

function bestCover(...covers) {
  for (const cover of covers) {
    const value = cover?.high || cover?.mid || cover?.low;
    if (value) return mediaUrl(value);
  }
  return undefined;
}

function pickTitle(ctx, item, fallback) {
  const english = ctx.defaults.get("englishTitles", false) === true;
  const main = item.main_name || "";
  const secondary = item.secondary_name || "";
  return (english ? secondary || main : main || secondary) || fallback;
}

function mapStatus(status) {
  const id = status?.id;
  switch (id ?? status?.name) {
    case 1:
    case 6:
    case "Закончен":
    case "Лицензировано":
      return "completed";
    case 2:
    case "Продолжается":
      return "ongoing";
    case 3:
    case "Заморожен":
      return "hiatus";
    default:
      return "unknown";
  }
}

function mapRating(item) {
  const age = item.age_limit;
  const ageName = String(age?.name ?? "");
  const adult = age?.id === 2 || ageName.includes("18") || /nsfw/i.test(ageName);
  const teen = age?.id === 1 || ageName.includes("16") || ageName.includes("17");
  let suggestive = teen;
  let nsfw = Boolean(item.is_erotic) || Boolean(item.is_yaoi) || adult;
  if (!nsfw) {
    for (const genre of item.genres ?? []) {
      const lower = String(genre?.name ?? "").toLowerCase();
      if (genre?.id === 40 || lower.includes("этти") || lower.includes("ecchi")) suggestive = true;
      if (
        genre?.id === 43 ||
        genre?.id === 41 ||
        /яой|yaoi|юри|yuri|эро|hentai|хент/.test(lower)
      ) {
        nsfw = true;
        break;
      }
    }
  }
  return nsfw ? "nsfw" : suggestive ? "suggestive" : "safe";
}

function mapViewer(typeName) {
  const name = String(typeName ?? "");
  if (/анхва|аньхуа|еб/.test(name)) return "webtoon";
  if (/ападн/.test(name)) return "ltr";
  return "rtl";
}

function typeNameOf(type) {
  if (!type) return "";
  return typeof type === "string" ? type : type.name ?? "";
}

function toEntry(ctx, item) {
  if (!item?.dir) return null;
  return {
    key: item.dir,
    title: pickTitle(ctx, item, item.dir),
    cover: bestCover(item.cover, item.img),
    url: `${SITE_URL}/manga/${item.dir}`,
    status: mapStatus(item.status),
    contentRating: mapRating(item),
    viewer: mapViewer(typeNameOf(item.type)),
  };
}

function hasMore(next) {
  if (typeof next === "string") return next !== "";
  if (typeof next === "number") return next > 0;
  return Boolean(next);
}

function stripHtml(text) {
  return String(text ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toUnixSeconds(value) {
  if (!value) return undefined;
  const raw = String(value).trim();
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function toNumber(value) {
  const number = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : undefined;
}

function formatDay(value) {
  const seconds = toUnixSeconds(value);
  if (seconds == null) return String(value).slice(0, 10);
  const date = new Date(seconds * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

async function searchByQuery(ctx, text, page) {
  const json = await apiGet(ctx, "/search/", [
    ["query", text],
    ["page", page],
    ["count", PAGE_SIZE],
  ]);
  const entries = (json?.results ?? []).map((item) => toEntry(ctx, item)).filter(Boolean);
  const meta = json?.meta;
  const hasNextPage =
    meta?.page != null && meta?.total_pages != null
      ? meta.page < meta.total_pages
      : entries.length >= PAGE_SIZE;
  return { entries, hasNextPage };
}

async function catalog(ctx, page, filters, defaultOrdering = "-chapter_date") {
  const params = [
    ["page", page],
    ["count", PAGE_SIZE],
  ];
  let ordering = defaultOrdering;
  for (const filter of filters ?? []) {
    if (!filter) continue;
    if (filter.type === "sort") {
      const field = ORDER_FIELDS[filter.index ?? 0] ?? "chapter_date";
      ordering = filter.ascending ? field : `-${field}`;
    } else if (filter.type === "multiSelect") {
      const include = filter.id;
      const exclude = filter.id === "genres" || filter.id === "categories" ? `exclude_${filter.id}` : null;
      for (const value of filter.included ?? []) params.push([include, value]);
      if (exclude) for (const value of filter.excluded ?? []) params.push([exclude, value]);
    }
  }
  params.push(["ordering", ordering]);
  const json = await apiGet(ctx, "/search/catalog/", params);
  const entries = (json?.results ?? []).map((item) => toEntry(ctx, item)).filter(Boolean);
  return { entries, hasNextPage: hasMore(json?.next) || entries.length >= PAGE_SIZE };
}

function creatorNames(creators) {
  const names = [];
  const push = (name) => {
    if (name && !names.includes(name)) names.push(name);
  };
  if (Array.isArray(creators)) {
    for (const creator of creators) push(creator?.name);
  } else if (creators && typeof creators === "object") {
    for (const list of Object.values(creators)) {
      for (const creator of list ?? []) push(creator?.name);
    }
  }
  return names.length ? names : undefined;
}

function primaryBranch(branches) {
  return [...branches].sort(
    (a, b) => (b.count_chapters ?? 0) - (a.count_chapters ?? 0) || (b.id ?? 0) - (a.id ?? 0),
  )[0];
}

async function fetchChapters(ctx, slug, branches) {
  let list = branches;
  if (!list?.length) {
    const title = await apiGet(ctx, `/titles/${encodeURIComponent(slug)}/`);
    list = title?.branches ?? [];
  }
  if (!list.length) throw new Error(`${SITE_NAME}: у тайтла нет веток перевода`);
  const branch = primaryBranch(list);
  const label = branch.publishers?.[0]?.name;
  const showPaid = ctx.defaults.get("showPaidInfo", true) !== false;
  const chapters = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_CHAPTER_PAGES; page += 1) {
    const json = await apiGet(ctx, "/titles/chapters/", [
      ["branch_id", branch.id],
      ["ordering", "-index"],
      ["user_data", 1],
      ["count", CHAPTER_PAGE_SIZE],
      ["page", page],
    ]);
    const batch = json?.results ?? [];
    if (!batch.length) break;
    for (const item of batch) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const locked = Boolean(item.is_paid) && !item.is_bought;
      const parts = [];
      if (item.name && item.name !== "null") parts.push(item.name);
      if (showPaid && locked) {
        const price = item.price != null && item.price !== "" ? `${item.price} RM` : "Платно";
        parts.push(price);
        if (item.pub_date) parts.push(`бесплатно с ${formatDay(item.pub_date)}`);
      }
      const names = (item.publishers ?? []).map((publisher) => publisher.name).filter(Boolean);
      if (label && !names.includes(label)) names.push(label);
      chapters.push({
        key: String(item.id),
        title: parts.length ? parts.join(" · ") : undefined,
        chapterNumber: toNumber(item.chapter) ?? (item.index != null ? item.index : undefined),
        volumeNumber: item.tome != null ? item.tome : undefined,
        dateUploaded: toUnixSeconds(item.upload_date) ?? toUnixSeconds(item.pub_date),
        language: "ru",
        scanlators: names.length ? names : undefined,
        locked: locked || undefined,
        url: `${SITE_URL}/manga/${slug}/${item.id}`,
      });
    }
    if (!hasMore(json?.next)) break;
  }
  return chapters;
}

function scroller(title, id, entries, kind = "scroller") {
  return { kind, title, entries, ...(id ? { listing: { id, name: title } } : {}) };
}

const source = {
  async getHome(ctx) {
    const ids = ["popular", "latest", "new-titles", "top-rated"];
    const results = await Promise.allSettled(
      ids.map((id) => catalog(ctx, 1, [], LISTINGS[id].ordering)),
    );
    const components = [];
    results.forEach((result, index) => {
      if (result.status !== "fulfilled" || !result.value.entries.length) return;
      const id = ids[index];
      components.push(scroller(LISTINGS[id].name, id, result.value.entries.slice(0, index === 0 ? 12 : 9), index === 0 ? "bigScroller" : "scroller"));
    });
    if (!components.length) {
      const reason = results.find((item) => item.status === "rejected")?.reason;
      throw reason ?? new Error(`${SITE_NAME}: главная пуста`);
    }
    return { components };
  },

  async getMangaList(listing, page, ctx) {
    const config = LISTINGS[listing?.id];
    if (!config) return { entries: [], hasNextPage: false };
    return catalog(ctx, page, [], config.ordering);
  },

  async getSearchMangaList({ query: text, page, filters }, ctx) {
    const trimmed = (text ?? "").trim();
    if (trimmed) return searchByQuery(ctx, trimmed, page ?? 1);
    return catalog(ctx, page ?? 1, filters);
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const slug = manga.key;
    const updated = { ...manga, url: `${SITE_URL}/manga/${slug}` };
    let branches = null;
    if (needsDetails || needsChapters) {
      try {
        const detail = await apiGet(ctx, `/titles/${encodeURIComponent(slug)}/`);
        branches = detail?.branches ?? null;
        if (needsDetails) {
          updated.title = pickTitle(ctx, detail, manga.title || slug);
          const alt = [detail.main_name, detail.secondary_name].filter(
            (name) => name && name !== updated.title,
          );
          updated.altTitles = [...new Set(alt)];
          updated.cover = bestCover(detail.cover) ?? manga.cover;
          updated.description = stripHtml(detail.description) || manga.description;
          updated.status = mapStatus(detail.status);
          updated.contentRating = mapRating(detail);
          updated.viewer = mapViewer(typeNameOf(detail.type));
          updated.tags = [...(detail.genres ?? []), ...(detail.categories ?? [])]
            .map((item) => item?.name)
            .filter(Boolean);
          updated.authors = creatorNames(detail.creators);
        }
      } catch (error) {
        if (!needsChapters) throw error;
        console.log(tag("details"), error?.message ?? String(error));
      }
    }
    if (needsChapters) updated.chapters = await fetchChapters(ctx, slug, branches);
    return updated;
  },

  async getPageList(manga, chapter, ctx) {
    const json = await apiGet(ctx, `/titles/chapters/${chapter.key}/`);
    const server = json?.server?.link || json?.server?.fallback_link || "";
    const raw = Array.isArray(json?.pages) ? json.pages.flat() : [];
    const pages = raw
      .map((page) => page?.link)
      .filter(Boolean)
      .map((link) => {
        if (/^https?:\/\//i.test(link)) return link;
        if (server) return `${server.replace(/\/+$/, "")}${link.startsWith("/") ? "" : "/"}${link}`;
        return mediaUrl(link);
      })
      .map((url) => ({ url }));
    if (!pages.length) {
      if (json?.is_paid && !json?.is_bought) {
        throw new Error(`${SITE_NAME}: глава платная. Войдите в аккаунт с покупкой или дождитесь бесплатной публикации`);
      }
      throw new Error(`${SITE_NAME}: страницы главы недоступны`);
    }
    return pages;
  },
};

if (typeof module !== "undefined") {
  module.exports = { source };
}
