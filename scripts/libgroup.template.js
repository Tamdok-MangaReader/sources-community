const SITE_ID = __SITE_ID__;
const SITE_NAME = "__SITE_NAME__";
const DEFAULT_BASE_URL = "__BASE_URL__";
const DEFAULT_API_URL = "https://api.cdnlibs.org";

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAX_ATTEMPTS = 3;
const IMAGE_SERVERS_TTL_MS = 3600 * 1000;

const SORT_KEYS = [
  null,
  "rate_avg",
  "views",
  "chap_count",
  "releaseDate",
  "last_chapter_at",
  "created_at",
  "name",
  "rus_name",
];

const MULTI_PARAMS = {
  age_rating: { include: "caution[]" },
  type: { include: "types[]" },
  format: { include: "format[]", exclude: "format_exclude[]" },
  title_status: { include: "status[]" },
  translation_status: { include: "scanlate_status[]" },
  genres: { include: "genres[]", exclude: "genres_exclude[]" },
  tags: { include: "tags[]", exclude: "tags_exclude[]" },
};

const RANGE_PARAMS = {
  chap_count: ["chap_count_min", "chap_count_max"],
  year: ["year_min", "year_max"],
  rating: ["rating_min", "rating_max"],
  rate_count: ["rate_min", "rate_max"],
};

const imageServersCache = { at: 0, key: "", servers: null };

function tag(name) {
  return `[${SITE_NAME}:${name}]`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function settings(ctx) {
  const base = trimSlash(ctx.defaults.get("baseUrl", DEFAULT_BASE_URL)) || DEFAULT_BASE_URL;
  const api = trimSlash(ctx.defaults.get("apiUrl", DEFAULT_API_URL)) || DEFAULT_API_URL;
  return {
    base,
    api,
    imageServer: ctx.defaults.get("imageServerUrl", "compress") || "compress",
    coverQuality: ctx.defaults.get("coverQuality", "default") || "default",
    token: parseToken(ctx.defaults.get("authToken", "")),
  };
}

function parseToken(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      return String(parsed?.token?.access_token ?? parsed?.access_token ?? "").trim();
    } catch {
      return "";
    }
  }
  return text.replace(/^Bearer\s+/i, "");
}

function apiHeaders(cfg, extra = {}) {
  return {
    Accept: "application/json",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.7",
    Origin: cfg.base,
    Referer: cfg.api,
    "Site-Id": String(SITE_ID),
    "User-Agent": USER_AGENT,
    ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
    ...extra,
  };
}

function query(params) {
  return params
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
}

async function apiGet(ctx, cfg, path, params = []) {
  const qs = query(params);
  const url = `${cfg.api}/api${path}${qs ? `?${qs}` : ""}`;
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await ctx.request.get(url, { headers: apiHeaders(cfg) });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (response.status === 401 || response.status === 403) {
        const error = new Error(
          `${SITE_NAME}: доступ запрещён (HTTP ${response.status}). Проверьте токен в настройках источника`,
        );
        error.fatal = true;
        throw error;
      }
      if (response.status === 404) {
        const error = new Error(`${SITE_NAME}: не найдено (404)`);
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
      await sleep(400 * attempt);
    }
  }
  console.log(tag("api"), path, lastError?.message ?? String(lastError));
  throw lastError;
}

function coverUrl(cover, quality) {
  if (!cover) return undefined;
  const fallback = cover.default || cover.md || cover.thumbnail || cover.orig;
  switch (quality) {
    case "thumbnail":
      return cover.thumbnail || fallback;
    case "md":
      return cover.md || fallback;
    case "orig":
      return cover.orig || cover.md || fallback;
    default:
      return fallback;
  }
}

function mapStatus(label) {
  switch (label) {
    case "Онгоинг":
      return "ongoing";
    case "Завершён":
      return "completed";
    case "Приостановлен":
      return "hiatus";
    case "Выпуск прекращён":
      return "cancelled";
    default:
      return "unknown";
  }
}

function mapRating(label) {
  switch (label) {
    case "Нет":
    case "6+":
    case "12+":
      return "safe";
    case "16+":
      return "suggestive";
    case "18+":
      return "nsfw";
    default:
      return undefined;
  }
}

