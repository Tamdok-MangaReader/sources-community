(() => {
  const REGISTRIES = [
    {
      id: "official",
      name: "Official",
      shareUrl: "https://tamdok-mangareader.github.io/sources/index.min.json",
      fetchUrl: "https://tamdok-mangareader.github.io/sources/index.min.json",
    },
    {
      id: "community",
      name: "Community",
      shareUrl: "https://tamdok-mangareader.github.io/sources-community/index.min.json",
      fetchUrl: "index.min.json",
    },
  ];
  const RATING = { SAFE: 0, MIXED: 1, NSFW: 2 };

  const $ = (id) => document.getElementById(id);
  const list = $("list");
  const search = $("search");
  const languageSelect = $("language");
  const ratingGroup = $("rating");
  const count = $("count");
  const empty = $("empty");

  const state = { query: "", language: "", rating: "", registry: "" };
  let rows = [];

  const regionNames = (() => {
    try {
      return new Intl.DisplayNames(["en"], { type: "language" });
    } catch {
      return null;
    }
  })();

  function languageName(code) {
    if (!code) return "Unknown";
    try {
      return regionNames?.of(code) || code;
    } catch {
      return code;
    }
  }

  function normalizeRating(value) {
    if (typeof value === "string") {
      const key = value.toLowerCase();
      if (key === "nsfw") return RATING.NSFW;
      if (key === "suggestive" || key === "mixed") return RATING.MIXED;
      return RATING.SAFE;
    }
    const number = Number(value);
    if (number >= RATING.NSFW) return RATING.NSFW;
    if (number === RATING.MIXED) return RATING.MIXED;
    return RATING.SAFE;
  }

  function groupOf(source) {
    const languages = Array.isArray(source.languages) ? source.languages : [];
    if (languages.length === 0) return "Unknown";
    if (languages.length > 1 || languages.includes("multi") || languages.includes("all")) return "Multi-language";
    return languageName(languages[0]);
  }

  function host(url) {
    try {
      return new URL(url).host;
    } catch {
      return url || "";
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function badge(rating) {
    if (rating === RATING.SAFE) return null;
    const mixed = rating === RATING.MIXED;
    const node = el("span", `badge ${mixed ? "badge-mixed" : "badge-nsfw"}`, mixed ? "Contains NSFW" : "NSFW");
    node.title = mixed
      ? "This source may contain NSFW titles"
      : "This source primarily contains NSFW content";
    return node;
  }

  function iconNode(source) {
    if (source.iconURL) {
      const img = el("img", "icon");
      img.src = source.iconHref;
      img.alt = "";
      img.width = 48;
      img.height = 48;
      img.loading = "lazy";
      img.addEventListener("error", () => img.replaceWith(placeholder(source)));
      return img;
    }
    return placeholder(source);
  }

  function placeholder(source) {
    return el("span", "icon icon-placeholder", (source.name || "?").trim().charAt(0).toUpperCase());
  }

  function card(source) {
    const rating = normalizeRating(source.contentRating);
    const item = el("li", "card");
    item.append(iconNode(source));

    const body = el("div", "card-body");
    const title = el("div", "card-title");
    title.append(el("span", "name", source.name), el("span", "version", `v${source.version}`));
    const b = badge(rating);
    if (b) title.append(b);
    const registry = REGISTRIES.find((item) => item.id === source.registryId);
    if (registry) title.append(el("span", "tag", registry.name));
    body.append(title);

    const meta = el("div", "card-meta");
    if (source.baseURL) {
      const link = el("a", "site", host(source.baseURL));
      link.href = source.baseURL;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      meta.append(link);
    }
    const langs = (source.languages ?? []).slice(0, 4).map((code) => code.toUpperCase());
    if ((source.languages ?? []).length > 4) langs.push(`+${source.languages.length - 4}`);
    if (langs.length) meta.append(el("span", "langs", langs.join(" · ")));
    body.append(meta);
    item.append(body);

    const download = el("a", "btn btn-small", "Download");
    download.href = source.downloadHref;
    download.setAttribute("download", "");
    download.setAttribute("aria-label", `Download ${source.name}`);
    item.append(download);

    return { source, item, rating, group: groupOf(source) };
  }

  function matchesRating(rating) {
    switch (state.rating) {
      case "safe":
        return rating === RATING.SAFE;
      case "mixed":
        return rating === RATING.MIXED;
      case "nsfw":
        return rating === RATING.NSFW;
      default:
        return true;
    }
  }

  function matchesLanguage(row) {
    if (!state.language) return true;
    if (row.group === state.language) return true;
    const code = languageCodes.get(state.language);
    return Boolean(code && (row.source.languages ?? []).includes(code));
  }

  const languageCodes = new Map();

  function apply() {
    const q = state.query.trim().toLowerCase();
    const sectionCounts = new Map();
    let visible = 0;
    for (const row of rows) {
      const { source } = row;
      const text = `${source.name ?? ""} ${source.baseURL ?? ""} ${(source.altNames ?? []).join(" ")}`.toLowerCase();
      const show =
        (!q || text.includes(q)) &&
        matchesRating(row.rating) &&
        matchesLanguage(row) &&
        (!state.registry || source.registryId === state.registry);
      row.item.hidden = !show;
      if (show) {
        visible += 1;
        sectionCounts.set(row.section, (sectionCounts.get(row.section) ?? 0) + 1);
      }
    }
    for (const section of list.querySelectorAll(".group")) {
      section.hidden = !sectionCounts.get(section);
    }
    count.textContent = `${visible} ${visible === 1 ? "source" : "sources"}`;
    empty.hidden = visible !== 0 || rows.length === 0;
  }

  function render(sources) {
    rows = sources.map(card);
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.group)) groups.set(row.group, []);
      groups.get(row.group).push(row);
    }
    const names = [...groups.keys()].sort((a, b) => {
      if (a === "Multi-language") return -1;
      if (b === "Multi-language") return 1;
      return a.localeCompare(b);
    });

    list.textContent = "";
    for (const name of names) {
      const section = el("section", "group");
      section.append(el("h2", "group-title", name));
      const ul = el("ul", "cards");
      for (const row of groups.get(name).sort((a, b) => a.source.name.localeCompare(b.source.name))) {
        row.section = section;
        ul.append(row.item);
      }
      section.append(ul);
      list.append(section);
    }

    for (const source of sources) {
      const label = groupOf(source);
      if (label !== "Multi-language" && source.languages?.[0]) languageCodes.set(label, source.languages[0]);
    }
    const labels = new Set(rows.map((row) => row.group));
    for (const code of new Set(sources.flatMap((s) => s.languages ?? []))) {
      if (!code || code === "multi" || code === "all") continue;
      const label = languageName(code);
      if (!languageCodes.has(label)) languageCodes.set(label, code);
      labels.add(label);
    }
    for (const label of [...labels].sort((a, b) => a.localeCompare(b))) {
      const option = el("option", "", label);
      option.value = label;
      languageSelect.append(option);
    }
    apply();
  }

  search.addEventListener("input", () => {
    state.query = search.value;
    apply();
  });
  languageSelect.addEventListener("change", () => {
    state.language = languageSelect.value;
    apply();
  });
  function bindSegmented(group, key) {
    group.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-value]");
      if (!button) return;
      state[key] = button.dataset.value;
      for (const item of group.querySelectorAll("button")) {
        item.setAttribute("aria-checked", String(item === button));
      }
      apply();
    });
  }
  bindSegmented(ratingGroup, "rating");
  bindSegmented($("registry"), "registry");

  const isApple = /iphone|ipad|macintosh|mac os x/i.test(navigator.userAgent);
  for (const node of document.querySelectorAll(".registry")) {
    const registry = REGISTRIES.find((item) => item.id === node.dataset.registry);
    if (!registry) continue;
    const code = node.querySelector(".registry-url");
    code.textContent = registry.shareUrl;
    const add = node.querySelector(".add-repo");
    add.href = `tamdok://settings/sources?registry=${encodeURIComponent(registry.shareUrl)}`;
    if (isApple) add.hidden = false;
    const copy = node.querySelector(".copy-url");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(registry.shareUrl);
        copy.textContent = "Copied";
      } catch {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        copy.textContent = "Select and copy";
      }
      setTimeout(() => {
        copy.textContent = "Copy URL";
      }, 1800);
    });
  }

  async function loadRegistry(registry) {
    const base = new URL(registry.fetchUrl, location.href).href;
    const response = await fetch(base, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${registry.name}: HTTP ${response.status}`);
    const data = await response.json();
    const sources = (Array.isArray(data.sources) ? data.sources : []).map((source) => ({
      ...source,
      registryId: registry.id,
      downloadHref: new URL(source.downloadURL, base).href,
      iconHref: source.iconURL ? new URL(source.iconURL, base).href : undefined,
    }));
    return { data, base, sources };
  }

  Promise.allSettled(REGISTRIES.map(loadRegistry)).then((results) => {
    const sources = [];
    const failed = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        sources.push(...result.value.sources);
        if (REGISTRIES[index].id === "community" && result.value.data.iconURL) {
          const icon = $("registry-icon");
          icon.addEventListener("error", () => {
            icon.hidden = true;
          });
          icon.addEventListener("load", () => {
            icon.hidden = false;
          });
          icon.src = new URL(result.value.data.iconURL, result.value.base).href;
        }
      } else {
        console.error(result.reason);
        failed.push(REGISTRIES[index].name);
      }
    });
    if (sources.length === 0) {
      count.textContent = "";
      empty.textContent = failed.length ? "Failed to load the source list." : "No sources published yet.";
      empty.hidden = false;
      return;
    }
    render(sources);
    if (failed.length) {
      count.textContent += ` · ${failed.join(", ")} repository unavailable`;
    }
  });
})();
