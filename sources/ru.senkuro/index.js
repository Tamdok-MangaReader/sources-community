"use strict";
const BASE_URL = "https://senkuro.me";
const API_URL = "https://api.senkuro.me/graphql";
const SITE_NAME = "Senkuro";
const DEFAULT_RATING = "suggestive";

const PAGE_SIZE = 20;
const RAW_PAGES_WITH_FILTERS = 3;
const MAX_ATTEMPTS = 4;

const MANGA_CARD = `
  slug
  originalName{lang content}
  titles{lang content}
  status
  rating
  cover{original{url}}
`;

const SEARCH_QUERY = `
  query Search($query:String!,$type:SearchType!){
    search(query:$query,type:$type,first:${PAGE_SIZE}){
      edges{
        node{
          ... on SearchManga{
            slug
            originalName
            titles{lang content}
            status
            rating
            cover{original{url}}
          }
        }
      }
    }
  }
`;

const BROWSE_QUERY = `
  query Browse($after:String){
    mangas(first:${PAGE_SIZE},after:$after,orderBy:{field:__FIELD__,direction:DESC}){
      edges{node{${MANGA_CARD}}}
      pageInfo{hasNextPage endCursor}
    }
  }
`;

const POPULAR_QUERY = `
  query Popular{
    mangaPopularByPeriod(period:DAY){${MANGA_CARD}}
  }
`;

const RECOMMENDATIONS_QUERY = `
  query Recommendations{
    mangaRecommendations{${MANGA_CARD}}
  }
`;

const MANGA_QUERY = `
  query Manga($slug:String!){
    manga(slug:$slug){
      slug
      originalName{lang content}
      titles{lang content}
      status
      rating
      cover{original{url}}
      mainStaff{person{name} roles}
      labels{slug titles{lang content}}
      branches{
        id
        primaryBranch
        teamActivities{team{id name}}
      }
    }
  }
`;

const CHAPTERS_QUERY = `
  query MangaChapters($branchId:ID!,$after:String,$orderBy:MangaChapterOrder!){
    mangaChapters(first:100,branchId:$branchId,after:$after,orderBy:$orderBy){
      edges{
        node{
          slug
          teamIds
          name
          number
          volume
          createdAt
        }
      }
      pageInfo{hasNextPage endCursor}
    }
  }
`;

const READER_QUERY = `
  query Reader($slug:String!,$cdnQuality:String){
    mangaChapter(slug:$slug){
      pages(cdnQuality:$cdnQuality){
        number
        image{original{height width url}}
      }
    }
  }
`;

const ORDERS = [
  { id: "latest-updates", field: "LAST_CHAPTER_AT" },
  { id: "new-titles", field: "CREATED_AT" },
];

const cursorCache = new Map();

function tag(scope) {
  return `[${SITE_NAME}][${scope}]`;
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

async function requestHeaders(ctx, extra = {}) {
  const cookie = await cookieHeader(ctx);
  return {
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
    ...(cookie ? { Cookie: cookie } : {}),
    ...extra,
  };
}

async function hasSession(ctx) {
  return (await cookieHeader(ctx)) !== "";
}

async function graphql(ctx, query, variables = {}) {
  const headers = await requestHeaders(ctx, {
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  const body = JSON.stringify({ query, variables });
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await ctx.request.post(API_URL, { headers, body });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (response.status >= 400) {
        const text = await response.text();
        const error = new Error(
          `${SITE_NAME}: HTTP ${response.status} ${String(text).slice(0, 200)}`,
        );
        error.fatal = true;
        throw error;
      }
      const result = await response.json();
      if (result?.errors?.length) {
        const error = new Error(
          `${SITE_NAME}: ${result.errors.map((item) => item.message ?? JSON.stringify(item)).join("; ")}`,
        );
        error.fatal = true;
        throw error;
      }
      if (!result?.data) {
        throw new Error(`${SITE_NAME}: пустой ответ GraphQL`);
      }
      return result.data;
    } catch (error) {
      lastError = error;
      if (error.fatal || error.name === "AbortError" || attempt === MAX_ATTEMPTS) break;
      await sleep(700 * attempt);
    }
  }
  console.log(tag("GraphQL"), lastError?.message ?? String(lastError));
  throw lastError;
}

function nameOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.content ?? "";
}

