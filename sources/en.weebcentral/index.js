const SITE_NAME = "Weeb Central";
const BASE_URL = "https://weebcentral.com";
const FETCH_LIMIT = 24;
const MAX_ATTEMPTS = 3;
const MIN_INTERVAL_MS = 700;
const SORTS = ["Best Match", "Alphabet", "Popularity", "Subscribers", "Recently Added", "Latest Updates"];

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

async function getHtml(ctx, url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await throttle();
      const response = await ctx.request.get(url, {
        headers: { Referer: `${BASE_URL}/`, Origin: BASE_URL },
      });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (response.status >= 400) {
        const error = new Error(`${SITE_NAME}: HTTP ${response.status}`);
        error.fatal = true;
        throw error;
      }
      return response.html();
    } catch (error) {
      lastError = error;
      if (error.fatal || attempt === MAX_ATTEMPTS) break;
      await sleep(800 * attempt);
    }
  }
  console.log(tag("html"), url, lastError?.message ?? String(lastError));
  throw lastError;
}

function absolute(href) {
  if (!href) return undefined;
  try {
    return new URL(href, BASE_URL).toString();
  } catch {
    return undefined;
  }
}

function keyOf(href) {
  const url = absolute(href);
  if (!url) return undefined;
  const parsed = new URL(url);
  return parsed.pathname;
}

function text(node) {
  return node?.text?.replace(/\s+/g, " ").trim() ?? "";
}

function cleanTitle(title) {
  return title.replace(/^Official\s+/, "").trim();
}

