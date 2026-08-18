"use strict";
const BASE_URL = "https://asurascans.com";
const API_URL = "https://api.asurascans.com/api";
function getMangaKey(url) {
  const path = url.split("?")[0] ?? "";
  const segment = path.split("/").slice(path.split("/").indexOf("comics") + 1)[0];
  if (!segment) return void 0;
  const dash = segment.lastIndexOf("-");
  if (dash === -1) return segment;
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
const GENRE_OPTIONS = [
  { id: "action", label: "Action" },
  { id: "adventure", label: "Adventure" },
  { id: "comedy", label: "Comedy" },
  { id: "crazy-mc", label: "Crazy MC" },
  { id: "demon", label: "Demon" },
  { id: "dungeons", label: "Dungeons" },
  { id: "fantasy", label: "Fantasy" },
  { id: "game", label: "Game" },
  { id: "genius-mc", label: "Genius MC" },
  { id: "isekai", label: "Isekai" },
  { id: "magic", label: "Magic" },
  { id: "murim", label: "Murim" },
  { id: "mystery", label: "Mystery" },
  { id: "necromancer", label: "Necromancer" },
  { id: "overpowered", label: "Overpowered" },
  { id: "regression", label: "Regression" },
  { id: "reincarnation", label: "Reincarnation" },
  { id: "revenge", label: "Revenge" },
  { id: "romance", label: "Romance" },
  { id: "school-life", label: "School Life" },
  { id: "sci-fi", label: "Sci-fi" },
  { id: "shoujo", label: "Shoujo" },
  { id: "shounen", label: "Shounen" },
  { id: "system", label: "System" },
  { id: "tower", label: "Tower" },
  { id: "tragedy", label: "Tragedy" },
  { id: "villain", label: "Villain" },
  { id: "violence", label: "Violence" }
];
const source = {
  async getListings() {
    return [{ id: "Ranking", name: "Ranking", kind: "list" }];
  },
  async getFilters() {
    return [
      {
        type: "sort",
        id: "sort",
        title: "Latest Update",
        options: ["Latest Update", "Popular", "Rating", "A-Z", "Newest"],
        default: 0
      },
      {
        type: "multiSelect",
        id: "status",
        title: "Status",
        options: [
          { id: "ongoing", label: "Ongoing" },
          { id: "completed", label: "Completed" },
          { id: "hiatus", label: "Hiatus" },
          { id: "dropped", label: "Dropped" }
        ]
      },
      {
        type: "multiSelect",
        id: "type",
        title: "Type",
        options: [
          { id: "manhwa", label: "Manhwa" },
          { id: "manhua", label: "Manhua" },
          { id: "manga", label: "Mangatoon" }
        ]
      },
      {
        type: "multiSelect",
        id: "genres",
        title: "Genre",
        options: GENRE_OPTIONS
      }
    ];
  },
  async getHome(ctx) {
    const response = await ctx.request.get(BASE_URL);
    const html = response.html();
    const components = [];

    const trendingSection = html.querySelector('astro-island[opts*="TrendingSection"] > section');
    if (trendingSection) {
      const title = trendingSection.querySelector("h2")?.text.trim() ?? "Trending Today";
      const entries = trendingSection.querySelectorAll("div.embla-trending > div > div > a").map((el) => {
        const href = el.getAttribute("href");
        const url = absUrl(response.url, href ?? undefined);
        const key = url ? getMangaKey(url) : undefined;
        if (!key) return null;
        return {
          key,
          title: el.querySelector("span.block")?.text.trim() ?? key,
          cover: absUrl(response.url, el.querySelector("img")?.getAttribute("src") ?? undefined)
        };
      }).filter(Boolean);
      if (entries.length > 0) {
        components.push({
          title,
          kind: "scroller",
          entries
        });
      }
    }

    const latestSection = html.querySelector('astro-island[opts*="LatestUpdates"] > section');
    if (latestSection) {
      const title = latestSection.querySelector("h2")?.text.trim() ?? "Latest Updates";
      const chapterEntries = latestSection.querySelectorAll("div.grid > div.grid").map((el) => {
        const mangaLink = el.querySelector("a.font-bold");
        const chapterLink = el.querySelector("div.flex > div > a.group.grid");
        const mangaHref = mangaLink?.getAttribute("href");
        const chapterHref = chapterLink?.getAttribute("href");
        const mangaUrl = absUrl(response.url, mangaHref ?? undefined);
        const chapterUrl = absUrl(response.url, chapterHref ?? undefined);
        const mangaKey = mangaUrl ? getMangaKey(mangaUrl) : undefined;
        const chapterKey = chapterUrl ? getChapterKey(chapterUrl) : undefined;
        if (!mangaKey || !chapterKey) return null;
        const chapterLabel = chapterLink?.querySelector("span.font-medium")?.text.trim() ?? "";
        const chapterNumber = Number(chapterLabel.replace(/^Chapter\s*/i, "").trim());
        return {
          manga: {
            key: mangaKey,
            title: mangaLink?.text.trim() ?? mangaKey,
            cover: absUrl(response.url, el.querySelector("img")?.getAttribute("src") ?? undefined)
          },
          chapter: {
            key: chapterKey,
            chapterNumber: Number.isFinite(chapterNumber) ? chapterNumber : undefined
          }
        };
      }).filter(Boolean);
      if (chapterEntries.length > 0) {
        components.push({
          title,
          kind: "mangaChapterList",
          entries: [],
          chapterEntries
        });
      }
    }

    if (components.length === 0) {
      const popular = await source.getMangaList({ id: "Ranking", name: "Ranking", kind: "list" }, 1, ctx);
      components.push({
        title: "Ranking",
        kind: "scroller",
        entries: popular.entries.slice(0, 12),
        listing: { id: "Ranking", name: "Ranking" }
      });
    }

    return { components };
  },
  async getSearchMangaList({ query, page, filters }, ctx) {
    const response = await ctx.request.get(buildBrowseUrl(page, query, filters));
    const html = response.html();
    const cards = html.querySelectorAll("#series-grid > .series-card");
    const entries = cards.map((card) => {
      const link = card.querySelector("a");
      const href = link?.getAttribute("href");
      const key = href ? getMangaKey(absUrl(response.url, href) ?? href) : void 0;
      if (!key) return null;
      return {
        key,
        title: card.querySelector("h3")?.text.trim() ?? key,
        cover: absUrl(response.url, card.querySelector("img")?.getAttribute("src") ?? void 0)
      };
    }).filter(Boolean);
    const hasNextPage = Boolean(html.querySelector('button[aria-label="Next page"].cursor-pointer'));
    return { entries, hasNextPage };
  },
  async getMangaList(listing, page, ctx) {
    if (listing.id === "latest") {
      return source.getSearchMangaList({ page, query: "", filters: [{ type: "sort", id: "sort", index: 0, ascending: false }] }, ctx);
    }
    if (listing.id !== "Ranking") {
      return { entries: [], hasNextPage: false };
    }
    const response = await ctx.request.get(`${BASE_URL}/series-ranking`);
    const html = response.html();
    const entries = html.querySelectorAll(".comics-ranking-list > a").map((el) => {
      const href = el.getAttribute("href");
      const url = absUrl(response.url, href ?? void 0);
      const parts = url?.split("/") ?? [];
      const comicsIndex = parts.indexOf("comics");
      const key = comicsIndex >= 0 ? parts[comicsIndex + 1] : void 0;
      if (!key) return null;
      return {
        key,
        title: el.querySelector(".flex-1 > .text-sm")?.text.trim() ?? key,
        cover: absUrl(response.url, el.querySelector("img")?.getAttribute("src") ?? void 0)
      };
    }).filter(Boolean);
    return { entries, hasNextPage: false };
  },
  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const url = getMangaUrl(manga.key);
    const response = await ctx.request.get(url);
    const html = response.html();
    const updated = { ...manga, url };
    if (needsDetails) {
      updated.title = html.querySelector("h1.text-xl.font-semibold")?.text.trim() ?? manga.title;
      updated.cover = absUrl(
        response.url,
        html.querySelector("div#desktop-cover-container img")?.getAttribute("src") ?? void 0
      );
      updated.authors = html.querySelectorAll('a[href^="/browse?author"]').map((el) => el.text.trim()).filter((value) => value !== "_");
      updated.artists = html.querySelectorAll('a[href^="/browse?artist"]').map((el) => el.text.trim()).filter((value) => value !== "_");
      updated.description = html.querySelector("div#description-text")?.text.trim();
      updated.tags = html.querySelectorAll('a[href^="/browse?genres="]').map((el) => el.text.trim());
      const infoBlocks = html.querySelectorAll("div.flex.gap-3.pt-4.border-t > div");
      let statusText;
      let typeText;
      for (const block of infoBlocks) {
        const label = block.querySelector("div.text-xs")?.text.trim().toLowerCase();
        const value = block.querySelector("span.text-base")?.text.trim();
        if (label === "status") statusText = value;
        if (label === "type") typeText = value;
      }
      updated.status = parseStatus(statusText);
      updated.contentRating = updated.tags?.some((tag) => tag === "Adult" || tag === "Ecchi") ? "suggestive" : "safe";
      updated.viewer = ["manhwa", "manhua", "mangatoon"].includes(typeText?.toLowerCase() ?? "") ? "webtoon" : "webtoon";
    }
    if (needsChapters) {
      const island = html.querySelector('astro-island[component-url*="ChapterListReact"], astro-island[opts*="ChapterListReact"]');
      const propsRaw = island?.getAttribute("props");
      if (propsRaw) {
        const json = JSON.parse(propsRaw);
        const chaptersArr = json?.chapters?.[1];
        if (Array.isArray(chaptersArr)) {
          updated.chapters = chaptersArr.map((entry) => {
            const obj = entry?.[1];
            if (!obj) return null;
            const chapterNumber = Number(obj.number?.[1]);
            if (Number.isNaN(chapterNumber)) return null;
            const key = String(chapterNumber);
            let dateUploaded;
            const published = obj.published_at?.[1];
            if (typeof published === "string") {
              const normalized = published.includes(".") ? `${published.split(".")[0]}Z` : published;
              dateUploaded = Math.floor(new Date(normalized).getTime() / 1e3);
            }
            return {
              key,
              chapterNumber,
              dateUploaded,
              url: getChapterUrl(key, manga.key),
              locked: Boolean(obj.is_locked?.[1])
            };
          }).filter(Boolean);
        }
      }
    }
    return updated;
  },
  async getPageList(manga, chapter, ctx) {
    const apiUrl = `${API_URL}/series/${manga.key}/chapters/${chapter.key}`;
    try {
      const apiResponse = await ctx.request.get(apiUrl);
      if (apiResponse.status === 200) {
        const json2 = await apiResponse.json();
        const pages = json2?.data?.chapter?.pages;
        if (Array.isArray(pages) && pages.length > 0) {
          return pages.map((item) => {
            const url = typeof item === "string" ? item : item?.url?.[1] ?? item?.url;
            return url ? { url: String(url) } : null;
          }).filter(Boolean);
        }
      }
    } catch {
    }
    const response = await ctx.request.get(getChapterUrl(chapter.key, manga.key));
    const html = response.html();
    const island = html.querySelector('astro-island[component-url*="ChapterReader"], astro-island[opts*="ChapterReader"]');
    const propsRaw = island?.getAttribute("props");
    if (!propsRaw) return [];
    const json = JSON.parse(propsRaw);
    const pageArr = json?.pages?.[1];
    if (!Array.isArray(pageArr)) return [];
    return pageArr.map((entry) => {
      const url = entry?.[1]?.url?.[1];
      return url ? { url: String(url) } : null;
    }).filter(Boolean);
  }
};
if (typeof module !== "undefined") {
  module.exports = { source };
}
