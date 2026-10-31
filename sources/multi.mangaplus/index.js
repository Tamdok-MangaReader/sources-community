"use strict";
// MANGA Plus by SHUEISHA (mangaplus.shueisha.co.jp). Ported from the Aidoku multi.mangaplus source.
//
// The API speaks protobuf, so responses are read with ctx.request.getBytes() and decoded by the
// tiny schema-driven decoder below. Page images are XOR-encrypted per page: they are downloaded
// as bytes, decrypted here and stored with ctx.files.saveImage(), then handed to the reader as
// local file:// URIs. This needs a Tamdok build that provides ctx.request.getBytes / ctx.files.

const BASE_URL = "https://mangaplus.shueisha.co.jp";
const WEB_API = "https://jumpg-webapi.tokyo-cdn.com/api";
const MOBILE_API = "https://jumpg-api.tokyo-cdn.com/api";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const ITEMS_PER_PAGE = 20;
const IMAGE_CONCURRENCY = 4;

// Language enum used by the API (field 7 of Title) -> setting value.
const LANGUAGES = { 0: "en", 1: "es", 2: "fr", 3: "id", 4: "pt-BR", 5: "ru", 6: "th", 7: "de", 9: "vi" };

// ---------------------------------------------------------------------------
// Minimal protobuf reader
// ---------------------------------------------------------------------------

function readVarint(buf, start) {
  let result = 0;
  let scale = 1;
  let pos = start;
  let byte;
  do {
    if (pos >= buf.length) throw new Error("Invalid protobuf response");
    byte = buf[pos];
    pos += 1;
    result += (byte & 0x7f) * scale;
    scale *= 128;
  } while (byte & 0x80);
  return [result, pos];
}

function utf8Decode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let code;
    if (b < 0x80) {
      code = b;
      i += 1;
    } else if (b < 0xe0) {
      code = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if (b < 0xf0) {
      code = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else {
      code = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      i += 4;
    }
    out += String.fromCodePoint(code);
  }
  return out;
}

// schema: { [fieldNumber]: { name, type: "int" | "string" | "message", schema?, repeated? } }
// Unknown fields are skipped, so new server-side fields never break decoding.
function decode(buf, schema) {
  const out = {};
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    let value;
    if (wire === 0) {
      [value, pos] = readVarint(buf, pos);
    } else if (wire === 2) {
      let length;
      [length, pos] = readVarint(buf, pos);
      value = buf.subarray(pos, pos + length);
      pos += length;
    } else if (wire === 1) {
      pos += 8;
      continue;
    } else if (wire === 5) {
      pos += 4;
      continue;
    } else {
      throw new Error("Invalid protobuf response");
    }
    const def = schema[field];
    if (!def) continue;
    let parsed = value;
    if (def.type === "string") parsed = utf8Decode(value);
    else if (def.type === "message") parsed = decode(value, def.schema);
    if (def.repeated) (out[def.name] ??= []).push(parsed);
    else out[def.name] = parsed;
  }
  return out;
}

