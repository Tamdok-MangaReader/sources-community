"use strict";
// MangaFire (mangafire.to). Ported from the Aidoku multi.mangafire source.
//
// The site exposes a JSON API under /api. Every request carries a `vrf` query
// parameter: a signature of the canonical request path computed by three chained
// substitution-table passes (see sign() below). Without it the API answers 4xx.

const BASE_URL = "https://mangafire.to";
const ALL_LANGUAGES = ["en", "es", "es-la", "fr", "ja", "pt", "pt-br"];

// ---------------------------------------------------------------------------
// VRF signing. Tables/keys are the site's own constants (reverse-engineered
// upstream in the Tachiyomi "mangafire" extension and reused by Aidoku).
// ---------------------------------------------------------------------------

const VRF_STAGES = [
  {
    table:
      "yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/Lmo33vUyjUE40kUoEWIr/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKGFvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISBeXY3BgANR+yVnjGbcxZ47d6kLNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMaxuouOwdxbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ0ywcK/u6RXhrbcCm4t2eCtrDgQVecJGkQ+A==",
    key: "0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA=",
    iv: 0x5a,
  },
  {
    table:
      "IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9VOhOaY0rAFdUxlDnl5BLNvwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41TezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90zpmQ7Byu483WsQqUE0C342HL+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD45UnifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7mL5IKQ1vXo/MOOvq1I1d8ar9X6Ttu5KF4fZgiA==",
    key: "AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ==",
    iv: 0x35,
  },
  {
    table:
      "NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybMHbBckT5Ton85E0FOeHezbh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMNhzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUlDb5vLcH6RWKxkIEMuP0bDwIqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDjNFeNl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWGCa6KtSzTCCG58n68nTyj2T3Sshk7utqCtMi/ZQ==",
    key: "DELOJgPsVaCcblDtTGMdHzM=",
    iv: 0xba,
  },
];

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Hermes may lack atob/Buffer, so base64 is implemented by hand.
function base64Decode(text) {
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    if (char === "=") break;
    buffer = (buffer << 6) | B64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}