function mapViewer(label) {
  switch (label) {
    case "Манга":
    case "Руманга":
    case "OEL-манга":
      return "rtl";
    case "Манхва":
    case "Маньхуа":
      return "webtoon";
    case "Комикс":
    case "Япония":
    case "Корея":
    case "Китай":
    case "Английский":
    case "Авторский":
    case "Фанфик":
      return "ltr";
    default:
      return "default";
  }
}

function titleOf(item) {
  return item.rus_name || item.eng_name || item.name || item.slug_url || "";
}

function toEntry(item, cfg) {
  if (!item?.slug_url) return null;
  return {
    key: item.slug_url,
    title: titleOf(item),
    cover: coverUrl(item.cover, cfg.coverQuality),
    url: `${cfg.base}/ru/manga/${item.slug_url}`,
    status: mapStatus(item.status?.label),
    contentRating: mapRating(item.ageRestriction?.label),
  };
}

function personNames(list) {
  const names = (list ?? []).map((item) => item?.rus_name || item?.name).filter(Boolean);
  return names.length ? [...new Set(names)] : undefined;
}

function textOfNodes(nodes) {
  let out = "";
  for (const node of nodes ?? []) {
    if (node?.type === "hardBreak") out += "\n";
    else if (typeof node?.text === "string") out += node.text;
    else if (node?.content) out += textOfNodes(node.content);
  }
  return out;
}

function summaryText(summary) {
  if (!summary) return "";
  if (typeof summary === "string") {
    return summary
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();
  }
  const blocks = (summary.content ?? [])
    .map((node) => textOfNodes(node.content).trim())
    .filter(Boolean);
  return blocks.join("\n\n");
}

function starsLine(rating) {
  const average = Number(rating?.average);
  if (!Number.isFinite(average) || average <= 0) return "";
  const stars = Math.min(5, Math.max(0, average / 2));
  const full = Math.floor(stars);
  const half = Math.round(stars * 10) % 10 >= 5 ? 1 : 0;
  const empty = 5 - full - half;
  return `${"★".repeat(full)}${"✮".repeat(half)}${"☆".repeat(empty)} ${average.toFixed(2)} (голосов: ${rating.votes ?? 0})`;
}

function altTitlesOf(item) {
  const list = [];
  if (item.rus_name && item.eng_name) list.push(item.eng_name);
  for (const name of item.otherNames ?? []) list.push(name);
  const main = titleOf(item);
  return [...new Set(list.filter((name) => name && name !== main))];
}

function activeFilters(filters) {
  const params = [];
  for (const filter of filters ?? []) {
    if (!filter) continue;
    switch (filter.type) {
      case "sort": {
        const key = SORT_KEYS[filter.index ?? 0];
        if (key) {
          params.push(["sort_by", key]);
          if (filter.ascending) params.push(["sort_type", "asc"]);
        }
        break;
      }
      case "select": {
        if (filter.id === "genres_match_mode" && filter.value === "any") {
          params.push(["genres_soft_search", "1"]);
        } else if (filter.id === "tags_match_mode" && filter.value === "any") {
          params.push(["tags_soft_search", "1"]);
        }
        break;
      }
      case "multiSelect": {
        const map = MULTI_PARAMS[filter.id];
        if (!map) break;
        for (const value of filter.included ?? []) params.push([map.include, value]);
        if (map.exclude) {
          for (const value of filter.excluded ?? []) params.push([map.exclude, value]);
        }
        break;
      }
      case "range": {
        const map = RANGE_PARAMS[filter.id];
        if (!map) break;
        const allowZero = filter.id === "rating";
        const from = Number(filter.from);
        const to = Number(filter.to);
        if (Number.isFinite(from) && (from > 0 || (allowZero && filter.from != null))) {
          params.push([map[0], from]);
        }
        if (Number.isFinite(to) && filter.to != null && (to > 0 || allowZero)) {
          params.push([map[1], filter.id === "year" ? Math.min(to, new Date().getFullYear()) : to]);
        }
        break;
      }
      default:
        break;
    }
  }
  return params;
}

