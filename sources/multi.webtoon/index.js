"use strict";
// WEBTOON (webtoons.com). Ported from the Aidoku multi.webtoon source.
//
// Data comes from two places:
//  - the desktop website (HTML) for lists, search, series details and chapter pages;
//  - the mobile JSON API (m.webtoons.com/api/v1/...) for the chapter list.
// Canvas (self-published) series use /challenge/ and /canvas/ URLs; their ids are
// stored with a "-canvas" suffix so one key is enough to rebuild the right URL.

const BASE_DESKTOP = "https://www.webtoons.com";
const BASE_MOBILE = "https://m.webtoons.com";
const CANVAS_SUFFIX = "-canvas";

const UA_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1";

// Sort filter index -> webtoons `sortOrder` query value.
const SORT_ORDERS = ["MANA", "LIKEIT", "UPDATE"];

// Words (in the site's languages) that appear in the status / notice blocks.
const COMPLETED_WORDS = ["completed", "완결", "terminé", "completo", "beendet", "จบแล้ว", "已完結", "tamat"];
const HIATUS_WORDS = [
  "will return", "hiatus", "휴재", "pause", "regresará", "zurückkehren", "reviendra", "กลับมา", "回歸", "akan kembali",
];

function langCode(ctx) {
  const lang = String(ctx.defaults.get("language", "en") || "en");
  return lang === "zh-Hant" ? "zh-hant" : lang;
}

function baseUrl(ctx) {
  return `${BASE_DESKTOP}/${langCode(ctx)}`;
}

function showCanvas(ctx) {
  return ctx.defaults.get("canvasSeries", true) !== false;
}

function requestInit(ctx, mobile) {
  const base = mobile ? BASE_MOBILE : BASE_DESKTOP;
  return {
    headers: {
      Referer: base,
      "User-Agent": mobile ? UA_MOBILE : UA_DESKTOP,
      // Skips the age gate / consent banners that would replace the page body.
      Cookie: `locale=${langCode(ctx)}; ageGatePass=true; needGDPR=false; needCCPA=true; needCOPPA=false`,
    },
  };
}

async function fetchHtml(ctx, url, mobile = false) {
  const response = await ctx.request.get(url, requestInit(ctx, mobile));
  if (response.status >= 400) throw new Error(`WEBTOON: HTTP ${response.status}`);
  return response.html();
}

const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

