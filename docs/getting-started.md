# Getting started

## 1. Create a source folder

```bash
cp -R sources/template sources/en.mysite.tamdok
```

Layout:

```
sources/en.mysite.tamdok/
  source.json    # Manifest
  index.js       # Source logic
  icon.png       # Optional, 128x128
  filters.json   # Optional
```

The `template/` folder is not included in builds.

## 2. Fill in source.json

```json
{
  "info": {
    "id": "en.mysite.tamdok",
    "name": "My Site",
    "version": 1,
    "url": "https://example.com",
    "contentRating": 0,
    "languages": ["en"],
    "minAppVersion": "0.1.0"
  },
  "listings": [
    { "id": "popular", "name": "Popular", "kind": "grid" }
  ]
}
```

`info` fields:

| Field | Description |
|-------|-------------|
| `id` | Unique identifier |
| `name` | Display name in the app |
| `version` | Integer; bump when you change parsing |
| `url` | Site base URL |
| `languages` | Language codes (`en`, `ru`, ...) |
| `contentRating` | `0` safe, `1` suggestive, `2` nsfw |
| `minAppVersion` | Minimum Tamdok version |

## 3. Export module.exports

```javascript
"use strict";

const BASE_URL = "https://example.com";

const source = {
  async getSearchMangaList({ query, page, filters }, ctx) {
    // ...
    return { entries: [], hasNextPage: false };
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    // ...
    return manga;
  },

  async getPageList(manga, chapter, ctx) {
    // ...
    return [{ url: "https://..." }];
  },
};

module.exports = { source };
```

## 4. HTTP and HTML

```javascript
const response = await ctx.request.get(url);
const html = response.html();

const title = html.querySelector("h1")?.text.trim();
const links = html.querySelectorAll("a.item");
```

`ctx.request` methods:

| Method | Purpose |
|--------|---------|
| `get(url, init?)` | GET request |
| `post(url, init?)` | POST request |
| `fetch(url, init?)` | Any method via `init.method` |

Response shape:

```javascript
{
  status: 200,
  url: "https://...",      // final URL after redirects
  text: async () => "...",
  json: async () => ({ ... }),
  html: () => HTMLElement  // node-html-parser
}
```

The app adds headers (User-Agent, Referer) automatically.

## 5. User settings

In `source.json`:

```json
{
  "settings": [
    {
      "type": "switch",
      "id": "showLocked",
      "title": "Show locked chapters",
      "default": true
    }
  ]
}
```

In code:

```javascript
const showLocked = ctx.defaults.get("showLocked", true);
```

Setting types: `switch`, `select`, `text`, `link`.

## 6. Build and install

```bash
npm install
node scripts/build.mjs
```

Output: `public/sources/en.mysite.tamdok-v1.tamdok`

In Tamdok: Settings > Sources > Import, or add the registry from [publishing.md](publishing.md).

## 7. Debugging

- Start from `template` and add one method at a time.
- Compare with [en.asurascans/index.js](../sources/en.asurascans/index.js).
- Test search, manga detail, chapter list, and reader.
- On errors, check the in-app message and Metro logs.

## Next steps

- [api-reference.md](api-reference.md) - all methods and types
- [home-layout.md](home-layout.md) - custom home screen
- [filters-and-settings.md](filters-and-settings.md) - search filters
