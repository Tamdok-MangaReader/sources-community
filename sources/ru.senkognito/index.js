"use strict";
const BASE_URL = "https://ne.senkognito.com";
const API_URL = "https://api.senkognito.com/graphql";

const SEARCH_QUERY = `
  query Search($query:String!,$type:SearchType!){
    search(query:$query,type:$type,first:20){
      edges{
        node{
          ... on SearchManga{
            id
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

const MANGA_CHAPTERS_QUERY = `
  query MangaChapters($branchId:ID!,$number:Float,$after:String,$orderBy:MangaChapterOrder!){
    mangaChapters(first:100,branchId:$branchId,number:$number,after:$after,orderBy:$orderBy){
      edges{
        node{
          id
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

const MANGA_BRANCHES_QUERY = `
  query Manga($slug:String!){
    manga(slug:$slug){
      slug
      branches{
        id
        primaryBranch
        teamActivities{team{id name}}
      }
    }
  }
`;

const READER_QUERY = `
  query Reader($slug:String!,$cdnQuality:String){
    mangaChapter(slug:$slug){
      pages(cdnQuality:$cdnQuality){
        id
        number
        image{original{height width url}}
      }
    }
  }
`;

async function fetchMangas(ctx, query, variables = {}) {
  const label = query.trim().split("\n")[0];
  try {
    if (typeof ctx?.request?.post !== "function")
      throw new TypeError("ctx.request.post отсутствует");

    const cookie = ctx.cookies;
    const cookieHeader = `access_token=${cookie.access_token}`;

    const response = await ctx.request.post(API_URL, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: cookieHeader,
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response) throw new TypeError("POST вернул пустой ответ");
    if (response.status !== 200) {
      const body =
        typeof response.text === "function" ? await response.text() : "";
      throw new Error(
        `HTTP ${response.status}: ${String(body).slice(0, 1000)}`,
      );
    }
    if (typeof response.json !== "function")
      throw new TypeError("response.json не является функцией");
    const result = await response.json();
    if (!result || typeof result !== "object")
      throw new TypeError("GraphQL вернул некорректный JSON");
    if (result.errors?.length)
      throw new Error(
        result.errors.map((e) => e.message ?? JSON.stringify(e)).join("; "),
      );
    if (!result.data)
      throw new Error(
        `В ответе GraphQL отсутствует data: ${JSON.stringify(result).slice(0, 1000)}`,
      );
    return result.data;
  } catch (error) {
    console.error("[Senkognito][GraphQL][ERROR]", {
      query: label,
      variables,
      message: error?.message ?? String(error),
      stack: error?.stack,
    });
    throw error;
  }
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function getOriginalImageUrl(page) {
  const url = page?.image?.original?.url;
  return isHttpUrl(url) ? url : undefined;
}

function parseChapterNumber(value) {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function parseUploadedDate(value) {
  if (!value) return undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : undefined;
}

function getMangaKey(url) {
  if (typeof url !== "string") return undefined;
  try {
    const parsed = new URL(url, BASE_URL);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const index = parts.indexOf("manga");
    if (index === -1) return undefined;
    const segment = parts[index + 1];
    if (!segment) return undefined;
    return segment;
  } catch {
    return undefined;
  }
}

function getChapterKey(url) {
  if (typeof url !== "string") return undefined;
  const parts = url.split("?")[0].split("/");
  const index = parts.indexOf("chapters");
  if (index === -1) return undefined;
  const segment = parts[index + 1];
  if (!segment) return undefined;
  const end = segment.search(/[^0-9.]/);
  return end === -1 ? segment : segment.slice(0, end);
}

function getMangaUrl(mangaId) {
  return `${BASE_URL}/manga/${mangaId}`;
}

function absUrl(base, href) {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function getSection(sections, name, header) {
  return Array.from(sections ?? []).find((section) => {
    const caption = section.querySelector(`${header}.caption`);
    return caption && caption.textContent.trim() === name;
  });
}

function parseStatus(text) {
  switch (text?.toLowerCase()) {
    case "ongoing":
    case "онгоинг":
      return "ongoing";
    case "hiatus":
    case "приостановлено":
      return "hiatus";
    case "finished":
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

function parseContentRating(text) {
  switch (text?.toLowerCase()) {
    case "safe":
    case "0+":
    case "12+":
      return "safe";
    case "sensitive":
    case "questionable":
    case "16+":
      return "suggestive";
    case "explicit":
    case "18+":
      return "nsfw";
    default:
      return "suggestive";
  }
}

function textOf(element) {
  return element?.text?.trim?.() ?? element?.textContent?.trim?.() ?? "";
}

function selectAll(root, selector) {
  return Array.from(root?.querySelectorAll?.(selector) ?? []);
}

function selectText(root, selector) {
  return textOf(root?.querySelector?.(selector));
}

function selectAttr(root, selector, attribute) {
  return (
    root?.querySelector?.(selector)?.getAttribute?.(attribute) ?? undefined
  );
}

const source = {
  async getHome(ctx) {
    try {
      const cookie = ctx.cookies;
      const cookieHeader = `access_token=${cookie.access_token}`;
      const response = await ctx.request.get(BASE_URL, {
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
      });
      const html = response.html();
      const components = [];
      const sections = selectAll(html, ".main-section");
      const trendingSection = getSection(sections, "Самое читаемое", "h2");
      if (trendingSection) {
        const title =
          selectText(trendingSection, "h2.caption") || "Самое читаемое";
        const entries = selectAll(trendingSection, "article.card-main")
          .map((el) => {
            const href = selectAttr(el, "a", "href")?.replace("/chapters", "");
            const url = absUrl(response.url, href);
            const key = url ? getMangaKey(url) : undefined;
            if (!key) return null;
            return {
              key,
              title: selectText(el, "h3.card-title") || key,
              cover: absUrl(response.url, selectAttr(el, "img", "src")),
              rating: selectText(el, ".card-main__rating--high") || undefined,
            };
          })
          .filter(Boolean);
        if (entries.length)
          components.push({ title, kind: "scroller", entries });
      }
      const latestSection = getSection(sections, "Последние обновления", "h3");
      if (latestSection) {
        const title =
          selectText(latestSection, "h3.caption") || "Последние обновления";
        const chapterEntries = selectAll(latestSection, ".card-new")
          .map((el) => {
            const mangaHref = selectAttr(el, ".card-cover", "href")?.replace(
              "/chapters",
              "",
            );
            const chapterHref = selectAttr(el, ".card-new__status", "href");
            const mangaUrl = absUrl(response.url, mangaHref);
            const chapterUrl = absUrl(response.url, chapterHref);
            const mangaKey = mangaUrl ? getMangaKey(mangaUrl) : undefined;
            const chapterKey = chapterUrl
              ? getChapterKey(chapterUrl)
              : undefined;
            if (!mangaKey || !chapterKey) return null;
            const chapterLabel = (
              selectText(el, ".card-new__info").split("+")[0] ?? ""
            )
              .replace(/^Глава\s*/i, "")
              .trim();
            const chapterNumber = Number(chapterLabel);
            return {
              manga: {
                key: mangaKey,
                title: selectText(el, "h3.card-title") || mangaKey,
                cover: absUrl(response.url, selectAttr(el, "img", "src")),
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
        if (chapterEntries.length)
          components.push({
            title,
            kind: "mangaChapterList",
            entries: [],
            chapterEntries,
          });
      }
      if (!components.length) {
        const popular = await source.getMangaList(
          { id: "latest-updates", name: "Свежие обновления", kind: "list" },
          1,
          ctx,
        );
        components.push({
          title: "Ranking",
          kind: "scroller",
          entries: (popular.entries ?? []).slice(0, 12),
          listing: { id: "Ranking", name: "Ranking" },
        });
      }
      return { components };
    } catch (error) {
      console.error("[Senkognito][getHome]", error?.stack ?? error);
      throw error;
    }
  },
  async getSearchMangaList({ query = "", page = 1, filters = [] } = {}, ctx) {
    const data = await fetchMangas(ctx, SEARCH_QUERY, {
      query: query.trim(),
      type: "MANGA",
    });
    const edges = data.search?.edges ?? [];
    const entries = edges
      .map(({ node }) => {
        if (!node?.slug) return null;
        return {
          key: node.slug,
          title:
            node.titles?.find((title) => title.lang?.toUpperCase() === "RU")
              ?.content ??
            node.originalName?.content ??
            node.slug,
          cover: node.cover?.original?.url,
          status: parseStatus(node.status),
          contentRating: parseContentRating(node.rating),
        };
      })
      .filter(Boolean);
    const activeFilters = (filters ?? []).filter(
      (filter) => filter.type === "multiSelect" && filter.included?.length > 0,
    );
    const filteredEntries = entries.filter((entry) =>
      activeFilters.every((filter) => {
        if (filter.id === "rating") {
          return filter.included.includes(entry.contentRating);
        }
        if (filter.id === "status") {
          return filter.included.includes(entry.status);
        }
        return true;
      }),
    );
    return {
      entries: filteredEntries,
      hasNextPage: false,
    };
  },
  async getMangaList(listing, page, ctx) {
    if (listing.id === "latest-updates") {
      return source.getSearchMangaList(
        {
          page,
          query: "",
          filters: [],
        },
        ctx,
      );
    }
    return { entries: [], hasNextPage: false };
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    try {
      const url = getMangaUrl(manga.key);
      const cookie = ctx.cookies;
      const cookieHeader = `access_token=${cookie.access_token}`;
      const response = await ctx.request.get(url, {
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
      });
      const html = response.html();
      const updated = { ...manga, url };
      if (needsDetails) {
        updated.title =
          selectText(html, "h1.caption.caption-size-lg") || manga.title;
        updated.altTitles = [
          ...new Set(
            selectAll(html, ".params__name-cnt").map(textOf).filter(Boolean),
          ),
        ];
        updated.cover = absUrl(response.url, selectAttr(html, "img", "src"));
        updated.authors = [
          ...new Set(
            selectAll(html, ".card-body > .card-title")
              .map((el) => textOf(el).replace(/\.$/, ""))
              .filter((value) => value && value !== "_"),
          ),
        ];
        updated.artists = selectAll(html, ".project-slider__container > .thing")
          .map((el) => {
            return el.querySelector(".card-text")
              ? selectText(el, ".card-name").replace(/\.$/, "")
              : "";
          })
          .filter(Boolean);
        updated.description =
          selectText(html, ".text-expander > .text-expander__collapse") ||
          undefined;
        updated.rating =
          selectText(html, ".rating-top > .rating-title") || undefined;
        updated.tags = [
          ...new Set(
            selectAll(html, ".project-tags a.button--secondary")
              .map((el) => selectText(el, "span"))
              .filter(Boolean),
          ),
        ];
        let statusText;
        let typeText;
        for (const block of selectAll(html, ".project-stats__body")) {
          const label = selectText(
            block,
            "div.project-stats__text",
          ).toLowerCase();
          const value = selectText(
            block,
            "div.project-stats__name",
          ).toLowerCase();
          if (label === "статус тайтла") statusText = value;
          if (label === "формат")
            typeText = value.includes("вебтун") ? "webtoon" : "default";
        }
        updated.status = parseStatus(statusText);
        updated.contentRating = parseContentRating(
          selectText(
            html,
            '.project-tags > .button--accent[href="/browse/manga/ratings/sensitive"]',
          ) || "16+",
        );
        updated.viewer = typeText || "default";
      }
      if (needsChapters) {
        const data = await fetchMangas(ctx, MANGA_BRANCHES_QUERY, {
          slug: manga.key,
        });
        const remote = data?.manga;
        if (!remote)
          throw new Error(
            `Senkognito: манга отсутствует в GraphQL-ответе для slug=${manga.key}`,
          );
        const branches = remote.branches ?? [];
        const branch =
          branches.find((item) => item.primaryBranch) ?? branches[0];
        if (!branch) {
          updated.chapters = [];
          return updated;
        }
        const chapters = [];
        const seen = new Set();
        let after = null;
        while (true) {
          const pageData = await fetchMangas(ctx, MANGA_CHAPTERS_QUERY, {
            branchId: branch.id,
            number: null,
            after,
            orderBy: { field: "NUMBER", direction: "DESC" },
          });
          const connection = pageData?.mangaChapters;
          if (!connection)
            throw new Error("Senkognito: отсутствует mangaChapters");
          for (const edge of connection.edges ?? []) {
            const chapter = edge?.node;
            if (!chapter?.slug || seen.has(chapter.slug)) continue;
            seen.add(chapter.slug);
            const teamIds = chapter.teamIds ?? [];
            const scanlators = (branch.teamActivities ?? [])
              .filter((activity) => teamIds.includes(activity.team?.id))
              .map((activity) => activity.team?.name)
              .filter(Boolean);
            const volume = chapter.volume;
            const number = chapter.number;
            chapters.push({
              key: chapter.slug,
              title:
                chapter.name ||
                (volume != null || number != null
                  ? [
                      volume != null ? `Том ${volume}` : null,
                      number != null ? `Глава ${number}` : null,
                    ]
                      .filter(Boolean)
                      .join(" ")
                  : undefined),
              chapterNumber: parseChapterNumber(number),
              volumeNumber: parseChapterNumber(volume),
              dateUploaded: parseUploadedDate(chapter.createdAt),
              language: "ru",
              scanlators: scanlators.length ? scanlators : undefined,
              url: `${BASE_URL}/manga/${remote.slug}/chapters`,
            });
          }
          const pageInfo = connection.pageInfo ?? {};
          if (!pageInfo.hasNextPage) break;
          const next = pageInfo.endCursor;
          if (!next || next === after)
            throw new Error("Senkognito: некорректный курсор пагинации глав");
          after = next;
        }
        updated.chapters = chapters;
      }
      return updated;
    } catch (error) {
      console.error("[Senkognito][getMangaUpdate]", {
        mangaKey: manga?.key,
        needsDetails,
        needsChapters,
        message: error?.message ?? String(error),
        stack: error?.stack,
      });
      throw error;
    }
  },

  async getPageList(manga, chapter, ctx) {
    try {
      const data = await fetchMangas(ctx, READER_QUERY, {
        slug: chapter.key,
        cdnQuality: "red",
      });
      const pages = data.mangaChapter?.pages ?? [];
      return pages
        .map((page) => {
          const url = getOriginalImageUrl(page);
          if (!url) return null;
          const original = page.image?.original;
          return {
            url,
            ...(Number(original?.width) > 0
              ? { width: Number(original.width) }
              : {}),
            ...(Number(original?.height) > 0
              ? { height: Number(original.height) }
              : {}),
          };
        })
        .filter(Boolean);
    } catch (error) {
      console.error("[Senkognito][getPageList]", {
        mangaKey: manga?.key,
        chapterKey: chapter?.key,
        message: error?.message ?? String(error),
        stack: error?.stack,
      });
      throw error;
    }
  },
};

if (typeof module !== "undefined") {
  module.exports = { source };
}
