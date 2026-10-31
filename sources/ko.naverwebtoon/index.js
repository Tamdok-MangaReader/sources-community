"use strict";
// Naver Webtoon (comic.naver.com). Ported from the Aidoku ko.naverwebtoon source.
//
// Everything is scraped from the mobile site (m.comic.naver.com); the official JSON
// endpoint /api/article/list/info is used only as a metadata fallback for 19+ titles
// that redirect to the login page. Best Challenge (reader-submitted) series use
// separate URLs, so their ids carry a "-best" suffix.

const BASE_URL = "https://m.comic.naver.com";
const API_URL = "https://comic.naver.com";
const BEST_SUFFIX = "-best";
const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const LOGIN_REQUIRED = "로그인이 필요한 작품입니다. 소스 설정에서 네이버 로그인을 완료해주세요.";
const CARD_SELECTOR = 'a[href*="/webtoon/list?titleId="], a[href*="/bestChallenge/list?titleId="]';
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

function hasNaverSession(cookies) {
  return ["NID_AUT", "NID_SES"].every((name) => String(cookies?.[name] ?? "").trim() !== "");
}

async function getCookies(ctx) {
  try {
    return (await ctx.cookies) ?? null;
  } catch {
    return null;
  }
}

// Cookies from the in-app web login are only sent to Naver comic hosts.
async function cookieHeader(ctx) {
  const cookies = await getCookies(ctx);
  if (!cookies || typeof cookies !== "object" || !hasNaverSession(cookies)) return "";
  return Object.entries(cookies)
    .filter(([, value]) => String(value ?? "").trim() !== "")
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function get(ctx, url) {
  const headers = { Referer: "https://comic.naver.com/", "User-Agent": USER_AGENT };
  const cookie = await cookieHeader(ctx);
  if (cookie) headers.Cookie = cookie;
  return ctx.request.get(url, { headers });
}

async function fetchHtml(ctx, url) {
  const response = await get(ctx, url);
  if (response.status >= 400) throw new Error(`Naver Webtoon: HTTP ${response.status}`);
  return response.html();
}

// Reads `name=value` from the query string (tolerates HTML-escaped "&amp;").
function queryParam(url, name) {
  const query = url.split("?").slice(1).join("?");
  for (const part of query.split("&")) {
    const cleaned = part.replace(/^amp;/, "");
    if (cleaned.startsWith(name)) {
      const value = cleaned.slice(name.length).split("#")[0];
      return value || null;
    }
  }
  return null;
}

function titleId(url) {
  const id = queryParam(url, "titleId=");
  if (!id) return null;
  return url.includes("bestChallenge") ? id + BEST_SUFFIX : id;
}

const episodeId = (url) => queryParam(url, "no=");

function mangaUrl(id) {
  return id.endsWith(BEST_SUFFIX)
    ? `${BASE_URL}/bestChallenge/list?titleId=${id.slice(0, -BEST_SUFFIX.length)}`
    : `${BASE_URL}/webtoon/list?titleId=${id}`;
}

function chapterUrl(chapter, mangaKey) {
  return mangaKey.endsWith(BEST_SUFFIX)
    ? `${BASE_URL}/bestChallenge/detail?titleId=${mangaKey.slice(0, -BEST_SUFFIX.length)}&no=${chapter}`
    : `${BASE_URL}/webtoon/detail?titleId=${mangaKey}&no=${chapter}`;
}

// Number written right before `marker` in titles like "3부 235화" (marker "화" -> 235, "부" -> 3).
function numberBefore(title, marker) {
  const index = title.indexOf(marker);
  if (index === -1) return undefined;
  let digits = "";
  for (const char of [...title.slice(0, index)].reverse()) {
    if (/[0-9.]/.test(char)) digits = char + digits;
    else if (digits) break;
  }
  const value = Number(digits);
  return digits && !Number.isNaN(value) ? value : undefined;
}

// "YY.MM.DD" or "YYYY.MM.DD" in Korea time -> unix seconds.
function parseKoreanDate(text) {
  const match = String(text ?? "").trim().replace(/\.$/, "").match(/^(\d{2}|\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (!match) return undefined;
  const year = match[1].length === 2 ? 2000 + Number(match[1]) : Number(match[1]);
  const utc = Date.UTC(year, Number(match[2]) - 1, Number(match[3]));
  return Math.floor(utc / 1000) - 9 * 3600;
}

function isLoginPage(html) {
  return (
    clean(html.querySelector("title")?.text).includes("로그인") ||
    Boolean(html.querySelector("form#frmNIDLogin"))
  );
}

// Cards from weekday / finished / best-challenge / search pages. The same title can
// appear twice (banner + list); keep the entry but prefer the sharper cover.
function parseCards(html) {
  const entries = [];
  for (const node of html.querySelectorAll(CARD_SELECTOR)) {
    const href = node.getAttribute("href") ?? "";
    const key = titleId(href);
    if (!key) continue;
    const cover = node.querySelector("img")?.getAttribute("src") ?? undefined;
    const existing = entries.find((entry) => entry.key === key);
    if (existing) {
      if (cover && !cover.includes("IMAG19")) existing.cover = cover;
      continue;
    }
    entries.push({
      key,
      title: clean(node.querySelector("strong")?.text) || clean(node.querySelector(".title")?.text),
      cover,
      url: /^https?:/i.test(href) ? href : `${BASE_URL}${href}`,
      viewer: "webtoon",
    });
  }
  return entries;
}

function hasNext(html, entries) {
  const button = html.querySelector("a.btn_next");
  if (!button) return false;
  const href = button.getAttribute("href") ?? "";
  return entries.length > 0 && !button.classList.contains("disabled") && href !== "" && href !== "#";
}

async function weekdayList(ctx, week) {
  const html = await fetchHtml(ctx, `${BASE_URL}/webtoon/weekday?week=${week}`);
  return { entries: parseCards(html), hasNextPage: false };
}

async function finishList(ctx, page, sort) {
  const html = await fetchHtml(ctx, `${BASE_URL}/webtoon/finish?page=${page}&sort=${sort}`);
  const entries = parseCards(html);
  return { entries, hasNextPage: hasNext(html, entries) };
}

async function bestChallengeList(ctx, page) {
  if (!showBestChallenge(ctx)) return { entries: [], hasNextPage: false };
  const html = await fetchHtml(ctx, `${BASE_URL}/bestChallenge/genre?genre=ALL&sort=VIEW&page=${page}`);
  const entries = parseCards(html);
  return { entries, hasNextPage: hasNext(html, entries) };
}

function showBestChallenge(ctx) {
  return ctx.defaults.get("showBestChallenge", true) !== false;
}

function splitPeople(text) {
  return String(text ?? "")
    .split(/[/,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

// For 19+ titles the page is a login redirect, so metadata comes from the JSON API instead.
async function detailsFromApi(ctx, manga, url) {
  const result = { ...manga, url, viewer: "webtoon", contentRating: "nsfw" };
  const cleanId = manga.key.replace(/-best$/, "");
  try {
    const response = await get(ctx, `${API_URL}/api/article/list/info?titleId=${cleanId}`);
    if (response.status < 400) {
      const info = await response.json();
      if (info.titleName) result.title = info.titleName;
      const cover = info.posterThumbnailUrl || info.thumbnailUrl;
      if (cover) result.cover = cover;
      if (info.synopsis) result.description = info.synopsis;
      const people = info.displayAuthor
        ? splitPeople(info.displayAuthor)
        : (info.communityArtists ?? []).map((artist) => clean(artist.name)).filter(Boolean);
      if (people.length > 0) {
        result.authors = people;
        result.artists = people;
      }
      const tags = (info.curationTagList ?? []).map((tag) => clean(tag.tagName)).filter(Boolean);
      if (tags.length > 0) result.tags = tags;
      result.status = info.finished ? "completed" : info.rest ? "hiatus" : "ongoing";
    }
  } catch {
    // Metadata is optional here; the placeholder description below explains the login need.
  }
  if (!result.description) result.description = LOGIN_REQUIRED;
  result.tags = [...new Set([...(result.tags ?? []), "성인"])];
  return result;
}

async function loadDetails(ctx, manga) {
  const url = mangaUrl(manga.key);
  const html = await fetchHtml(ctx, url);
  if (isLoginPage(html)) return detailsFromApi(ctx, manga, url);

  const result = { ...manga, url, viewer: "webtoon" };
  const title =
    html.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
    clean(html.querySelector(".info_area .title, .title_area strong")?.text);
  if (title) result.title = title;

  const cover = html.querySelector('meta[property="og:image"]')?.getAttribute("content");
  if (cover) result.cover = cover;

  const description =
    html.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
    clean(html.querySelector(".summary, .desc")?.text);
  if (description) result.description = description;

  const people = splitPeople(
    clean(html.querySelector(".author, .info_area .author, .writer, .info .author_area")?.text),
  );
  if (people.length > 0) {
    result.authors = people;
    result.artists = people;
  }

  const tags = [];
  for (const node of html.querySelectorAll(".genre dd span, .genre dd li, .tag_item")) {
    const tag = clean(node.text);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > 0) result.tags = tags;
  result.contentRating = tags.some((tag) => tag.includes("19") || tag.includes("성인")) ? "nsfw" : "safe";

  const statusText = clean(html.querySelector(".week_day .list_detail, .detail .week_day")?.text);
  const hiatus =
    Boolean(html.querySelector("span.bullet.break, span.bullet_break")) ||
    clean(html.querySelector(".area_info, .section_toon_info")?.text).includes("휴재") ||
    statusText.includes("휴재");
  const completed = statusText.includes("완결") || clean(html.querySelector(".week_day")?.text).includes("완결");
  result.status = completed ? "completed" : hiatus ? "hiatus" : "ongoing";
  return result;
}

// The mobile list is paginated (newest first); walk every page until a page adds nothing new.
async function loadChapters(ctx, key) {
  const base = key.endsWith(BEST_SUFFIX)
    ? `${BASE_URL}/bestChallenge/list?titleId=${key.slice(0, -BEST_SUFFIX.length)}`
    : `${BASE_URL}/webtoon/list?titleId=${key}`;
  const chapters = [];
  const seen = new Set();

  for (let page = 1; page <= 1000; page += 1) {
    const html = await fetchHtml(ctx, `${base}&sortOrder=DESC&page=${page}`);

    if (isLoginPage(html) || html.querySelector("input[name='dynamicKey']")) {
      const loggedIn = hasNaverSession(await getCookies(ctx));
      throw new Error(
        loggedIn ? "네이버 로그인 세션이 만료되었습니다. 소스 설정에서 다시 로그인해주세요." : LOGIN_REQUIRED,
      );
    }

    // Layouts differ between titles, so fall back through three selectors.
    let items = html.querySelectorAll("ul.section_episode_list li.item");
    if (items.length === 0) items = html.querySelectorAll("li.item[data-no]");
    if (items.length === 0) items = html.querySelectorAll('a[href*="detail?"]');

    let foundNew = false;
    for (const node of items) {
      const href = node.getAttribute("href") ?? node.querySelector("a")?.getAttribute("href") ?? "";
      const id = node.getAttribute("data-no") || episodeId(href);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      foundNew = true;

      const locked =
        node.classList.contains("lock") ||
        clean(node.querySelector(".ico_comic .blind")?.text).includes("유료") ||
        (href === "#" && Boolean(node.querySelector("em.cookie_txt")));

      const title =
        clean(node.querySelector(".name")?.text) ||
        clean(node.querySelector("strong.title, .title")?.text) ||
        `${id}화`;
      const fallbackNumber = Number(id);
      const chapterNumber = numberBefore(title, "화") ?? (Number.isNaN(fallbackNumber) ? undefined : fallbackNumber);
      const thumbnail = node.querySelector("div.thumbnail img, .item_thumb img")?.getAttribute("src");

      chapters.push({
        key: id,
        title,
        volumeNumber: numberBefore(title, "부"),
        chapterNumber,
        dateUploaded: parseKoreanDate(node.querySelector(".date")?.text),
        url: href.includes("detail?") ? (/^https?:/i.test(href) ? href : `${BASE_URL}${href}`) : chapterUrl(id, key),
        thumbnail: thumbnail || undefined,
        language: "ko",
        locked,
      });
    }

    if (!foundNew) break;
    const next = html.querySelector("a.btn_next");
    const nextHref = next?.getAttribute("href") ?? "";
    if (!next || next.classList.contains("disabled") || nextHref === "" || nextHref === "#") break;
  }
  return chapters;
}

const source = {
  async getListings(ctx) {
    const listings = [
      ...WEEKDAYS.map((id, index) => ({ id, name: "월화수목금토일"[index] + "요일", kind: "grid" })),
      { id: "completed", name: "완결", kind: "grid" },
      { id: "popular", name: "인기순", kind: "list" },
    ];
    if (showBestChallenge(ctx)) listings.push({ id: "best", name: "베스트도전", kind: "grid" });
    return listings;
  },

  async getMangaList(listing, page, ctx) {
    const id = listing?.id;
    if (WEEKDAYS.includes(id)) return weekdayList(ctx, id);
    if (id === "completed") return finishList(ctx, page, "UPDATE");
    if (id === "popular") return finishList(ctx, page, "ALL_READER");
    if (id === "best") return bestChallengeList(ctx, page);
    return weekdayList(ctx, "mon");
  },

  async getSearchMangaList({ query, page, filters }, ctx) {
    let searchType = showBestChallenge(ctx) ? "ALL" : "WEBTOON";
    for (const filter of filters ?? []) {
      if (filter.type === "select" && filter.id === "searchType" && filter.value) searchType = filter.value;
    }

    const text = (query ?? "").trim();
    if (text) {
      const keyword = encodeURIComponent(text);
      const url =
        searchType === "ALL"
          ? `${BASE_URL}/search/result?keyword=${keyword}`
          : `${BASE_URL}/search/result?keyword=${keyword}&searchType=${searchType}`;
      const html = await fetchHtml(ctx, url);
      return { entries: parseCards(html), hasNextPage: false };
    }

    if (searchType === "BEST_CHALLENGE") return bestChallengeList(ctx, page);
    return weekdayList(ctx, "mon");
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    let result = manga;
    if (needsDetails) result = await loadDetails(ctx, manga);
    if (needsChapters) result = { ...result, chapters: await loadChapters(ctx, manga.key) };
    return result;
  },

  async getPageList(manga, chapter, ctx) {
    const html = await fetchHtml(ctx, chapterUrl(chapter.key, manga.key));
    if (isLoginPage(html)) throw new Error(LOGIN_REQUIRED);

    let images = html.querySelectorAll("img.toon_image");
    if (images.length === 0) {
      images = html.querySelectorAll("div.wt_viewer img, #toon_layer img, div.toon_view_area img");
    }

    const pages = [];
    for (const img of images) {
      let url = img.getAttribute("data-src") ?? "";
      if (!url || url.includes("bg_transparency.png")) url = img.getAttribute("src") ?? "";
      // Age-gate placeholders are not real pages.
      if (!url || url.includes("bg_transparency.png") || url.includes("agerate") || url.includes("age_")) continue;
      pages.push({ url });
    }

    if (pages.length === 0) {
      const body = html.querySelector("body")?.innerHTML ?? "";
      if (body.includes("유료로 전환된 회차") || body.includes("구매") || body.includes("대여")) {
        throw new Error("구매 또는 대여가 필요한 유료 회차입니다.");
      }
      throw new Error("회차 이미지를 불러올 수 없습니다.");
    }
    return pages;
  },

  async getHome(ctx) {
    const components = [];
    const sections = [
      { title: "오늘의 웹툰", load: () => weekdayListToday(ctx) },
      { title: "인기 완결작", load: () => finishList(ctx, 1, "ALL_READER"), listing: { id: "popular", name: "인기순" } },
      { title: "최신 완결작", load: () => finishList(ctx, 1, "UPDATE"), listing: { id: "completed", name: "완결" } },
    ];
    for (const section of sections) {
      try {
        const { entries } = await section.load();
        if (entries.length > 0) {
          components.push({ kind: "scroller", title: section.title, entries, ...(section.listing ? { listing: section.listing } : {}) });
        }
      } catch {
        // One failing section should not blank the whole home screen.
      }
    }
    return { components };
  },
};

async function weekdayListToday(ctx) {
  const html = await fetchHtml(ctx, `${BASE_URL}/webtoon/weekday`);
  return { entries: parseCards(html), hasNextPage: false };
}

module.exports = { source };