async function fetchList(ctx, cfg, path, params, page) {
  const json = await apiGet(ctx, cfg, path, [
    ...params,
    ["page", page],
    ["site_id[]", SITE_ID],
  ]);
  const entries = (json?.data ?? []).map((item) => toEntry(item, cfg)).filter(Boolean);
  const hasNextPage = Boolean(json?.meta?.has_next_page);
  return { entries, hasNextPage };
}

async function imageServerUrl(ctx, cfg) {
  const now = Date.now();
  const cacheKey = `${cfg.api}|${cfg.imageServer}`;
  if (
    imageServersCache.servers &&
    imageServersCache.key === cacheKey &&
    now - imageServersCache.at < IMAGE_SERVERS_TTL_MS
  ) {
    return imageServersCache.servers;
  }
  try {
    const json = await apiGet(ctx, cfg, "/constants", [["fields[]", "imageServers"]]);
    const servers = (json?.data?.imageServers ?? []).filter((server) =>
      (server.site_ids ?? []).includes(SITE_ID),
    );
    const chosen = servers.find((server) => server.id === cfg.imageServer) ?? servers[0];
    if (!chosen?.url) throw new Error("image server not found");
    const url = trimSlash(chosen.url);
    imageServersCache.at = now;
    imageServersCache.key = cacheKey;
    imageServersCache.servers = url;
    return url;
  } catch (error) {
    if (imageServersCache.servers) return imageServersCache.servers;
    throw error;
  }
}

function toUnixSeconds(value) {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function toNumber(value) {
  const number = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) ? number : undefined;
}

function branchesOf(item) {
  const branches = item.branches;
  if (Array.isArray(branches)) return branches;
  if (branches && typeof branches === "object") return Object.values(branches);
  return [];
}

function buildChapters(data, cfg, slug) {
  const chapters = [];
  for (const item of [...(data ?? [])].reverse()) {
    const volume = toNumber(item.volume);
    const number = toNumber(item.number);
    for (const branch of branchesOf(item)) {
      const teams = (branch.teams ?? []).map((team) => team.name).filter(Boolean);
      const scanlators = teams.length ? teams : branch.user?.username ? [branch.user.username] : [];
      const locked =
        (branch.restricted_view != null && branch.restricted_view.is_open === false) ||
        branch.moderation?.label === "На модерации";
      const branchId = branch.branch_id ?? "";
      const bid = branch.branch_id ? `?bid=${branch.branch_id}` : "";
      chapters.push({
        key: `${item.volume ?? ""}|${item.number ?? ""}|${branchId}|${branch.id}`,
        title: item.name || undefined,
        chapterNumber: number,
        volumeNumber: volume,
        dateUploaded: toUnixSeconds(branch.created_at),
        language: "ru",
        scanlators: scanlators.length ? scanlators : undefined,
        locked: locked || undefined,
        url: `${cfg.base}/ru/${slug}/read/v${item.volume ?? 0}/c${item.number ?? 0}${bid}`,
      });
    }
  }
  return chapters;
}

function scroller(title, id, entries, kind = "scroller") {
  return { kind, title, entries, ...(id ? { listing: { id, name: title } } : {}) };
}

const LISTINGS = {
  popular: (ctx, cfg, page) => fetchList(ctx, cfg, "/manga", [], page),
  currently_reading: (ctx, cfg, page) =>
    fetchList(ctx, cfg, "/media/top-views", [["popularity", 1], ["time", "day"]], page),
  latest: (ctx, cfg, page) =>
    fetchList(ctx, cfg, "/manga", [["sort_by", "last_chapter_at"]], page),
};

