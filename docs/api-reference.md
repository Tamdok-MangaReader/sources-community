# API reference

The source module is exported as `module.exports = { source }`. All methods are async. The second argument is always `ctx` (Tamdok context).

## Context (ctx)

```javascript
{
  sourceId: "en.example.tamdok",
  request: { get, post, fetch },
  defaults: { get, set }
}
```

### ctx.defaults

```javascript
const value = ctx.defaults.get("apiDomain", "https://api.example.com");
await ctx.defaults.set("token", "abc");
```

Values come from source settings in the app (see [filters-and-settings.md](filters-and-settings.md)).

---

## Core methods (minimal source)

A usable source needs these three methods.

### getSearchMangaList(params, ctx)

Search and browse.

**params:**

```javascript
{
  query: "naruto",     // string, may be empty
  page: 1,             // page number, starts at 1
  filters: [ ... ]     // FilterValue array, see filters-and-settings.md
}
```

**returns:**

```javascript
{
  entries: [ { key, title, cover?, url? }, ... ],
  hasNextPage: true
}
```

### getMangaUpdate(manga, needsDetails, needsChapters, ctx)

Series details and chapter list.

| Flag | Fill in |
|------|---------|
| `needsDetails` | title, cover, description, authors, artists, tags, status, contentRating, viewer |
| `needsChapters` | `manga.chapters` |

**manga.chapters[]:**

```javascript
{
  key: "42",              // stable chapter id
  title: "Chapter 42",
  chapterNumber: 42,
  volumeNumber: 1,
  dateUploaded: 1700000000,  // unix seconds
  scanlators: ["Group"],
  url: "https://...",
  language: "en",
  thumbnail: "https://...",
  locked: false
}
```

**status:** `ongoing` | `completed` | `hiatus` | `cancelled` | `unknown`

**contentRating:** `safe` | `suggestive` | `nsfw`

**viewer:** `default` | `ltr` | `rtl` | `webtoon` | `vertical`

Descriptions may use `\n\n` blocks. The app can extract ratings (`★ 4.5`) and alt titles for libgroup-style sources.

### getPageList(manga, chapter, ctx)

Pages for the reader.

**returns:** array of `Page`:

```javascript
// Image URL
{ url: "https://cdn.example/page.jpg", thumbnail?: "..." }

// Text page
{ text: "..." }

// ZIP/CBZ (app unpacks the archive)
{ zipUrl: "https://.../chapter.zip", zipEntry?: "optional/path/filter" }
```

---

## Optional methods

### getHome(ctx)

Custom home screen. Returns `{ components: HomeComponent[] }`. See [home-layout.md](home-layout.md).

### getListings(ctx)

Dynamic browse tabs. If omitted, `listings` from `source.json` is used.

```javascript
[
  { id: "popular", name: "Popular", kind: "grid" },
  { id: "latest", name: "Latest", kind: "list" }
]
```

`kind`: `grid` or `list`.

### getMangaList(listing, page, ctx)

Paginated listing for a browse tab. Same return shape as `getSearchMangaList`.

### getFilters(ctx)

Dynamic search filters. Alternative to `filters.json`. See [filters-and-settings.md](filters-and-settings.md).

---

## Manga type (minimal vs full)

Minimum for lists:

```javascript
{ key: "series-slug", title: "Title", cover: "https://..." }
```

Full object after `getMangaUpdate`:

```javascript
{
  key: "series-slug",
  title: "Title",
  cover: "https://...",
  url: "https://...",
  description: "Synopsis...",
  authors: ["Author"],
  artists: ["Artist"],
  tags: ["Action", "Fantasy"],
  status: "ongoing",
  contentRating: "safe",
  viewer: "webtoon",
  chapters: [ ... ]
}
```

`key` must be consistent across search, home, listings, and detail.

---

## Normalization

The app expects camelCase (`chapterNumber`). If you return snake_case (`chapter_number`), the Tamdok runtime normalizes chapter fields.

---

## Call order in the app

1. **Sources / Home** - `getListings`, `getHome`, sometimes `getMangaList` for empty sections
2. **Search** - `getFilters`, `getSearchMangaList`
3. **Listing tab** - `getMangaList`
4. **Manga detail** - `getMangaUpdate(manga, true, true)`
5. **Reader** - `getPageList`

Home may also call `getMangaUpdate(manga, true, false)` to enrich big scroller cards (authors, tags, description).

---

## Errors

Throw `Error` with a clear message; it is shown to the user. For empty results, return `{ entries: [], hasNextPage: false }` instead of throwing.

---

## Example flow (Asura Scans)

See [sources/en.asurascans/index.js](../sources/en.asurascans/index.js):

- `getHome` parses Trending and Latest Updates HTML sections
- `getFilters` + `getSearchMangaList` build browse URLs
- `getMangaUpdate` uses the chapters API with HTML fallback
- `getPageList` tries the pages REST API, then Astro props