function pickTitle(node) {
  const titles = node.titles ?? [];
  const russian = titles.find((item) => item.lang?.toUpperCase() === "RU");
  return (
    russian?.content ||
    nameOf(node.originalName) ||
    titles[0]?.content ||
    node.slug
  );
}

function altTitlesOf(node, title) {
  const values = [
    nameOf(node.originalName),
    ...(node.titles ?? []).map((item) => item.content),
  ];
  return [...new Set(values.filter((value) => value && value !== title))];
}

function mapRating(value) {
  switch (String(value ?? "").toUpperCase()) {
    case "GENERAL":
    case "SAFE":
    case "0+":
    case "12+":
      return "safe";
    case "SENSITIVE":
    case "QUESTIONABLE":
    case "16+":
      return "suggestive";
    case "EXPLICIT":
    case "18+":
      return "nsfw";
    default:
      return DEFAULT_RATING;
  }
}

function mapStatus(value) {
  switch (String(value ?? "").toLowerCase()) {
    case "ongoing":
    case "онгоинг":
      return "ongoing";
    case "suspended":
    case "hiatus":
    case "приостановлено":
      return "hiatus";
    case "finished":
    case "released":
    case "completed":
    case "выпущено":
      return "completed";
    case "cancelled":
    case "отменено":
      return "cancelled";
    default:
      return "unknown";
  }
}

function toEntry(node) {
  if (!node?.slug) return null;
  return {
    key: node.slug,
    title: pickTitle(node),
    cover: node.cover?.original?.url,
    url: `${BASE_URL}/manga/${node.slug}`,
    status: mapStatus(node.status),
    contentRating: mapRating(node.rating),
  };
}

