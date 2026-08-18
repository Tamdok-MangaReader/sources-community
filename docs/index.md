# Tamdok Sources Documentation

Guides for writing JavaScript sources for the Tamdok app.

## What is a Tamdok source?

A source is a `.tamdok` ZIP package with a manifest (`source.json`) and a script (`index.js`). The app loads the script and calls methods on the `source` module for search, home, manga details, and chapter pages.

The format is similar to [Aidoku](https://github.com/Aidoku-Community/sources), but code is written in JavaScript instead of Rust/WASM.

## Where to start

1. [Getting started](getting-started.md) - folder layout, first source, debugging.
2. [API reference](api-reference.md) - all methods, data types, `ctx` context.
3. [Home layout](home-layout.md) - scroller, grid, big scroller, chapter lists.
4. [Filters and settings](filters-and-settings.md) - search, `filters.json`, settings.
5. [Publishing](publishing.md) - build, registry, versioning.

## Examples in this repo

| Folder | Description |
|--------|-------------|
| `sources/template/` | Minimal scaffold (search, detail, reader) |
| `sources/en.asurascans/` | Full example: home, listings, filters, settings, API fallback |

## Comparison with Aidoku

| Feature | Tamdok JS | Aidoku WASM |
|---------|-----------|-------------|
| Language | JavaScript | Rust |
| HTTP | `ctx.request.get/post/fetch` | Full net API in WASM |
| Home | `getHome()` returns JSON layout | `get_home` + partial results |
| Filters | `getFilters()` or `filters.json` | `filters.json` or dynamic |
| ZIP/CBZ pages | `{ zipUrl, zipEntry? }` in `getPageList` | `PageContent::Zip` |
| Canvas / WebView JS | Not available | Available in WASM host |

Tamdok JS works well for sites you can parse with HTTP and HTML (or JSON APIs).

## Conventions

- `info.id` must be unique (use a `.tamdok` suffix, e.g. `en.asurascans.tamdok`).
- Manga and chapter `key` values must be stable across calls.
- Pages are numbered from **1** (`page: 1` is the first page).
- Fill in `status`, `contentRating`, `viewer`, authors, and tags in `getMangaUpdate` when the site provides them.
- Do not block the UI: return partial data and set `hasNextPage` correctly.

## Help

Issues and pull requests: [tamdok-sources](https://github.com/Tamdok-MangaReader/tamdok-sources).

Tamdok app: [Tamdok](https://github.com/Tamdok-MangaReader/Tamdok).