const TITLE = {
  1: { name: "titleId", type: "int" },
  2: { name: "name", type: "string" },
  3: { name: "author", type: "string" },
  4: { name: "portraitImageUrl", type: "string" },
  7: { name: "language", type: "int" },
};
const CHAPTER = {
  2: { name: "chapterId", type: "int" },
  3: { name: "name", type: "string" },
  4: { name: "subTitle", type: "string" },
  6: { name: "startTimeStamp", type: "int" },
};
const POPUP = { 2: { name: "body", type: "string" } };
const RESPONSE = {
  1: {
    name: "success",
    type: "message",
    schema: {
      8: {
        name: "titleDetail",
        type: "message",
        schema: {
          1: { name: "title", type: "message", schema: TITLE },
          3: { name: "overview", type: "string" },
          7: { name: "viewingPeriodDescription", type: "string" },
          8: { name: "nonAppearanceInfo", type: "string" },
          28: {
            name: "chapterGroups",
            type: "message",
            repeated: true,
            schema: {
              2: { name: "first", type: "message", repeated: true, schema: CHAPTER },
              3: { name: "middle", type: "message", repeated: true, schema: CHAPTER },
              4: { name: "last", type: "message", repeated: true, schema: CHAPTER },
            },
          },
        },
      },
      10: {
        name: "viewer",
        type: "message",
        schema: {
          1: {
            name: "pages",
            type: "message",
            repeated: true,
            schema: {
              1: {
                name: "page",
                type: "message",
                schema: { 1: { name: "imageUrl", type: "string" }, 5: { name: "encryptionKey", type: "string" } },
              },
            },
          },
          9: { name: "titleId", type: "int" },
          19: { name: "viewToken", type: "string" },
        },
      },
      35: {
        name: "allTitles",
        type: "message",
        schema: {
          3: {
            name: "entries",
            type: "message",
            repeated: true,
            schema: { 2: { name: "title", type: "message", schema: TITLE } },
          },
        },
      },
      37: {
        name: "ranking",
        type: "message",
        schema: {
          3: {
            name: "groups",
            type: "message",
            repeated: true,
            schema: { 2: { name: "titles", type: "message", repeated: true, schema: TITLE } },
          },
        },
      },
      38: {
        name: "home",
        type: "message",
        schema: {
          2: {
            name: "groups",
            type: "message",
            repeated: true,
            schema: {
              2: {
                name: "titles",
                type: "message",
                repeated: true,
                schema: {
                  3: { name: "latest", type: "message", schema: { 1: { name: "title", type: "message", schema: TITLE } } },
                },
              },
            },
          },
        },
      },
    },
  },
  2: {
    name: "error",
    type: "message",
    schema: {
      2: { name: "english", type: "message", schema: POPUP },
      3: { name: "spanish", type: "message", schema: POPUP },
    },
  },
};

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function mobile(ctx) {
  return ctx.defaults.get("mobile", false) === true;
}

function apiUrl(ctx) {
  return mobile(ctx) ? MOBILE_API : WEB_API;
}

function authParams(ctx) {
  if (!mobile(ctx)) return "";
  const value = (key) => encodeURIComponent(String(ctx.defaults.get(key, "") ?? ""));
  return `&os=${value("os")}&os_ver=${value("osVer")}&app_ver=${value("appVer")}&secret=${value("secret")}`;
}

async function request(ctx, url) {
  const response = await ctx.request.getBytes(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      "User-Agent": USER_AGENT,
      "Session-Token": uuid(),
    },
  });
  if (response.status >= 400) throw new Error(`MANGA Plus: HTTP ${response.status}`);
  const decoded = decode(await response.bytes(), RESPONSE);
  if (!decoded.success) {
    throw new Error(decoded.error?.english?.body ?? decoded.error?.spanish?.body ?? "MANGA Plus API request failed");
  }
  return decoded.success;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function allowedLanguage(ctx, title) {
  const wanted = String(ctx.defaults.get("language", "en") || "en");
  if (wanted === "all") return true;
  const code = LANGUAGES[title.language ?? 0] ?? "en";
  return code === wanted;
}

function toManga(title) {
  return {
    key: String(title.titleId),
    title: title.name,
    cover: title.portraitImageUrl,
    authors: title.author ? title.author.split(/[/,]/).map((part) => part.trim()) : undefined,
  };
}

// Only the first and last few chapters of a title are free to read. The ones in between are listed
// by the API too (field 3), but need a MANGA Plus MAX subscription, so they are returned locked.
function chapterList(detail) {
  return (detail.chapterGroups ?? []).flatMap((group) => [
    ...(group.first ?? []).map((chapter) => ({ chapter, locked: false })),
    ...(group.middle ?? []).map((chapter) => ({ chapter, locked: true })),
    ...(group.last ?? []).map((chapter) => ({ chapter, locked: false })),
  ]);
}

// "Chapter 12: Title" -> "Title"; a bare "Chapter 12" is left alone.
const CHAPTER_PREFIX = /^(?:chapter|ch\.?|capítulo|capitulo|chapitre|kapitel|bab|глава|ตอนที่|chương)\s*\d+(?:\.\d+)?\s*[:：.\-–—]\s*(?=\S)/i;
const stripChapterPrefix = (title) => String(title ?? "").replace(CHAPTER_PREFIX, "").trim();

function isCompleted(detail) {
  const chapters = chapterList(detail).map((item) => item.chapter);
  const oneShot = chapters.length === 1 && String(chapters[0].name).toLowerCase() === "one-shot";
  return (
    String(detail.nonAppearanceInfo ?? "").toLowerCase().includes("complet") ||
    oneShot ||
    String(detail.viewingPeriodDescription ?? "").includes("latest 0 chapters")
  );
}