function base64UrlEncode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(chunk >> 18) & 63] + B64[(chunk >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(chunk >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[chunk & 63];
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_");
}

function utf8Bytes(text) {
  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return bytes;
}

const VRF_DECODED = VRF_STAGES.map((stage) => ({
  table: base64Decode(stage.table),
  key: base64Decode(stage.key),
  iv: stage.iv,
}));

// One stage: each output byte is table[input ^ key[i] ^ previousOutput], a CBC-like chain.
function encryptStage(data, { table, key, iv }) {
  const out = [];
  let previous = iv;
  for (let i = 0; i < data.length; i += 1) {
    previous = table[data[i] ^ key[i % key.length] ^ previous];
    out.push(previous);
  }
  return out;
}

function sign(canonicalPath) {
  let data = utf8Bytes(canonicalPath);
  for (const stage of VRF_DECODED) data = encryptStage(data, stage);
  return base64UrlEncode(data);
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

// `params` is a list of [key, value]. Keys ending in "[]" are array parameters.
// The signature covers a canonical form (sorted by key, "[]" turned into "[0]", "[1]"...),
// while the sent URL keeps the original keys, percent-encoded.
function buildApiUrl(path, params) {
  const sorted = [...params].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  let canonical = path;
  if (sorted.length > 0) {
    let lastKey = "";
    let index = 0;
    canonical += "?";
    canonical += sorted
      .map(([key, value]) => {
        if (key.endsWith("[]")) {
          if (lastKey !== key) index = 0;
          lastKey = key;
          const name = `${key.slice(0, -2)}[${index}]`;
          index += 1;
          return `${name}=${value}`;
        }
        return `${key}=${value}`;
      })
      .join("&");
  }

  const query = sorted.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  query.push(`vrf=${sign(canonical)}`);
  return `${BASE_URL}/api${path}?${query.join("&")}`;
}

async function api(ctx, path, params = [], referer = `${BASE_URL}/`) {
  const response = await ctx.request.get(buildApiUrl(path, params), {
    headers: { Accept: "application/json", Referer: referer },
  });
  if (response.status >= 400) throw new Error(`MangaFire: HTTP ${response.status}`);
  return response.json();
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const posterUrl = (poster) => poster?.large || poster?.medium || poster?.small || undefined;

const toManga = (item) => ({ key: item.hid, title: item.title, cover: posterUrl(item.poster) });

const titles = (entities) => (entities ?? []).map((entity) => entity.title);

function htmlToText(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim();
}

const STATUS = { releasing: "ongoing", finished: "completed", on_hiatus: "hiatus", discontinued: "cancelled" };

// The author/artist search fields need numeric tag ids, so resolve the typed name first.
async function findTagId(ctx, keyword, tagType) {
  const response = await api(ctx, "/tags", [["keyword", keyword]], `${BASE_URL}/browse`);
  const tags = response.data ?? [];
  const match =
    tags.find((tag) => tag.type === tagType && String(tag.name).toLowerCase() === keyword.toLowerCase()) ??
    tags.find((tag) => tag.type === tagType);
  return match ? String(match.id) : null;
}

// Sort filter index -> [param, direction]; order matches filters.json.
const SORTS = [
  ["order[relevance]", "desc"],
  ["order[chapter_updated_at]", "desc"],
  ["order[created_at]", "desc"],
  ["order[title]", "asc"],
  ["order[title]", "desc"],
  ["order[year]", "desc"],
  ["order[year]", "asc"],
  ["order[score]", "desc"],
  ["order[views_7d]", "desc"],
  ["order[views_30d]", "desc"],
  ["order[views_total]", "desc"],
  ["order[follows_total]", "desc"],
];

function chapterLanguages(ctx) {
  const language = String(ctx.defaults.get("language", "en") || "en");
  return language === "all" ? ALL_LANGUAGES : [language];
}

const source = {
  async getListings() {
    return [
      { id: "trending", name: "Trending", kind: "grid" },
      { id: "latest", name: "Latest updates", kind: "grid" },
    ];
  },

  async getMangaList(listing, page, ctx) {
    if (listing?.id === "trending") {
      if (page > 1) return { entries: [], hasNextPage: false };
      const data = await api(ctx, "/top-titles", [["type", "trending"], ["days", "1"], ["limit", "50"]]);
      return { entries: (data.items ?? []).map(toManga), hasNextPage: false };
    }
    return source.getSearchMangaList(
      { query: "", page, filters: [{ type: "sort", id: "sort", index: 1, ascending: false }] },
      ctx,
    );
  },

  async getSearchMangaList({ query, page, filters }, ctx) {
    const params = [];

    for (const filter of filters ?? []) {
      switch (filter.type) {
        case "text": {
          if (!filter.value) break;
          if (filter.id === "author" || filter.id === "artist") {
            const tag = await findTagId(ctx, filter.value, filter.id);
            if (tag) params.push([filter.id === "author" ? "authors[]" : "artists[]", tag]);
          } else if (filter.id === "minchap") {
            params.push(["min_chap", filter.value]);
          }
          break;
        }
        case "sort": {
          const sort = SORTS[filter.index];
          if (sort) params.push(sort);
          break;
        }
        case "multiSelect": {
          if (filter.id === "genres") {
            for (const option of filter.included ?? []) params.push(["genres_in[]", option]);
            for (const option of filter.excluded ?? []) params.push(["genres_ex[]", option]);
          } else {
            for (const option of filter.included ?? []) params.push([filter.id, option]);
          }
          break;
        }
        case "select":
          if (filter.value) params.push([filter.id, filter.value]);
          break;
        case "range":
          if (filter.from) params.push(["year_from", String(filter.from)]);
          if (filter.to) params.push(["year_to", String(filter.to)]);
          break;
        default:
          break;
      }
    }

    if (query) params.push(["keyword", query]);
    params.push(["page", String(page)]);
    params.push(["limit", "50"]);

    const data = await api(ctx, "/titles", params);
    return { entries: (data.items ?? []).map(toManga), hasNextPage: Boolean(data.meta?.hasNext) };
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const result = { ...manga };

    if (needsDetails) {
      const { data: details } = await api(ctx, `/titles/${manga.key}`);
      result.title = details.title;
      result.cover = posterUrl(details.poster);
      result.authors = titles(details.authors);
      result.artists = titles(details.artists);
      result.description = htmlToText(details.synopsisHtml) || undefined;
      result.url = `${BASE_URL}/title/${manga.key}`;
      result.tags = [...titles(details.genres), ...titles(details.themes)];
      result.status = STATUS[details.status] ?? "unknown";
      result.contentRating = result.tags.some((tag) => ["Adult", "Mature", "Smut"].includes(tag))
        ? "nsfw"
        : result.tags.includes("Ecchi")
          ? "suggestive"
          : "safe";
      result.viewer = ["manhua", "manhwa"].includes(details.type) ? "webtoon" : "rtl";
    }

    if (needsChapters) {
      const languages = chapterLanguages(ctx);
      const chapters = [];
      for (const language of languages) {
        for (let page = 1; ; page += 1) {
          const data = await api(ctx, `/titles/${manga.key}/chapters`, [
            ["language", language],
            ["sort", "number"],
            ["order", "desc"],
            ["page", String(page)],
            ["limit", "200"],
          ]);
          for (const chapter of data.items ?? []) {
            chapters.push({
              key: String(chapter.id),
              title: chapter.name || undefined,
              chapterNumber: chapter.number,
              dateUploaded: chapter.createdAt,
              scanlators: chapter.type === "official" ? ["Official"] : undefined,
              url: `${BASE_URL}/title/${manga.key}/chapter/${chapter.id}`,
              language,
            });
          }
          if (!data.meta?.hasNext) break;
        }
      }
      // Interleave languages by chapter number (stable, so equal numbers keep language order).
      if (languages.length > 1) {
        chapters.sort((a, b) => Math.trunc(b.chapterNumber ?? 0) - Math.trunc(a.chapterNumber ?? 0));
      }
      result.chapters = chapters;
    }

    return result;
  },

  async getPageList(manga, chapter, ctx) {
    const data = await api(ctx, `/chapters/${chapter.key}`);
    // The image CDN rejects requests without the site Referer (HTTP 403).
    return (data.data?.pages ?? []).map((page) => ({ url: page.url, headers: { Referer: `${BASE_URL}/` } }));
  },

  async getHome(ctx) {
    // Sequential on purpose: parallel signed requests to the API trip its rate limit on a cold start.
    // Each call is retried once, and a failing section is dropped instead of blanking the whole home.
    const load = async (path, params) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await api(ctx, path, params);
        } catch (error) {
          if (attempt === 1) return { items: [], error };
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
    };
    const trending = await load("/top-titles", [["type", "trending"], ["days", "1"], ["limit", "30"]]);
    const latest = await load("/titles", [["order[chapter_updated_at]", "desc"], ["hot", "1"], ["page", "1"], ["limit", "30"]]);
    if (trending.error && latest.error) throw trending.error;
    return {
      components: [
        {
          kind: "scroller",
          title: "Trending",
          subtitle: "Trending Now",
          entries: (trending.items ?? []).map(toManga),
          listing: { id: "trending", name: "Trending" },
        },
        {
          kind: "mangaChapterList",
          title: "Latest Updates",
          subtitle: "Fresh Chapters",
          entries: [],
          chapterEntries: (latest.items ?? []).map((item) => ({
            manga: toManga(item),
            chapter: {
              key: String(item.latestChapter ?? ""),
              chapterNumber: item.latestChapter,
              title: item.latestChapter != null ? `Chapter ${item.latestChapter}` : undefined,
            },
          })),
          listing: { id: "latest", name: "Latest updates" },
        },
      ],
    };
  },
};

module.exports = { source };
