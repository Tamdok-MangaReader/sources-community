# Publishing and registry

## Local build

```bash
npm install
node scripts/build.mjs
```

The script:

1. Scans `sources/*` (except `template/`)
2. Writes `public/sources/<id>-v<version>.tamdok`
3. Copies icons to `public/icons/`
4. Writes `public/index.min.json` with registry metadata from `static/registry.json`

### Registry metadata

Create `static/registry.json`:

```json
{
  "name": "Tamdok Community"
}
```

Optional registry icon: place `static/registry-icon.png` (or set `"icon": "my-icon.png"` in `registry.json`). The build copies it to `public/icons/registry.png` and sets `iconURL` in `index.min.json`.

### Package contents

| ZIP path | Source file |
|----------|-------------|
| `Payload/source.json` | `source.json` |
| `Payload/index.js` | `index.js` |
| `Payload/icon.png` | `icon.png` (if present) |
| `Payload/filters.json` | `filters.json` (if present) |
| `Payload/settings.json` | `settings` array in source.json |

## Testing in Tamdok

### Import a file

1. Settings > Sources > Import
2. Pick `.tamdok` from `public/sources/`

### Registry URL

Add this URL in Tamdok settings (after GitHub Pages deploy):

```
https://tamdok-mangareader.github.io/sources-community/index.min.json
```

Or open the one-click page (redirects into Tamdok → Settings → Sources):

```
https://tamdok-mangareader.github.io/sources-community/open.html
```

Deep link format used by `open.html`:

```
tamdok://settings/sources?registry=<url-encoded-registry-url>
```

### Sync from the Tamdok app repo

If you have both repos cloned:

```bash
# in the Tamdok repo
pnpm run sync:sources
```

## Versioning

- `info.version` in `source.json` is an integer.
- Bump it whenever parsing changes so users get an update.
- Filename pattern: `{id}-v{version}.tamdok`

For breaking changes (e.g. manga `key` format), document in the PR and migrate keys in `getMangaUpdate` when possible.

## GitHub Pages

Workflow `.github/workflows/build.yaml` builds sources on push to `main` and publishes `public/`.

After merge:

1. Check Actions
2. Open the Pages URL
3. Confirm `index.min.json` lists your source

## index.min.json format

```json
{
  "name": "Tamdok Community",
  "iconURL": "icons/registry.png",
  "sources": [
    {
      "id": "en.asurascans.tamdok",
      "name": "Asura Scans",
      "version": 3,
      "iconURL": "icons/en.asurascans.tamdok-v3.png",
      "downloadURL": "sources/en.asurascans.tamdok-v3.tamdok",
      "languages": ["en"],
      "contentRating": 0,
      "baseURL": "https://asurascans.com",
      "minAppVersion": "0.1.0",
      "maxAppVersion": "1.0.0"
    }
  ]
}
```

`baseURL` comes from `info.url` in `source.json`. Registry `name` and `iconURL` come from `static/registry.json` and `static/registry-icon.png` at build time.

## Pull request checklist

- [ ] Unique `info.id`
- [ ] `version` bumped if the source was already in the registry
- [ ] 128x128 PNG icon when possible
- [ ] Search, detail, chapters, and reader tested on the live site
- [ ] No hardcoded personal tokens
- [ ] `contentRating` matches site content
- [ ] Short PR description: site name and what you tested

## NSFW

Set `"contentRating": 1` or `2` in `source.json`. Users can hide NSFW sources in Tamdok settings.

## minAppVersion

If the source relies on newer app APIs (e.g. home `filters`), set the minimum Tamdok version that supports them.

## Ethics

- Respect robots.txt and site terms of service.
- Do not bypass paywalls without permission.
- Respect rate limits; avoid hundreds of parallel requests from a single method.
