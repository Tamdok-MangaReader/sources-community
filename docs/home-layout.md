# Home layout

`getHome(ctx)` returns:

```javascript
{
  components: [
    { kind: "scroller", title: "Popular", entries: [ ... ] },
    // ...
  ]
}
```

If `getHome` is not implemented, the app builds home from `listings` and search.

## Section kinds

| kind | UI | Use for |
|------|-----|---------|
| `scroller` | Horizontal cover strip | Popular, trending |
| `bigScroller` | Large carousel banner | Hero slider, weekly top |
| `mangaGrid` | 3-column grid | Rankings, catalog |
| `mangaList` | Vertical text list | Compact lists |
| `mangaChapterList` | Cover + chapter label | Latest updates |
| `filters` | Quick filter chips | Genres on home (Aidoku Filters) |
| `links` | Link rows | Banners, external URLs (Aidoku Links) |

## scroller

```javascript
{
  kind: "scroller",
  title: "Trending Today",
  subtitle: "Optional",
  entries: [
    { key: "manga-id", title: "Title", cover: "https://..." }
  ],
  listing: { id: "popular", name: "See all" }  // optional "see all" tab
}
```

### Ratings in scroller (rated scroller)

Add `scrollerEntries` with a subtitle or put the rating in `description`:

```javascript
{
  kind: "scroller",
  entries: [ manga1, manga2 ],
  scrollerEntries: [
    { manga: manga1, homeCover: "https://.../cover.jpg", subtitle: "★★★★☆ 4.2" },
    { manga: manga2, subtitle: "★★★★★ 4.9" }
  ]
}
```

The app renders `MangaRatedScroller` with star ratings.

Use `homeCover` when `getMangaUpdate` enrichment might replace the cover with banner art. The scroller keeps `homeCover` even after detail data is loaded.

## bigScroller

```javascript
{
  kind: "bigScroller",
  title: "Featured",
  entries: [ /* full or partial Manga objects */ ],
  autoScrollInterval: 5   // seconds, optional, default 5
}
```

The app may call `getMangaUpdate` per entry to load authors, tags, and description for the card.

## mangaGrid

```javascript
{
  kind: "mangaGrid",
  title: "Top 100",
  entries: [ ... ],
  ranking: true,           // show #1, #2, ...
  pageSize: 9,             // optional limit
  listing: { id: "ranking", name: "Ranking" }
}
```

## mangaChapterList

Latest chapter list. Leave `entries` empty; use `chapterEntries`:

```javascript
{
  kind: "mangaChapterList",
  title: "Latest Updates",
  entries: [],
  chapterEntries: [
    {
      manga: { key: "id", title: "Title", cover: "https://..." },
      chapter: { key: "ch-12", chapterNumber: 12, title: "Chapter 12" }
    }
  ],
  listing: { id: "latest", name: "All updates" }
}
```

## filters

Quick filters on home (like Aidoku MangaBox):

```javascript
{
  kind: "filters",
  title: "Genres",
  entries: [],
  filterItems: [
    {
      title: "Action",
      filters: [
        { type: "multiSelect", id: "genres", included: ["action"], excluded: [] }
      ]
    },
    {
      title: "Romance",
      filters: [
        { type: "multiSelect", id: "genres", included: ["romance"], excluded: [] }
      ]
    }
  ]
}
```

Tapping opens search with those filters applied.

## links

```javascript
{
  kind: "links",
  title: "Links",
  entries: [],
  links: [
    {
      title: "Discord",
      subtitle: "Community",
      url: "https://discord.gg/..."
    },
    {
      title: "Open manga",
      manga: { key: "id", title: "Title", cover: "https://..." }
    },
    {
      title: "Browse",
      listing: { id: "popular", name: "Popular" }
    }
  ]
}
```

## App fallbacks

If a scroller/grid section has a `listing` but no `entries`, the app calls `getMangaList(listing, 1)`.

If `getHome` returns no components, the app tries listings and search with an empty query.

## Aidoku MangaList

In Aidoku WASM, `MangaList` maps to `mangaGrid`. In Tamdok JS, return `mangaGrid` directly.

## ImageScroller

In Aidoku this is a banner strip. In Tamdok JS use `scroller` + `scrollerEntries`, or `links`.

## Tips

- Do not block home: return at least one section with data.
- For heavy sites, start with one scroller and add sections later.
- A `listing` on a section opens that browse tab in the same source.