function toNumber(value) {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function toUnixSeconds(value) {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.floor(time / 1000) : undefined;
}

function staffNames(staff, roles) {
  const names = (staff ?? [])
    .filter((member) =>
      (member.roles ?? []).some((role) =>
        roles.some((needle) => String(role).toUpperCase().includes(needle)),
      ),
    )
    .map((member) => member.person?.name)
    .filter(Boolean);
  return [...new Set(names)];
}

function activeFilters(filters) {
  const result = { status: null, rating: null, order: ORDERS[0], popular: false };
  for (const filter of filters ?? []) {
    if (filter.type === "multiSelect") {
      const included = filter.included ?? [];
      const excluded = filter.excluded ?? [];
      if (filter.id === "status" || filter.id === "rating") {
        if (included.length || excluded.length) {
          result[filter.id] = { included, excluded };
        }
      }
    } else if (filter.type === "sort" && filter.id === "sort") {
      if (filter.index === 2) result.popular = true;
      else result.order = ORDERS[filter.index] ?? ORDERS[0];
    }
  }
  return result;
}

function matchesFilters(entry, selected) {
  const test = (rule, value) => {
    if (!rule) return true;
    if (rule.included.length && !rule.included.includes(value)) return false;
    return !rule.excluded.includes(value);
  };
  return (
    test(selected.status, entry.status) &&
    test(selected.rating, entry.contentRating)
  );
}

function hasClientFilters(selected) {
  return Boolean(selected.status || selected.rating);
}

async function fetchBrowse(ctx, order, rawIndex) {
  const cacheKey = (index) => `${order.field}:${index}`;
  let start = rawIndex;
  while (start > 1 && !cursorCache.has(cacheKey(start))) start -= 1;
  let after = start === 1 ? null : cursorCache.get(cacheKey(start));
  let result = null;
  for (let index = start; index <= rawIndex; index += 1) {
    const data = await graphql(
      ctx,
      BROWSE_QUERY.replace("__FIELD__", order.field),
      { after },
    );
    const connection = data.mangas;
    if (!connection) throw new Error(`${SITE_NAME}: нет данных mangas`);
    const pageInfo = connection.pageInfo ?? {};
    const nextCursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    if (nextCursor) cursorCache.set(cacheKey(index + 1), nextCursor);
    result = {
      entries: (connection.edges ?? []).map((edge) => toEntry(edge?.node)).filter(Boolean),
      hasNextPage: Boolean(nextCursor),
    };
    if (!nextCursor) {
      if (index < rawIndex) return { entries: [], hasNextPage: false };
      break;
    }
    after = nextCursor;
  }
  return result ?? { entries: [], hasNextPage: false };
}

async function browse(ctx, selected, page) {
  if (selected.popular) {
    const data = await graphql(ctx, POPULAR_QUERY);
    const entries = (data.mangaPopularByPeriod ?? [])
      .map(toEntry)
      .filter(Boolean)
      .filter((entry) => matchesFilters(entry, selected));
    return { entries: page === 1 ? entries : [], hasNextPage: false };
  }
  const rawPerPage = hasClientFilters(selected) ? RAW_PAGES_WITH_FILTERS : 1;
  const entries = [];
  let hasNextPage = false;
  for (let step = 0; step < rawPerPage; step += 1) {
    const rawIndex = (page - 1) * rawPerPage + step + 1;
    const result = await fetchBrowse(ctx, selected.order, rawIndex);
    entries.push(...result.entries.filter((entry) => matchesFilters(entry, selected)));
    hasNextPage = result.hasNextPage;
    if (!hasNextPage) break;
  }
  return { entries, hasNextPage };
}

function scroller(title, id, entries) {
  return {
    kind: "scroller",
    title,
    entries,
    ...(id ? { listing: { id, name: title } } : {}),
  };
}

async function fetchDescriptionAndFormat(ctx, url) {
  const response = await ctx.request.get(url, {
    headers: await requestHeaders(ctx),
  });
  const html = response.html();
  const description =
    html.querySelector(".text-expander__collapse")?.text?.trim() ||
    html.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ||
    undefined;
  const rating = html.querySelector(".rating-top > .rating-title")?.text?.trim() || undefined;
  let viewer;
  for (const block of html.querySelectorAll(".project-stats__body")) {
    const label = block.querySelector("div.project-stats__text")?.text?.trim().toLowerCase();
    const value = block.querySelector("div.project-stats__name")?.text?.trim().toLowerCase() ?? "";
    if (label === "формат") viewer = value.includes("вебтун") ? "webtoon" : "default";
  }
  return { description, rating, viewer };
}

async function fetchChapters(ctx, remote) {
  const branches = remote.branches ?? [];
  const branch = branches.find((item) => item.primaryBranch) ?? branches[0];
  if (!branch) return [];
  const teams = new Map(
    (branch.teamActivities ?? []).map((activity) => [activity.team?.id, activity.team?.name]),
  );
  const chapters = [];
  const seen = new Set();
  let after = null;
  for (let guard = 0; guard < 500; guard += 1) {
    const data = await graphql(ctx, CHAPTERS_QUERY, {
      branchId: branch.id,
      after,
      orderBy: { field: "NUMBER", direction: "DESC" },
    });
    const connection = data.mangaChapters;
    if (!connection) throw new Error(`${SITE_NAME}: нет данных mangaChapters`);
    for (const edge of connection.edges ?? []) {
      const chapter = edge?.node;
      if (!chapter?.slug || seen.has(chapter.slug)) continue;
      seen.add(chapter.slug);
      const scanlators = (chapter.teamIds ?? [])
        .map((id) => teams.get(id))
        .filter(Boolean);
      const volume = toNumber(chapter.volume);
      const number = toNumber(chapter.number);
      chapters.push({
        key: chapter.slug,
        title:
          chapter.name ||
          [
            volume != null ? `Том ${volume}` : null,
            number != null ? `Глава ${number}` : null,
          ]
            .filter(Boolean)
            .join(" ") ||
          undefined,
        chapterNumber: number,
        volumeNumber: volume,
        dateUploaded: toUnixSeconds(chapter.createdAt),
        language: "ru",
        scanlators: scanlators.length ? scanlators : undefined,
        url: `${BASE_URL}/manga/${remote.slug}/chapters`,
      });
    }
    const pageInfo = connection.pageInfo ?? {};
    if (!pageInfo.hasNextPage) break;
    if (!pageInfo.endCursor || pageInfo.endCursor === after) {
      throw new Error(`${SITE_NAME}: некорректный курсор пагинации глав`);
    }
    after = pageInfo.endCursor;
  }
  return chapters;
}

function parseHomeChapters(html, baseUrl) {
  const section = Array.from(html.querySelectorAll(".main-section")).find(
    (item) => item.querySelector("h3.caption")?.text?.trim() === "Последние обновления",
  );
  if (!section) return [];
  const absolute = (href) => {
    if (!href) return undefined;
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return undefined;
    }
  };
  return Array.from(section.querySelectorAll(".card-new"))
    .map((card) => {
      const mangaHref = card.querySelector(".card-cover")?.getAttribute("href");
      const chapterHref = card.querySelector(".card-new__status")?.getAttribute("href");
      const mangaPath = mangaHref ? new URL(absolute(mangaHref) ?? baseUrl).pathname : "";
      const chapterPath = chapterHref ? new URL(absolute(chapterHref) ?? baseUrl).pathname : "";
      const mangaKey = mangaPath.split("/").filter(Boolean)[1];
      const rawChapterKey = chapterPath.split("/").filter(Boolean)[3] ?? "";
      const chapterKey = rawChapterKey.replace(/[^0-9.].*$/, "");
      if (!mangaKey || !chapterKey) return null;
      const label = (card.querySelector(".card-new__info")?.text ?? "")
        .split("+")[0]
        .replace(/^Глава\s*/i, "")
        .trim();
      return {
        manga: {
          key: mangaKey,
          title: card.querySelector("h3.card-title")?.text?.trim() || mangaKey,
          cover: absolute(card.querySelector("img")?.getAttribute("src")),
        },
        chapter: { key: chapterKey, chapterNumber: toNumber(label) },
      };
    })
    .filter(Boolean);
}

