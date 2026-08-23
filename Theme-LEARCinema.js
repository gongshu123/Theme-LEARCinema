(() => {
  const ROOT_CLASS = "lear-cinema";
  const HERO_CLASS = "lear-cinema-hero";
  const TOP_PILL_CLASS = "lear-top-pill";
  const LIBRARY_HEAD_CLASS = "lear-library-head";
  const SOURCE_CARD_CLASS = "lear-source-card";
  const SEARCH_OVERLAY_CLASS = "lear-search-overlay";
  const RECENT_SCENES_HREF = "/scenes?sortby=created_at&sortdir=desc";
  const PAGE_CLASSES = [
    "lear-page-home",
    "lear-page-recent",
    "lear-page-scenes",
    "lear-page-scene-detail",
    "lear-page-library-list",
    "lear-page-galleries",
    "lear-page-performers",
    "lear-page-groups",
    "lear-page-studios",
    "lear-page-entity-detail",
    "lear-page-settings",
  ];

  document.documentElement.classList.add(ROOT_CLASS);

  let scheduled = false;
  let lastScrollY = window.scrollY;
  let scrollScheduled = false;
  let collapsedStudioPath = "";
  let searchIndexPromise = null;
  let imageLibraryPromise = null;
  let sceneFoldersPromise = null;
  let homeGalleriesPromise = null;
  const performerGalleriesPromises = new Map();
  let customGalleryPath = "";
  let searchRequestId = 0;

  async function graphql(query, variables = {}) {
    const response = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json();
    if (!response.ok || payload.errors?.length) {
      throw new Error(payload.errors?.[0]?.message || "GraphQL request failed");
    }
    return payload.data;
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/[_\-.,/\\:;()\[\]{}'\"!?&+]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function editDistance(left, right) {
    if (left === right) return 0;
    if (!left.length) return right.length;
    if (!right.length) return left.length;
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let row = 1; row <= left.length; row += 1) {
      const current = [row];
      for (let column = 1; column <= right.length; column += 1) {
        current[column] = Math.min(
          current[column - 1] + 1,
          previous[column] + 1,
          previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
        );
      }
      previous = current;
    }
    return previous[right.length];
  }

  function searchScore(label, query) {
    const text = normalizeSearchText(label);
    const needle = normalizeSearchText(query);
    if (!needle || !text) return 0;
    if (text === needle) return 120;
    if (text.startsWith(needle)) return 105;
    if (text.includes(needle)) return 95;

    const textTokens = text.split(" ");
    const queryTokens = needle.split(" ");
    let score = 0;
    for (const token of queryTokens) {
      if (textTokens.some((candidate) => candidate === token)) {
        score += 24;
        continue;
      }
      if (textTokens.some((candidate) => candidate.startsWith(token))) {
        score += 20;
        continue;
      }
      const fuzzy = textTokens.some((candidate) => {
        if (Math.min(candidate.length, token.length) < 4) return false;
        const allowance = Math.max(candidate.length, token.length) >= 8 ? 2 : 1;
        return editDistance(candidate, token) <= allowance;
      });
      if (!fuzzy) return 0;
      score += 14;
    }
    return score;
  }

  function parentDirectory(path) {
    const normalized = String(path || "").replace(/\//g, "\\");
    const index = normalized.lastIndexOf("\\");
    return index > 0 ? normalized.slice(0, index) : "";
  }

  function directoryName(path) {
    const normalized = String(path || "").replace(/\//g, "\\").replace(/\\+$/, "");
    return normalized.split("\\").pop() || "未命名专辑";
  }

  function libraryCategory(path) {
    const parts = String(path || "").replace(/\//g, "\\").split("\\").filter(Boolean);
    const marker = parts.findIndex((part) => /kristen bjorn/i.test(part));
    return (marker >= 0 ? parts[marker + 1] : "") || parts[Math.max(0, parts.length - 2)] || "其他";
  }

  function archiveTitle(value) {
    return String(value || "").replace(/\.(?:zip|cbz)$/i, "").trim();
  }

  function mediaTimestamp(value) {
    const timestamp = Date.parse(value || "");
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function createAlbumCard(album) {
    const link = createLink(
      `/images?learAlbum=${encodeURIComponent(album.path)}`,
      "",
      "lear-album-card"
    );
    const image = document.createElement("img");
    image.loading = "lazy";
    const representative =
      album.images[Math.floor(album.images.length / 2)] || album.images[0];
    image.src = representative?.paths?.image || representative?.paths?.thumbnail || "";
    image.alt = album.name;
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = album.name;
    const meta = document.createElement("small");
    meta.textContent = `${album.images.length} 张 · ${album.category}`;
    copy.append(title, meta);
    link.append(image, copy);
    return link;
  }

  function loadHomeGalleries() {
    if (!homeGalleriesPromise) {
      homeGalleriesPromise = graphql(`
        query LearHomeGalleries {
          findGalleries(
            filter: { per_page: 6, sort: "created_at", direction: DESC }
          ) {
            galleries {
              id
              title
              created_at
              image_count
              paths { cover }
              files { path basename }
              scenes { id title studio { name } }
            }
          }
        }
      `).then(({ findGalleries }) => findGalleries.galleries || []);
    }
    return homeGalleriesPromise;
  }

  function createHomeAlbumCard(gallery) {
    const file = gallery.files?.[0] || {};
    const name = archiveTitle(
      gallery.title || file.basename || directoryName(file.path)
    );
    const category =
      gallery.sceneStudio ||
      gallery.scenes?.find((scene) => scene.studio?.name)?.studio?.name ||
      libraryCategory(file.path);
    const link = createLink(
      `/images?learAlbum=${encodeURIComponent(`gallery:${gallery.id}`)}`,
      "",
      "lear-album-card lear-home-album-card"
    );
    const image = document.createElement("img");
    image.loading = "lazy";
    image.src = gallery.paths?.cover || "";
    image.alt = name;
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = name;
    const meta = document.createElement("small");
    meta.textContent = `${gallery.image_count || 0} 张 · ${category}`;
    copy.append(title, meta);
    link.append(image, copy);
    return link;
  }

  function loadSceneFolders() {
    if (!sceneFoldersPromise) {
      const query = `
        query LearSceneFolders($folder_filter: FolderFilterType) {
          findFolders(
            filter: { per_page: -1, sort: "basename", direction: ASC }
            folder_filter: $folder_filter
          ) {
            folders { id path basename }
          }
        }
      `;
      sceneFoldersPromise = graphql(query, {
        folder_filter: {
          parent_folder: { modifier: "IS_NULL" },
          zip_file: { modifier: "IS_NULL" },
        },
      }).then(async ({ findFolders }) => {
        const roots = findFolders.folders || [];
        const groups = await Promise.all(
          roots.map((root) =>
            graphql(query, {
              folder_filter: {
                parent_folder: { value: root.id, modifier: "EQUALS" },
                zip_file: { modifier: "IS_NULL" },
              },
            }).then(({ findFolders: children }) =>
              children.folders?.length ? children.folders : [root]
            )
          )
        );
        const unique = new Map();
        groups.flat().forEach((folder) => unique.set(folder.path, folder));
        return Array.from(unique.values()).sort((left, right) =>
          left.basename.localeCompare(right.basename, "zh-CN", {
            numeric: true,
            sensitivity: "base",
          })
        );
      });
    }
    return sceneFoldersPromise;
  }

  function stashCriterion(value) {
    return JSON.stringify(value).replaceAll("{", "(").replaceAll("}", ")");
  }

  function sceneFolderHref(folder) {
    const params = new URLSearchParams(window.location.search);
    params.delete("page");
    params.delete("p");
    if (folder) {
      params.set(
        "c",
        stashCriterion({
          type: "folder",
          modifier: "INCLUDES",
          value: {
            items: [{ id: folder.id, label: folder.path }],
            depth: 0,
            excluded: [],
          },
        })
      );
    } else {
      params.delete("c");
    }
    return `/scenes${params.size ? `?${params}` : ""}`;
  }

  function ensureSceneFolderFilters(paneContent) {
    let filters = paneContent.querySelector(":scope > .lear-scene-folder-filters");
    if (!filters) {
      filters = document.createElement("nav");
      filters.className = "lear-album-categories lear-scene-folder-filters";
      filters.setAttribute("aria-label", "按视频文件夹筛选");
      const head = paneContent.querySelector(":scope > .lear-library-head");
      head?.insertAdjacentElement("afterend", filters);
    }

    const criterion = new URLSearchParams(window.location.search).get("c") || "";
    const signature = criterion;
    if (filters.dataset.signature === signature) return;
    filters.dataset.signature = signature;
    filters.innerHTML = '<span class="lear-folder-loading">正在读取文件夹…</span>';

    loadSceneFolders()
      .then((folders) => {
        if (!filters.isConnected || filters.dataset.signature !== signature) return;
        filters.replaceChildren();
        const activeFolder = folders.find((folder) =>
          criterion.includes(`"id":"${folder.id}"`)
        );
        const addButton = (label, folder) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.title = folder?.path || "显示全部视频";
          button.classList.toggle("active", folder ? folder === activeFolder : !activeFolder);
          button.addEventListener("click", () => {
            window.location.assign(sceneFolderHref(folder));
          });
          filters.append(button);
        };
        addButton("全部", null);
        folders.forEach((folder) => addButton(folder.basename, folder));
      })
      .catch((error) => {
        if (!filters.isConnected) return;
        filters.innerHTML = '<span class="lear-folder-loading">文件夹标签加载失败</span>';
        console.error("LEAR scene folder filters failed", error);
      });
  }

  function loadImageLibrary() {
    if (!imageLibraryPromise) {
      imageLibraryPromise = graphql(`
        query LearImageLibrary {
          findImages(filter: { per_page: -1, sort: "path", direction: ASC }) {
            count
            images {
              id
              title
              created_at
              paths { thumbnail image }
              visual_files { ... on ImageFile { path basename } }
              galleries {
                id
                title
                files { path basename }
                scenes { id title studio { name } }
              }
            }
          }
        }
      `).then(({ findImages }) => {
        const images = findImages.images.map((image) => {
          const file = image.visual_files?.[0] || {};
          const gallery = image.galleries?.[0] || null;
          const galleryFile = gallery?.files?.[0] || {};
          const sourcePath = galleryFile.path || file.path || "";
          const folder = gallery
            ? `gallery:${gallery.id}`
            : parentDirectory(file.path);
          const albumName = gallery
            ? archiveTitle(
                gallery.title || galleryFile.basename || directoryName(sourcePath)
              )
            : directoryName(folder);
          const linkedStudio = gallery?.scenes?.find((scene) => scene.studio?.name)
            ?.studio?.name;
          return {
            ...image,
            filePath: file.path || "",
            basename: file.basename || image.title || `图片 ${image.id}`,
            folder,
            albumName,
            category: linkedStudio || libraryCategory(sourcePath),
            galleryId: gallery?.id || "",
            sceneIds: (gallery?.scenes || []).map((scene) => scene.id),
          };
        });
        const albums = new Map();
        images.forEach((image) => {
          if (!image.folder) return;
          if (!albums.has(image.folder)) {
            albums.set(image.folder, {
              path: image.folder,
              name: image.albumName,
              category: image.category,
              latestCreatedAt: image.created_at || "",
              galleryId: image.galleryId,
              sceneIds: image.sceneIds,
              images: [],
            });
          }
          const album = albums.get(image.folder);
          album.images.push(image);
          if (mediaTimestamp(image.created_at) > mediaTimestamp(album.latestCreatedAt)) {
            album.latestCreatedAt = image.created_at;
          }
        });
        return { images, albums: Array.from(albums.values()) };
      });
    }
    return imageLibraryPromise;
  }

  function loadSearchIndex() {
    if (!searchIndexPromise) {
      searchIndexPromise = Promise.all([
        graphql(`
          query LearSearchIndex {
            scenes: findScenes(filter: { per_page: -1 }) {
              scenes { id title paths { screenshot } studio { name } performers { name } }
            }
            performers: findPerformers(filter: { per_page: -1 }) {
              performers { id name disambiguation image_path scene_count }
            }
            studios: findStudios(filter: { per_page: -1 }) {
              studios { id name image_path scene_count }
            }
          }
        `),
        loadImageLibrary(),
      ]).then(([data, library]) => ({ ...data, albums: library.albums }));
    }
    return searchIndexPromise;
  }

  function createLink(href, label, className) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    link.className = className || "";
    return link;
  }

  function getToolbarSearchInput() {
    return document.querySelector(
      '.item-list-container .filtered-list-toolbar .search-term-input input'
    );
  }

  function updateControlledInput(input, value) {
    if (!input) {
      return;
    }

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function closeSearchOverlay() {
    document
      .querySelector(`.${SEARCH_OVERLAY_CLASS}`)
      ?.classList.remove("active");
    document.documentElement.classList.remove("lear-search-open");
  }

  function createSearchResult(item) {
    const link = document.createElement("a");
    link.className = "lear-search-result";
    link.href = item.href;
    const image = document.createElement("img");
    image.src = item.image || "";
    image.alt = "";
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = item.label;
    const meta = document.createElement("small");
    meta.textContent = item.meta || "";
    copy.append(title, meta);
    link.append(image, copy);
    return link;
  }

  function renderSearchGroup(container, title, items) {
    if (!items.length) return;
    const group = document.createElement("section");
    group.className = "lear-search-group";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const grid = document.createElement("div");
    items.slice(0, 6).forEach((item) => grid.append(createSearchResult(item)));
    group.append(heading, grid);
    container.append(group);
  }

  async function submitSearchOverlay() {
    const overlay = document.querySelector(`.${SEARCH_OVERLAY_CLASS}`);
    const modalInput = overlay?.querySelector(".lear-search-input");
    const results = overlay?.querySelector(".lear-search-results");
    const query = modalInput?.value.trim() || "";
    if (!results || !query) return;

    const requestId = ++searchRequestId;
    results.innerHTML = '<div class="lear-search-status">正在搜索整个媒体库…</div>';
    overlay.classList.add("has-results");
    try {
      const index = await loadSearchIndex();
      if (requestId !== searchRequestId) return;
      const rank = (items, mapper) =>
        items
          .map((item) => {
            const mapped = mapper(item);
            return { ...mapped, score: searchScore(mapped.search, query) };
          })
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

      const scenes = rank(index.scenes.scenes, (scene) => ({
        label: scene.title || `短片 ${scene.id}`,
        search: [scene.title, scene.studio?.name, ...(scene.performers || []).map((p) => p.name)].join(" "),
        href: `/scenes/${scene.id}`,
        image: scene.paths?.screenshot,
        meta: [scene.studio?.name, ...(scene.performers || []).slice(0, 2).map((p) => p.name)].filter(Boolean).join(" · "),
      }));
      const performers = rank(index.performers.performers, (performer) => ({
        label: performer.name,
        search: `${performer.name} ${performer.disambiguation || ""}`,
        href: `/performers/${performer.id}`,
        image: performer.image_path,
        meta: `${performer.scene_count || 0} 部作品`,
      }));
      const studios = rank(index.studios.studios, (studio) => ({
        label: studio.name,
        search: studio.name,
        href: `/studios/${studio.id}`,
        image: studio.image_path,
        meta: `${studio.scene_count || 0} 部作品`,
      }));
      const albums = rank(index.albums, (album) => ({
        label: album.name,
        search: `${album.name} ${album.category}`,
        href: `/images?learAlbum=${encodeURIComponent(album.path)}`,
        image: album.images[0]?.paths?.thumbnail,
        meta: `${album.category} · ${album.images.length} 张`,
      }));

      results.replaceChildren();
      renderSearchGroup(results, "短片", scenes);
      renderSearchGroup(results, "演员", performers);
      renderSearchGroup(results, "工作室", studios);
      renderSearchGroup(results, "图库专辑", albums);
      if (!results.children.length) {
        const status = document.createElement("div");
        status.className = "lear-search-status";
        status.textContent = `没有找到“${query}”`;
        results.append(status);
      }
    } catch (error) {
      results.innerHTML = '<div class="lear-search-status">搜索加载失败，请稍后重试。</div>';
      console.error("LEAR global search failed", error);
    }
  }

  function openSearchOverlay() {
    const overlay = ensureSearchOverlay();
    const modalInput = overlay.querySelector(".lear-search-input");

    document
      .querySelector(".item-list-container")
      ?.classList.remove("lear-filter-open");
    modalInput.value = "";
    overlay.querySelector(".lear-search-results")?.replaceChildren();
    overlay.classList.remove("has-results");
    overlay.classList.add("active");
    document.documentElement.classList.add("lear-search-open");

    window.setTimeout(() => {
      modalInput.focus();
      modalInput.select();
    }, 60);
  }

  function ensureSearchOverlay() {
    let overlay = document.querySelector(`.${SEARCH_OVERLAY_CLASS}`);
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("div");
    overlay.className = SEARCH_OVERLAY_CLASS;
    overlay.innerHTML = `
      <button type="button" class="lear-search-backdrop" aria-label="关闭搜索"></button>
      <section class="lear-search-dialog" role="dialog" aria-modal="true" aria-label="全局搜索">
        <div class="lear-search-row">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"/></svg>
          <input class="lear-search-input" type="search" autocomplete="off" placeholder="搜索短片、演员、工作室或图库专辑…">
          <button type="button" class="lear-search-submit" aria-label="确认搜索">✓</button>
        </div>
        <div class="lear-search-results" aria-live="polite"></div>
      </section>
    `;

    const modalInput = overlay.querySelector(".lear-search-input");
    modalInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitSearchOverlay();
      }
    });
    overlay
      .querySelector(".lear-search-backdrop")
      .addEventListener("click", closeSearchOverlay);
    overlay
      .querySelector(".lear-search-submit")
      .addEventListener("click", submitSearchOverlay);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeSearchOverlay();
      }
    });

    document.body.append(overlay);
    return overlay;
  }

  function ensureTopPill() {
    let pill = document.querySelector(`.${TOP_PILL_CLASS}`);
    if (pill) {
      return pill;
    }

    pill = document.createElement("nav");
    pill.className = TOP_PILL_CLASS;
    pill.setAttribute("aria-label", "影院快捷导航");
    pill.append(
      createLink(RECENT_SCENES_HREF, "最近增加"),
      createLink("/scenes", "正在观看", "active"),
      createLink("/images", "图库"),
      createLink(
        "/performers?sortby=scenes_count&sortdir=desc",
        "演员"
      ),
      createLink(
        "/studios?sortby=scenes_count&sortdir=desc",
        "工作室"
      )
    );

    const searchButton = document.createElement("button");
    searchButton.type = "button";
    searchButton.className = "lear-top-search";
    searchButton.setAttribute("aria-label", "搜索与筛选");
    searchButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"/></svg>';
    searchButton.addEventListener("click", openSearchOverlay);
    pill.append(searchButton);
    document.body.append(pill);
    return pill;
  }

  function isRecentScenesRoute() {
    return (
      window.location.pathname === "/scenes" &&
      new URLSearchParams(window.location.search).get("sortby") === "created_at"
    );
  }

  function shouldBuildScenesHero() {
    if (window.location.pathname !== "/scenes") {
      return false;
    }
    const params = new URLSearchParams(window.location.search);
    const page = Number(params.get("page") || params.get("p") || "1");
    return !params.has("c") && !params.get("q") && (!Number.isFinite(page) || page <= 1);
  }

  function updatePageState(pill) {
    const root = document.documentElement;
    root.classList.remove(...PAGE_CLASSES);

    const path = window.location.pathname;
    let activeHref = "";

    if (/^\/scenes\/[^/]+/.test(path)) {
      root.classList.add("lear-page-scene-detail");
      activeHref =
        new URLSearchParams(window.location.search).get("qsort") === "created_at"
          ? RECENT_SCENES_HREF
          : "/scenes";
    } else if (path === "/") {
      root.classList.add("lear-page-home");
    } else if (path === "/scenes") {
      root.classList.add("lear-page-scenes");
      if (isRecentScenesRoute()) {
        root.classList.add("lear-page-recent");
        activeHref = RECENT_SCENES_HREF;
      } else {
        activeHref = "/scenes";
      }
    } else if (path === "/performers") {
      root.classList.add("lear-page-library-list", "lear-page-performers");
      activeHref = "/performers?sortby=scenes_count&sortdir=desc";
    } else if (path === "/images") {
      root.classList.add("lear-page-library-list", "lear-page-galleries");
      activeHref = "/images";
    } else if (path.startsWith("/images/")) {
      root.classList.add("lear-page-entity-detail", "lear-page-galleries");
      activeHref = "/images";
    } else if (path === "/galleries") {
      root.classList.add("lear-page-library-list", "lear-page-galleries");
      activeHref = "/images";
    } else if (path.startsWith("/galleries/")) {
      root.classList.add("lear-page-entity-detail", "lear-page-galleries");
      activeHref = "/images";
    } else if (path.startsWith("/performers/")) {
      root.classList.add("lear-page-entity-detail", "lear-page-performers");
      activeHref = "/performers?sortby=scenes_count&sortdir=desc";
    } else if (path === "/groups") {
      root.classList.add("lear-page-library-list", "lear-page-groups");
      activeHref = "/groups";
    } else if (path.startsWith("/groups/")) {
      root.classList.add("lear-page-entity-detail", "lear-page-groups");
      activeHref = "/groups";
    } else if (path === "/studios") {
      root.classList.add("lear-page-library-list", "lear-page-studios");
      activeHref = "/studios?sortby=scenes_count&sortdir=desc";
    } else if (path.startsWith("/studios/")) {
      root.classList.add("lear-page-entity-detail", "lear-page-studios");
      activeHref = "/studios?sortby=scenes_count&sortdir=desc";
    } else if (path.startsWith("/settings")) {
      root.classList.add("lear-page-settings");
    }

    pill.querySelectorAll("a").forEach((link) => {
      const active = link.getAttribute("href") === activeHref;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function updateTopPillOnScroll() {
    scrollScheduled = false;
    const currentY = Math.max(0, window.scrollY);
    const pill = document.querySelector(`.${TOP_PILL_CLASS}`);
    if (!pill) {
      lastScrollY = currentY;
      return;
    }

    const searchOpen =
      document.documentElement.classList.contains("lear-search-open");
    const scrollingDown = currentY > lastScrollY + 4;
    const scrollingUp = currentY < lastScrollY - 4;

    if (searchOpen || currentY < 56 || scrollingUp) {
      pill.classList.remove("lear-top-hidden");
    } else if (scrollingDown && currentY > 110) {
      pill.classList.add("lear-top-hidden");
    }
    lastScrollY = currentY;
  }

  function scheduleTopPillUpdate() {
    if (scrollScheduled) {
      return;
    }
    scrollScheduled = true;
    window.requestAnimationFrame(updateTopPillOnScroll);
  }

  function buildHero(sceneList, cards) {
    const source = cards[0];
    if (!source) {
      return;
    }

    cards.forEach((card) => card.classList.remove(SOURCE_CARD_CLASS));
    source.classList.add(SOURCE_CARD_CLASS);

    const getSceneData = (card) => {
      const sceneLink = card.querySelector(".scene-card-link");
      const titleLink = card.querySelector(".card-section > a");
      return {
        title:
          card.querySelector(".card-section-title")?.textContent?.trim() ||
          "最近添加",
        date:
          card.querySelector(".scene-card__date")?.textContent?.trim() || "",
        description:
          card.querySelector(".scene-card__description")?.textContent?.trim() ||
          "从你的媒体库继续观看。",
        studio:
          card.querySelector(".studio-overlay img")?.getAttribute("alt") ||
          "FEATURED",
        href:
          titleLink?.getAttribute("href") ||
          sceneLink?.getAttribute("href") ||
          "/scenes",
        imageSrc:
          card
            .querySelector(".scene-card-preview-image")
            ?.getAttribute("src") || "",
      };
    };
    const initial = getSceneData(source);

    let hero = sceneList.querySelector(`:scope > .${HERO_CLASS}`);
    if (!hero) {
      hero = document.createElement("section");
      hero.className = HERO_CLASS;
      sceneList.prepend(hero);
    }

    const signature = `${initial.href}|${initial.imageSrc}|${initial.title}`;
    if (hero.dataset.signature === signature) {
      return;
    }
    hero.dataset.signature = signature;

    hero.replaceChildren();

    const backgroundLink = createLink(
      initial.href,
      "",
      "lear-hero-background"
    );
    backgroundLink.setAttribute("aria-label", initial.title);
    const heroImage = document.createElement("img");
    heroImage.src = initial.imageSrc;
    heroImage.alt = "";
    backgroundLink.append(heroImage);

    const content = document.createElement("div");
    content.className = "lear-hero-content";

    const kicker = document.createElement("div");
    kicker.className = "lear-hero-kicker";
    kicker.textContent = `${initial.studio}  ·  最近添加`;

    const heroTitle = document.createElement("h1");
    const heroTitleLink = createLink(initial.href, initial.title);
    heroTitle.append(heroTitleLink);

    const meta = document.createElement("div");
    meta.className = "lear-hero-meta";
    meta.textContent = initial.date || "媒体库精选";

    const copy = document.createElement("p");
    copy.textContent = initial.description;

    const actions = document.createElement("div");
    actions.className = "lear-hero-actions";
    const play = createLink(
      initial.href,
      "▶  立即播放",
      "lear-play-button"
    );
    const details = createLink(
      initial.href,
      "查看详情",
      "lear-detail-button"
    );
    actions.append(play, details);

    content.append(kicker, heroTitle, meta, copy, actions);

    const thumbnails = document.createElement("div");
    thumbnails.className = "lear-hero-thumbnails";
    cards.slice(0, 5).forEach((card, index) => {
      const data = getSceneData(card);
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = index === 0 ? "active" : "";
      thumb.setAttribute("aria-label", `预览 ${data.title}`);
      const thumbImage = document.createElement("img");
      thumbImage.src = data.imageSrc;
      thumbImage.alt = "";
      thumb.append(thumbImage);
      thumb.addEventListener("click", () => {
        heroImage.src = data.imageSrc;
        backgroundLink.href = data.href;
        backgroundLink.setAttribute("aria-label", data.title);
        heroTitleLink.href = data.href;
        heroTitleLink.textContent = data.title;
        meta.textContent = data.date || "媒体库精选";
        copy.textContent = data.description;
        kicker.textContent = `${data.studio}  ·  最近添加`;
        play.href = data.href;
        details.href = data.href;
        thumbnails
          .querySelectorAll("button")
          .forEach((button) => button.classList.toggle("active", button === thumb));
      });
      thumbnails.append(thumb);
    });

    hero.append(backgroundLink, content, thumbnails);
  }

  function getLibraryHeaderCopy() {
    const path = window.location.pathname;
    if (isRecentScenesRoute()) {
      return { kicker: "RECENTLY ADDED", title: "最近增加的视频" };
    }
    if (path === "/performers") {
      return { kicker: "PEOPLE", title: "演员" };
    }
    if (path === "/studios") {
      return { kicker: "STUDIOS", title: "工作室" };
    }
    return { kicker: "MY LIBRARY", title: "影片库" };
  }

  function ensureLibraryHeader(list, paneContent) {
    let head = paneContent.querySelector(`:scope > .${LIBRARY_HEAD_CLASS}`);
    if (!head) {
      head = document.createElement("div");
      head.className = LIBRARY_HEAD_CLASS;

      const label = document.createElement("div");
      const kicker = document.createElement("span");
      kicker.className = "lear-section-kicker";
      const title = document.createElement("h2");
      label.append(kicker, title);

      head.append(label);

      const toolbar = paneContent.querySelector(".filtered-list-toolbar");
      paneContent.insertBefore(head, toolbar || paneContent.firstChild);
    }

    const copy = getLibraryHeaderCopy();
    head.querySelector(".lear-section-kicker").textContent = copy.kicker;
    head.querySelector("h2").textContent = copy.title;
    ensureHeaderPagination(head, paneContent);
  }

  function ensureHeaderPagination(head, paneContent) {
    let pagination =
      paneContent.querySelector(":scope > .lear-header-pagination") ||
      head.querySelector(".lear-header-pagination");
    if (!pagination) {
      pagination = document.createElement("nav");
      pagination.className = "lear-header-pagination";
      pagination.setAttribute("aria-label", "影片库分页");
      pagination.innerHTML = `
        <button type="button" data-action="first" aria-label="首页">«</button>
        <button type="button" data-action="previous" aria-label="上一页">‹</button>
        <button type="button" class="lear-page-count" data-action="page">第1页</button>
        <button type="button" data-action="next" aria-label="下一页">›</button>
        <button type="button" data-action="last" aria-label="尾页">»</button>
      `;
      pagination.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button || button.disabled) {
          return;
        }

        const source = paneContent.querySelector(
          ".pagination-footer-container .pagination"
        );
        const directButtons = source
          ? Array.from(source.children).filter(
              (element) => element.tagName === "BUTTON"
            )
          : [];
        const actions = {
          first: directButtons[0],
          previous: directButtons[1],
          page: source?.querySelector(".page-count"),
          next: directButtons.at(-2),
          last: directButtons.at(-1),
        };
        actions[button.dataset.action]?.click();
      });
      paneContent.append(pagination);
    }

    // Keep the mirrored controls immediately before Stash's hidden footer.
    // React can mount the card grid after our first pass, so re-checking the
    // sibling also keeps performer/studio tabs below the full grid.
    const footer = paneContent.querySelector(
      ":scope > .pagination-footer-container"
    );
    if (footer) {
      if (pagination.nextElementSibling !== footer) {
        paneContent.insertBefore(pagination, footer);
      }
    } else if (pagination.parentElement !== paneContent) {
      paneContent.append(pagination);
    }

    const source = paneContent.querySelector(
      ".pagination-footer-container .pagination"
    );
    if (!source) {
      pagination.hidden = true;
      return;
    }

    pagination.hidden = false;
    const directButtons = Array.from(source.children).filter(
      (element) => element.tagName === "BUTTON"
    );
    const sourceMap = {
      first: directButtons[0],
      previous: directButtons[1],
      next: directButtons.at(-2),
      last: directButtons.at(-1),
    };
    Object.entries(sourceMap).forEach(([action, sourceButton]) => {
      pagination.querySelector(`[data-action="${action}"]`).disabled =
        !sourceButton || sourceButton.disabled;
    });

    let pageCount = source.querySelector(".page-count")?.textContent?.trim();
    if (!pageCount && directButtons.length > 4) {
      const numberedPages = directButtons.slice(2, -2);
      const activePage = numberedPages.find((button) =>
        button.classList.contains("active")
      );
      if (activePage) {
        pageCount = `第${activePage.textContent.trim()}页，共 ${numberedPages.length}页`;
      }
    }
    if (pageCount) {
      pagination.querySelector(".lear-page-count").textContent = pageCount;
    }
  }

  function decorateLibraryCards(grid) {
    grid
      .querySelectorAll(".performer-card, .studio-card")
      .forEach((card) => {
        const thumbnail = card.querySelector(".thumbnail-section");
        const count =
          card.querySelector(".scene-count span")?.textContent?.trim() || "";
        if (!thumbnail || !count) {
          return;
        }

        let badge = thumbnail.querySelector(".lear-card-count");
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "lear-card-count";
          thumbnail.append(badge);
        }
        badge.textContent = `${count} 部作品`;
      });
  }

  function collapseStudioDetailOnce() {
    const root = document.documentElement;
    if (
      !root.classList.contains("lear-page-entity-detail") ||
      !root.classList.contains("lear-page-studios")
    ) {
      return;
    }

    const path = window.location.pathname;
    if (collapsedStudioPath === path) {
      return;
    }

    const header = document.querySelector(".detail-header");
    const toggle = header?.querySelector(".expand-collapse");
    if (!header || !toggle) {
      return;
    }

    collapsedStudioPath = path;
    if (!header.classList.contains("collapsed")) {
      toggle.click();
    }
  }

  function loadPerformerGalleries(performerId) {
    if (!performerGalleriesPromises.has(performerId)) {
      performerGalleriesPromises.set(
        performerId,
        graphql(
          `
            query LearPerformerGalleries($id: ID!) {
              findPerformer(id: $id) {
                id
                scenes {
                  id
                  studio { name }
                  galleries {
                    id
                    title
                    created_at
                    image_count
                    paths { cover }
                    files { path basename }
                  }
                }
              }
            }
          `,
          { id: performerId }
        ).then(({ findPerformer }) => {
          const galleries = new Map();
          (findPerformer?.scenes || []).forEach((scene) => {
            (scene.galleries || []).forEach((gallery) => {
              if (!galleries.has(gallery.id)) {
                galleries.set(gallery.id, {
                  ...gallery,
                  sceneStudio: scene.studio?.name || "",
                });
              }
            });
          });
          return Array.from(galleries.values()).sort(
            (left, right) =>
              mediaTimestamp(right.created_at) - mediaTimestamp(left.created_at) ||
              String(left.title || left.files?.[0]?.basename || "").localeCompare(
                String(right.title || right.files?.[0]?.basename || "")
              )
          );
        })
      );
    }
    return performerGalleriesPromises.get(performerId);
  }

  function decoratePerformerDetail() {
    const root = document.documentElement;
    if (!root.classList.contains("lear-page-performers")) return;

    const performerId = window.location.pathname.match(/^\/performers\/(\d+)/)?.[1];
    const tabs = document.querySelector(".performer-tabs");
    const nav = tabs?.querySelector(":scope > .nav-tabs");
    const galleryTab = nav?.querySelector(
      '.lear-performer-gallery-tab, [aria-controls="performer-tabs-tabpane-galleries"]'
    );
    if (!performerId || !tabs || !nav || !galleryTab) return;

    galleryTab.classList.add("lear-performer-gallery-tab");
    galleryTab.setAttribute("aria-controls", "lear-performer-gallery-panel");

    let badge = galleryTab.querySelector(".badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "left-spacing badge badge-pill badge-secondary";
      badge.textContent = "…";
      galleryTab.append(badge);
    }

    let panel = tabs.querySelector(":scope > .lear-performer-gallery-panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "lear-performer-gallery-panel";
      panel.className = "lear-performer-gallery-panel";
      panel.hidden = true;
      panel.innerHTML =
        '<div class="lear-gallery-loading">正在整理该演员的图库…</div>';
      tabs.append(panel);
    }

    if (!galleryTab.dataset.learGalleryBound) {
      galleryTab.dataset.learGalleryBound = "true";
      galleryTab.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        nav.querySelectorAll(".nav-link").forEach((link) => {
          const active = link === galleryTab;
          link.classList.toggle("active", active);
          link.setAttribute("aria-selected", String(active));
        });
        tabs.classList.add("lear-performer-gallery-active");
        panel.hidden = false;
        panel.classList.add("active");
      });
    }

    if (!nav.dataset.learGalleryBound) {
      nav.dataset.learGalleryBound = "true";
      nav.addEventListener("click", (event) => {
        const link = event.target.closest(".nav-link");
        if (!link || link === galleryTab) return;
        nav.querySelectorAll(".nav-link").forEach((item) => {
          const active = item === link;
          item.classList.toggle("active", active);
          item.setAttribute("aria-selected", String(active));
        });
        tabs.classList.remove("lear-performer-gallery-active");
        panel.hidden = true;
        panel.classList.remove("active");
      });
    }

    if (
      panel.dataset.performerId === performerId &&
      (panel.dataset.state === "loading" || panel.dataset.state === "ready")
    ) {
      return;
    }
    panel.dataset.performerId = performerId;
    panel.dataset.state = "loading";
    loadPerformerGalleries(performerId)
      .then((galleries) => {
        if (!panel.isConnected || panel.dataset.performerId !== performerId) return;
        badge.textContent = String(galleries.length);
        if (!galleries.length) {
          panel.innerHTML =
            '<div class="lear-gallery-loading">这个演员出演的短片暂时没有关联图库。</div>';
          panel.dataset.state = "ready";
          return;
        }
        const grid = document.createElement("div");
        grid.className = "lear-album-grid lear-performer-album-grid";
        galleries.forEach((gallery) => grid.append(createHomeAlbumCard(gallery)));
        panel.replaceChildren(grid);
        panel.dataset.state = "ready";
      })
      .catch((error) => {
        if (!panel.isConnected || panel.dataset.performerId !== performerId) return;
        badge.textContent = "0";
        panel.innerHTML =
          '<div class="lear-gallery-error">演员图库加载失败，请刷新后重试。</div>';
        panel.dataset.state = "error";
        console.error("LEAR performer galleries failed", error);
      });
  }

  function decorateSceneDetail() {
    const tabs = document.querySelector(".scene-tabs");
    const player = document.querySelector(".scene-player-container");
    const row = player?.parentElement;
    if (!tabs || !player || !row) {
      return;
    }

    tabs.querySelector(":scope > .lear-detail-cover")?.remove();

    let titlebar = row.querySelector(":scope > .lear-scene-titlebar");
    if (!titlebar) {
      titlebar = document.createElement("div");
      titlebar.className = "lear-scene-titlebar";
      row.insertBefore(titlebar, player);
    }

    const title =
      tabs.querySelector(".scene-header") ||
      titlebar.querySelector(".scene-header");
    if (title && title.parentElement !== titlebar) {
      titlebar.append(title);
    }

    tabs.querySelector(".scene-toolbar")?.classList.add("lear-hidden-toolbar");
    const hasLinkedGallery = Boolean(
      tabs.querySelector(".scene-galleries .gallery-card")
    );
    tabs.querySelectorAll(".nav-tabs .nav-link").forEach((tab) => {
      const label = tab.textContent?.trim() || "";
      tab.classList.toggle(
        "lear-hidden-tab",
        label !== "简介" &&
          label !== "文件信息" &&
          !(label === "图库" && hasLinkedGallery)
      );
    });

    if (hasLinkedGallery) {
      renderSceneGallery(tabs);
    }
    decorateLibraryCards(tabs);
  }

  function galleryHost() {
    return document.querySelector(".main") || document.querySelector("main") || document.getElementById("root");
  }

  function ensureGalleryLightbox() {
    let lightbox = document.querySelector(".lear-gallery-lightbox");
    if (lightbox) return lightbox;
    lightbox = document.createElement("div");
    lightbox.className = "lear-gallery-lightbox";
    lightbox.innerHTML = `
      <button type="button" class="lear-lightbox-close" aria-label="关闭">×</button>
      <button type="button" class="lear-lightbox-prev" aria-label="上一张">‹</button>
      <img alt="">
      <button type="button" class="lear-lightbox-next" aria-label="下一张">›</button>
      <div class="lear-lightbox-count"></div>
    `;
    const close = () => {
      lightbox.classList.remove("active");
      document.documentElement.classList.remove("lear-lightbox-open");
    };
    lightbox.querySelector(".lear-lightbox-close").addEventListener("click", close);
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) close();
    });
    document.addEventListener("keydown", (event) => {
      if (!lightbox.classList.contains("active")) return;
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") lightbox.querySelector(".lear-lightbox-prev").click();
      if (event.key === "ArrowRight") lightbox.querySelector(".lear-lightbox-next").click();
    });
    document.body.append(lightbox);
    return lightbox;
  }

  function openGalleryLightbox(images, startIndex = 0) {
    const lightbox = ensureGalleryLightbox();
    let index = Math.max(0, Math.min(startIndex, images.length - 1));
    const image = lightbox.querySelector("img");
    const count = lightbox.querySelector(".lear-lightbox-count");
    const show = () => {
      const current = images[index];
      image.src = current.paths?.image || current.paths?.thumbnail || "";
      image.alt = current.basename || current.albumName || "图片预览";
      count.textContent = `${index + 1} / ${images.length}`;
    };
    lightbox.querySelector(".lear-lightbox-prev").onclick = () => {
      index = (index - 1 + images.length) % images.length;
      show();
    };
    lightbox.querySelector(".lear-lightbox-next").onclick = () => {
      index = (index + 1) % images.length;
      show();
    };
    show();
    lightbox.classList.add("active");
    document.documentElement.classList.add("lear-lightbox-open");
  }

  function createPhotoButton(image, images, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lear-photo-tile";
    button.setAttribute("aria-label", `预览 ${image.basename}`);
    const picture = document.createElement("img");
    picture.loading = "lazy";
    picture.src = image.paths?.image || image.paths?.thumbnail || "";
    picture.alt = "";
    button.append(picture);
    button.addEventListener("click", () => openGalleryLightbox(images, index));
    return button;
  }

  function renderAlbumPage(browser, album) {
    browser.innerHTML = `
      <header class="lear-gallery-heading">
        <div><a class="lear-gallery-back" href="/images">← 全部专辑</a><h1></h1><p></p></div>
      </header>
      <div class="lear-photo-grid"></div>
    `;
    browser.querySelector("h1").textContent = album.name;
    browser.querySelector("p").textContent = `${album.category} · ${album.images.length} 张照片`;
    const grid = browser.querySelector(".lear-photo-grid");
    album.images.forEach((image, index) => grid.append(createPhotoButton(image, album.images, index)));
  }

  function renderSceneGallery(tabs) {
    const nativeGallery = tabs.querySelector(".scene-galleries");
    const galleryLink = nativeGallery?.querySelector(
      '.gallery-card a[href^="/galleries/"]'
    );
    const galleryId = galleryLink?.getAttribute("href")?.match(/^\/galleries\/(\d+)/)?.[1];
    const pane = nativeGallery?.closest(".tab-pane");
    if (!nativeGallery || !galleryId || !pane) return;

    pane.classList.add("lear-scene-gallery-active");
    nativeGallery.hidden = true;
    let browser = pane.querySelector(".lear-scene-gallery-browser");
    if (!browser) {
      browser = document.createElement("section");
      browser.className = "lear-scene-gallery-browser";
      pane.append(browser);
    }
    if (
      browser.dataset.galleryId === galleryId &&
      (browser.dataset.state === "loading" || browser.dataset.state === "ready")
    ) {
      return;
    }

    browser.dataset.galleryId = galleryId;
    browser.dataset.state = "loading";
    browser.innerHTML = '<div class="lear-gallery-loading">正在整理对应相册…</div>';
    loadImageLibrary()
      .then((library) => {
        if (!browser.isConnected || browser.dataset.galleryId !== galleryId) return;
        const album = library.albums.find((item) => item.galleryId === galleryId);
        if (!album) {
          browser.innerHTML = '<div class="lear-gallery-error">找不到这个视频的相册图片。</div>';
          browser.dataset.state = "error";
          return;
        }
        renderAlbumPage(browser, album);
        browser.dataset.state = "ready";
      })
      .catch((error) => {
        if (!browser.isConnected) return;
        browser.innerHTML = '<div class="lear-gallery-error">对应相册加载失败，请刷新后重试。</div>';
        browser.dataset.state = "error";
        console.error("LEAR scene gallery failed", error);
      });
  }

  function renderAlbumIndex(browser, library) {
    browser.innerHTML = `
      <header class="lear-gallery-heading">
        <div><span class="lear-section-kicker">PHOTO LIBRARY</span><h1>图库</h1><p></p></div>
        <div class="lear-gallery-header-actions">
          <div class="lear-album-search" role="search">
            <button type="button" class="lear-album-search-icon" aria-label="聚焦专辑搜索">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>
            </button>
            <input type="search" aria-label="搜索专辑或分类" placeholder="搜索专辑或分类…">
          </div>
          <nav class="lear-album-pagination" aria-label="专辑分页">
            <button type="button" class="lear-page-first" aria-label="第一页">«</button>
            <button type="button" class="lear-page-prev" aria-label="上一页">‹</button>
            <span class="lear-page-summary">第<label class="lear-page-jump"><span class="lear-visually-hidden">页码</span><input type="number" min="1" step="1" inputmode="numeric" aria-label="输入页码"></label>页，共<span class="lear-page-total">1</span>页</span>
            <button type="button" class="lear-page-next" aria-label="下一页">›</button>
            <button type="button" class="lear-page-last" aria-label="最后一页">»</button>
          </nav>
        </div>
      </header>
      <div class="lear-album-categories"></div>
      <div class="lear-album-grid"></div>
    `;
    const stats = browser.querySelector(".lear-gallery-heading p");
    stats.textContent =
      `${library.albums.length} 个专辑 · ${library.images.length} 张照片`;
    const categories = ["全部", ...Array.from(new Set(library.albums.map((album) => album.category))).sort()];
    const categoryBar = browser.querySelector(".lear-album-categories");
    const grid = browser.querySelector(".lear-album-grid");
    const input = browser.querySelector(".lear-album-search input");
    const searchIcon = browser.querySelector(".lear-album-search-icon");
    const pagination = browser.querySelector(".lear-album-pagination");
    const pageInput = browser.querySelector(".lear-page-jump input");
    const pageTotal = browser.querySelector(".lear-page-total");
    const firstButton = browser.querySelector(".lear-page-first");
    const previousButton = browser.querySelector(".lear-page-prev");
    const nextButton = browser.querySelector(".lear-page-next");
    const lastButton = browser.querySelector(".lear-page-last");
    let activeCategory = "全部";
    let currentPage = 1;
    const pageSize = 48;

    const goToPage = (page, totalPages, scroll = true) => {
      currentPage = Math.max(1, Math.min(Number(page) || 1, totalPages));
      draw();
      if (scroll) browser.querySelector(".lear-album-categories")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const draw = () => {
      const query = normalizeSearchText(input.value);
      const filtered = library.albums
        .filter((album) => activeCategory === "全部" || album.category === activeCategory)
        .filter((album) => !query || searchScore(`${album.name} ${album.category}`, query) > 0)
        .sort(
          (a, b) =>
            mediaTimestamp(b.latestCreatedAt) - mediaTimestamp(a.latestCreatedAt) ||
            a.name.localeCompare(b.name)
        );
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      currentPage = Math.min(currentPage, totalPages);
      const pageStart = (currentPage - 1) * pageSize;
      grid.replaceChildren();
      filtered.slice(pageStart, pageStart + pageSize).forEach((album) => {
        grid.append(createAlbumCard(album));
      });
      pageInput.value = String(currentPage);
      pageInput.max = String(totalPages);
      pageTotal.textContent = String(totalPages);
      firstButton.disabled = currentPage === 1;
      previousButton.disabled = currentPage === 1;
      nextButton.disabled = currentPage === totalPages;
      lastButton.disabled = currentPage === totalPages;
      pagination.hidden = filtered.length === 0;
      stats.textContent =
        `${filtered.length} 个专辑 · ${library.images.length} 张照片`;
    };

    categories.forEach((category, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = category;
      button.classList.toggle("active", index === 0);
      button.addEventListener("click", () => {
        activeCategory = category;
        currentPage = 1;
        categoryBar.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
        draw();
      });
      categoryBar.append(button);
    });
    // Use one shared page rhythm: filters and count on one row, content next,
    // and pagination centered after the full grid.
    categoryBar.append(stats);
    browser.append(pagination);
    searchIcon.addEventListener("click", () => input.focus());
    input.addEventListener("input", () => {
      currentPage = 1;
      draw();
    });
    pageInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        goToPage(pageInput.value, Number(pageInput.max));
        pageInput.blur();
      }
      if (event.key === "Escape") {
        pageInput.value = String(currentPage);
        pageInput.blur();
      }
    });
    pageInput.addEventListener("change", () => goToPage(pageInput.value, Number(pageInput.max)));
    pageInput.addEventListener("focus", () => pageInput.select());
    firstButton.addEventListener("click", () => goToPage(1, Number(pageInput.max)));
    previousButton.addEventListener("click", () => goToPage(currentPage - 1, Number(pageInput.max)));
    nextButton.addEventListener("click", () => goToPage(currentPage + 1, Number(pageInput.max)));
    lastButton.addEventListener("click", () => goToPage(Number(pageInput.max), Number(pageInput.max)));
    draw();
  }

  function renderImageDetail(browser, library, imageId) {
    const current = library.images.find((image) => image.id === imageId);
    if (!current) {
      browser.innerHTML = '<div class="lear-gallery-error">找不到这张图片。</div>';
      return;
    }
    const album = library.albums.find((item) => item.path === current.folder) || {
      name: current.albumName,
      category: current.category,
      images: [current],
      path: current.folder,
    };
    let selected = Math.max(0, album.images.findIndex((image) => image.id === current.id));
    browser.innerHTML = `
      <div class="lear-image-album-panel">
        <a class="lear-gallery-back" href="/images?learAlbum=${encodeURIComponent(album.path)}">← 返回专辑</a>
        <h1></h1><p></p><div class="lear-image-album-thumbs"></div>
      </div>
      <button type="button" class="lear-image-main" aria-label="全屏预览"><img alt=""></button>
    `;
    browser.querySelector("h1").textContent = album.name;
    browser.querySelector("p").textContent = `${selected + 1} / ${album.images.length}`;
    const mainImage = browser.querySelector(".lear-image-main img");
    const thumbs = browser.querySelector(".lear-image-album-thumbs");
    const show = (index) => {
      selected = index;
      const image = album.images[index];
      mainImage.src = image.paths?.image || image.paths?.thumbnail || "";
      mainImage.alt = image.basename;
      browser.querySelector(".lear-image-album-panel p").textContent = `${index + 1} / ${album.images.length}`;
      thumbs.querySelectorAll("button").forEach((button, buttonIndex) => button.classList.toggle("active", buttonIndex === index));
    };
    album.images.forEach((image, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.title = image.basename;
      const picture = document.createElement("img");
      picture.loading = "lazy";
      picture.src = image.paths?.thumbnail || image.paths?.image || "";
      picture.alt = "";
      button.append(picture);
      button.addEventListener("click", () => show(index));
      thumbs.append(button);
    });
    browser.querySelector(".lear-image-main").addEventListener("click", () => openGalleryLightbox(album.images, selected));
    show(selected);
    window.setTimeout(() => thumbs.querySelector("button.active")?.scrollIntoView({ block: "nearest" }), 30);
  }

  function maybeRenderCustomGallery() {
    const path = window.location.pathname;
    if (path !== "/images" && !/^\/images\/[^/]+/.test(path)) {
      document.documentElement.classList.remove("lear-custom-gallery-active");
      document.querySelector(".lear-gallery-browser")?.remove();
      customGalleryPath = "";
      return false;
    }
    const signature = `${path}${window.location.search}`;
    document.documentElement.classList.add("lear-custom-gallery-active");
    if (customGalleryPath === signature && document.querySelector(".lear-gallery-browser")) return true;
    customGalleryPath = signature;
    const host = galleryHost();
    if (!host) return true;
    let browser = document.querySelector(".lear-gallery-browser");
    if (!browser) {
      browser = document.createElement("section");
      browser.className = "lear-gallery-browser";
      host.append(browser);
    }
    browser.innerHTML = '<div class="lear-gallery-loading">正在整理图库专辑…</div>';
    loadImageLibrary()
      .then((library) => {
        if (signature !== `${window.location.pathname}${window.location.search}`) return;
        if (path.startsWith("/images/")) {
          renderImageDetail(browser, library, path.split("/")[2]);
          return;
        }
        const albumPath = new URLSearchParams(window.location.search).get("learAlbum");
        const album = albumPath ? library.albums.find((item) => item.path === albumPath) : null;
        if (album) renderAlbumPage(browser, album);
        else renderAlbumIndex(browser, library);
      })
      .catch((error) => {
        browser.innerHTML = '<div class="lear-gallery-error">图库加载失败，请刷新后重试。</div>';
        console.error("LEAR gallery browser failed", error);
      });
    return true;
  }

  function renderRecentAlbums(section, library) {
    const albumGrid = section.querySelector(".lear-album-grid");
    const recentAlbums = library.albums
      .filter((album) => mediaTimestamp(album.latestCreatedAt))
      .sort((left, right) =>
        mediaTimestamp(right.latestCreatedAt) - mediaTimestamp(left.latestCreatedAt)
      )
      .slice(0, 6);
    albumGrid.replaceChildren();
    recentAlbums.forEach((album) => albumGrid.append(createAlbumCard(album)));
    if (!recentAlbums.length) {
      albumGrid.innerHTML = '<p class="lear-gallery-loading">暂时没有新入库的图集。</p>';
    }
  }

  function ensureRecentAlbums(list) {
    const existing = document.querySelector(".lear-native-recent-albums");
    existing?.remove();
  }

  function decorateHome() {
    const recommendations = document.querySelector(".recommendations-container");
    if (!recommendations) {
      return;
    }

    ensureHomeGalleryRow(recommendations);

    const sceneCards = Array.from(
      recommendations.querySelectorAll(
        ".scene-recommendations .slick-slide:not(.slick-cloned) .scene-card"
      )
    );

    if (sceneCards.length) {
      buildHero(recommendations, sceneCards);
    }
  }

  function ensureHomeGalleryRow(recommendations) {
    const nativeRow = recommendations.querySelector(".gallery-recommendations");
    const existing = recommendations.querySelector(".lear-home-gallery-row");
    if (recommendations.classList.contains("recommendations-container-edit")) {
      nativeRow?.removeAttribute("hidden");
      existing?.remove();
      return;
    }
    if (!nativeRow) return;

    nativeRow.hidden = true;
    nativeRow.setAttribute("aria-hidden", "true");
    let section = existing;
    if (!section) {
      section = document.createElement("section");
      section.className = "lear-home-gallery-row";
      section.innerHTML = `
        <header class="lear-home-section-head">
          <div><span class="lear-section-kicker">PHOTO LIBRARY</span><h2>最近添加的图集</h2></div>
          <a href="/images">查看全部</a>
        </header>
        <div class="lear-home-album-grid"><span class="lear-folder-loading">正在读取最近相册…</span></div>
      `;
      nativeRow.insertAdjacentElement("afterend", section);
    }
    if (section.dataset.state === "loading" || section.dataset.state === "ready") return;

    section.dataset.state = "loading";
    loadHomeGalleries()
      .then((galleries) => {
        if (!section.isConnected) return;
        const grid = section.querySelector(".lear-home-album-grid");
        grid.replaceChildren();
        galleries.forEach((gallery) => grid.append(createHomeAlbumCard(gallery)));
        if (!galleries.length) {
          grid.innerHTML = '<span class="lear-folder-loading">暂时没有相册</span>';
        }
        section.dataset.state = "ready";
      })
      .catch((error) => {
        if (!section.isConnected) return;
        section.querySelector(".lear-home-album-grid").innerHTML =
          '<span class="lear-folder-loading">最近相册加载失败</span>';
        section.dataset.state = "error";
        console.error("LEAR home galleries failed", error);
      });
  }

  function applyCinemaLayout() {
    scheduled = false;
    ensureSearchOverlay();
    const pill = ensureTopPill();
    updatePageState(pill);
    ensureRecentAlbums(null);

    if (maybeRenderCustomGallery()) {
      return;
    }

    if (document.documentElement.classList.contains("lear-page-home")) {
      decorateHome();
      return;
    }

    if (
      document.documentElement.classList.contains("lear-page-scene-detail")
    ) {
      decorateSceneDetail();
      return;
    }

    if (
      document.documentElement.classList.contains("lear-page-entity-detail")
    ) {
      document
        .querySelectorAll(
          ".detail-body .tab-pane.active .sidebar-pane-content, " +
            ".detail-body > .item-list-container .sidebar-pane-content"
        )
        .forEach((paneContent) =>
          ensureHeaderPagination(paneContent, paneContent)
        );
      collapseStudioDetailOnce();
      decoratePerformerDetail();
      decorateLibraryCards(document);
      return;
    }

    const isScenes =
      document.documentElement.classList.contains("lear-page-scenes");
    const isLibraryList =
      document.documentElement.classList.contains("lear-page-library-list");
    if (!isScenes && !isLibraryList) {
      return;
    }

    const list = document.querySelector(".item-list-container");
    const paneContent = list?.querySelector(".sidebar-pane-content");
    const grid = paneContent?.querySelector(
      ":scope > .row.justify-content-center"
    );
    if (!list || !paneContent || !grid) {
      return;
    }

    ensureLibraryHeader(list, paneContent);
    if (isScenes) {
      ensureSceneFolderFilters(paneContent);
    }
    decorateLibraryCards(grid);

    if (isScenes) {
      const cards = Array.from(grid.children).filter((element) =>
        element.classList.contains("scene-card")
      );
      if (cards.length && shouldBuildScenesHero()) {
        buildHero(list, cards);
      } else {
        list.querySelector(`:scope > .${HERO_CLASS}`)?.remove();
        cards.forEach((card) => card.classList.remove(SOURCE_CARD_CLASS));
      }
      ensureRecentAlbums(list);
    }
  }

  function scheduleLayout() {
    if (scheduled) {
      return;
    }
    scheduled = true;
    window.requestAnimationFrame(applyCinemaLayout);
  }

  const root = document.getElementById("root");
  if (root) {
    new MutationObserver(scheduleLayout).observe(root, {
      childList: true,
      subtree: true,
    });
  }

  window.addEventListener("scroll", scheduleTopPillUpdate, { passive: true });
  scheduleLayout();
})();