const source = {
  async getHome(ctx) {
    const cfg = settings(ctx);
    const section = async (run) => {
      let last;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const value = await run();
          if (value.entries.length) return value;
          last = new Error(`${SITE_NAME}: пустая секция`);
        } catch (error) {
          last = error;
          if (error?.name === "AbortError") break;
        }
        await sleep(900 * attempt);
      }
      throw last;
    };
    const [popular, reading, latest] = await Promise.allSettled([
      section(() => LISTINGS.popular(ctx, cfg, 1)),
      section(() => LISTINGS.currently_reading(ctx, cfg, 1)),
      section(() => LISTINGS.latest(ctx, cfg, 1)),
    ]);
    const components = [];
    if (popular.status === "fulfilled" && popular.value.entries.length) {
      components.push(scroller("Популярное", "popular", popular.value.entries.slice(0, 12), "bigScroller"));
    }
    if (reading.status === "fulfilled" && reading.value.entries.length) {
      components.push(scroller("Сейчас читают", "currently_reading", reading.value.entries.slice(0, 12)));
    }
    if (latest.status === "fulfilled" && latest.value.entries.length) {
      components.push(scroller("Последние обновления", "latest", latest.value.entries.slice(0, 12)));
    }
    if (!components.length) {
      const reason = [popular, reading, latest].find((item) => item.status === "rejected")?.reason;
      throw reason ?? new Error(`${SITE_NAME}: главная пуста`);
    }
    return { components };
  },

  async getMangaList(listing, page, ctx) {
    const load = LISTINGS[listing?.id];
    if (!load) return { entries: [], hasNextPage: false };
    return load(ctx, settings(ctx), page);
  },

  async getSearchMangaList({ query: text, page, filters }, ctx) {
    const cfg = settings(ctx);
    const raw = String(text ?? "").normalize("NFC").trim();
    const filterParams = activeFilters(filters);
    const run = (value) =>
      fetchList(ctx, cfg, "/manga", [...(value ? [["q", value]] : []), ...filterParams], page ?? 1);
    const result = await run(raw);
    if (!result.entries.length && raw && raw !== raw.toLowerCase()) {
      return run(raw.toLowerCase());
    }
    return result;
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const cfg = settings(ctx);
    const slug = manga.key;
    const updated = { ...manga, url: `${cfg.base}/ru/manga/${slug}` };

    const detailsTask = needsDetails
      ? apiGet(ctx, cfg, `/manga/${slug}`, [
          ["fields[]", "summary"],
          ["fields[]", "tags"],
          ["fields[]", "authors"],
          ["fields[]", "artists"],
          ["fields[]", "otherNames"],
          ["fields[]", "rate_avg"],
        ])
      : Promise.resolve(null);
    const chaptersTask = needsChapters
      ? apiGet(ctx, cfg, `/manga/${slug}/chapters`)
      : Promise.resolve(null);
    const [details, chapters] = await Promise.all([detailsTask, chaptersTask]);

    if (details) {
      const item = details.data ?? {};
      updated.title = titleOf(item) || manga.title;
      updated.altTitles = altTitlesOf(item);
      updated.cover = coverUrl(item.cover, cfg.coverQuality) ?? manga.cover;
      updated.authors = personNames(item.authors);
      updated.artists = personNames(item.artists);
      updated.tags = (item.tags ?? []).map((entry) => entry.name).filter(Boolean);
      updated.status = mapStatus(item.status?.label);
      updated.contentRating = mapRating(item.ageRestriction?.label);
      updated.viewer = mapViewer(item.type?.label);
      updated.description =
        [summaryText(item.summary), starsLine(item.rating)].filter(Boolean).join("\n\n") ||
        undefined;
    }
    if (chapters) updated.chapters = buildChapters(chapters.data, cfg, slug);
    return updated;
  },

  async getPageList(manga, chapter, ctx) {
    const cfg = settings(ctx);
    const [volume, number, branchId] = String(chapter.key).split("|");
    const json = await apiGet(ctx, cfg, `/manga/${manga.key}/chapter`, [
      ["number", number],
      ["volume", volume],
      ["branch_id", branchId],
    ]);
    const data = json?.data;
    if (!data) throw new Error(`${SITE_NAME}: глава пуста`);
    if (!Array.isArray(data.pages)) {
      const text = summaryText(
        typeof data.content === "string" ? data.content : data.content,
      );
      if (!text) throw new Error(`${SITE_NAME}: неподдерживаемый тип главы`);
      return [{ text }];
    }
    const server = await imageServerUrl(ctx, cfg);
    return data.pages
      .map((page) => {
        if (!page?.url) return null;
        const url = /^https?:\/\//i.test(page.url) ? page.url : `${server}${page.url}`;
        const width = Number(page.width);
        const height = Number(page.height);
        return { url, ...(width > 0 && height > 0 ? { width, height } : {}) };
      })
      .filter(Boolean);
  },
};

if (typeof module !== "undefined") {
  module.exports = { source };
}