function dedupe(titles) {
  const seen = new Set();
  return titles.filter((title) => !seen.has(title.titleId) && seen.add(title.titleId));
}

async function homeTitles(ctx) {
  const result = await request(ctx, `${WEB_API}/web/web_homeV4?lang=eng&clang=eng`);
  if (!result.home) throw new Error("Failed to fetch home view");
  const titles = (result.home.groups ?? []).flatMap((group) => group.titles ?? []).map((item) => item.latest?.title);
  return dedupe(titles.filter(Boolean).filter((title) => allowedLanguage(ctx, title)));
}

async function rankingTitles(ctx) {
  const result = await request(ctx, `${WEB_API}/title_list/rankingV2?lang=eng&type=hottest&clang=eng`);
  if (!result.ranking) throw new Error("Failed to fetch ranking");
  const titles = (result.ranking.groups ?? []).flatMap((group) => group.titles ?? []);
  return dedupe(titles.filter((title) => allowedLanguage(ctx, title)));
}

// The API has no paging: keep the last full list and slice it for later pages.
let directory = { key: "", at: 0, titles: [] };
const DIRECTORY_TTL_MS = 5 * 60 * 1000;

function pageOf(titles, page) {
  const start = (page - 1) * ITEMS_PER_PAGE;
  return {
    entries: titles.slice(start, start + ITEMS_PER_PAGE).map(toManga),
    hasNextPage: (page + 1) * ITEMS_PER_PAGE < titles.length,
  };
}

async function cachedDirectory(key, load, page) {
  if (page === 1 || directory.key !== key || Date.now() - directory.at > DIRECTORY_TTL_MS) {
    directory = { key, at: Date.now(), titles: await load() };
  }
  return directory.titles;
}

// ---------------------------------------------------------------------------
// Image decryption
// ---------------------------------------------------------------------------

function hexToBytes(hex) {
  const out = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const value = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(value)) throw new Error("Invalid encryption key");
    out.push(value);
  }
  return out;
}

function sniffExtension(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46) return "webp";
  return "jpg";
}

// Runs `worker` over items with at most `limit` in flight, keeping result order.
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

async function decryptPage(ctx, page, viewToken) {
  const headers = viewToken ? { "Plus-Vw-Token": viewToken } : {};
  // Unencrypted pages can be loaded straight from the CDN by the reader.
  if (!page.encryptionKey) return { url: page.imageUrl, headers };

  const response = await ctx.request.getBytes(page.imageUrl, { headers: { ...headers, Referer: `${BASE_URL}/`, "User-Agent": USER_AGENT } });
  if (response.status >= 400) throw new Error(`MANGA Plus: image HTTP ${response.status}`);
  const bytes = await response.bytes();
  const key = hexToBytes(page.encryptionKey);
  if (key.length === 0) throw new Error("Invalid encryption key");
  // The CDN XORs every byte with a repeating key; applying it again restores the image.
  const plain = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) plain[i] = bytes[i] ^ key[i % key.length];
  return { url: await ctx.files.saveImage(plain, sniffExtension(plain)) };
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

