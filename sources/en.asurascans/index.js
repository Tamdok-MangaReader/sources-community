"use strict";
const BASE_URL = "https://asurascans.com";
const API_URL = "https://api.asurascans.com/api";
const MAX_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchResponse(ctx, url, { allowStatuses = [] } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await ctx.request.get(url);
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (response.status >= 400 && !allowStatuses.includes(response.status)) {
        const error = new Error(`Asura Scans: HTTP ${response.status} for ${url}`);
        error.fatal = true;
        throw error;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (error.fatal || attempt === MAX_ATTEMPTS) break;
      await sleep(500 * attempt);
    }
  }
  console.error("[Asura Scans]", url, lastError?.message ?? String(lastError));
  throw lastError;
}

function nextButtonActive(html) {
  const button = html.querySelector('button[aria-label="Next page"]');
  if (!button) return false;
  if (button.hasAttribute("disabled")) return false;
  const className = button.getAttribute("class") ?? "";
  return !/cursor-not-allowed|opacity-50|pointer-events-none/.test(className);
}
function getMangaKey(url, keepSuffix = false) {
  const path = url.split("?")[0] ?? "";
  const segment = path
    .split("/")
    .slice(path.split("/").indexOf("comics") + 1)[0];
  if (!segment) return void 0;
  if (keepSuffix) return segment;
  const dash = segment.lastIndexOf("-");
  if (dash === -1) return segment;
  const suffix = segment.slice(dash + 1);
  const looksLikeHash =
    /^[0-9a-f]{6,}$/i.test(suffix) || (suffix.length >= 6 && /\d/.test(suffix) && /^[0-9a-z]+$/i.test(suffix));
  if (!looksLikeHash) return segment;
  return segment.slice(0, dash);
}
function getChapterKey(url) {
  const path = url.split("?")[0] ?? "";
  const parts = path.split("/");
  const chapterIndex = parts.indexOf("chapter");
  if (chapterIndex === -1) return void 0;
  const segment = parts[chapterIndex + 1];
  if (!segment) return void 0;
  const end = segment.search(/[^0-9.]/);
  return end === -1 ? segment : segment.slice(0, end);
}
function getMangaUrl(mangaId) {
  return `${BASE_URL}/comics/${mangaId}`;
}
function getChapterUrl(chapterId, mangaId) {
  return `${BASE_URL}/comics/${mangaId}/chapter/${chapterId}`;
}
function absUrl(base, href) {
  if (!href) return void 0;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}
