(() => {
  "use strict";

  const TV_PARAM = "learTV";
  const PLAYER_PARAM = "learTVPlayer";
  const ROOT_CLASS = "lear-tv-mode";
  const APP_ID = "lear-tv-app";
  const FAVORITE_FIELD = "lear_favorite";
  const FOCUS_SELECTOR = ".lear-tv-focusable:not([disabled])";
  const memoryKey = "lear-tv-last-focus";
  const GAMEPAD_AXIS_THRESHOLD = 0.55;
  const GAMEPAD_REPEAT_DELAY = 360;
  const GAMEPAD_REPEAT_RATE = 135;

  const params = new URLSearchParams(window.location.search);
  const isTvHome = params.get(TV_PARAM) === "1";
  const isTvPlayer = params.get(PLAYER_PARAM) === "1";
  if (!isTvHome && !isTvPlayer) return;

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

  function favoriteValue(scene) {
    const value = scene?.custom_fields?.[FAVORITE_FIELD];
    return value === true || value === 1 || value === "1" || value === "true";
  }

  function sceneDuration(scene) {
    return Number(scene?.files?.[0]?.duration || 0);
  }

  function unfinishedValue(scene) {
    const duration = sceneDuration(scene);
    const resume = Number(scene?.resume_time || 0);
    return resume > 0 && duration > 0 && resume < duration - 10;
  }

  function cleanTitle(scene) {
    return String(scene?.title || scene?.files?.[0]?.basename || `视频 ${scene?.id || ""}`)
      .replace(/\.(?:mp4|mkv|avi|mov|wmv|m4v|webm)$/i, "")
      .trim();
  }

  function timestamp(value) {
    const result = Date.parse(value || "");
    return Number.isFinite(result) ? result : 0;
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return hours ? `${hours}小时${minutes ? `${minutes}分` : ""}` : `${minutes || 1}分钟`;
  }

  function shortCopy(value, fallback = "暂无简介") {
    const copy = String(value || fallback).replace(/\s+/g, " ").trim();
    return copy.length > 150 ? `${copy.slice(0, 147)}…` : copy;
  }

  function sceneImage(scene) {
    return scene?.paths?.screenshot || scene?.paths?.stream || "";
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function focusable(node, id, label) {
    node.classList.add("lear-tv-focusable");
    node.tabIndex = -1;
    node.dataset.tvFocusId = id;
    if (label) node.setAttribute("aria-label", label);
    return node;
  }

  function detailsHref(scene) {
    return `/scenes/${scene.id}`;
  }

  function sceneMeta(scene, performerLimit = 4) {
    const performers = scene?.performers || [];
    const names = performers.slice(0, performerLimit).map((item) => item.name);
    if (performers.length > performerLimit) names.push(`另 ${performers.length - performerLimit} 位演员`);
    return [scene?.date, formatDuration(sceneDuration(scene)), ...names]
      .filter(Boolean)
      .join("  ·  ");
  }

  async function saveTvProgress(scene, seconds) {
    const duration = sceneDuration(scene);
    const current = Math.max(0, Number(seconds) || 0);
    const resume = duration > 0 && current >= duration - 10 ? 0 : current;
    try {
      await graphql(`
        mutation LearTelevisionProgress($input: SceneUpdateInput!) {
          sceneUpdate(input: $input) { id resume_time }
        }
      `, { input: { id: scene.id, resume_time: resume } });
      scene.resume_time = resume;
    } catch (error) {
      console.error("LEAR television progress save failed", error);
    }
  }

  function formatPlayerTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function openTvPlayer(app, scene) {
    app.querySelector(".lear-tv-player-shell")?._learClose?.();
    const returnFocusId = document.activeElement?.dataset?.tvFocusId || "";
    const shell = element("section", "lear-tv-player-shell");
    shell.setAttribute("aria-label", `正在播放 ${cleanTitle(scene)}`);
    const video = element("video", "lear-tv-player-video");
    video.src = scene?.paths?.stream || "";
    video.controls = false;
    video.autoplay = true;
    video.preload = "auto";
    video.playsInline = true;

    const controls = element("div", "lear-tv-player-controls is-visible");
    const title = element("h2", "lear-tv-player-title", cleanTitle(scene));
    const timelineWrap = element("div", "lear-tv-player-timeline-wrap");
    const timelineFill = element("span", "lear-tv-player-timeline-fill");
    const timeline = element("input", "lear-tv-player-timeline");
    timeline.type = "range";
    timeline.min = "0";
    timeline.max = "1000";
    timeline.step = "1";
    timeline.value = "0";
    timeline.setAttribute("aria-label", "播放进度");
    timelineWrap.append(timelineFill, timeline);

    const actions = element("div", "lear-tv-player-actions");
    const back = element("button", "lear-tv-player-control lear-tv-player-back", "B  返回");
    const rewind = element("button", "lear-tv-player-control", "↶ 10");
    const playPause = element("button", "lear-tv-player-control lear-tv-player-toggle", "❚❚");
    const forward = element("button", "lear-tv-player-control", "10 ↷");
    const time = element("div", "lear-tv-player-time", "0:00 / 0:00");
    const hint = element("div", "lear-tv-player-hint", "A 播放/暂停　← → 快退/快进 10 秒");
    [back, rewind, playPause, forward].forEach((button) => {
      button.type = "button";
      button.tabIndex = -1;
    });
    actions.append(back, rewind, playPause, forward, time, hint);
    controls.append(title, timelineWrap, actions);
    const seekFeedback = element("div", "lear-tv-player-seek-feedback");
    shell.append(video, seekFeedback, controls);
    app.append(shell);

    let lastSavedAt = Number(scene?.resume_time || 0);
    let closing = false;
    let controlsTimer = 0;
    let feedbackTimer = 0;
    const updateControls = () => {
      const duration = Number(video.duration || sceneDuration(scene) || 0);
      const current = Number(video.currentTime || 0);
      timeline.value = duration > 0 ? String(Math.round((current / duration) * 1000)) : "0";
      time.textContent = `${formatPlayerTime(current)} / ${formatPlayerTime(duration)}`;
      playPause.textContent = video.paused ? "▶" : "❚❚";
      timelineFill.style.width = `${duration > 0 ? (current / duration) * 100 : 0}%`;
    };
    const showControls = (keepVisible = false) => {
      controls.classList.add("is-visible");
      window.clearTimeout(controlsTimer);
      if (!keepVisible && !video.paused) {
        controlsTimer = window.setTimeout(() => controls.classList.remove("is-visible"), 3800);
      }
    };
    const seekBy = (delta) => {
      const duration = Number(video.duration || Number.POSITIVE_INFINITY);
      video.currentTime = Math.max(0, Math.min(duration, Number(video.currentTime || 0) + delta));
      seekFeedback.textContent = delta < 0 ? "↶ 10 秒" : "10 秒 ↷";
      seekFeedback.classList.add("is-visible");
      window.clearTimeout(feedbackTimer);
      feedbackTimer = window.setTimeout(() => seekFeedback.classList.remove("is-visible"), 700);
      updateControls();
      showControls();
    };
    shell._learShowControls = showControls;
    shell._learSeek = seekBy;

    const close = async () => {
      if (closing) return;
      closing = true;
      window.clearTimeout(controlsTimer);
      window.clearTimeout(feedbackTimer);
      await saveTvProgress(scene, video.currentTime);
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen().catch(() => {});
      }
      shell.remove();
      const returnTarget = returnFocusId
        ? app.querySelector(`[data-tv-focus-id="${CSS.escape(returnFocusId)}"]`)
        : null;
      (returnTarget || app.querySelector('[data-tv-focus-id="hero-play"]'))?.focus({ preventScroll: true });
    };
    shell._learClose = close;
    video.addEventListener("loadedmetadata", () => {
      const resume = Number(scene?.resume_time || 0);
      if (resume > 0 && resume < video.duration - 10) video.currentTime = resume;
      updateControls();
      video.play().catch(() => {});
    }, { once: true });
    video.addEventListener("timeupdate", () => {
      updateControls();
      if (Math.abs(video.currentTime - lastSavedAt) < 15) return;
      lastSavedAt = video.currentTime;
      saveTvProgress(scene, video.currentTime);
    });
    video.addEventListener("play", () => {
      updateControls();
      showControls();
    });
    video.addEventListener("pause", () => {
      updateControls();
      showControls(true);
    });
    video.addEventListener("ended", () => showControls(true));
    video.addEventListener("click", () => togglePlayer(video));
    shell.addEventListener("mousemove", () => showControls());
    timeline.addEventListener("input", () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      video.currentTime = (Number(timeline.value) / 1000) * video.duration;
      updateControls();
      showControls(true);
    });
    timeline.addEventListener("change", () => showControls());
    back.addEventListener("click", close);
    rewind.addEventListener("click", () => seekBy(-10));
    forward.addEventListener("click", () => seekBy(10));
    playPause.addEventListener("click", () => togglePlayer(video));
    shell.requestFullscreen?.().catch(() => {});
    video.play().catch(() => {});
  }

  function progressValue(scene) {
    const duration = sceneDuration(scene);
    return duration > 0
      ? Math.min(100, Math.max(0, (Number(scene?.resume_time || 0) / duration) * 100))
      : 0;
  }

  function createProgress(scene) {
    const progress = progressValue(scene);
    if (!progress) return null;
    const track = element("span", "lear-tv-progress");
    const value = element("span", "lear-tv-progress-value");
    value.style.width = `${progress}%`;
    track.append(value);
    return track;
  }

  function createSceneCard(scene, index, rowId, onOpen) {
    const title = cleanTitle(scene);
    const card = focusable(element("button", "lear-tv-card lear-tv-scene-card"), `${rowId}-${scene.id}`, title);
    card.type = "button";
    card.dataset.sceneId = scene.id;
    card.style.setProperty("--tv-order", String(index));

    const art = element("span", "lear-tv-card-art");
    const image = element("img");
    image.src = sceneImage(scene);
    image.alt = "";
    image.loading = index < 6 ? "eager" : "lazy";
    art.append(image);
    const progress = createProgress(scene);
    if (progress) art.append(progress);
    if (favoriteValue(scene)) art.append(element("span", "lear-tv-heart", "♥"));

    const copy = element("span", "lear-tv-card-copy");
    copy.append(element("strong", "lear-tv-card-title", title));
    const meta = [scene?.studio?.name, scene?.date?.slice(0, 4), formatDuration(sceneDuration(scene))]
      .filter(Boolean)
      .join(" · ");
    copy.append(element("small", "lear-tv-card-meta", meta));
    card.append(art, copy);
    card.addEventListener("click", () => onOpen(scene));
    return card;
  }

  function createPersonCard(person, index, rowId, onOpen) {
    const card = focusable(element("button", "lear-tv-card lear-tv-person-card"), `${rowId}-${person.id}`, person.name);
    card.type = "button";
    card.style.setProperty("--tv-order", String(index));
    const image = element("img");
    image.src = person.image_path || "";
    image.alt = "";
    image.loading = "lazy";
    card.append(image, element("strong", "lear-tv-card-title", person.name));
    card.addEventListener("click", () => onOpen(person));
    return card;
  }

  function createStudioCard(studio, index, rowId, onOpen) {
    const card = focusable(element("button", "lear-tv-card lear-tv-studio-card"), `${rowId}-${studio.id}`, studio.name);
    card.type = "button";
    card.style.setProperty("--tv-order", String(index));
    const image = element("img");
    image.src = studio.image_path || "";
    image.alt = "";
    image.loading = "lazy";
    card.append(image, element("strong", "lear-tv-card-title", studio.name));
    card.addEventListener("click", () => onOpen(studio));
    return card;
  }

  function createEntityView(app, entity, kind, scenes, onOpenScene) {
    app.querySelector(".lear-tv-entity-view")?._learDismiss?.();
    const returnFocusId = document.activeElement?.dataset?.tvFocusId || "";
    const lockedScrollY = window.scrollY;
    document.documentElement.classList.add("lear-tv-detail-open");
    const view = element("section", "lear-tv-entity-view");
    view.classList.add(kind === "演员" ? "is-performer" : "is-studio");
    view.setAttribute("role", "dialog");
    view.setAttribute("aria-modal", "true");
    view.setAttribute("aria-label", `${kind} ${entity.name}`);

    const profile = element("header", "lear-tv-entity-profile");
    const image = element("img");
    image.src = entity.image_path || "";
    image.alt = "";
    profile.append(
      image,
      element("div", "lear-tv-kicker", kind),
      element("h1", "lear-tv-entity-title", entity.name),
      element("p", "lear-tv-entity-meta", `${scenes.length} 部作品 · B 返回`)
    );
    const rowId = `entity-${kind === "演员" ? "performer" : "studio"}-${entity.id}`;
    const row = buildRow(
      rowId,
      "作品",
      scenes.slice(0, 30),
      (scene, index, id) => createSceneCard(scene, index, id, onOpenScene),
      "暂时没有关联作品"
    );
    view.append(profile, row);
    app.append(view);

    const dismiss = () => {
      view.remove();
      if (!app.querySelector(".lear-tv-details")) {
        document.documentElement.classList.remove("lear-tv-detail-open");
      }
      window.scrollTo({ top: lockedScrollY, behavior: "instant" });
      const returnTarget = returnFocusId
        ? app.querySelector(`[data-tv-focus-id="${CSS.escape(returnFocusId)}"]`)
        : null;
      (returnTarget || app.querySelector('[data-tv-focus-id="hero-play"]'))?.focus({ preventScroll: true });
    };
    view._learDismiss = dismiss;
    window.setTimeout(() => view.querySelector(FOCUS_SELECTOR)?.focus({ preventScroll: true }), 30);
  }

  function buildRow(id, title, items, createCard, emptyText) {
    const section = element("section", "lear-tv-row");
    section.id = `lear-tv-row-${id}`;
    section.append(element("h2", "lear-tv-row-title", title));
    const rail = element("div", "lear-tv-rail");
    rail.dataset.tvRow = id;
    if (items.length) {
      items.forEach((item, index) => rail.append(createCard(item, index, id)));
    } else {
      rail.append(element("div", "lear-tv-empty", emptyText));
    }
    section.append(rail);
    return section;
  }

  function setHeroBackground(app, scene) {
    app.style.setProperty("--lear-tv-hero", `url("${String(sceneImage(scene)).replace(/["\\]/g, "\\$&")}")`);
  }

  function createHero(app, scene, onOpen) {
    const hero = element("section", "lear-tv-hero");
    const copy = element("div", "lear-tv-hero-copy");
    const kicker = element("div", "lear-tv-kicker", scene?.studio?.name || "FEATURED");
    const title = element("h1", "lear-tv-hero-title", cleanTitle(scene));
    const meta = element(
      "div",
      "lear-tv-hero-meta",
      sceneMeta(scene, 3)
    );
    const details = element("p", "lear-tv-hero-description", shortCopy(scene?.details));
    const actions = element("div", "lear-tv-hero-actions");
    const play = focusable(element("button", "lear-tv-button lear-tv-button-primary", Number(scene?.resume_time || 0) > 0 ? "▶ 继续播放" : "▶ 立即播放"), "hero-play", `播放 ${cleanTitle(scene)}`);
    play.type = "button";
    play.addEventListener("click", () => openTvPlayer(app, scene));
    const more = focusable(element("button", "lear-tv-button", "查看详情"), "hero-details", `查看 ${cleanTitle(scene)} 的详情`);
    more.type = "button";
    more.addEventListener("click", () => onOpen(scene));
    actions.append(play, more);
    copy.append(kicker, title, meta, details, actions);
    hero.append(copy);
    setHeroBackground(app, scene);
    return hero;
  }

  function createDetails(app, scene) {
    const returnFocusId = document.activeElement?.dataset?.tvFocusId || "";
    const lockedScrollY = window.scrollY;
    document.documentElement.classList.add("lear-tv-detail-open");
    let dialog = app.querySelector(".lear-tv-details");
    if (!dialog) {
      dialog = element("section", "lear-tv-details");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      app.append(dialog);
    }
    dialog.replaceChildren();
    dialog.dataset.open = "true";
    dialog.style.setProperty("--lear-tv-detail-art", `url("${String(sceneImage(scene)).replace(/["\\]/g, "\\$&")}")`);

    const content = element("div", "lear-tv-details-copy");
    const cast = element(
      "p",
      "lear-tv-details-cast",
      `演员：${(scene?.performers || []).map((item) => item.name).join(" · ") || "暂无演员资料"}`
    );
    content.append(
      element("div", "lear-tv-kicker", scene?.studio?.name || "影片详情"),
      element("h2", "lear-tv-details-title", cleanTitle(scene)),
      element("div", "lear-tv-hero-meta", sceneMeta(scene, 3)),
      element("p", "lear-tv-details-description", shortCopy(scene?.details, "尚未匹配简介。")),
      cast
    );
    const actions = element("div", "lear-tv-hero-actions");
    const play = focusable(element("button", "lear-tv-button lear-tv-button-primary", Number(scene?.resume_time || 0) > 0 ? "▶ 继续播放" : "▶ 立即播放"), "details-play", `播放 ${cleanTitle(scene)}`);
    play.type = "button";
    play.addEventListener("click", () => openTvPlayer(app, scene));
    const fullDetails = focusable(element("button", "lear-tv-button", "完整资料"), "details-full", `展开 ${cleanTitle(scene)} 的完整资料`);
    fullDetails.type = "button";
    fullDetails.addEventListener("click", () => {
      const expanded = content.classList.toggle("is-expanded");
      content.querySelector(".lear-tv-details-description").textContent = expanded
        ? String(scene?.details || "尚未匹配简介。").trim()
        : shortCopy(scene?.details, "尚未匹配简介。");
      fullDetails.textContent = expanded ? "收起资料" : "完整资料";
      fullDetails.setAttribute("aria-expanded", String(expanded));
    });
    actions.append(play, fullDetails);
    content.append(actions);
    dialog.append(content);

    const dismiss = () => {
      dialog.dataset.open = "false";
      if (!app.querySelector(".lear-tv-entity-view")) {
        document.documentElement.classList.remove("lear-tv-detail-open");
      }
      window.setTimeout(() => dialog.remove(), 180);
      window.scrollTo({ top: lockedScrollY, behavior: "instant" });
      const returnTarget = returnFocusId
        ? app.querySelector(`[data-tv-focus-id="${CSS.escape(returnFocusId)}"]`)
        : null;
      (returnTarget || app.querySelector('[data-tv-focus-id="hero-play"]'))?.focus({ preventScroll: true });
    };
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dismiss();
    });
    dialog._learDismiss = dismiss;
    window.setTimeout(() => play.focus({ preventScroll: true }), 20);
  }

  function navButton(label, id, rowId) {
    const button = focusable(element("button", "lear-tv-nav-item", label), `nav-${id}`, label);
    button.type = "button";
    button.addEventListener("click", () => {
      const row = document.getElementById(`lear-tv-row-${rowId}`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => row?.querySelector(FOCUS_SELECTOR)?.focus(), 260);
    });
    return button;
  }

  function createHeader() {
    const header = element("header", "lear-tv-header");
    const brand = element("div", "lear-tv-brand", "LEAR CINEMA");
    const nav = element("nav", "lear-tv-nav");
    nav.setAttribute("aria-label", "电视版主导航");
    nav.append(
      navButton("首页", "home", "continue"),
      navButton("正在观看", "watching", "continue"),
      navButton("收藏", "favorites", "favorites"),
      navButton("最近添加", "recent", "recent"),
      navButton("演员", "performers", "performers")
    );
    const exit = focusable(element("a", "lear-tv-exit", "退出电视模式"), "nav-exit", "退出电视模式");
    exit.href = "/";
    header.append(brand, nav, exit);
    return header;
  }

  function directionalScore(origin, candidate, direction) {
    const a = origin.getBoundingClientRect();
    const b = candidate.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const primary = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    if (primary <= 8) return Number.POSITIVE_INFINITY;
    const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    return primary + cross * 2.4;
  }

  function moveFocus(app, direction) {
    const scope = app.querySelector(".lear-tv-details") || app.querySelector(".lear-tv-entity-view") || app;
    const active = document.activeElement?.matches?.(FOCUS_SELECTOR) && scope.contains(document.activeElement)
      ? document.activeElement
      : scope.querySelector(FOCUS_SELECTOR);
    if (!active) return;
    const candidates = [...scope.querySelectorAll(FOCUS_SELECTOR)].filter((item) => item !== active && item.offsetParent !== null);
    const target = candidates
      .map((candidate) => ({ candidate, score: directionalScore(active, candidate, direction) }))
      .sort((left, right) => left.score - right.score)[0];
    if (!target || !Number.isFinite(target.score)) return;
    target.candidate.focus({ preventScroll: true });
    target.candidate.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }

  function focusStored(app) {
    const id = sessionStorage.getItem(memoryKey);
    const target = id
      ? app.querySelector(`[data-tv-focus-id="${CSS.escape(id)}"]`)
      : null;
    (target || app.querySelector('[data-tv-focus-id="hero-play"]') || app.querySelector(FOCUS_SELECTOR))?.focus({ preventScroll: true });
  }

  function dismissOrGoBack(app) {
    const player = app?.querySelector(".lear-tv-player-shell");
    if (player?._learClose) {
      player._learClose();
      return;
    }
    const dialog = app?.querySelector(".lear-tv-details");
    if (dialog?._learDismiss) {
      dialog._learDismiss();
      return;
    }
    const entityView = app?.querySelector(".lear-tv-entity-view");
    if (entityView?._learDismiss) {
      entityView._learDismiss();
      return;
    }
    if (isTvPlayer && history.length > 1) {
      history.back();
      return;
    }
    window.location.assign("/");
  }

  function showGamepadStatus(app, gamepad) {
    if (!app) return;
    let status = app.querySelector(".lear-tv-gamepad-status");
    if (!status) {
      status = element("div", "lear-tv-gamepad-status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      app.append(status);
    }
    status.textContent = `🎮 手柄已连接 · ${gamepad?.id || "Gamepad"}`;
    status.classList.remove("is-idle");
    window.clearTimeout(status._learIdleTimer);
    status._learIdleTimer = window.setTimeout(() => status.classList.add("is-idle"), 3200);
  }

  function gamepadButtonPressed(gamepad, index) {
    const button = gamepad?.buttons?.[index];
    return Boolean(button && (button.pressed || button.value > 0.55));
  }

  function gamepadDirection(gamepad) {
    if (gamepadButtonPressed(gamepad, 12)) return "up";
    if (gamepadButtonPressed(gamepad, 13)) return "down";
    if (gamepadButtonPressed(gamepad, 14)) return "left";
    if (gamepadButtonPressed(gamepad, 15)) return "right";
    const horizontal = Number(gamepad?.axes?.[0] || 0);
    const vertical = Number(gamepad?.axes?.[1] || 0);
    if (Math.abs(horizontal) >= Math.abs(vertical) && Math.abs(horizontal) > GAMEPAD_AXIS_THRESHOLD) {
      return horizontal < 0 ? "left" : "right";
    }
    if (Math.abs(vertical) > GAMEPAD_AXIS_THRESHOLD) return vertical < 0 ? "up" : "down";
    return "";
  }

  function togglePlayer(video) {
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function handleGamepadDirection(app, direction, playerMode) {
    if (!direction) return;
    if (playerMode) {
      const video = document.querySelector("video");
      if (!video) return;
      const shell = app?.querySelector(".lear-tv-player-shell") || video.closest(".lear-tv-player-shell");
      if (direction === "left") {
        if (shell?._learSeek) shell._learSeek(-10);
        else video.currentTime = Math.max(0, video.currentTime - 10);
      }
      if (direction === "right") {
        if (shell?._learSeek) shell._learSeek(10);
        else video.currentTime = Math.min(video.duration || Number.POSITIVE_INFINITY, video.currentTime + 10);
      }
      if (direction === "up" || direction === "down") {
        shell?._learShowControls?.(true);
      }
      return;
    }
    moveFocus(app, direction);
  }

  function installGamepadSupport(app, { playerMode = false } = {}) {
    if (typeof navigator.getGamepads !== "function") return;
    const states = new Map();
    let announcedIndex = -1;

    const tick = (now) => {
      const gamepads = [...(navigator.getGamepads() || [])].filter(Boolean);
      const gamepad = gamepads[0];
      if (gamepad) {
        if (announcedIndex !== gamepad.index) {
          announcedIndex = gamepad.index;
          showGamepadStatus(app, gamepad);
        }
        const previous = states.get(gamepad.index) || {
          buttons: [],
          direction: "",
          nextRepeat: 0,
        };
        const activePlayerMode = playerMode || Boolean(app?.querySelector(".lear-tv-player-shell"));
        const direction = gamepadDirection(gamepad);
        if (direction && direction !== previous.direction) {
          handleGamepadDirection(app, direction, activePlayerMode);
          previous.nextRepeat = now + GAMEPAD_REPEAT_DELAY;
        } else if (direction && now >= previous.nextRepeat) {
          handleGamepadDirection(app, direction, activePlayerMode);
          previous.nextRepeat = now + GAMEPAD_REPEAT_RATE;
        }
        previous.direction = direction;

        const buttons = gamepad.buttons.map((_, index) => gamepadButtonPressed(gamepad, index));
        const justPressed = (index) => buttons[index] && !previous.buttons[index];
        if (justPressed(0)) {
          if (activePlayerMode) togglePlayer(app?.querySelector(".lear-tv-player-video") || document.querySelector("video"));
          else document.activeElement?.matches?.(FOCUS_SELECTOR) && document.activeElement.click();
        }
        if (justPressed(1)) dismissOrGoBack(app);
        if (activePlayerMode && (justPressed(9) || justPressed(16))) {
          togglePlayer(app?.querySelector(".lear-tv-player-video") || document.querySelector("video"));
        }
        previous.buttons = buttons;
        states.set(gamepad.index, previous);
      } else {
        announcedIndex = -1;
      }
      window.requestAnimationFrame(tick);
    };

    window.addEventListener("gamepadconnected", (event) => showGamepadStatus(app, event.gamepad));
    window.requestAnimationFrame(tick);
  }

  function installFocusEngine(app) {
    app.addEventListener("focusin", (event) => {
      const target = event.target.closest?.(FOCUS_SELECTOR);
      if (target?.dataset.tvFocusId) sessionStorage.setItem(memoryKey, target.dataset.tvFocusId);
    });
    window.addEventListener("keydown", (event) => {
      if (!document.documentElement.classList.contains(ROOT_CLASS)) return;
      const player = app.querySelector(".lear-tv-player-shell");
      if (player) {
        const video = player.querySelector("video");
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          player._learSeek?.(event.key === "ArrowLeft" ? -10 : 10);
          return;
        }
        if (event.key === "Enter" || event.key === " " || event.key === "MediaPlayPause") {
          event.preventDefault();
          togglePlayer(video);
          player._learShowControls?.(true);
          return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          player._learShowControls?.(true);
          return;
        }
        if (event.key === "Escape" || event.key === "BrowserBack") {
          event.preventDefault();
          player._learClose?.();
          return;
        }
      }
      const directions = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      };
      if (directions[event.key]) {
        event.preventDefault();
        moveFocus(app, directions[event.key]);
        return;
      }
      if (event.key === "Enter" && document.activeElement?.matches?.(FOCUS_SELECTOR)) {
        event.preventDefault();
        document.activeElement.click();
        return;
      }
      if (event.key === "Escape" || event.key === "BrowserBack") {
        event.preventDefault();
        dismissOrGoBack(app);
      }
    });
  }

  async function loadTvData() {
    return graphql(`
      query LearTelevisionHome {
        findScenes(filter: { per_page: -1 }) {
          scenes {
            id title details date created_at last_played_at resume_time custom_fields
            paths { screenshot stream }
            files { basename duration width height }
            studio { id name image_path }
            performers { id name image_path }
          }
        }
        findPerformers(filter: { per_page: 16, sort: "scenes_count", direction: DESC }) {
          performers { id name image_path scene_count }
        }
        findStudios(filter: { per_page: 16, sort: "scenes_count", direction: DESC }) {
          studios { id name image_path scene_count }
        }
      }
    `);
  }

  function sortNewest(left, right) {
    return timestamp(right.created_at || right.date) - timestamp(left.created_at || left.date);
  }

  function renderError(app, error) {
    app.classList.remove("is-loading");
    const panel = element("main", "lear-tv-error");
    panel.append(
      element("h1", "", "电视模式加载失败"),
      element("p", "", error?.message || "无法读取媒体库，请稍后重试。")
    );
    const retry = focusable(element("button", "lear-tv-button lear-tv-button-primary", "重新加载"), "retry", "重新加载电视模式");
    retry.type = "button";
    retry.addEventListener("click", () => window.location.reload());
    panel.append(retry);
    app.replaceChildren(panel);
    retry.focus();
  }

  async function mountTvHome() {
    document.documentElement.classList.add(ROOT_CLASS);
    let app = document.getElementById(APP_ID);
    if (!app) {
      app = element("div", "lear-tv-app is-loading");
      app.id = APP_ID;
      app.innerHTML = '<div class="lear-tv-loading"><span></span><strong>正在准备电视界面…</strong></div>';
      document.body.append(app);
    }

    installFocusEngine(app);
    try {
      const data = await loadTvData();
      const scenes = data.findScenes?.scenes || [];
      const newest = [...scenes].sort(sortNewest).slice(0, 20);
      const favorites = scenes.filter(favoriteValue).sort(sortNewest).slice(0, 20);
      const continueWatching = scenes
        .filter(unfinishedValue)
        .sort((left, right) => timestamp(right.last_played_at) - timestamp(left.last_played_at))
        .slice(0, 20);
      const heroScene = continueWatching[0] || favorites[0] || newest[0] || scenes[0];
      if (!heroScene) throw new Error("媒体库中还没有可以显示的视频。");

      const openDetails = (scene) => createDetails(app, scene);
      const openPerformer = (performer) => createEntityView(
        app,
        performer,
        "演员",
        scenes.filter((scene) => scene.performers?.some((item) => String(item.id) === String(performer.id))),
        openDetails
      );
      const openStudio = (studio) => createEntityView(
        app,
        studio,
        "工作室",
        scenes.filter((scene) => String(scene.studio?.id || "") === String(studio.id)),
        openDetails
      );
      const content = element("main", "lear-tv-content");
      content.append(
        createHero(app, heroScene, openDetails),
        buildRow("continue", "继续观看", continueWatching, (scene, index, rowId) => createSceneCard(scene, index, rowId, openDetails), "还没有未看完的视频"),
        buildRow("favorites", "我的收藏", favorites, (scene, index, rowId) => createSceneCard(scene, index, rowId, openDetails), "还没有收藏视频"),
        buildRow("recent", "最近添加", newest, (scene, index, rowId) => createSceneCard(scene, index, rowId, openDetails), "还没有视频"),
        buildRow("performers", "热门演员", data.findPerformers?.performers || [], (person, index, rowId) => createPersonCard(person, index, rowId, openPerformer), "还没有演员资料"),
        buildRow("studios", "工作室", data.findStudios?.studios || [], (studio, index, rowId) => createStudioCard(studio, index, rowId, openStudio), "还没有工作室资料")
      );
      app.replaceChildren(createHeader(), content);
      app.classList.remove("is-loading");
      installGamepadSupport(app);
      window.setTimeout(() => focusStored(app), 60);
    } catch (error) {
      console.error("LEAR television mode failed", error);
      renderError(app, error);
    }
  }

  function installPlayerKeys() {
    document.documentElement.classList.add("lear-tv-player-mode");
    installGamepadSupport(null, { playerMode: true });
    window.addEventListener("keydown", (event) => {
      const video = document.querySelector("video");
      if (!video) return;
      if (event.key === " " || event.key === "MediaPlayPause") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (video.paused) video.play();
        else video.pause();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopImmediatePropagation();
        video.currentTime = Math.max(0, video.currentTime - 10);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopImmediatePropagation();
        video.currentTime = Math.min(video.duration || Number.POSITIVE_INFINITY, video.currentTime + 10);
      } else if (event.key === "Escape" || event.key === "BrowserBack") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (history.length > 1) history.back();
        else window.location.assign(`/?${TV_PARAM}=1`);
      }
    }, true);
  }

  if (isTvHome) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountTvHome, { once: true });
    } else {
      mountTvHome();
    }
  } else if (isTvPlayer) {
    installPlayerKeys();
  }
})();