function toSeconds(value) {
  const ms = Date.parse(value ?? "");
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function cleanQuery(value) {
  return String(value ?? "")
    .replace(/[[!#:()\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFilters(query, filters) {
  const params = [];
  let extra = "";
  const cleaned = cleanQuery(query);
  if (cleaned) params.push(["text", cleaned]);
  for (const filter of filters ?? []) {
    if (!filter) continue;
    switch (filter.type) {
      case "text":
        if (filter.value?.trim()) params.push(["author", filter.value.trim()]);
        break;
      case "sort":
        params.push(["sort", SORTS[filter.index ?? 0] ?? SORTS[0]]);
        params.push(["order", filter.ascending ? "Ascending" : "Descending"]);
        break;
      case "multiSelect":
        if (filter.id === "genre") {
          for (const value of filter.included ?? []) params.push(["included_tag", value]);
          for (const value of filter.excluded ?? []) params.push(["excluded_tag", value]);
        } else {
          for (const value of filter.included ?? []) extra += value;
        }
        break;
      case "check":
        if (filter.value === true || filter.value === 1) params.push(["official", "True"]);
        break;
      default:
        break;
    }
  }
  const qs = params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  return qs + extra;
}

function parseCards(root, selector) {
  return Array.from(root.querySelectorAll(selector))
    .map((card) => {
      const link = card.querySelector("a");
      const key = keyOf(link?.getAttribute("href"));
      if (!key) return null;
      const title = cleanTitle(text(card.querySelector(".text-lg")) || text(link));
      return {
        key,
        title: title || key,
        cover: absolute(card.querySelector("img")?.getAttribute("src")),
        url: absolute(key),
      };
    })
    .filter(Boolean);
}

function parseChapterCards(root, selector) {
  return Array.from(root.querySelectorAll(selector))
    .map((card) => {
      const links = Array.from(card.querySelectorAll("a"));
      const mangaKey = keyOf(links[0]?.getAttribute("href"));
      const chapterLink = links[links.length - 1];
      const chapterKey = keyOf(chapterLink?.getAttribute("href"));
      if (!mangaKey || !chapterKey) return null;
      const label = text(chapterLink?.querySelector("div.flex > span"));
      const number = Number.parseFloat(label.split(" ").pop() ?? "");
      return {
        manga: {
          key: mangaKey,
          title: cleanTitle(text(card.querySelector(".text-lg"))) || mangaKey,
          cover: absolute(card.querySelector("img")?.getAttribute("src")),
        },
        chapter: {
          key: chapterKey,
          chapterNumber: Number.isFinite(number) ? number : undefined,
          dateUploaded: toSeconds(card.querySelector("time[datetime]")?.getAttribute("datetime")),
        },
      };
    })
    .filter(Boolean);
}

function infoValues(root, label, selector = "a") {
  const items = Array.from(root.querySelectorAll("li")).filter((li) =>
    text(li.querySelector("strong")).includes(label),
  );
  return items.flatMap((li) => Array.from(li.querySelectorAll(selector)).map(text).filter(Boolean));
}

const source = {
  async getHome(ctx) {
    const html = await getHtml(ctx, BASE_URL);
    const sections = Array.from(html.querySelectorAll("section"));
    const sectionWith = (heading) =>
      sections.find((section) =>
        Array.from(section.querySelectorAll("h2, span")).some((node) => text(node).includes(heading)),
      );
    const hotSection = sectionWith("Hot Updates");
    const latestSection = sectionWith("Latest Updates");
    const recSection = sectionWith("Recommendations");
    const components = [];
    const hot = hotSection ? parseChapterCards(hotSection, "article:not(.hidden)") : [];
    if (hot.length) {
      components.push({
        kind: "mangaChapterList",
        title: "Hot Updates",
        entries: [],
        chapterEntries: hot,
        listing: { id: "hot", name: "Hot Updates" },
      });
    }
    const latest = latestSection ? parseChapterCards(latestSection, "article") : [];
    if (latest.length) {
      components.push({
        kind: "mangaChapterList",
        title: "Latest Updates",
        entries: [],
        chapterEntries: latest,
      });
    }
    const recs = recSection ? parseCards(recSection, "li.glide__slide:not(.glide__slide--clone)") : [];
    if (recs.length) components.push({ kind: "scroller", title: "Recommendations", entries: recs });
    if (!components.length) throw new Error(`${SITE_NAME}: home is empty`);
    return { components };
  },

  async getMangaList(listing, page, ctx) {
    if (listing?.id !== "hot") return { entries: [], hasNextPage: false };
    const html = await getHtml(ctx, `${BASE_URL}/hot-updates`);
    return { entries: parseCards(html, "article:not(.hidden)"), hasNextPage: false };
  },

  async getSearchMangaList({ query, page, filters }, ctx) {
    const offset = ((page ?? 1) - 1) * FETCH_LIMIT;
    const url = `${BASE_URL}/search/data?limit=${FETCH_LIMIT}&offset=${offset}&display_mode=Full+Display&${buildFilters(query, filters)}`;
    const html = await getHtml(ctx, url);
    const entries = parseCards(html, "article:has(section)");
    return { entries, hasNextPage: entries.length > 0 };
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const mangaUrl = absolute(manga.key);
    const updated = { ...manga, url: mangaUrl };

    if (needsDetails) {
      const html = await getHtml(ctx, mangaUrl);
      const sections = html.querySelectorAll("section[x-data] > section");
      if (sections.length < 2) throw new Error(`${SITE_NAME}: unexpected page layout`);
      const info = sections[0];
      const titleBlock = sections[sections.length - 1];
      const tags = infoValues(info, "Tag").concat(infoValues(info, "Type"));
      const type = infoValues(info, "Type")[0] ?? "";
      const status = infoValues(info, "Status")[0] ?? "";
      const descriptionItem = Array.from(titleBlock.querySelectorAll("li")).find((li) =>
        text(li.querySelector("strong")).includes("Description"),
      );
      const altNames = Array.from(titleBlock.querySelectorAll("li"))
        .filter((li) => text(li.querySelector("strong")).includes("Associated Name"))
        .flatMap((li) => Array.from(li.querySelectorAll("li")).map(text).filter(Boolean));
      updated.title = cleanTitle(text(titleBlock.querySelector("h1"))) || manga.title;
      updated.altTitles = altNames;
      updated.cover = absolute(info.querySelector("img")?.getAttribute("src")) ?? manga.cover;
      updated.authors = infoValues(info, "Author");
      updated.description = text(descriptionItem?.querySelector("p")) || undefined;
      updated.tags = tags;
      updated.status =
        { Complete: "completed", Ongoing: "ongoing", Hiatus: "hiatus", Canceled: "cancelled" }[status] ??
        "unknown";
      updated.contentRating = tags.some((name) => ["Adult", "Hentai", "Mature"].includes(name))
        ? "nsfw"
        : tags.includes("Ecchi")
          ? "suggestive"
          : "safe";
      updated.viewer = type === "Manhua" || type === "Manhwa" ? "webtoon" : "rtl";
    }

    if (needsChapters) {
      const base = new URL(mangaUrl);
      const segments = base.pathname.split("/").filter(Boolean);
      const listPath = segments.length > 2 ? segments.slice(0, 2).join("/") : segments.join("/");
      const html = await getHtml(ctx, `${BASE_URL}/${listPath}/full-chapter-list`);
      updated.chapters = Array.from(html.querySelectorAll("div[x-data]"))
        .map((row) => {
          const link = row.querySelector("a");
          const key = keyOf(link?.getAttribute("href"));
          if (!key) return null;
          const title = text(row.querySelector("span.flex > span"));
          let number = Number.parseFloat(title.split(" ").pop() ?? "");
          number = Number.isFinite(number) ? number : undefined;
          const isVolume = title.includes("Volume");
          const isChapter = title.includes("Chapter");
          return {
            key,
            title: isVolume || isChapter ? undefined : title || undefined,
            chapterNumber: isVolume ? undefined : number,
            volumeNumber: isVolume ? number : undefined,
            dateUploaded: toSeconds(row.querySelector("time[datetime]")?.getAttribute("datetime")),
            url: absolute(key),
          };
        })
        .filter(Boolean);
    }
    return updated;
  },

  async getPageList(manga, chapter, ctx) {
    const html = await getHtml(
      ctx,
      `${BASE_URL}${chapter.key}/images?is_prev=False&reading_style=long_strip`,
    );
    const pages = Array.from(html.querySelectorAll("section[x-data*=scroll] > img"))
      .map((img) => absolute(img.getAttribute("src")))
      .filter(Boolean)
      .map((url) => ({ url }));
    if (!pages.length) throw new Error(`${SITE_NAME}: no pages found`);
    return pages;
  },
};

if (typeof module !== "undefined") {
  module.exports = { source };
}
