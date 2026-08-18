# Tamdok Community Sources

JavaScript sources for [Tamdok](https://github.com/Tamdok-MangaReader/Tamdok). Same idea as [Aidoku Community Sources](https://github.com/Aidoku-Community/sources), but sources run as plain JavaScript and ship as `.tamdok` packages.

Tamdok also supports Aidoku `.aix` (Rust/WASM) sources from the Aidoku registry.

## Quick start

1. Copy `sources/template/` to `sources/<your-source-id>/`.
2. Edit `source.json` and `index.js`.
3. Run `npm install` and `node scripts/build.mjs`.
4. Import the built `.tamdok` from `public/sources/` or publish to GitHub Pages.

See [docs/index.md](docs/index.md) for full documentation.

## Repository layout

```
sources/
  en.asurascans/       Reference source (Asura Scans)
  template/            Starter template (not built)
scripts/
  build.mjs            Builds .tamdok packages and index.min.json
static/
  open.html            GitHub Pages redirect to open Tamdok
public/
  index.min.json       Registry for the app
  sources/             Built packages
  icons/               Icons for the registry
docs/                  Author documentation
```

## Documentation

| Guide | Description |
|-------|-------------|
| [docs/index.md](docs/index.md) | Overview and links |
| [docs/getting-started.md](docs/getting-started.md) | Create your first source |
| [docs/api-reference.md](docs/api-reference.md) | Source module API |
| [docs/home-layout.md](docs/home-layout.md) | Home screen components |
| [docs/filters-and-settings.md](docs/filters-and-settings.md) | Search filters and user settings |
| [docs/publishing.md](docs/publishing.md) | Build, test, and publish |

## Package format (`.tamdok`)

ZIP archive (Aidoku-compatible layout):

| Path | Required |
|------|----------|
| `Payload/source.json` | Yes |
| `Payload/index.js` | Yes |
| `Payload/icon.png` | No |
| `Payload/filters.json` | No |
| `Payload/settings.json` | No (generated from `settings` in source.json) |

## Minimal source API

```javascript
const source = {
  async getSearchMangaList({ query, page, filters }, ctx) { /* ... */ },
  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) { /* ... */ },
  async getPageList(manga, chapter, ctx) { /* ... */ },
};
module.exports = { source };
```

Optional: `getHome`, `getListings`, `getMangaList`, `getFilters`.

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

<p align="center">
  <a href="https://tamdok-mangareader.github.io/sources-community/open.html">
    <img src="https://img.shields.io/badge/Open%20in%20Tamdok-Add%20registry-0A84FF?style=for-the-badge" alt="Open in Tamdok" />
  </a>
</p>

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


Or import a `.tamdok` file from Settings → Sources.

## Contributing

1. Fork the repo and add a folder under `sources/`.
2. Use a unique `info.id` in `source.json` (for example `en.example.tamdok`).
3. Bump `info.version` when you change parsing logic.
4. Open a pull request with a short description of the site and what you tested.