const source = {
  async getHome(ctx) {
    const sections = [
      () =>
        graphql(ctx, POPULAR_QUERY).then((data) =>
          (data.mangaPopularByPeriod ?? []).map(toEntry).filter(Boolean),
        ),
      () =>
        requestHeaders(ctx)
          .then((headers) => ctx.request.get(BASE_URL, { headers }))
          .then((response) => parseHomeChapters(response.html(), response.url)),
      () => fetchBrowse(ctx, ORDERS[1], 1).then((result) => result.entries),
      () =>
        graphql(ctx, RECOMMENDATIONS_QUERY).then((data) =>
          (data.mangaRecommendations ?? []).map(toEntry).filter(Boolean),
        ),
    ];
    const loadSection = async (run) => {
      let last;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const value = await run();
          if (value.length) return value;
          last = new Error(`${SITE_NAME}: пустая секция`);
        } catch (error) {
          last = error;
          if (error?.name === "AbortError") break;
        }
        await sleep(900 * attempt);
      }
      throw last;
    };
    const [popular, latestChapters, fresh, recommended] = await Promise.allSettled(
      sections.map((run) => loadSection(run)),
    );
    const components = [];
    if (popular.status === "fulfilled" && popular.value.length) {
      components.push(scroller("Популярное за день", null, popular.value));
    }
    if (latestChapters.status === "fulfilled" && latestChapters.value.length) {
      components.push({
        kind: "mangaChapterList",
        title: "Последние обновления",
        entries: [],
        chapterEntries: latestChapters.value,
        listing: { id: "latest-updates", name: "Свежие обновления" },
      });
    }
    if (fresh.status === "fulfilled" && fresh.value.length) {
      components.push(scroller("Новые тайтлы", "new-titles", fresh.value));
    }
    if (recommended.status === "fulfilled" && recommended.value.length) {
      components.push(scroller("Рекомендации", null, recommended.value));
    }
    if (!components.length) {
      const reason = [popular, latestChapters, fresh, recommended].find(
        (item) => item.status === "rejected",
      )?.reason;
      throw reason ?? new Error(`${SITE_NAME}: главная пуста`);
    }
    return { components };
  },

  async getSearchMangaList({ query = "", page = 1, filters = [] } = {}, ctx) {
    const selected = activeFilters(filters);
    const text = String(query ?? "").trim();
    if (!text) return browse(ctx, selected, page);
    if (page > 1) return { entries: [], hasNextPage: false };
    const data = await graphql(ctx, SEARCH_QUERY, { query: text, type: "MANGA" });
    const entries = (data.search?.edges ?? [])
      .map((edge) => toEntry(edge?.node))
      .filter(Boolean)
      .filter((entry) => matchesFilters(entry, selected));
    return { entries, hasNextPage: false };
  },

  async getMangaList(listing, page, ctx) {
    const order = ORDERS.find((item) => item.id === listing?.id);
    if (!order) return { entries: [], hasNextPage: false };
    return browse(ctx, { status: null, rating: null, order, popular: false }, page);
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const url = `${BASE_URL}/manga/${manga.key}`;
    const data = await graphql(ctx, MANGA_QUERY, { slug: manga.key });
    const remote = data?.manga;
    if (!remote) throw new Error(`${SITE_NAME}: тайтл ${manga.key} не найден`);
    const updated = { ...manga, url };

    const htmlTask = needsDetails
      ? fetchDescriptionAndFormat(ctx, url).catch((error) => {
          console.log(tag("details"), error?.message ?? String(error));
          return {};
        })
      : Promise.resolve({});
    const chaptersTask = needsChapters ? fetchChapters(ctx, remote) : Promise.resolve(null);
    const [extra, chapters] = await Promise.all([htmlTask, chaptersTask]);

    if (needsDetails) {
      const title = pickTitle(remote);
      updated.title = title;
      updated.altTitles = altTitlesOf(remote, title);
      updated.cover = remote.cover?.original?.url ?? manga.cover;
      updated.authors = staffNames(remote.mainStaff, ["AUTHOR", "WRITER", "STORY", "SCRIPT"]);
      updated.artists = staffNames(remote.mainStaff, ["ART", "ILLUSTRATOR", "DRAWER"]);
      updated.tags = [
        ...new Set(
          (remote.labels ?? [])
            .map((label) => pickTitle({ slug: label.slug, titles: label.titles }))
            .filter(Boolean),
        ),
      ];
      updated.status = mapStatus(remote.status);
      updated.contentRating = mapRating(remote.rating);
      updated.description = extra.description;
      updated.rating = extra.rating;
      updated.viewer = extra.viewer ?? "default";
    }
    if (needsChapters) updated.chapters = chapters ?? [];
    return updated;
  },

  async getPageList(manga, chapter, ctx) {
    const data = await graphql(ctx, READER_QUERY, {
      slug: chapter.key,
      cdnQuality: "red",
    });
    const pages = (data.mangaChapter?.pages ?? [])
      .slice()
      .sort((left, right) => (toNumber(left.number) ?? 0) - (toNumber(right.number) ?? 0))
      .map((page) => {
        const original = page.image?.original;
        if (!original?.url || !/^https?:\/\//i.test(original.url)) return null;
        const width = Number(original.width);
        const height = Number(original.height);
        return {
          url: original.url,
          ...(width > 0 && height > 0 ? { width, height } : {}),
        };
      })
      .filter(Boolean);
    if (!pages.length && !(await hasSession(ctx))) {
      throw new Error(`${SITE_NAME}: для чтения требуется авторизация (Настройки источника → Авторизироваться)`);
    }
    return pages;
  },
};

if (typeof module !== "undefined") {
  module.exports = { source };
}
