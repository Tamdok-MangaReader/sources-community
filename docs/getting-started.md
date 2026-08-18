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
| `url` | Site base URL (used for Referer and registry `baseURL`) |
| `urls` | Optional URL list when a source covers multiple domains; first entry is the base URL |
| `languages` | Language codes (`en`, `ru`, ...) |
| `contentRating` | `0` safe, `1` suggestive, `2` nsfw |
| `minAppVersion` | Minimum Tamdok version (registry metadata) |
| `maxAppVersion` | Optional upper bound if the source needs an older app build |

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

The app adds browser-like headers automatically:

- `User-Agent` (Safari on iPhone by default)
- `Referer` / `Origin` from `info.url` or the request URL
- `Accept` and `Accept-Language`

Pass custom headers via the second argument:

```javascript
await ctx.request.get(url, {
  headers: { Authorization: "Bearer " + token },
});
```

Custom headers override defaults with the same name.

## 5. User settings

In `source.json`:

```json
{
  "settings": [
    {
      "type": "group",
      "title": "Reader",
      "items": [
        {
          "type": "switch",
          "id": "showLocked",
          "title": "Show locked chapters",
          "subtitle": "Include chapters that require login",
          "default": true
        }
      ]
    },
    {
      "type": "text",
      "id": "apiToken",
      "title": "API token",
      "default": "",
      "secure": true
    },
    {
      "type": "link",
      "id": "login",
      "title": "Login on website",
      "url": "https://example.com/login"
    }
  ]
}
```

In code:

```javascript
const showLocked = ctx.defaults.get("showLocked", true);
const token = ctx.defaults.get("apiToken", "");
```

Supported setting types for Tamdok JS: `group`, `section`, `switch`, `select`, `text`, `link`.

See [filters-and-settings.md](filters-and-settings.md) for the full settings reference (including Aidoku WASM-only types).

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
