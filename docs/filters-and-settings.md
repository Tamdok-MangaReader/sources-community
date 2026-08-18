# Filters and settings

## Search filters

Filters define the search UI in Tamdok. Three options:

1. `filters.json` in the source folder (Aidoku format)
2. `getFilters(ctx)` in JavaScript
3. Combine both: JSON as base, JS for dynamic values

`build.mjs` packs `filters.json` into `.tamdok` when the file exists.

### filters.json (Aidoku format)

```json
[
  {
    "type": "sort",
    "id": "sort",
    "title": "Sort",
    "options": ["Latest", "Popular", "Rating"],
    "default": { "index": 0, "ascending": true }
  },
  {
    "type": "multi-select",
    "id": "genres",
    "title": "Genre",
    "options": ["Action", "Romance"],
    "ids": ["action", "romance"]
  },
  {
    "type": "select",
    "id": "status",
    "title": "Status",
    "options": ["Any", "Ongoing", "Completed"],
    "ids": ["", "ongoing", "completed"]
  },
  {
    "type": "text",
    "id": "author",
    "title": "Author"
  },
  {
    "type": "check",
    "id": "completed",
    "title": "Completed only",
    "default": false
  },
  {
    "type": "range",
    "id": "chapter",
    "title": "Chapters",
    "min": 0,
    "max": 500,
    "default": { "from": 0, "to": 100 }
  }
]
```

### getFilters(ctx) in JavaScript

```javascript
async getFilters(ctx) {
  return [
    {
      type: "sort",
      id: "sort",
      title: "Sort",
      options: ["Latest", "Popular"],
      default: 0,
      defaultAscending: true
    },
    {
      type: "multiSelect",
      id: "genres",
      title: "Genre",
      options: [
        { id: "action", label: "Action" },
        { id: "romance", label: "Romance" }
      ]
    }
  ];
}
```

### FilterValue in getSearchMangaList

The app passes selected values in `params.filters`:

```javascript
async getSearchMangaList({ query, page, filters }, ctx) {
  for (const filter of filters ?? []) {
    switch (filter.type) {
      case "sort":
        // filter.index, filter.ascending
        break;
      case "select":
        // filter.value
        break;
      case "multiSelect":
        // filter.included, filter.excluded, filter.matchAll
        break;
      case "text":
        // filter.value
        break;
      case "check":
        // filter.value (boolean)
        break;
      case "range":
        // filter.from, filter.to
        break;
    }
  }
}
```

### sort and ascending

For MangaDex and similar APIs, sort direction matters. The first sort option often needs `ascending: true` (Best Match / Relevance).

Example:

```javascript
{ type: "sort", id: "sort", index: 0, ascending: true }
```

### multiSelect and matchAll

- `matchAll: true` (AND): all selected tags
- `matchAll: false` (OR): any selected tag

For genres with repeated query params (Asura), check `filter.matchAll !== false`.

---

## Source settings

Define in `source.json`:

### Flat list

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

### Grouped settings (Aidoku-style)

Use `group` to split settings into separate cards in the app (like Aidoku sections):

```json
{
  "settings": [
    {
      "type": "group",
      "title": "URL",
      "items": [
        {
          "type": "text",
          "id": "serverUrl",
          "title": "Server URL",
          "default": "http://localhost:25600"
        }
      ]
    },
    {
      "type": "group",
      "title": "AUTH",
      "items": [
        {
          "type": "text",
          "id": "apiKey",
          "title": "API key",
          "default": ""
        }
      ]
    }
  ]
}
```

You can also insert explicit section headers in a flat array:

```json
{ "type": "section", "id": "auth", "title": "AUTH" }
```

See `sources/server.komga/` in the main Tamdok sources repo for a full example.

```json
{
  "settings": [
    {
      "type": "select",
      "id": "apiDomain",
      "title": "API domain",
      "options": [
        { "id": "primary", "label": "Primary" },
        { "id": "backup", "label": "Backup" }
      ],
      "default": "primary"
    },
    {
      "type": "text",
      "id": "token",
      "title": "API token",
      "default": ""
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

On build, settings are written to `Payload/settings.json`.

### Reading in code

```javascript
const showLocked = ctx.defaults.get("showLocked", true);
const domain = ctx.defaults.get("apiDomain", "primary");

if (!showLocked) {
  chapters = chapters.filter((ch) => !ch.locked);
}
```

### Supported UI types

| type | App UI |
|------|--------|
| group | Section card with nested fields |
| section | Section header in a flat settings list |
| switch | Toggle |
| select | Picker |
| text | Text field |
| link | Opens URL in browser |

Aidoku multi-select and editable-list settings have no dedicated UI yet, but defaults can be read in WASM sources. For Tamdok JS use switch/select/text/link.

---

## Listings in source.json

Static browse tabs:

```json
{
  "listings": [
    { "id": "popular", "name": "Popular", "kind": "grid" },
    { "id": "latest", "name": "Latest", "kind": "list" }
  ]
}
```

Implement `getMangaList(listing, page, ctx)` for each `id`. For dynamic tabs (e.g. after login), use `getListings(ctx)`.

---

## Home filters and search

Home sections with `kind: "filters"` pass the same `FilterValue` objects as search. Filter IDs must match `filters.json` / `getFilters`.

See [home-layout.md](home-layout.md).