const source = {
  async getListings() {
    return [
      { id: "Updates", name: "Updates", kind: "grid" },
      { id: "Ranking", name: "Ranking", kind: "list" },
    ];
  },

  async getMangaList(listing, page, ctx) {
    const id = listing?.id;
    if (id !== "Updates" && id !== "Ranking") throw new Error("Invalid listing");
    const titles = await cachedDirectory(`listing:${id}:${ctx.defaults.get("language", "en")}`, () => (id === "Updates" ? homeTitles(ctx) : rankingTitles(ctx)), page);
    return pageOf(titles, page);
  },

  async getSearchMangaList({ query, page }, ctx) {
    const text = (query ?? "").trim();

    // Direct lookups by pasted id.
    if (page === 1 && text.startsWith("id:")) {
      const result = await request(ctx, `${apiUrl(ctx)}/title_detailV3?title_id=${text.slice(3)}&clang=eng${authParams(ctx)}`);
      const title = result.titleDetail?.title;
      return { entries: title && allowedLanguage(ctx, title) ? [toManga(title)] : [], hasNextPage: false };
    }
    if (page === 1 && text.startsWith("chapter-id:")) {
      const result = await request(
        ctx,
        `${WEB_API}/manga_viewer_v3?chapter_id=${text.slice(11)}&split=no&img_quality=low&clang=eng`,
      );
      if (!result.viewer?.titleId) throw new Error("Chapter expired");
      const manga = await source.getMangaUpdate({ key: String(result.viewer.titleId) }, true, false, ctx).catch(() => null);
      return { entries: manga ? [manga] : [], hasNextPage: false };
    }

    const titles = await cachedDirectory(
      `search:${text}:${ctx.defaults.get("language", "en")}`,
      async () => {
        const result = await request(ctx, `${apiUrl(ctx)}/title_list/all_v3?type=serializing&lang=eng&clang=eng${authParams(ctx)}`);
        if (!result.allTitles) throw new Error("Failed to fetch title list");
        const all = (result.allTitles.entries ?? []).map((entry) => entry.title).filter((title) => allowedLanguage(ctx, title));
        if (!text) return all;
        const needle = text.toLowerCase();
        return all.filter(
          (title) => title.name.toLowerCase().includes(needle) || (title.author ?? "").toLowerCase().includes(needle),
        );
      },
      page,
    );
    return pageOf(titles, page);
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const result = await request(ctx, `${apiUrl(ctx)}/title_detailV3?title_id=${manga.key}&clang=eng${authParams(ctx)}`);
    const detail = result.titleDetail;
    if (!detail) throw new Error("Failed to fetch title details");
    const updated = { ...manga };

    if (needsChapters) {
      updated.chapters = chapterList(detail)
        // Free chapters without a subtitle have expired from the free window.
        .filter(({ chapter, locked }) => locked || chapter.subTitle)
        .map(({ chapter, locked }) => {
          const hash = String(chapter.name).indexOf("#");
          const number = hash === -1 ? NaN : parseFloat(String(chapter.name).slice(hash + 1));
          return {
            key: String(chapter.chapterId),
            title: stripChapterPrefix(chapter.subTitle || chapter.name),
            chapterNumber: Number.isNaN(number) ? undefined : number,
            dateUploaded: chapter.startTimeStamp,
            url: `${BASE_URL}/viewer/${chapter.chapterId}`,
            ...(locked ? { locked: true } : {}),
          };
        })
        .reverse();
    }

    if (needsDetails) {
      const completed = isCompleted(detail);
      const hiatus = String(detail.nonAppearanceInfo ?? "").toLowerCase().includes("on a hiatus");
      Object.assign(updated, toManga(detail.title), {
        description: `${detail.overview ?? ""}\n\n${completed ? "" : (detail.viewingPeriodDescription ?? "")}`.trim(),
        url: `${BASE_URL}/titles/${detail.title.titleId}`,
        status: completed ? "completed" : hiatus ? "hiatus" : "ongoing",
        contentRating: "safe",
        viewer: "rtl",
      });
    }
    return updated;
  },

  async getPageList(manga, chapter, ctx) {
    const split = ctx.defaults.get("split", false) === true ? "yes" : "no";
    const quality = String(ctx.defaults.get("imgQuality", "super_high") || "super_high");
    const result = await request(
      ctx,
      `${apiUrl(ctx)}/manga_viewer_v3?chapter_id=${chapter.key}&split=${split}&img_quality=${quality}&clang=eng${authParams(ctx)}`,
    );
    if (!result.viewer) throw new Error("Failed to fetch manga viewer");

    const pages = (result.viewer.pages ?? []).map((item) => item.page).filter((page) => page?.imageUrl);
    return mapLimit(pages, IMAGE_CONCURRENCY, (page) => decryptPage(ctx, page, result.viewer.viewToken));
  },

  async getHome(ctx) {
    const [updates, ranking] = await Promise.all([homeTitles(ctx), rankingTitles(ctx)]);
    return {
      components: [
        {
          kind: "scroller",
          title: "Daily Updates",
          entries: updates.map(toManga),
          listing: { id: "Updates", name: "Updates" },
        },
        {
          kind: "mangaGrid",
          title: "Hottest",
          entries: ranking.slice(0, 50).map(toManga),
          ranking: true,
          pageSize: 10,
          listing: { id: "Ranking", name: "Hottest" },
        },
      ],
    };
  },
};

module.exports = { source };