function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}
/** Unwrap Astro serialized props (`[0, value]` / `[1, array]`) without treating URL strings as arrays. */
function astroUnwrap(value) {
  let current = value;
  for (let i = 0; i < 6; i += 1) {
    if (!Array.isArray(current) || current.length < 2) break;
    if (current[0] !== 0 && current[0] !== 1) break;
    current = current[1];
  }
  return current;
}
function pageUrlFromItem(item) {
  const unwrapped = astroUnwrap(item);
  if (isHttpUrl(unwrapped)) return unwrapped;
  if (typeof unwrapped === "string") return absUrl(BASE_URL, unwrapped);
  if (!unwrapped || typeof unwrapped !== "object") return undefined;
  const url =
    astroUnwrap(unwrapped.url) ??
    astroUnwrap(unwrapped.src) ??
    astroUnwrap(unwrapped.image);
  if (isHttpUrl(url)) return url;
  if (typeof url === "string") return absUrl(BASE_URL, url);
  return undefined;
}
function pageSizeFromItem(item) {
  const unwrapped = astroUnwrap(item);
  if (!unwrapped || typeof unwrapped !== "object") return {};
  const width = Number(astroUnwrap(unwrapped.width));
  const height = Number(astroUnwrap(unwrapped.height));
  return {
    ...(Number.isFinite(width) && width > 0 ? { width } : {}),
    ...(Number.isFinite(height) && height > 0 ? { height } : {}),
  };
}
function pagesFromItems(items) {
  const list = astroUnwrap(items);
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const url = pageUrlFromItem(item);
      if (!url) return null;
      return { url, ...pageSizeFromItem(item) };
    })
    .filter(Boolean);
}
function seriesKeysForManga(manga) {
  const keys = [];
  const push = (value) => {
    if (value && !keys.includes(value)) keys.push(value);
  };
  push(manga.key);
  if (manga.url) {
    push(getMangaKey(manga.url, true));
    push(getMangaKey(manga.url));
  }
  return keys;
}
function parseStatus(text) {
  switch (text?.toLowerCase()) {
    case "ongoing":
      return "ongoing";
    case "hiatus":
      return "hiatus";
    case "completed":
      return "completed";
    case "dropped":
      return "cancelled";
    default:
      return "unknown";
  }
}
function buildBrowseUrl(page, query, filters) {
  const url = new URL("/browse", BASE_URL);
  url.searchParams.set("page", String(page));
  if (query) url.searchParams.set("q", query);
  for (const filter of filters ?? []) {
    if (filter.type === "sort") {
      const values = ["update", "popular", "rating", "name", "newest"];
      url.searchParams.set(filter.id, values[filter.index ?? 0] ?? "update");
      if (filter.ascending) url.searchParams.set("order", "asc");
    } else if (filter.type === "select" && filter.value) {
      url.searchParams.set(filter.id, filter.value);
    } else if (filter.type === "multiSelect" && filter.included?.length) {
      if (filter.id === "genres" && filter.matchAll !== false) {
        for (const value of filter.included) {
          url.searchParams.append(filter.id, value);
        }
      } else {
        url.searchParams.set(filter.id, filter.included.join(","));
      }
    }
  }
  return url.toString();
}
const source = {
  async getHome(ctx) {
    const response = await fetchResponse(ctx, BASE_URL);
    const html = response.html();
    const components = [];

    const trendingSection = html.querySelector(
      'astro-island[opts*="TrendingSection"] > section',
    );
    if (trendingSection) {
      const title =
        trendingSection.querySelector("h2")?.text.trim() ?? "Trending Today";
      const entries = trendingSection
        .querySelectorAll("div.embla-trending > div > div > a")
        .map((el) => {
          const href = el.getAttribute("href");
          const url = absUrl(response.url, href ?? undefined);
          const key = url ? getMangaKey(url) : undefined;
          if (!key) return null;
          return {
            key,
            title: el.querySelector("span.block")?.text.trim() ?? key,
            cover: absUrl(
              response.url,
              el.querySelector("img")?.getAttribute("src") ?? undefined,
            ),
            rating: el.querySelector("span.ml-1")?.text.trim() ?? undefined,
          };
        })
        .filter(Boolean);
      if (entries.length > 0) {
        components.push({
          title,
          kind: "scroller",
          entries,
        });
      }
    }

    const latestSection = html.querySelector(
      'astro-island[opts*="LatestUpdates"] > section',
    );
    if (latestSection) {
      const title =
        latestSection.querySelector("h2")?.text.trim() ?? "Latest Updates";
      const chapterEntries = latestSection
        .querySelectorAll("div.grid > div.grid")
        .map((el) => {
          const mangaLink = el.querySelector("a.font-bold");
          const chapterLink = el.querySelector("div.flex > div > a.group.grid");
          const mangaHref = mangaLink?.getAttribute("href");
          const chapterHref = chapterLink?.getAttribute("href");
          const mangaUrl = absUrl(response.url, mangaHref ?? undefined);
          const chapterUrl = absUrl(response.url, chapterHref ?? undefined);
          const mangaKey = mangaUrl ? getMangaKey(mangaUrl) : undefined;
          const chapterKey = chapterUrl ? getChapterKey(chapterUrl) : undefined;
          if (!mangaKey || !chapterKey) return null;
          const chapterLabel =
            chapterLink?.querySelector("span.font-medium")?.text.trim() ?? "";
          const chapterNumber = Number(
            chapterLabel.replace(/^Chapter\s*/i, "").trim(),
          );
          return {
            manga: {
              key: mangaKey,
              title: mangaLink?.text.trim() ?? mangaKey,
              cover: absUrl(
                response.url,
                el.querySelector("img")?.getAttribute("src") ?? undefined,
              ),
            },
            chapter: {
              key: chapterKey,
              chapterNumber: Number.isFinite(chapterNumber)
                ? chapterNumber
                : undefined,
            },
          };
        })
        .filter(Boolean);
      if (chapterEntries.length > 0) {
        components.push({
          title,
          kind: "mangaChapterList",
          entries: [],
          chapterEntries,
        });
      }
    }

    const ranking = await source
      .getMangaList({ id: "Ranking", name: "Ranking", kind: "list" }, 1, ctx)
      .catch((error) => {
        if (components.length === 0) throw error;
        return { entries: [] };
      });
    if (ranking.entries.length > 0) {
      components.push({
        title: "Ranking",
        kind: "scroller",
        entries: ranking.entries.slice(0, 12),
        listing: { id: "Ranking", name: "Ranking" },
      });
    }

    if (components.length === 0) {
      throw new Error("Asura Scans: home page is empty");
    }
    return { components };
  },
  async getSearchMangaList({ query, page, filters }, ctx) {
    const response = await fetchResponse(ctx, buildBrowseUrl(page, query, filters));
    const html = response.html();
    const cards = html.querySelectorAll("#series-grid > .series-card");
    const entries = cards
      .map((card) => {
        const link = card.querySelector("a");
        const href = link?.getAttribute("href");
        const key = href
          ? getMangaKey(absUrl(response.url, href) ?? href)
          : void 0;
        if (!key) return null;
        return {
          key,
          title: card.querySelector("h3")?.text.trim() ?? key,
          cover: absUrl(
            response.url,
            card.querySelector("img")?.getAttribute("src") ?? void 0,
          ),
          status: card.querySelector("span.capitalize")
            ? parseStatus(card.querySelector("span.capitalize")?.text.trim())
            : undefined,
          rating:
            card.querySelector('span[class*="text-[10px]"]')?.text.trim() ??
            undefined,
        };
      })
      .filter(Boolean);
    return { entries, hasNextPage: nextButtonActive(html) };
  },
  async getMangaList(listing, page, ctx) {
    if (listing.id === "latest") {
      return source.getSearchMangaList(
        {
          page,
          query: "",
          filters: [{ type: "sort", id: "sort", index: 0, ascending: false }],
        },
        ctx,
      );
    }
    if (listing.id !== "Ranking") {
      return { entries: [], hasNextPage: false };
    }
    const response = await fetchResponse(ctx, `${BASE_URL}/series-ranking`);
    const html = response.html();
    const entries = html
      .querySelectorAll(".comics-ranking-list > a")
      .map((el) => {
        const href = el.getAttribute("href");
        const url = absUrl(response.url, href ?? void 0);
        const parts = url?.split("/") ?? [];
        const comicsIndex = parts.indexOf("comics");
        const key = comicsIndex >= 0 ? parts[comicsIndex + 1] : void 0;
        if (!key) return null;
        return {
          key,
          title: el.querySelector(".flex-1 > .text-sm")?.text.trim() ?? key,
          cover: absUrl(
            response.url,
            el.querySelector("img")?.getAttribute("src") ?? void 0,
          ),
          rating:
            el.querySelector(".flex-1 span.tabular-nums")?.text.trim() ??
            undefined,
        };
      })
      .filter(Boolean);
    return { entries, hasNextPage: false };
  },
  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const url = getMangaUrl(manga.key);
    const response = await fetchResponse(ctx, url);
    const html = response.html();
    const updated = { ...manga, url };
    if (needsDetails) {
      updated.title =
        html.querySelector("h1.text-xl.font-semibold")?.text.trim() ??
        manga.title;
      updated.cover =
        absUrl(
          response.url,
          html
            .querySelector("div#desktop-cover-container img")
            ?.getAttribute("src") ?? void 0,
        ) ?? manga.cover;
      updated.authors = html
        .querySelectorAll('a[href^="/browse?author"]')
        .map((el) => el.text.trim())
        .filter((value) => value !== "_");
      updated.artists = html
        .querySelectorAll('a[href^="/browse?artist"]')
        .map((el) => el.text.trim())
        .filter((value) => value !== "_");
      updated.description = html
        .querySelector("div#description-text")
        ?.text.trim();
      updated.rating = html
        .querySelector("span[data-series-rating]")
        ?.text.trim();
      updated.tags = html
        .querySelectorAll('a[href^="/browse?genres="]')
        .map((el) => el.text.trim());
      const infoBlocks = html.querySelectorAll(
        "div.flex.gap-3.pt-4.border-t > div",
      );
      let statusText;
      let typeText;
      for (const block of infoBlocks) {
        const label = block
          .querySelector("div.text-xs")
          ?.text.trim()
          .toLowerCase();
        const value = block.querySelector("span.text-base")?.text.trim();
        if (label === "status") statusText = value;
        if (label === "type") typeText = value;
      }
      updated.status = parseStatus(statusText);
      const tagNames = updated.tags ?? [];
      updated.contentRating = tagNames.some((tag) => /^(adult|mature|hentai)$/i.test(tag))
        ? "nsfw"
        : tagNames.some((tag) => /^ecchi$/i.test(tag))
          ? "suggestive"
          : "safe";
      updated.viewer = "webtoon";
    }
    if (needsChapters) {
      const island = html.querySelector(
        'astro-island[component-url*="ChapterListReact"], astro-island[opts*="ChapterListReact"]',
      );
      const propsRaw = island?.getAttribute("props");
      if (propsRaw) {
        try {
          const json = JSON.parse(propsRaw);
          const chaptersArr = astroUnwrap(json?.chapters);
          const showLocked = ctx.defaults.get("showLocked", true) !== false;
          if (Array.isArray(chaptersArr)) {
            updated.chapters = chaptersArr
              .map((entry) => {
                const obj = astroUnwrap(entry);
                if (!obj || typeof obj !== "object") return null;
                if (
                  (!astroUnwrap(obj.is_locked) &&
                    !astroUnwrap(obj.is_premium)) ||
                  showLocked
                ) {
                  const chapterNumber = Number(astroUnwrap(obj.number));
                  if (Number.isNaN(chapterNumber)) return null;
                  const key = String(chapterNumber);
                  let dateUploaded;
                  const published = astroUnwrap(obj.published_at);
                  if (typeof published === "string") {
                    const normalized = published.includes(".")
                      ? `${published.split(".")[0]}Z`
                      : published;
                    const parsed = new Date(normalized).getTime();
                    dateUploaded = Number.isFinite(parsed)
                      ? Math.floor(parsed / 1e3)
                      : undefined;
                  }
                  return {
                    key,
                    chapterNumber,
                    language: "en",
                    dateUploaded,
                    url: getChapterUrl(key, manga.key),
                    locked: Boolean(
                      astroUnwrap(obj.is_locked) || astroUnwrap(obj.is_premium),
                    ),
                  };
                }
              })
              .filter(Boolean);
          }
        } catch (error) {
          console.error("[Asura Scans] chapter props", error?.message ?? String(error));
        }
      }
      if (!updated.chapters?.length) {
        const seen = new Set();
        const chapters = html
          .querySelectorAll('a[href*="/chapter/"]')
          .map((el) => {
            const href = el.getAttribute("href");
            const chapterUrl = absUrl(response.url, href ?? undefined);
            const key = chapterUrl ? getChapterKey(chapterUrl) : undefined;
            if (!key || seen.has(key)) return null;
            seen.add(key);
            const chapterNumber = Number(key);
            return {
              key,
              chapterNumber: Number.isFinite(chapterNumber)
                ? chapterNumber
                : undefined,
              url: getChapterUrl(key, manga.key),
            };
          })
          .filter(Boolean);
        if (chapters.length > 0) {
          chapters.sort(
            (a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0),
          );
          updated.chapters = chapters;
        }
      }
    }
    return updated;
  },
  async getPageList(manga, chapter, ctx) {
    for (const seriesKey of seriesKeysForManga(manga)) {
      const apiUrl = `${API_URL}/series/${encodeURIComponent(seriesKey)}/chapters/${encodeURIComponent(chapter.key)}`;
      try {
        const apiResponse = await ctx.request.get(apiUrl);
        if (apiResponse.status === 200) {
          const json2 = await apiResponse.json();
          const mapped = pagesFromItems(json2?.data?.chapter?.pages);
          if (mapped.length > 0) return mapped;
        }
      } catch (error) {
        console.error("[Asura Scans] page api", error?.message ?? String(error));
      }
    }
    const htmlUrls = [];
    if (chapter.url) htmlUrls.push(chapter.url);
    for (const key of seriesKeysForManga(manga)) {
      const url = getChapterUrl(chapter.key, key);
      if (!htmlUrls.includes(url)) htmlUrls.push(url);
    }
    let html;
    let response;
    for (const url of htmlUrls) {
      try {
        response = await ctx.request.get(url);
        if (response.status === 200) {
          html = response.html();
          break;
        }
      } catch (error) {
        console.error("[Asura Scans] page html", error?.message ?? String(error));
      }
    }
    if (!html || !response) throw new Error("Asura Scans: chapter pages are unavailable");
    const island = html.querySelector(
      'astro-island[component-url*="ChapterReader"], astro-island[opts*="ChapterReader"]',
    );
    const propsRaw = island?.getAttribute("props");
    if (propsRaw) {
      try {
        const mapped = pagesFromItems(JSON.parse(propsRaw)?.pages);
        if (mapped.length > 0) return mapped;
      } catch (error) {
        console.error("[Asura Scans] reader props", error?.message ?? String(error));
      }
    }
    const fallbackPages = html
      .querySelectorAll("img")
      .map((el) => {
        const src =
          el.getAttribute("src") ??
          el.getAttribute("data-src") ??
          el.getAttribute("data-lazy-src");
        if (!src || !src.includes("/asura-images/chapters/")) return null;
        const url = absUrl(response.url, src);
        return isHttpUrl(url) ? { url } : null;
      })
      .filter(Boolean);
    if (fallbackPages.length === 0) throw new Error("Asura Scans: no pages found");
    return fallbackPages;
  },
};
if (typeof module !== "undefined") {
  module.exports = { source };
}
