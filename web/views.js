/* 资料库视图：专辑网格/详情、最近添加、艺人、歌曲、文件夹、播放列表、喜爱、搜索 */
const Views = (() => {
  const PAGE = 60;
  const content = () => document.getElementById("content");
  const stack = [];          // 返回栈：{view, arg, title}
  let current = null;
  let pager = null;          // 当前分页加载器
  let filterTimer = null;

  const art = (id, size = 300) => id ? `<img class="art" src="${LMS.cover(id, size)}" alt="" loading="lazy">` : `<div class="art"></div>`;
  const thumb = (id) => id ? `<img class="thumb" src="${LMS.cover(id, 100)}" alt="" loading="lazy">` : `<div class="thumb"></div>`;
  /* 详情标题行：既没有返回箭头、也没有标题时整行隐藏（如搜索页） */
  function syncHead() {
    const back = document.getElementById("btn-back");
    const title = document.getElementById("view-title").textContent.trim();
    document.querySelector(".detail-head").hidden = back.hidden && !title;
  }
  /* 数量：和名称分开，灰色靠右。分类总数放窗口顶部（setCount），详情里的数量放详情标题行（setTitle 第二个参数） */
  const UNIT = { albums: "张", recent: "张", artists: "位", songs: "首",
    folders: "项", playlists: "个", favorites: "项" };
  const fmtCount = (n, unit) => (n === undefined || n === null || n === "") ? "" : `${n} ${unit || ""}`.trim();
  const setCount = (n) => {
    document.getElementById("pick-count").textContent = fmtCount(n, UNIT[rootView]);
  };
  const setTitle = (t, n, unit) => {
    document.getElementById("view-title").textContent = t;
    document.getElementById("view-count").textContent = t ? fmtCount(n, unit) : "";
    syncHead();
  };
  const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;

  /* ---------- 分栏：艺人/播放列表用两栏（左列条目、右列详情），其余只用一栏 ---------- */
  const pickList = () => document.getElementById("pick-list");
  const TWO = new Set(["artists", "playlists"]);
  const CAT = { albums: "专辑", recent: "最近添加", artists: "艺人", songs: "歌曲",
    folders: "文件夹", playlists: "播放列表", favorites: "喜爱", search: "搜索" };
  let listPager = null;      // 左栏的分页加载器
  function setCols(view) {
    document.querySelector(".picker-cols").classList.toggle("one", !TWO.has(view));
    document.getElementById("pick-cat").textContent = CAT[view] || "";
    document.getElementById("pick-count").textContent = "";
    if (listPager) { listPager.stop(); listPager = null; }
    pickList().innerHTML = "";
    pickList().scrollTop = 0;
  }
  /* 左栏点选：高亮当前项，右栏换成它的详情（右栏不保留返回栈） */
  function pickLeft(li, view, arg) {
    pickList().querySelectorAll("li.on").forEach((x) => x.classList.remove("on"));
    li.classList.add("on");
    stack.length = 0;
    current = null;
    go(view, arg);
  }

  /* ---------- 分页：滚动到底部自动加载下一页（root 为滚动容器，默认右栏） ---------- */
  function paged(fetchPage, renderItems, container, countLabel, root = content()) {
    let start = 0, total = Infinity, busy = false;
    const sentinel = document.createElement("div");
    sentinel.className = "more-sentinel";
    container.after(sentinel);
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) more(); }, { root, rootMargin: "600px" });
    async function more() {
      if (busy || start >= total) return;
      busy = true;
      try {
        const r = await fetchPage(start, PAGE);
        total = Number(r.count || 0);
        if (countLabel) countLabel(total);
        const html = renderItems(r, start);
        container.insertAdjacentHTML("beforeend", html);
        start += PAGE;
        if (!total) container.outerHTML = empty("没有内容");
      } catch (e) { toast("加载失败：" + e.message); }
      busy = false;
    }
    io.observe(sentinel);
    more();
    return { stop: () => io.disconnect() };
  }

  function reset(html) {
    if (pager) { pager.stop(); pager = null; }
    content().innerHTML = html;
    content().scrollTop = 0;
  }

  /* ---------- 专辑网格（专辑 / 最近添加 / 艺人下的专辑） ---------- */
  /* title 为空：分类首页（专辑、最近添加），数量放窗口顶部；否则是艺人下的专辑，数量放详情标题行 */
  function albumGrid(title, extra) {
    reset(`<div class="grid" id="grid"></div>`);
    setTitle(title);
    const grid = document.getElementById("grid");
    pager = paged((s, n) => LMS.albums(s, n, extra), (r) => (r.albums_loop || []).map((a) => `
      <button class="card" data-album="${a.id}">
        ${art(a.artwork_track_id)}
        <div class="t1">${esc(a.album)}</div><div class="t2">${esc(a.artist || "")}</div>
      </button>`).join(""), grid,
      (n) => (title ? setTitle(title, n, "张") : setCount(n)));
    grid.onclick = (e) => { const c = e.target.closest("[data-album]"); if (c) open("album", c.dataset.album); };
  }

  /* ---------- 专辑详情 ---------- */
  async function albumDetail(albumId) {
    reset(empty("加载中…"));
    const [info, tr] = await Promise.all([LMS.albums(0, 1, ["album_id:" + albumId]), LMS.albumTracks(albumId)]);
    const a = (info.albums_loop || [])[0] || {};
    const tracks = tr.titles_loop || [];
    const coverId = a.artwork_track_id || (tracks[0] && (tracks[0].coverid || tracks[0].artwork_track_id));
    const totalSec = tracks.reduce((s, t) => s + Number(t.duration || 0), 0);
    setTitle(a.album || "专辑");
    content().innerHTML = `
      <div class="album-head">
        ${art(coverId, 300)}
        <div style="min-width:0">
          <h2>${esc(a.album || "未知专辑")}</h2>
          <div class="artist">${esc(a.artist || "未知艺人")}</div>
          <div class="meta">${[a.year && a.year !== 0 ? a.year : "", tracks.length + " 首", fmtTime(totalSec)].filter(Boolean).join(" · ")}</div>
          ${tracks.length ? selectAllBtn(`<button class="pill" data-addall>＋ 整张加入</button>`) : ""}
        </div>
      </div>
      ${trackTable(tracks, { num: true })}`;
    bindTracks((e) => {
      if (e.target.closest("[data-addall]")) {
        act(async () => { await LMS.loadAlbum(albumId, "add"); toast(`已把整张专辑（${tracks.length} 首）加到当前播放末尾`); });
      }
    });
    markPlaying(S.cur);
  }

  /* 详情页顶部的整体操作按钮（如「＋ 整张加入」） */
  const selectAllBtn = (extra = "") => extra ? `<div class="actions">${extra}</div>` : "";

  /* 行尾的「＋」：点一下把这一首（或这一项）加到当前播放末尾 */
  const PLUS = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;
  const CHECK = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const plusBtn = (attr) => `<button class="add-btn" ${attr} aria-label="加入当前播放">${PLUS}</button>`;
  /* 加入成功后「＋」短暂变成蓝色「✓」 */
  function flashDone(btn) {
    btn.classList.add("done");
    btn.innerHTML = CHECK;
    setTimeout(() => { btn.classList.remove("done"); btn.innerHTML = PLUS; }, 1200);
  }

  /* ---------- 喜爱：曲目行「＋」前面的心形，只用来添加 ----------
     进入列表时一律灰色空心；点击先问 LMS：已在喜爱里 → 提示「已在喜爱列表中」；
     不在 → 加入，这一行的心形变成实心红。移出喜爱只在「喜爱」页向左滑动。 */
  const HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2C6.9 16.4 3.6 13.4 3.6 9.5 3.6 7 5.5 5.1 8 5.1c1.6 0 3.1.8 4 2.1.9-1.3 2.4-2.1 4-2.1 2.5 0 4.4 1.9 4.4 4.4 0 3.9-3.3 6.9-8.4 10.7z"/></svg>`;
  const favBtn = () => `<button class="fav-btn" data-fav aria-label="加入喜爱">${HEART}</button>`;
  function addFav(btn) {
    const row = btn.closest("[data-id]");
    if (!row || btn.disabled) return;
    const id = row.dataset.id;
    btn.disabled = true;
    Promise.resolve(act(async () => {
      const ex = await LMS.favExists(id);
      if (btn.classList.contains("on")) {   // 已是实心红：再点即取消喜爱，变回空心灰
        if (Number(ex.exists)) await LMS.favDelete(ex.index);
        btn.classList.remove("on");
        return toast(`已从喜爱移除：${row.dataset.title || ""}`);
      }
      if (Number(ex.exists)) {   // 已在喜爱里：提示，并把心形刷新成实心红
        btn.classList.add("on");
        return toast("已在喜爱列表中");
      }
      const t = await LMS.trackUrl(id);
      if (!t.url) throw new Error("找不到这首歌的文件地址");
      await LMS.favAdd(t.url, t.title || row.dataset.title || "");
      btn.classList.add("on");
      toast(`已加入喜爱：${row.dataset.title || t.title || ""}`);
    }, "加入喜爱失败")).finally(() => { btn.disabled = false; });
  }

  /* 歌曲表格：点整行加入当前播放；最右一列是心形 */
  function trackTable(tracks, opt = {}) {
    if (!tracks.length) return empty("没有歌曲");
    return `<table class="tracks"><thead><tr>
      ${opt.num ? `<th class="num">#</th>` : ""}<th>标题</th><th class="dur">时长</th><th class="fav"></th>
    </tr></thead><tbody>${tracks.map((t, i) => trackRow(t, i, opt)).join("")}</tbody></table>`;
  }
  const trackRow = (t, i, opt) => `<tr data-i="${i}" data-id="${t.id}" data-title="${esc(t.title)}">
      ${opt.num ? `<td class="num">${esc(t.tracknum || i + 1)}</td>` : ""}
      <td class="ttl">${esc(t.title)}${opt.artist ? `<div class="sub">${esc([t.artist, t.album].filter(Boolean).join(" — "))}</div>` : ""}</td>
      <td class="dur">${t.duration ? fmtTime(t.duration) : ""}</td>
      <td class="fav">${favBtn()}</td></tr>`;

  /* ---------- 选曲：点单曲那一行，把它加到当前播放末尾 ----------
     加入成功后整行闪一下强调色；请求进行中再点同一行不重复加入 */
  function flashRow(row) {
    row.classList.remove("added");
    void row.offsetWidth;            // 连续点同一行时让动画重新开始
    row.classList.add("added");
    setTimeout(() => row.classList.remove("added"), 900);
  }
  function addRow(row, add, title) {
    if (row.dataset.busy) return;
    row.dataset.busy = "1";
    Promise.resolve(act(async () => {
      await add();
      toast(`已加入：${title || "1 首"}`);
      flashRow(row);
    })).finally(() => { delete row.dataset.busy; });
  }
  /* 选曲窗口里的点击：心形加入喜爱；单曲行加入当前播放；other 处理其余点击（进入目录、目录和整张的「＋」） */
  function bindTracks(other) {
    content().onclick = (e) => {
      const h = e.target.closest("[data-fav]");
      if (h) return addFav(h);
      if (!e.target.closest("[data-add], [data-addall]")) {
        const row = e.target.closest("tr[data-id], li[data-id]");
        if (row) return addRow(row, () => LMS.addTracks([row.dataset.id]), row.dataset.title);
      }
      if (other) other(e);
    };
  }

  /* ---------- 歌曲（全部，分页） ---------- */
  function songs(extra = []) {
    reset(`<table class="tracks"><thead><tr><th>标题</th><th class="dur">时长</th><th class="fav"></th></tr></thead><tbody id="tb"></tbody></table>`);
    setTitle("");   // 顶部已有「歌曲」
    const tb = document.getElementById("tb");
    pager = paged((s, n) => LMS.songs(s, n, extra), (r, s) => (r.titles_loop || []).map((t, i) => trackRow(t, s + i, { artist: true })).join(""),
      tb, (n) => setCount(n));
    bindTracks();
  }

  /* ---------- 通用列表 ---------- */
  function list(title, items, onPick) {
    // it.track：单曲（行尾心形，点整行加入）；it.add：
    //   目录（it.more，文件夹/收藏夹）→ 行尾「＋」整个加入，点行进入；
    //   单项（喜爱里的曲目）→ 没有「＋」，点整行加入
    const single = (it) => !it.track && it.add && !it.more;
    reset(items.length ? `<ul class="list" id="ls">${items.map((it, i) => `
      <li data-i="${i}"${it.track ? ` data-id="${it.id}" data-title="${esc(it.name)}"` : ""}${it.swipe ? ` data-swipe="${esc(it.swipe)}" data-title="${esc(it.name)}"` : ""}>
        ${it.lead || (it.thumb !== undefined ? thumb(it.thumb) : "")}
        <div class="grow">${esc(it.name)}${it.sub ? `<div class="sub">${esc(it.sub)}</div>` : ""}</div>
        ${it.track ? favBtn() : it.add && it.more ? plusBtn(`data-add="${i}"`) : ""}
        ${it.more ? `<span style="color:var(--text3)">›</span>` : ""}
      </li>`).join("")}</ul>` : empty("没有内容"));
    // title 为空：分类首页（文件夹、收藏），数量放窗口顶部；否则是子目录，数量放详情标题行
    if (title) setTitle(title, items.length, "项");
    else { setTitle(""); setCount(items.length); }
    bindTracks((e) => {
      const ab = e.target.closest("[data-add]");
      if (ab) return act(async () => { await items[ab.dataset.add].add(); toast(`已加入：${items[ab.dataset.add].name}`); flashDone(ab); });
      const li = e.target.closest("li[data-i]");
      if (!li) return;
      const it = items[li.dataset.i];
      if (single(it)) return addRow(li, it.add, it.name);
      onPick(it);
    });
  }

  /* 左栏条目（艺人 / 播放列表）：data-k 存条目 id，点选后右栏显示详情 */
  const leftItem = (id, name) => `<li data-k="${id}" data-name="${esc(name)}"><div class="grow">${esc(name)}</div></li>`;
  function leftList(hint, fetchPage, loopKey, nameKey, detailView) {
    reset(empty(hint));
    setTitle("");
    pickList().innerHTML = `<ul class="list" id="pl"></ul>`;
    const pl = document.getElementById("pl");
    listPager = paged(fetchPage, (r) => (r[loopKey] || []).map((x) => leftItem(x.id, x[nameKey])).join(""),
      pl, (n) => setCount(n), pickList());
    pl.onclick = (e) => {
      const li = e.target.closest("li[data-k]");
      if (li) pickLeft(li, detailView, { id: li.dataset.k, name: li.dataset.name });
    };
  }

  function artists() {
    leftList("选择艺人", (s, n) => LMS.artists(s, n), "artists_loop", "artist", "artist");
  }

  /* ---------- 文件夹：行首图标区分 磁盘 / 网络盘 / 目录 / 专辑目录 / 曲目 ---------- */
  const ICO = {
    drive: '<rect x="2.75" y="6.5" width="18.5" height="11" rx="2.5"/><path d="M6.5 12h6"/><circle cx="17" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
    net: '<rect x="3" y="3" width="18" height="9.5" rx="2.25"/><path d="M6.75 7.75h5.5M12 12.5v6M3.5 20.5h6.5M14 20.5h6.5"/><circle cx="12" cy="20.5" r="2"/>',
    folder: '<path d="M3 7.25A1.75 1.75 0 0 1 4.75 5.5h4.1l2 2.25h8.4A1.75 1.75 0 0 1 21 9.5v8.25a1.75 1.75 0 0 1-1.75 1.75H4.75A1.75 1.75 0 0 1 3 17.75z"/><path d="M3 10.25h18"/>',
    disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/><path d="M12 6.2a5.8 5.8 0 0 1 5.8 5.8M6.2 12a5.8 5.8 0 0 0 5.8 5.8"/>',
    track: '<path d="M10 17.5V4.5l9-1.75v3.5L10 8"/><circle cx="7.25" cy="17.6" r="2.75"/>',
    playlist: '<path d="M3.5 5.25h17M3.5 9.75h17M3.5 14.25h17M3.5 18.75h17"/>',
    other: '<path d="M6 2.75h8l4.5 4.5v14H6zM14 2.75v4.5h4.5"/>',
  };
  const svgOf = (k) => `<svg class="row-ico" viewBox="0 0 24 24" aria-hidden="true">${ICO[k]}</svg>`;
  const lead = (k, probe) => `<span class="lead lead-${k}"${probe ? ` data-probe="${probe}"` : ""}>${svgOf(k)}</span>`;

  /* 普通目录滚动到眼前时，看它的第一项：是曲目就是专辑目录 → 换成光盘图标，封面加载成功再换成封面 */
  const peekCache = new Map();   // folder_id -> { album, cover }
  async function peek(id) {
    if (peekCache.has(id)) return peekCache.get(id);
    const r = await LMS.folderPeek(id);
    const f = (r.folder_loop || [])[0];
    const p = f && f.type === "track" ? { album: true, cover: f.coverid || "" } : { album: false };
    peekCache.set(id, p);
    return p;
  }
  function paintLead(el, p) {
    if (!p.album) return;
    el.className = "lead lead-disc";
    el.innerHTML = svgOf("disc");
    if (!p.cover) return;
    const img = new Image();
    img.alt = "";
    img.onload = () => { el.innerHTML = ""; el.appendChild(img); el.classList.add("has-art"); };   // 失败就保持光盘图标
    img.src = LMS.cover(p.cover, 100);
  }
  function probeFolders(box) {
    const queue = [];
    let running = 0, stopped = false;
    const pump = () => {
      while (!stopped && running < 4 && queue.length) {   // 最多 4 个并发，别压垮 Daphile
        const el = queue.shift();
        running++;
        peek(el.dataset.probe).then((p) => { if (!stopped) paintLead(el, p); })
          .catch(() => {}).finally(() => { running--; pump(); });
      }
    };
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); queue.push(e.target); } });
      pump();
    }, { root: content(), rootMargin: "300px" });
    box.querySelectorAll(".lead[data-probe]").forEach((el) => io.observe(el));
    return { stop: () => { stopped = true; io.disconnect(); } };
  }

  /* ---------- 专辑目录（目录里直接有曲目）：顶部封面 + 专辑信息 + 「＋ 整张加入」，下面是曲目表 ---------- */
  const FMT = { flc: "FLAC", wav: "WAV", aif: "AIFF", alc: "ALAC", mp3: "MP3", aac: "AAC", mp4: "AAC", ogg: "Ogg",
    ops: "Opus", dsf: "DSD", dff: "DSD", wvp: "WavPack", ape: "APE", wma: "WMA" };
  const secOf = (d) => typeof d === "number" ? d : String(d || "").split(":").reduce((s, x) => s * 60 + Number(x || 0), 0);
  function fmtInfo(i) {
    const kind = FMT[i.type] || (i.type ? String(i.type).toUpperCase() : "");
    const rate = Number(i.samplerate) ? `${+(i.samplerate / 1000).toFixed(1)}kHz` : "";
    const bits = Number(i.samplesize) ? `${i.samplesize}bit` : "";
    return [kind, [rate, bits].filter(Boolean).join("/")].filter(Boolean).join(" ");
  }
  async function albumFolder(folderId, name, loop, depth, net) {
    reset(empty("加载中…"));
    const files = loop.filter((f) => f.type === "track");
    const others = loop.filter((f) => f.type !== "track");
    // 第一首的标签给出专辑名、艺人、年份、格式；再按 album_id 取干净的曲名和曲序（目录里给的是文件名）
    const info = await LMS.songInfo(files[0].id).catch(() => ({}));
    const byId = new Map();
    if (info.album_id) {
      const tr = await LMS.albumTracks(info.album_id).catch(() => ({}));
      (tr.titles_loop || []).forEach((t) => byId.set(String(t.id), t));
    }
    const tracks = files.map((f) => byId.get(String(f.id))
      || { id: f.id, title: f.filename.replace(/\.[^.]+$/, ""), duration: secOf(f.duration) });
    const cover = (files.find((f) => f.coverid) || {}).coverid || info.coverid || "";
    const total = tracks.reduce((s, t) => s + secOf(t.duration), 0);
    const year = Number(info.year) ? info.year : "";
    const meta = [year, tracks.length + " 首", total ? fmtTime(total) : "", fmtInfo(info)].filter(Boolean).join(" · ");
    // 目录里混了别的专辑的曲目（如合辑、榜单）：标题用目录名，艺人写「多位艺人」，免得把第一首的专辑当成整个目录
    const mixed = files.some((f) => !byId.has(String(f.id)));
    const albumName = mixed ? (name || info.album) : (info.album || name);
    const artistName = mixed ? "多位艺人" : (info.albumartist || info.artist);
    setTitle(name || info.album || "", tracks.length, "首");
    content().innerHTML = `
      <div class="album-head">
        ${art(cover, 300)}
        <div style="min-width:0">
          <h2>${esc(albumName || "未知专辑")}</h2>
          <div class="artist">${esc(artistName || "未知艺人")}</div>
          <div class="meta">${esc(meta)}</div>
          ${selectAllBtn(`<button class="pill" data-addall>＋ 整张加入</button>`)}
        </div>
      </div>
      ${trackTable(tracks, { num: true })}
      ${others.length ? `<ul class="list album-extra" id="ls">${others.map((f, i) => {
        const dir = f.type === "folder";
        return `<li data-o="${i}">
          ${lead(dir ? "folder" : f.type === "playlist" ? "playlist" : "other", dir ? f.id : "")}
          <div class="grow">${esc(f.filename)}</div>
          ${dir ? plusBtn(`data-add="${i}"`) + `<span style="color:var(--text3)">›</span>` : ""}
        </li>`; }).join("")}</ul>` : ""}`;
    bindTracks((e) => {
      if (e.target.closest("[data-addall]")) {
        return act(async () => { await LMS.loadFolder(folderId, "add"); toast(`已把整张专辑（${tracks.length} 首）加到当前播放末尾`); });
      }
      const ab = e.target.closest("[data-add]");
      if (ab) {
        const o = others[ab.dataset.add];
        return act(async () => { await LMS.loadFolder(o.id, "add"); toast(`已加入：${o.filename}`); flashDone(ab); });
      }
      const li = e.target.closest("li[data-o]");
      const o = li && others[li.dataset.o];
      if (o && o.type === "folder") open("folder", { id: o.id, name: o.filename, depth: depth + 1, net });
    });
    const box = document.getElementById("ls");
    if (box) pager = probeFolders(box);
    markPlaying(S.cur);
  }

  /* depth 0 = 顶层 Drives（Internal/Network/RAM），depth 1 = 卷（Daphile_Music、NAS）；这两层不显示「＋」 */
  async function folders(folderId, name, depth = 0, net = false) {
    const r = await LMS.folder(folderId);
    // 目录里直接有曲目 → 当作专辑显示（磁盘和卷那两层除外）
    if (depth >= 2 && (r.folder_loop || []).some((f) => f.type === "track")) {
      return albumFolder(folderId, name, r.folder_loop, depth, net);
    }
    const items = (r.folder_loop || []).map((f) => {
      const isDir = f.type === "folder";
      const sys = isDir && depth <= 1;                       // 磁盘或卷
      const isNet = net || (depth === 0 && /network/i.test(f.filename));
      const kind = sys ? (isNet ? "net" : "drive")
        : isDir ? "folder" : f.type === "track" ? "track" : f.type === "playlist" ? "playlist" : "other";
      return {
        name: f.filename, id: f.id, type: f.type, more: isDir, net: isNet,
        lead: lead(kind, isDir && !sys ? f.id : ""),
        sub: f.type === "track" && f.duration ? fmtTime(f.duration) : "",
        track: f.type === "track",
        add: isDir && !sys ? () => LMS.loadFolder(f.id, "add") : null,
      };
    });
    list(name || "", items, (f) => {
      if (f.type === "folder") open("folder", { id: f.id, name: f.name, depth: depth + 1, net: f.net });
    });
    const box = document.getElementById("ls");
    if (box) pager = probeFolders(box);   // 换页面时 reset() 会停掉它
  }

  async function playlists() {
    reset(empty("选择播放列表"));
    setTitle("");
    const r = await LMS.playlists();
    const pls = r.playlists_loop || [];
    setCount(pls.length);
    pickList().innerHTML = pls.length ? `<ul class="list" id="pl">${pls.map((p) => leftItem(p.id, p.playlist)).join("")}</ul>` : empty("没有播放列表");
    const pl = document.getElementById("pl");
    if (pl) pl.onclick = (e) => {
      const li = e.target.closest("li[data-k]");
      if (li) pickLeft(li, "playlist", { id: li.dataset.k, name: li.dataset.name });
    };
  }

  async function playlistDetail({ id, name }) {
    reset(empty("加载中…"));
    const r = await LMS.playlistTracks(id);
    const tracks = r.playlisttracks_loop || [];
    reset(`${tracks.length ? selectAllBtn(`<button class="pill" data-addall>＋ 整个加入</button>`) : ""}${trackTable(tracks, { artist: true })}`);
    setTitle(name, tracks.length, "首");
    bindTracks((e) => {
      if (e.target.closest("[data-addall]")) {
        act(async () => { await LMS.loadPlaylist(id, "add"); toast(`已把「${name}」（${tracks.length} 首）加到当前播放末尾`); });
      }
    });
  }

  async function favorites(arg) {
    const r = await LMS.favorites(arg && arg.id);
    // 行首：收藏夹用文件夹图标；曲目用专辑封面——image 为 music/<曲目id>/cover.png 时取该曲目封面，
    // 否则（LMS 通用占位图 html/images/cover.png，多为文件已移动、曲库里找不到）显示灰色圆角方块
    const coverFromImage = (img) => { const m = /^\/?music\/([^/]+)\/cover/.exec(img || ""); return m ? m[1] : ""; };
    const loop = r.loop_loop || [];
    const items = loop.map((f) => {
      const dir = Number(f.hasitems) > 0;
      return {
        // 喜爱页本身不显示心形；曲目向左滑动即移出喜爱（失效条目也能这样删掉）
        // f.id 形如 "e94ffc7d.8"：前面是会话号，后面才是删除要用的条目号（子目录里是 "3.2"）
        name: f.name, id: f.id, more: dir, swipe: !dir && Number(f.isaudio) > 0 ? String(f.id).replace(/^[0-9a-f]+\./i, "") : "",
        ...(dir ? { lead: lead("folder") } : { thumb: coverFromImage(f.image) }),
        add: Number(f.isaudio) ? () => LMS.addFavorite(f.id) : null,
      };
    });
    list(arg ? arg.name : "", items, (f) => {
      if (f.more) open("favorites", { id: f.id, name: f.name });
    });
  }

  /* ---------- 搜索（侧边栏「搜索」或顶部搜索框） ---------- */
  async function search(term) {
    setTitle("");   // 顶部已有「搜索」，详情里不再重复
    if (!term) { reset(empty("在上方搜索框输入艺人、专辑或歌曲")); document.getElementById("filter").focus(); return; }
    reset(empty("正在搜索…"));
    const r = await LMS.search(term);
    const al = r.albums_loop || [], ar = r.contributors_loop || [], tr = r.tracks_loop || [];
    if (!al.length && !ar.length && !tr.length) return reset(empty(`没有找到“${term}”`));
    content().innerHTML = `
      ${ar.length ? `<div class="section-h">艺人</div><ul class="list">${ar.map((a) => `<li data-artist="${a.contributor_id}" data-name="${esc(a.contributor)}"><div class="grow">${esc(a.contributor)}</div><span style="color:var(--text3)">›</span></li>`).join("")}</ul>` : ""}
      ${al.length ? `<div class="section-h">专辑</div><ul class="list">${al.map((a) => `<li data-album="${a.album_id}"><div class="grow">${esc(a.album)}</div><span style="color:var(--text3)">›</span></li>`).join("")}</ul>` : ""}
      ${tr.length ? `<div class="section-h">歌曲</div><ul class="list">${tr.map((t) => `<li data-id="${t.track_id}" data-title="${esc(t.track)}"><div class="grow">${esc(t.track)}</div>${favBtn()}</li>`).join("")}</ul>` : ""}`;
    bindTracks((e) => {
      const li = e.target.closest("li");
      if (!li) return;
      if (li.dataset.artist) open("artist", { id: li.dataset.artist, name: li.dataset.name });
      else if (li.dataset.album) open("album", li.dataset.album);
    });
  }

  /* ---------- 路由 ---------- */
  const ROUTES = {
    albums: (term) => albumGrid("", ["sort:album", ...(term ? ["search:" + term] : [])]),
    recent: () => albumGrid("", ["sort:new"]),
    album: (id) => albumDetail(id),
    artists: () => artists(),
    artist: (a) => albumGrid(a.name, ["artist_id:" + a.id, "sort:yearalbum"]),
    songs: () => songs(),
    folders: () => folders(null, ""),
    folder: (f) => folders(f.id, f.name, f.depth || 0, !!f.net),
    playlists: () => playlists(),
    playlist: (p) => playlistDetail(p),
    favorites: (f) => favorites(f),
    search: (term) => search(term),
  };
  const TOP = new Set(["albums", "recent", "artists", "songs", "folders", "playlists", "favorites", "search"]);

  let rootView = "albums";   // 从侧边栏打开的分类
  async function go(view, arg) {
    current = { view, arg };
    content().onclick = null;
    if (TOP.has(view)) setCols(view);   // 换分类时重设一栏/两栏；进入详情时左栏保持不动
    document.getElementById("btn-back").hidden = !stack.length;
    syncHead();
    try { await ROUTES[view](arg); } catch (e) { reset(empty("加载失败：" + e.message)); }
  }
  function open(view, arg) { if (current) stack.push(current); go(view, arg); }
  /* 选曲窗口：从左侧分类打开；关闭时向左缩回边栏后面，动画结束再隐藏 */
  let closeTok = 0;          // 缩回途中又被打开时，作废这次缩回
  const pickerOpen = () => {
    const p = document.getElementById("picker");
    return !p.hidden && !p.classList.contains("closing");
  };
  /* swiped：手指向左滑动关闭，窗口从松手的位置接着滑出，不再从头播放缩回动画 */
  function showPicker(on, swiped) {
    const p = document.getElementById("picker");
    const app = document.getElementById("app");
    const clearDrag = () => { p.style.transform = p.style.transition = ""; };
    if (on) {
      closeTok++;
      clearDrag();
      p.classList.remove("closing");
      p.hidden = false;
      app.classList.add("picker-open");
      return;
    }
    if (p.hidden) return;
    app.classList.remove("picker-open");   // 「当前播放」同时移回原位
    if (pager) { pager.stop(); pager = null; }
    if (listPager) { listPager.stop(); listPager = null; }
    current = null;
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    const tok = ++closeTok;
    const done = () => { if (tok !== closeTok) return; p.classList.remove("closing"); p.hidden = true; clearDrag(); };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return done();
    if (swiped) {
      p.style.transition = "transform .18s ease-in";
      p.style.transform = "translateX(-100%)";
      setTimeout(done, 200);
      return;
    }
    p.classList.add("closing");
    p.addEventListener("animationend", (e) => { if (e.target === p) done(); }, { once: true });
    setTimeout(done, 400);   // 兜底：动画事件没触发也能收起
  }
  function root(view) {
    stack.length = 0;
    rootView = view;
    document.getElementById("filter").value = "";
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    showPicker(true);
    go(view);
  }

  /* 正在播放的行高亮 */
  function markPlaying(cur) {
    const id = cur && String(cur.id);
    document.querySelectorAll(".tracks tr[data-id]").forEach((tr) => tr.classList.toggle("playing", tr.dataset.id === id));
  }

  /* ---------- 分隔条：拖动调节选曲窗口宽度（「当前播放」跟着让位），记在 localStorage，双击恢复默认 ---------- */
  const PW_KEY = "daphile.pickerW";
  const PW_MIN = 340, MAIN_MIN = 300;   // 与 style.css 里 --pw 的 clamp 保持一致
  function setPW(px) {
    const st = document.documentElement.style;
    if (px) st.setProperty("--picker-w", Math.round(px) + "px"); else st.removeProperty("--picker-w");
  }
  function bindResize() {
    try { const v = Number(localStorage.getItem(PW_KEY)); if (v > 0) setPW(v); } catch (e) { /* 无存储时用默认宽度 */ }
    const h = document.getElementById("picker-resize");
    const picker = document.getElementById("picker");
    const app = document.getElementById("app");
    h.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      app.classList.add("resizing");
      const left = picker.getBoundingClientRect().left;
      const max = innerWidth - left - MAIN_MIN;
      let w = picker.getBoundingClientRect().width;
      const move = (ev) => { w = Math.min(max, Math.max(PW_MIN, ev.clientX - left)); setPW(w); };
      const up = () => {
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", up);
        h.removeEventListener("pointercancel", up);
        app.classList.remove("resizing");
        try { localStorage.setItem(PW_KEY, String(Math.round(w))); } catch (err) { /* 记不住也不影响使用 */ }
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up);
      h.addEventListener("pointercancel", up);
    });
    h.addEventListener("dblclick", () => {
      setPW(0);
      try { localStorage.removeItem(PW_KEY); } catch (err) { /* 忽略 */ }
    });
  }

  /* ---------- 向左滑动关闭选曲窗口：窗口跟着手指左移，拉过窗口宽度 1/4（或快速一甩）松手即关闭，不够就弹回 ----------
     喜爱页的行（左滑是移出喜爱）、分隔条、输入框上不接管；竖向移动留给列表滚动 */
  /* 选曲窗口跟手左移（x ≤ 0）。窗口自己的左滑、喜爱行露出按钮后继续左滑，都用这一对函数 */
  let pd = null;
  function pickDrag(x, t) {
    const p = document.getElementById("picker");
    if (!pd) { pd = { x: 0, t: 0, v: 0 }; p.style.transition = "none"; }
    if (pd.t) pd.v = (x - pd.x) / Math.max(8, t - pd.t);        // 速度 px/ms，负数是向左
    pd.x = x; pd.t = t;
    p.style.transform = `translateX(${x}px)`;
  }
  /* 松手：拉过窗口宽度 1/4（或快速一甩）就关闭，不够就弹回；返回是否关闭 */
  function pickRelease(ok) {
    const p = document.getElementById("picker");
    if (!pd) return false;
    const { x, v } = pd;
    pd = null;
    if (ok && (-x > p.offsetWidth / 4 || (v < -0.6 && -x > 30))) { showPicker(false, true); return true; }
    p.style.transition = "transform .2s ease";
    p.style.transform = "";
    setTimeout(() => { if (!p.style.transform) p.style.transition = ""; }, 220);
    return false;
  }

  function bindSwipeClose() {
    const p = document.getElementById("picker");
    const START = 12;
    let g = null;
    p.addEventListener("pointerdown", (e) => {
      g = null;
      if (e.button > 0 || !pickerOpen()) return;
      if (e.target.closest("[data-swipe], #picker-resize, input, textarea, select")) return;
      g = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false };
    });
    p.addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.on) {
        if (Math.abs(dy) > START) { g = null; return; }            // 竖向：是滚动
        if (dx > -START || -dx < Math.abs(dy) * 1.5) return;        // 还没确定是向左横滑
        g.on = true;
        try { p.setPointerCapture(g.id); } catch (_) { /* 忽略 */ }
      }
      e.preventDefault();
      pickDrag(Math.min(0, dx + START), e.timeStamp);              // 扣掉起步的 12px，窗口不会突然一跳
    });
    const end = (ok) => (e) => {
      if (!g || e.pointerId !== g.id) return;
      const { on } = g;
      g = null;
      if (!on) return;
      swallowClick(p);                                             // 松手的 click 不当成点按
      pickRelease(ok);
    };
    p.addEventListener("pointerup", end(true));
    p.addEventListener("pointercancel", end(false));
  }

  function init() {
    bindResize();
    bindSwipeClose();
    // 喜爱页：向左滑动一行先露出红色「移出」按钮，松手就停住，再点按钮才移出喜爱；
    // 手指不松开继续左滑，就变成拖动选曲窗口（够远松手关闭），不会误删。
    // 删后 LMS 会重新编号，所以整页重读
    bindSwipe(content(), "li[data-swipe]", (li) => act(async () => {
      await LMS.favDelete(li.dataset.swipe);
      toast(`已从喜爱移除：${li.dataset.title || ""}`);
      if (current && current.view === "favorites") await go("favorites", current.arg);
    }, "移除失败"), { reveal: true, over: { drag: pickDrag, release: pickRelease } });
    document.getElementById("sidebar").addEventListener("click", (e) => {
      const b = e.target.closest(".nav-item[data-view]");
      if (!b || !TOP.has(b.dataset.view)) return;
      // 再点一次当前已打开的分类：缩回选曲窗口；点别的分类：切换过去
      if (pickerOpen() && rootView === b.dataset.view) showPicker(false);
      else root(b.dataset.view);
    });
    document.getElementById("btn-back").onclick = () => { const prev = stack.pop(); if (prev) go(prev.view, prev.arg); };
    document.getElementById("filter").addEventListener("input", (e) => {
      clearTimeout(filterTimer);
      const term = e.target.value.trim();
      filterTimer = setTimeout(() => {
        stack.length = 0;
        if (rootView === "albums" && term) go("albums", term);       // 专辑：就地筛选
        else if (term) go("search", term);                          // 其他：全库搜索（一栏）
        else go(rootView);                                          // 清空：回到原来的分类
      }, 350);
    });
    document.getElementById("btn-pick-close").onclick = () => showPicker(false);
    // 默认不打开选曲窗口，主区只显示「当前播放」。
    // 调试：?open=albums 打开某个分类；?open=album:<id> 直接打开某张专辑
    const o = new URLSearchParams(location.search).get("open");
    if (o) {
      const [v, id] = o.split(":");
      if (v === "album" && id) { root("albums"); open("album", id); }
      else if (TOP.has(v)) root(v);
    }
  }

  /* 保存新播放列表后：如果窗口正开着「所有播放列表」，重新载入左栏 */
  function refreshPlaylists() {
    if (pickerOpen() && rootView === "playlists") { stack.length = 0; go("playlists"); }
  }

  return { init, markPlaying, refreshPlaylists };
})();