// Reads the first query param found in the URL ("title_no=" or "titleNo=") up to & # or /.
function urlParam(url, names) {
  for (const name of names) {
    const index = url.indexOf(name);
    if (index === -1) continue;
    const rest = url.slice(index + name.length);
    const value = rest.split(/[&#/]/)[0];
    if (value) return value;
  }
  return null;
}

function withCanvasSuffix(url, value) {
  const isCanvas = url.includes("canvas") || url.includes("challenge");
  return isCanvas && !value.endsWith(CANVAS_SUFFIX) ? value + CANVAS_SUFFIX : value;
}

const mangaId = (url) => {
  const value = urlParam(url, ["title_no=", "titleNo="]);
  return value ? withCanvasSuffix(url, value) : null;
};

const chapterId = (url) => {
  const value = urlParam(url, ["episode_no=", "episodeNo="]);
  return value ? withCanvasSuffix(url, value) : null;
};

function mangaUrl(id) {
  return id.endsWith(CANVAS_SUFFIX)
    ? `${BASE_DESKTOP}/challenge/episodeList?titleNo=${id.slice(0, -CANVAS_SUFFIX.length)}`
    : `${BASE_DESKTOP}/episodeList?titleNo=${id}`;
}

function chapterUrl(chapterKey, mangaKey) {
  const cleanManga = mangaKey.replace(/-canvas$/, "");
  const cleanChapter = chapterKey.replace(/-canvas$/, "");
  if (mangaKey.endsWith(CANVAS_SUFFIX) || chapterKey.endsWith(CANVAS_SUFFIX)) {
    return `${BASE_DESKTOP}/challenge/viewer?titleNo=${cleanManga}&episodeNo=${cleanChapter}`;
  }
  return `${BASE_DESKTOP}/viewer?titleNo=${mangaKey}&episodeNo=${chapterKey}`;
}

const absolute = (href) => (/^https?:/i.test(href) ? href : `${BASE_DESKTOP}${href}`);

// Reads cards like <li><a href=".../episodeList?titleNo=1"><img><span class="title">.
function parseCards(html, itemSelector, titleSelector, stripCoverSize) {
  const entries = [];
  const seen = new Set();
  for (const node of html.querySelectorAll(itemSelector)) {
    const href = node.getAttribute("href") ?? "";
    const key = mangaId(href);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let cover = node.querySelector("img")?.getAttribute("src");
    if (cover && stripCoverSize) cover = cover.replace("?type=f164_164", "");
    entries.push({
      key,
      title: clean(node.querySelector(titleSelector)?.text),
      cover: cover || undefined,
      url: absolute(href),
      viewer: "webtoon",
      contentRating: "safe",
    });
  }
  return entries;
}

const ORIGINALS_ITEMS = "#content > div.webtoon_list_wrap ul > li > a";
const CANVAS_ITEMS = "#content div.challenge_lst > ul > li > a";

async function originalsList(ctx, url) {
  const html = await fetchHtml(ctx, url);
  return { entries: parseCards(html, ORIGINALS_ITEMS, ".title"), hasNextPage: false };
}

async function canvasList(ctx, url, page) {
  if (!showCanvas(ctx)) return { entries: [], hasNextPage: false };
  const html = await fetchHtml(ctx, `${url}&page=${page}`);
  const entries = parseCards(html, CANVAS_ITEMS, ".subj", true);
  const hasNextPage =
    entries.length > 0 &&
    Boolean(html.querySelector(`a[href*="page=${page + 1}"]`) || html.querySelector("a.pg_next"));
  return { entries, hasNextPage };
}

// Splits "(S2) Chapter 5 - Title" style names into { title, volume }.
// Mirrors the Aidoku parser: strips a leading season marker, "Chapter N"/"Ep. N" prefix and a dash.
function cleanEpisodeTitle(raw) {
  const words = String(raw ?? "").split(/\s+/).filter(Boolean);
  let volume;
  let start = 0;

  const first = words[0] ?? "";
  let match;
  if ((match = first.match(/^[(\[][STst](\d+)/))) {
    volume = Number(match[1]);
    start += 1;
  } else if ((match = first.match(/^[Ss](\d+)/))) {
    volume = Number(match[1]);
    start += 1;
  } else if (/^E[pP]\.\d+$/.test(first)) {
    start += 1;
  }

  // "[Season 1]" / "(Season 1)" is split into two words by whitespace.
  if (words.length - start >= 2) {
    const a = words[start];
    const b = words[start + 1];
    if ((a === "[Season" && b.endsWith("]")) || (a === "(Season" && b.endsWith(")"))) {
      const season = Number(b.replace(/[\])]$/, ""));
      if (!Number.isNaN(season)) {
        volume = season;
        start += 2;
      }
    }
  }

  if (words.length - start >= 2 && ["Chapter", "Episode", "Ch.", "CH.", "Ep.", "EP", "EP."].includes(words[start])) {
    if (!Number.isNaN(Number(words[start + 1].replace(/:$/, "")))) start += 2;
  }

  if (words[start] === "-" || words[start] === ":") start += 1;

  const title = words.slice(start).join(" ");
  return { title: title || undefined, volume };
}

async function loadDetails(ctx, manga) {
  const url = mangaUrl(manga.key);
  const html = await fetchHtml(ctx, url);
  const result = { ...manga, url, viewer: "webtoon" };

  const cover = html.querySelector('head meta[property="og:image"]')?.getAttribute("content");
  if (cover) result.cover = cover;

  const title =
    clean(html.querySelector(".detail_header .subj, .challenge_header .subj, .info > .subj")?.text) ||
    html.querySelector('head meta[property="og:title"]')?.getAttribute("content");
  if (title) result.title = title;

  // "Author, Artist" or "Author / Artist"; the first entry is the writer.
  const authorRaw = clean(html.querySelector(".author_area, .author")?.text).replace("author info", "");
  const people = authorRaw
    .split(/[,/]/)
    .map((part) => part.trim().replace(/\.+$/, "").trim())
    .filter(Boolean);
  if (people.length > 0) {
    result.authors = [people[0]];
    result.artists = people.length > 1 ? people.slice(1) : [people[0]];
  }

  const description =
    clean(html.querySelector(".summary")?.text) ||
    html.querySelector('head meta[property="og:description"]')?.getAttribute("content");
  if (description) result.description = description;

  const statusText = clean(html.querySelector("#_asideDetail > .day_info")?.text).toLowerCase();
  const notice = clean(
    html.querySelector("#content > div.cont_box > div.detail_body div.detail_paywall")?.text,
  ).toLowerCase();
  const completed =
    Boolean(html.querySelector(".txt_ico_completed")) || COMPLETED_WORDS.some((word) => statusText.includes(word));
  const hiatus =
    Boolean(html.querySelector(".txt_ico_hiatus, .ico_hiatus")) || HIATUS_WORDS.some((word) => notice.includes(word));
  result.status = completed ? "completed" : hiatus ? "hiatus" : "ongoing";

  const tags = [];
  for (const node of html.querySelectorAll(".detail_header .genre, .challenge_header .genre, .info > .genre")) {
    const tag = clean(node.text);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > 0) result.tags = tags;

  const mature =
    tags.some((tag) => tag === "Mature" || tag === "Horror" || tag === "Gore") ||
    Boolean(html.querySelector('[data-title-unsuitable-for-children="true"]'));
  result.contentRating = mature ? "suggestive" : "safe";
  return result;
}

async function loadChapters(ctx, key) {
  const canvasId = key.endsWith(CANVAS_SUFFIX) ? key.slice(0, -CANVAS_SUFFIX.length) : null;
  const apiUrl = canvasId
    ? `${BASE_MOBILE}/api/v1/canvas/${canvasId}/episodes?pageSize=100000`
    : `${BASE_MOBILE}/api/v1/webtoon/${key}/episodes?pageSize=100000`;
  const response = await ctx.request.get(apiUrl, requestInit(ctx, true));
  if (response.status >= 400) throw new Error(`WEBTOON: HTTP ${response.status}`);
  const data = await response.json();

  const language = langCode(ctx);
  const chapters = [];
  for (const episode of [...(data?.result?.episodeList ?? [])].reverse()) {
    const viewerLink = episode.viewerLink ?? "";
    const id = chapterId(viewerLink);
    if (!id) continue;
    const { title, volume } = cleanEpisodeTitle(episode.episodeTitle);
    const thumbnail = episode.thumbnail
      ? /^https?:/i.test(episode.thumbnail)
        ? episode.thumbnail
        : `https://webtoon-phinf.pstatic.net${episode.thumbnail}`
      : undefined;
    chapters.push({
      key: id,
      title,
      volumeNumber: volume,
      chapterNumber: Number(episode.episodeNo),
      dateUploaded: episode.exposureDateMillis ? Math.floor(episode.exposureDateMillis / 1000) : undefined,
      url: absolute(viewerLink),
      thumbnail,
      language,
    });
  }
  return chapters;
}

const source = {
  async getListings(ctx) {
    const listings = [
      { id: "latest", name: "Latest", kind: "grid" },
      { id: "popular", name: "Popular", kind: "grid" },
      { id: "top", name: "Top", kind: "grid" },
    ];
    if (showCanvas(ctx)) {
      listings.push(
        { id: "canvas_latest", name: "Canvas Latest", kind: "grid" },
        { id: "canvas_popular", name: "Canvas Popular", kind: "grid" },
        { id: "canvas_top", name: "Canvas Top", kind: "grid" },
      );
    }
    return listings;
  },

  async getMangaList(listing, page, ctx) {
    const base = baseUrl(ctx);
    const id = listing?.id;
    const originals = { latest: "UPDATE", popular: "MANA", top: "LIKEIT" };
    const canvas = { canvas_latest: "UPDATE", canvas_popular: "MANA", canvas_top: "LIKEIT" };
    if (id in originals) {
      // The originals page is one long list without pagination.
      if (page > 1) return { entries: [], hasNextPage: false };
      return originalsList(ctx, `${base}/genres?sortOrder=${originals[id]}`);
    }
    if (id in canvas) {
      return canvasList(ctx, `${base}/canvas/list?genreTab=ALL&sortOrder=${canvas[id]}`, page);
    }
    if (page > 1) return { entries: [], hasNextPage: false };
    return originalsList(ctx, `${base}/genres`);
  },

  async getSearchMangaList({ query, page, filters }, ctx) {
    const base = baseUrl(ctx);
    const text = (query ?? "").trim();

    if (text) {
      const path = showCanvas(ctx) ? "search" : "search/originals";
      const html = await fetchHtml(ctx, `${base}/${path}?keyword=${encodeURIComponent(text)}&page=${page}`);
      const entries = parseCards(html, ORIGINALS_ITEMS, ".title");
      // The site returns 12 cards per page; a short page means the end.
      return { entries, hasNextPage: entries.length >= 12 };
    }

    let genre = "";
    let sort = SORT_ORDERS[0];
    for (const filter of filters ?? []) {
      if (filter.type === "select" && filter.id === "genre" && filter.value) genre = filter.value;
      if (filter.type === "sort") sort = SORT_ORDERS[filter.index] ?? "UPDATE";
    }
    // Genre pages are not paginated either.
    if (page > 1) return { entries: [], hasNextPage: false };
    const path = genre ? `genres/${genre}` : "genres";
    return originalsList(ctx, `${base}/${path}?sortOrder=${sort}`);
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    let result = manga;
    if (needsDetails) result = await loadDetails(ctx, manga);
    if (needsChapters) result = { ...result, chapters: await loadChapters(ctx, manga.key) };
    return result;
  },

  async getPageList(manga, chapter, ctx) {
    const html = await fetchHtml(ctx, chapterUrl(chapter.key, manga.key));
    const optional = ctx.defaults.get("optionalPages", true) !== false;
    const pages = [];
    for (const img of html.querySelectorAll("div#_imageList > img")) {
      let url = img.getAttribute("data-url") ?? "";
      // Lazy-loaded images carry a 1px placeholder in `src` and the real URL in data-url.
      if (!url || url.includes("bg_transparency.png")) url = img.getAttribute("src") ?? "";
      if (!url || url.includes("bg_transparency.png")) continue;
      // "?type=opti" marks warning pages and author notes.
      if (url.endsWith("?type=opti") && !optional) continue;
      pages.push({ url });
    }
    if (pages.length === 0) throw new Error("WEBTOON: no pages found");
    return pages;
  },
};

module.exports = { source };
