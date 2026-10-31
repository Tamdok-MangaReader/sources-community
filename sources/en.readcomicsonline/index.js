"use strict";
// Read Comics Online (readcomicsonline.ru) - DC / Marvel / indie comics.
// Ported from the Aidoku en.readcomicsonline source (an MMRCMS site with a custom theme).
// Comics default to right-to-left reading (viewer "rtl") as requested for this repository.

const BASE_URL = "https://readcomicsonline.ru";
const ITEM_PATH = "comic";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

async function fetchHtml(ctx, url) {
  const response = await ctx.request.get(url, { headers: { Referer: `${BASE_URL}/` } });
  if (response.status >= 400) throw new Error(`Read Comics Online: HTTP ${response.status}`);
  return response.html();
}

function absolute(href) {
  if (!href) return undefined;
  if (/^https?:/.test(href)) return href;
  if (href.startsWith("//")) return `https:${href}`;
  return `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
}

// Lazy-loaded images keep the real URL in one of several data-* attributes.
function imageOf(node) {
  if (!node) return undefined;
  for (const name of ["data-background-image", "data-cfsrc", "data-lazy-src", "data-src", "src"]) {
    const value = node.getAttribute(name);
    if (value) return absolute(value.trim());
  }
  return undefined;
}

// Slug -> the conventional cover path used when the page has no (or a placeholder) image.
function coverFor(key, found) {
  if (found && !found.endsWith("no-image.png")) return found;
  return `${BASE_URL}/uploads/${ITEM_PATH}/${key}/cover/cover_250x350.jpg`;
}

function keyFromHref(href) {
  const url = absolute(href) ?? "";
  const prefix = `${BASE_URL}/${ITEM_PATH}/`;
  return url.startsWith(prefix) ? url.slice(prefix.length).replace(/\/+$/, "") : null;
}

function entry(key, title, cover) {
  return { key, title: clean(title), cover: coverFor(key, cover), url: `${BASE_URL}/${ITEM_PATH}/${key}`, viewer: "rtl", contentRating: "safe" };
}

function statusOf(value) {
  const text = clean(value).toLowerCase();
  if (text === "complete" || text === "completed") return "completed";
  if (text === "ongoing") return "ongoing";
  if (text === "dropped") return "cancelled";
  return "unknown";
}

// "5 Mar 2021" -> unix seconds (UTC).
function parseDate(value) {
  const match = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/.exec(value ?? "");
  const month = match ? MONTHS.indexOf(match[2].toLowerCase()) : -1;
  return match && month !== -1 ? Math.floor(Date.UTC(+match[3], month, +match[1]) / 1000) : undefined;
}

function chapterNumber(title) {
  const match = /(\d+(?:\.\d+)?)/.exec(title);
  return match ? parseFloat(match[1]) : undefined;
}

// A grid card holds a link to the comic and a <p> with the title.
function parseGrid(html) {
  const entries = [];
  for (const node of html.querySelectorAll("main > .grid > .group")) {
    const anchor = node.querySelector("a");
    const key = keyFromHref(anchor?.getAttribute("href"));
    const title = anchor?.querySelector("p")?.text;
    if (key && title) entries.push(entry(key, title, imageOf(node.querySelector("img"))));
  }
  return { entries, hasNextPage: html.querySelector("nav a[rel=next]") != null };
}

const source = {
  async getListings() {
    return [{ id: "latest", name: "Latest Releases", kind: "grid" }];
  },

  async getMangaList(listing, page, ctx) {
    const html = await fetchHtml(ctx, `${BASE_URL}/latest-release?page=${page}`);
    const entries = [];
    for (const row of html.querySelectorAll("main > div > div.grid")) {
      const anchor = row.querySelector("a.text-brand-400");
      const key = keyFromHref(anchor?.getAttribute("href"));
      if (key && anchor.text) entries.push(entry(key, anchor.text, imageOf(row.querySelector("img"))));
    }
    return { entries, hasNextPage: html.querySelector("nav span a[rel=next]") != null };
  },

  async getSearchMangaList({ query, page, filters }, ctx) {
    const values = { status_id: "", type_id: "", category: "" };
    for (const filter of filters ?? []) {
      if (filter.type === "select" && filter.id in values) values[filter.id] = filter.value ?? "";
    }
    const qs =
      `name=${encodeURIComponent(query ?? "")}&status_id=${encodeURIComponent(values.status_id)}` +
      `&type_id=${encodeURIComponent(values.type_id)}&category=${encodeURIComponent(values.category)}&page=${page}`;
    return parseGrid(await fetchHtml(ctx, `${BASE_URL}/advanced-search?${qs}`));
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const html = await fetchHtml(ctx, `${BASE_URL}/${ITEM_PATH}/${manga.key}`);
    const updated = { ...manga, viewer: "rtl" };

    if (needsDetails) {
      // The info block is a <dl> of "Label:" rows; read links from the row with the wanted label.
      const linksFor = (label) => {
        for (const row of html.querySelectorAll("dl div")) {
          if (clean(row.text).startsWith(label)) return row.querySelectorAll("a").map((a) => clean(a.text)).filter(Boolean);
        }
        return [];
      };
      const authors = [];
      for (const row of html.querySelectorAll("div")) {
        if (row.querySelector("span") && clean(row.querySelector("span").text).startsWith("Author:")) {
          authors.push(...row.querySelectorAll("a").map((a) => clean(a.text)).filter(Boolean));
          break;
        }
      }
      Object.assign(updated, {
        title: clean(html.querySelector("h1.text-2xl")?.text) || manga.title,
        cover: coverFor(manga.key, imageOf(html.querySelector("img.w-full.rounded-xl"))),
        description: clean(html.querySelector("p.mt-5.text-sm")?.text),
        status: statusOf(html.querySelector("div.flex.flex-wrap.gap-2 span.rounded-full")?.text),
        tags: linksFor("Genres:"),
        authors: authors.length ? authors : undefined,
        url: `${BASE_URL}/${ITEM_PATH}/${manga.key}`,
        contentRating: "safe",
      });
    }

    if (needsChapters) {
      const prefix = `${BASE_URL}/${ITEM_PATH}/${manga.key}/`;
      updated.chapters = html
        .querySelectorAll(".overflow-hidden.border-ink-600 > a")
        .map((node) => {
          const url = absolute(node.getAttribute("href"));
          if (!url || !url.startsWith(prefix)) return null;
          const name = clean(node.querySelector(".text-brand-400")?.text) || clean(node.text);
          // "Title #5: Subtitle" -> drop the series name, keep the rest.
          const title = name.startsWith(updated.title ?? "") ? name.slice((updated.title ?? "").length).trim() || name : name;
          return {
            key: url.slice(prefix.length),
            title,
            chapterNumber: chapterNumber(title),
            dateUploaded: parseDate(node.querySelector(".text-slate-500")?.text),
            url,
          };
        })
        .filter(Boolean);
    }
    return updated;
  },

  async getPageList(manga, chapter, ctx) {
    const html = await fetchHtml(ctx, `${BASE_URL}/${ITEM_PATH}/${manga.key}/${chapter.key}`);
    const pages = [];
    for (const img of html.querySelectorAll("#reader-all img")) {
      const url = imageOf(img);
      if (url) pages.push({ url, headers: { Referer: `${BASE_URL}/` } });
    }
    if (pages.length === 0) throw new Error("Read Comics Online: no pages found");
    return pages;
  },

  async getHome(ctx) {
    const html = await fetchHtml(ctx, BASE_URL);
    const hot = [];
    for (const a of html.querySelectorAll("#hot-track > a.hot-item")) {
      const key = keyFromHref(a.getAttribute("href"));
      const title = a.querySelector("p")?.text;
      if (key && title) hot.push(entry(key, title, imageOf(a.querySelector("img"))));
    }
    const latest = [];
    for (const row of html.querySelectorAll("section .grid > div")) {
      const anchor = row.querySelector("a.text-brand-400");
      const key = keyFromHref(anchor?.getAttribute("href"));
      if (key && anchor.text) latest.push(entry(key, anchor.text, imageOf(row.querySelector("img"))));
    }
    const components = [];
    if (hot.length) components.push({ kind: "scroller", title: "Hot Comics", entries: hot });
    if (latest.length) components.push({ kind: "mangaGrid", title: "Latest Releases", entries: latest, listing: { id: "latest", name: "Latest Releases" } });
    return { components };
  },
};

module.exports = { source };
