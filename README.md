# Tamdok Community Sources

JavaScript sources for [Tamdok](https://github.com/Tamdok-MangaReader/Tamdok). Same idea as [Aidoku Community Sources](https://github.com/Aidoku-Community/sources), but sources run as plain JavaScript and ship as `.tamdok` packages.

Tamdok also supports Aidoku `.aix` (Rust/WASM) sources from the Aidoku registry.

## Quick start

1. Copy `sources/template/` to `sources/<your-source-id>/`.
2. Edit `source.json` and `index.js`.
3. Run `npm install` and `node scripts/build.mjs`.
4. Import the built `.tamdok` from `public/sources/` or publish to GitHub Pages.

See [docs](https://github.com/Tamdok-MangaReader/sources-community/wiki) for full documentation.

## Repository layout

```
sources/
  en.asurascans/       Reference source (Asura Scans)
  en.readcomicsonline/ Western comics (right-to-left by default)
  multi.mangaplus/     MANGA Plus: protobuf API + encrypted images (needs getBytes / files.saveImage)
  multi.mangafire/     MangaFire with VRF request signing
  multi.webtoon/       WEBTOON, ko.naverwebtoon/ for Naver
  ru.mangalib/         Templated source (source.json only, uses templates/libgroup)
  template/            Starter source (not built)
templates/
  libgroup/            Shared engine for sites on the same platform
scripts/
  build.mjs            Builds .tamdok packages and index.min.json
  emit.mjs             Writes a composed source to .build/ for testing
  lib/compose.mjs      Expands templated sources
static/
  open.html            GitHub Pages redirect to open Tamdok
public/
  index.min.json       Registry for the app
  sources/             Built packages
  icons/               Icons for the registry
```

## Templates

Sites on a common engine share code from `templates/<name>/`. A templated source is just a `source.json` with `"template"` and `"config"`; the build inlines the template into a normal package. See [Templates](https://github.com/Tamdok-MangaReader/sources-community/wiki/Templates). Bump the version of every dependent source when a template changes.

## Documentation

See the [wiki](https://github.com/Tamdok-MangaReader/sources-community/wiki)

## Package format (`.tamdok`)

ZIP archive (Aidoku-compatible layout):

| Path                    | Required                                      |
| ----------------------- | --------------------------------------------- |
| `Payload/source.json`   | Yes                                           |
| `Payload/index.js`      | Yes                                           |
| `Payload/icon.png`      | No                                            |
| `Payload/filters.json`  | No                                            |
| `Payload/settings.json` | No (generated from `settings` in source.json) |

## Minimal source API

```javascript
const source = {
  async getSearchMangaList({ query, page, filters }, ctx) {
    /* ... */
  },
  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    /* ... */
  },
  async getPageList(manga, chapter, ctx) {
    /* ... */
  },
};
module.exports = { source };
```

Optional: `getHome`, `getListings`, `getMangaList`, `getFilters`.

Manifest `config` flags: `hidesFiltersWhileSearching`, `skipHomeEnrichment` (see [Home layout](https://github.com/Tamdok-MangaReader/sources-community/wiki/Home-layout)).

Context helpers: `ctx.request.{get,post,fetch,getBytes}`, `ctx.defaults`, `ctx.cookies` (a promise), `ctx.files.saveImage`. Binary helpers need Tamdok with binary support; set `minAppVersion` in `source.json` accordingly. Full reference in the [API wiki page](https://github.com/Tamdok-MangaReader/sources-community/wiki/API-reference).

Western comics should return `viewer: "rtl"` on each manga to open in right-to-left mode by default.

Reference implementation: [sources/en.asurascans/index.js](sources/en.asurascans/index.js).

## Build

```bash
npm install
node scripts/build.mjs
```

From the Tamdok app repo you can sync built packages:

```bash
pnpm run sync:sources
```

## Add sources in Tamdok

### Website

[https://tamdok-mangareader.github.io/sources-community](https://tamdok-mangareader.github.io/sources-community/)

### Manual

Tap the button on your iPhone to open Tamdok. The app opens **Settings → Sources** and asks you to confirm adding this registry.

GitHub does not allow `tamdok://` links in README markdown, so the button opens an HTTPS redirect page that launches the app.

Registry URL:

```
https://tamdok-mangareader.github.io/sources-community/index.min.json
```

Deep link (same action):

```
tamdok://settings/sources?registry=https%3A%2F%2Ftamdok-mangareader.github.io%2Fsources-community%2Findex.min.json
```

<p align="center">
  <a href="https://tamdok-mangareader.github.io/sources-community/open.html">
    <img src="https://img.shields.io/badge/Open%20in%20Tamdok-Add%20registry-0A84FF?style=for-the-badge" alt="Open in Tamdok" />
  </a>
</p>

Or import a `.tamdok` file from Settings → Sources.

## Contributing

1. Fork the repo and add a folder under `sources/`.
2. Use a unique `info.id` in `source.json` (for example `en.example.tamdok`).
3. Bump `info.version` when you change parsing logic.
4. Open a pull request with a short description of the site and what you tested.
