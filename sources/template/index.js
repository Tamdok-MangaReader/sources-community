const BASE_URL = 'https://example.com';

function parseListing(html, baseUrl) {
  return html.querySelectorAll('a.series').map((link) => {
    const href = link.getAttribute('href');
    if (!href) return null;
    const url = new URL(href, baseUrl).toString();
    const key = url.split('/').pop() ?? url;
    return {
      key,
      title: link.text.trim() || key,
      cover: link.querySelector('img')?.getAttribute('src') ?? undefined,
      url,
    };
  }).filter(Boolean);
}

const source = {
  async getSearchMangaList({ query, page }, ctx) {
    const url = new URL('/search', BASE_URL);
    url.searchParams.set('page', String(page));
    if (query) url.searchParams.set('q', query);
    const response = await ctx.request.get(url.toString());
    const html = response.html();
    const entries = parseListing(html, response.url);
    return { entries, hasNextPage: entries.length > 0 };
  },

  async getMangaUpdate(manga, needsDetails, needsChapters, ctx) {
    const response = await ctx.request.get(manga.url ?? `${BASE_URL}/series/${manga.key}`);
    const html = response.html();
    const updated = { ...manga, url: response.url };
    if (needsDetails) {
      updated.title = html.querySelector('h1')?.text.trim() ?? manga.title;
      updated.description = html.querySelector('.description')?.text.trim();
      updated.cover = html.querySelector('img.cover')?.getAttribute('src') ?? manga.cover;
    }
    if (needsChapters) {
      updated.chapters = html.querySelectorAll('a.chapter').map((link, index) => {
        const href = link.getAttribute('href');
        const key = href?.split('/').pop() ?? String(index + 1);
        return {
          key,
          title: link.text.trim() || `Chapter ${key}`,
          chapterNumber: Number(key) || index + 1,
          url: href ? new URL(href, response.url).toString() : undefined,
        };
      });
    }
    return updated;
  },

  async getPageList(manga, chapter, ctx) {
    const response = await ctx.request.get(chapter.url ?? `${BASE_URL}/series/${manga.key}/${chapter.key}`);
    const html = response.html();
    return html.querySelectorAll('img.page').map((img) => ({
      url: img.getAttribute('src') ?? undefined,
    })).filter((page) => page.url);
  },
};

module.exports = { source };
