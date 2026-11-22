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
    const head = document.querySelector(".detail-head");
    head.hidden = back.hidden && !title;
  }
  /* 数量：和名称分开，灰色靠右。分类总数放窗口顶部（setCount），详情里的数量放详情标题行（setTitle 第二个参数） */
  const UNIT = { albums: "张", recent: "张", artists: "位", songs: "首",
    folders: "项", playlists: "个", favorites: "项", cd: "首" };
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

  /* ---------- 分栏：艺人用两栏（左列条目、右列详情），其余只用一栏 ---------- */
  const pickList = () => document.getElementById("pick-list");
  const TWO = new Set(["artists"]);
  const CAT = { albums: "专辑", recent: "最近添加", artists: "艺人", songs: "歌曲",
    folders: "文件夹", playlists: "播放列表", favorites: "我的喜爱", search: "搜索", cd: "CD播放器" };
  let listPager = null;      // 左栏的分页加载器
  let pickedAt = -1;         // 最近一次在左栏点选条目的时刻（performance.now）
  const cols = () => document.querySelector(".picker-cols");
  /* 两栏状态：浏览（左栏宽，默认 3/5）↔ 详情（选中条目后左栏让位，右栏默认 3/5） */
  const setDetail = (on) => { cols().classList.toggle("detail", on); if (!on) cols().classList.remove("deep"); };
  function setCols(view) {
    cols().classList.toggle("one", !TWO.has(view));
    setDetail(false);
    document.getElementById("pick-cat").textContent = CAT[view] || "";
    document.getElementById("pick-count").textContent = "";
    // 从侧栏「搜索」进来时，搜索框加长放到顶部正中；其他分类里输入查找时不跟着跳位置
    document.getElementById("picker").classList.toggle("is-search", rootView === "search");
    if (listPager) { listPager.stop(); listPager = null; }
    pickList().innerHTML = "";
    pickList().scrollTop = 0;
  }
  /* 左栏点选：高亮当前项，右栏换成它的详情（右栏不保留返回栈） */
  function pickLeft(li, view, arg) {
    pickList().querySelectorAll("li.on").forEach((x) => x.classList.remove("on"));
    li.classList.add("on");
    pickedAt = performance.now();
    setDetail(true);                       // 左栏向左缩，给右栏的详情让出位置
    stack.length = 0;
    current = null;
    go(view, arg);
  }

  /* ---------- 分页：滚动到底部自动加载下一页（root 为滚动容器，默认右栏） ---------- */
  function paged(fetchPage, renderItems, container, countLabel, root = content()) {
    let start = 0, total = Infinity, busy = false, dead = false;
    const sentinel = document.createElement("div");
    sentinel.className = "more-sentinel";
    container.after(sentinel);
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) more(); }, { root, rootMargin: "600px" });
    async function more() {
      if (busy || start >= total) return;
      busy = true;
      try {
        const r = await fetchPage(start, PAGE);
        if (dead) return;   // 这一页回来时已经换到别的页面了：不要把这里的数量写到别的页面的标题栏上
        total = Number(r.count || 0);
        if (countLabel) countLabel(total);
        const html = renderItems(r, start);
        container.insertAdjacentHTML("beforeend", html);
        markRows(S.cur);   // 新加载的一页也标出正在播放、已加入的曲目
        start += PAGE;
        if (!total) container.outerHTML = empty("没有内容");
      } catch (e) { toast("加载失败：" + e.message); }
      busy = false;
    }
    io.observe(sentinel);
    more();
    return { stop: () => { dead = true; io.disconnect(); } };
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
          ${fmtChips(tracks[0])}
          ${tracks.length ? selectAllBtn(`<button class="pill" data-addall>＋ 全部播放</button>`) : ""}
        </div>
      </div>
      ${trackTable(tracks, { num: true })}`;
    bindTracks((e) => {
      if (e.target.closest("[data-addall]")) {
        addOnce(e.target.closest("[data-addall]"), async () => { await LMS.loadAlbum(albumId, "add"); toast(`已把整张专辑（${tracks.length} 首）加到当前播放末尾`); });
      }
    });
    markRows(S.cur);
  }

  /* 详情页顶部的整体操作按钮（如「＋ 全部播放」） */
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

  /* 整张 / 整个 / 目录「＋」加入：请求进行中按钮变灰、不能再点，防止重复加入；当前播放标题行同时转圈 */
  function addOnce(btn, fn) {
    if (!btn || btn.dataset.busy) return;
    btn.dataset.busy = "1";
    btn.classList.add("busy");
    const pill = btn.classList.contains("pill"), label = btn.innerHTML;
    if (pill) btn.textContent = "正在加入…";
    return Promise.resolve(addAct(fn)).finally(() => {
      delete btn.dataset.busy;
      btn.classList.remove("busy");
      if (pill) btn.innerHTML = label;
    });
  }

  /* ---------- 喜爱：曲目行「＋」前面的心形 ----------
     进入列表时一律灰色空心；点击先问 LMS：已在喜爱里 → 提示「已在喜爱列表中」并变成实心红；
     不在 → 加入，这一行的心形变成实心红。实心红再点一次 → 移出喜爱，变回空心。
     成批移出喜爱在「我的喜爱」页标题栏的「删除」键（见 favorites()）。 */
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
    Promise.resolve(addAct(async () => {
      await add();
      toast(`已加入：${title || "1 首"}`);
      flashRow(row);
      if (row.dataset.id) row.classList.add("queued");   // 不等下一次刷新，立即变灰
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
      <li data-i="${i}"${it.track ? ` data-id="${it.id}" data-title="${esc(it.name)}"` : ""}>
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
      if (ab) return addOnce(ab, async () => { await items[ab.dataset.add].add(); toast(`已加入：${items[ab.dataset.add].name}`); flashDone(ab); });
      const li = e.target.closest("li[data-i]");
      if (!li) return;
      const it = items[li.dataset.i];
      if (it.tap) return it.tap(li);   // 例如喜爱里文件已不在的行：点了问怎么处理，不再加入
      if (single(it)) return addRow(li, it.add, it.name);
      onPick(it);
    });
    markRows(S.cur);
  }

  /* 左栏条目（艺人 / 播放列表）：data-k 存条目 id，点选后右栏显示详情 */
  const leftItem = (id, name, icon = "") => `<li data-k="${id}" data-name="${esc(name)}">${icon}<div class="grow">${esc(name)}</div></li>`;
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
    playlist: '<path d="M3.5 6h12M3.5 10.5h12M3.5 15h7.5M18.5 17.5V8.25l3-0.9"/><circle cx="16.25" cy="17.6" r="2.25"/>',
    other: '<path d="M6 2.75h8l4.5 4.5v14H6zM14 2.75v4.5h4.5"/>',
    artist: '<rect x="9" y="2.75" width="6" height="11.5" rx="3"/><path d="M5.75 11a6.25 6.25 0 0 0 12.5 0M12 17.25v3.5M8.75 20.75h6.5"/>',
    song: '<path d="M9 17.5V5.2l10-2.2v12.3"/><circle cx="6.6" cy="17.6" r="2.5"/><circle cx="16.6" cy="15.4" r="2.5"/>',
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

  /* ---------- 专辑目录（目录里直接有曲目）：顶部封面 + 专辑信息 + 「＋ 全部播放」，下面是曲目表 ---------- */
  const FMT = { flc: "FLAC", wav: "WAV", aif: "AIFF", alc: "ALAC", mp3: "MP3", aac: "AAC", mp4: "AAC", ogg: "Ogg",
    ops: "Opus", dsf: "DSD", dff: "DSD", wvp: "WavPack", ape: "APE", wma: "WMA" };
  const secOf = (d) => typeof d === "number" ? d : String(d || "").split(":").reduce((s, x) => s * 60 + Number(x || 0), 0);
  /* 格式小标签：和曲目信息面板一样，FLAC  16bit  44.1kHz 各占一块 */
  function fmtChips(i) {
    if (!i) return "";
    const kind = FMT[i.type] || (i.type ? String(i.type).toUpperCase() : "");
    const r = Number(i.samplerate) || 0, b = Number(i.samplesize) || 0;
    const rate = !r ? "" : r >= 1e6 ? `${+(r / 1e6).toFixed(1)}MHz` : `${+(r / 1000).toFixed(1)}kHz`;
    const list = [kind, b ? `${b}bit` : "", rate].filter(Boolean);
    return list.length ? `<div class="np-fmt">${list.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : "";
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
    const meta = [year, tracks.length + " 首", total ? fmtTime(total) : ""].filter(Boolean).join(" · ");
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
          ${fmtChips(info)}
          ${selectAllBtn(`<button class="pill" data-addall>＋ 全部播放</button>`)}
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
        return addOnce(e.target.closest("[data-addall]"), async () => { await LMS.loadFolder(folderId, "add"); toast(`已把整张专辑（${tracks.length} 首）加到当前播放末尾`); });
      }
      const ab = e.target.closest("[data-add]");
      if (ab) {
        const o = others[ab.dataset.add];
        return addOnce(ab, async () => { await LMS.loadFolder(o.id, "add"); toast(`已加入：${o.filename}`); flashDone(ab); });
      }
      const li = e.target.closest("li[data-o]");
      const o = li && others[li.dataset.o];
      if (o && o.type === "folder") open("folder", { id: o.id, name: o.filename, depth: depth + 1, net });
    });
    const box = document.getElementById("ls");
    if (box) pager = probeFolders(box);
    markRows(S.cur);
  }

  /* depth 是正在打开的这一层：0 = 文件夹首页（列出 Internal/Network/RAM Drives），1 = 打开磁盘（列出卷），
     2 = 打开卷本身（如 Daphile_Music、NAS），3 起才是卷里的文件夹。磁盘和卷不显示「＋」 */
  async function folders(folderId, name, depth = 0, net = false) {
    const r = await LMS.folder(folderId);
    // 卷里的文件夹直接放着曲目 → 当作专辑显示；卷本身（根目录散放几首歌也一样）仍按文件夹列出
    if (depth >= 3 && (r.folder_loop || []).some((f) => f.type === "track")) {
      return albumFolder(folderId, name, r.folder_loop, depth, net);
    }
    const items = (r.folder_loop || []).map((f) => {
      const isDir = f.type === "folder";
      const sys = isDir && depth <= 1;                       // 磁盘或卷
      const isNet = net || (depth === 0 && /network/i.test(f.filename));
      const kind = sys ? (isNet ? "net" : "drive")
        : isDir ? "folder" : f.type === "track" ? "track" : f.type === "playlist" ? "playlist" : "other";
      return {
        // 曲目去掉扩展名；musicfolder 给的时长是「6:40」这样的文字，要先换成秒
        name: f.type === "track" ? f.filename.replace(/\.[^.]+$/, "") : f.filename,
        id: f.id, type: f.type, more: isDir, net: isNet,
        lead: lead(kind, isDir && !sys ? f.id : ""),
        sub: f.type === "track" && secOf(f.duration) ? fmtTime(secOf(f.duration)) : "",
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

  /* ---------- 窗口标题栏的「删除」（喜爱、播放列表一览、播放列表里的曲目共用） ----------
     平时只有一个浅红色「删除」键；点它进入选择状态：点行打勾，标题栏变成「全选」「取消」「删除（N）」，
     点「删除（N）」弹窗确认后才删。没有「一键全部删除」，要全删就先点「全选」。
     opt.items 条目数组；opt.el 列表元素（加 selecting 类）；opt.rowSel 可勾选的行（带 data-i）；
     opt.ask(picks, all) 返回 ask() 的参数；opt.remove(picks) 执行删除并返回条数；opt.done(n) 提示文字；opt.reload() 删后重读；
     opt.tools() 可选：平时在「删除」前面多放的键（html，键上带 data-favtool），点了调 opt.tool(btn)。返回 draw()，供外部重画标题栏 */
  const TRASH = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13M10 11v5.5M14 11v5.5"/></svg>`;
  function selDelete(opt) {
    const me = current, mine = () => current === me;
    const box = document.getElementById("fav-tools"), el = opt.el, act0 = document.getElementById("view-act");
    let selecting = false, busy = false;
    const rows = () => (el ? [...el.querySelectorAll(opt.rowSel)] : []);
    const picked = () => rows().filter((r) => r.classList.contains("sel")).map((r) => opt.items[r.dataset.i]);
    const draw = () => {
      const n = picked().length;
      const all = !!opt.items.length && n === opt.items.length;
      box.innerHTML = selecting
        ? `<button class="pill fav-b" data-favpickall ${busy ? "disabled" : ""}>${all ? "全不选" : "全选"}</button>
           <button class="pill fav-b" data-favcancel ${busy ? "disabled" : ""}>取消</button>
           <button class="pill fav-main fav-del" data-favdo ${busy || !n ? "disabled" : ""}>${TRASH}删除${n ? `（${n}）` : ""}</button>`
        : `${opt.tools ? opt.tools() : ""}<button class="pill fav-main" data-favsome ${busy || !opt.items.length ? "disabled" : ""}>${TRASH}删除</button>`;
    };
    const select = (on) => {
      selecting = on;
      if (el) { el.classList.toggle("selecting", on); if (!on) rows().forEach((r) => r.classList.remove("sel")); }
      act0.hidden = on;   // 选择时先收起标题行里的「加入」「播放」，免得误点
      draw();
    };
    box.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled || !mine()) return;
      if (b.hasAttribute("data-favsome")) return select(true);
      if (b.hasAttribute("data-favtool")) return opt.tool && opt.tool(b);
      if (b.hasAttribute("data-favcancel")) return select(false);
      if (b.hasAttribute("data-favpickall")) {   // 全选；已经全选时再点就是全不选
        const rs = rows(), on = rs.some((r) => !r.classList.contains("sel"));
        rs.forEach((r) => r.classList.toggle("sel", on));
        return draw();
      }
      if (b.hasAttribute("data-favdo")) {
        const picks = picked();
        if (!picks.length) return;
        if (!await ask(opt.ask(picks, picks.length === opt.items.length)) || !mine()) return;
        busy = true; draw();
        try { const n = await opt.remove(picks); toast(opt.done(n)); } catch (err) { toast("删除失败：" + err.message); }
        busy = false;
        if (mine()) await opt.reload();   // 删后整页重读
      }
    };
    // 选择状态下点一行只打勾，不加入当前播放、不进入下一层
    const base = content().onclick;
    content().onclick = (e) => {
      if (!selecting) return base && base(e);
      const r = e.target.closest(opt.rowSel);
      if (!r || busy) return;
      r.classList.toggle("sel");
      draw();
    };
    draw();
    return draw;
  }
  const whatOf = (picks, all, unit) => picks.length === 1 ? `「${picks[0].name}」` : all ? `全部 ${picks.length} ${unit}` : `选中的 ${picks.length} ${unit}`;

  /* ---------- 播放列表：单列，每行「加入」「播放」；删除在窗口标题栏 ----------
     「播放」：清空当前播放、换成这个列表并从第一首开始放（先弹窗提示会清掉当前播放里的曲目）；
     确定播放后关闭选曲窗口，回到「当前播放」。「加入」：加到当前播放末尾，不自动播放，窗口不关。点行的其他地方进入列表看曲目，标题行同样有这两个键。 */
  // 和其他页面一致的圆钮：「播放」深灰圆 + 白三角，「加入」灰圆 + 「＋」（同专辑、目录行的加入键）
  const PLAY = `<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M5.5 3.3v9.4L13 8z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
  const plBtns = (id, name) => `<span class="pl-acts" data-plid="${esc(id)}" data-plname="${esc(name)}">
      <button class="add-btn pl-play" data-plplay aria-label="播放这个播放列表" title="播放">${PLAY}</button>
      <button class="add-btn" data-pladd aria-label="加入当前播放" title="加入当前播放">${PLUS}</button></span>`;
  async function plAct(e) {
    const b = e.target.closest("[data-pladd], [data-plplay]");
    if (!b || b.disabled || b.dataset.busy) return !!b;
    const box = b.closest("[data-plid]"), id = box.dataset.plid, name = box.dataset.plname;
    // 进行中：这一组键都不能再点（「加入」键自己由 addOnce 变灰，成功后短暂变成蓝色「✓」）
    const busy = (on, self = true) => box.querySelectorAll("button").forEach((x) => { if (x !== b || self) x.disabled = on; });
    if (b.hasAttribute("data-pladd")) {
      busy(true, false);
      await addOnce(b, async () => { await LMS.loadPlaylist(id, "add"); toast(`已把「${name}」加到当前播放末尾`); flashDone(b); });
      busy(false);
    } else {
      const n = (S.st && Number(S.st.playlist_tracks)) || 0;
      if (!await ask({ title: `播放「${name}」？`,
        msg: n ? `当前播放列表里的 ${n} 首曲目会被清除，换成这个播放列表，并从第一首开始播放。` : "将把这个播放列表放进当前播放，并从第一首开始播放。",
        ok: "播放", danger: !!n })) return true;
      // 确定后关掉选曲窗口，回到「当前播放」看新换上的列表（滚回顶部，从第一首看起）
      showPicker(false);
      const cl = document.getElementById("cur-list"); if (cl) cl.scrollTop = 0;
      busy(true);
      await act(async () => {
        if (S.st && Number(S.st.power) !== 1) await LMS.power(1);
        await LMS.loadPlaylist(id, "load");
        toast(`正在播放「${name}」`);
      }, "播放失败");
      busy(false);
    }
    return true;
  }

  async function playlists() {
    reset(empty("加载中…"));
    setTitle("");
    const me = current;
    const r = await LMS.playlists();
    if (current !== me) return;
    const pls = r.playlists_loop || [];
    const items = pls.map((p) => ({ id: String(p.id), name: p.playlist }));
    setCount(pls.length);
    reset(pls.length ? `<ul class="list pl-list" id="pl">${items.map((p, i) => `
      <li data-i="${i}" data-k="${esc(p.id)}" data-name="${esc(p.name)}">${lead("playlist")}<div class="grow">${esc(p.name)}</div>${plBtns(p.id, p.name)}</li>`).join("")}</ul>` : empty("没有播放列表"));
    content().onclick = async (e) => {
      if (await plAct(e)) return;
      const li = e.target.closest("li[data-k]");
      if (li) open("playlist", { id: li.dataset.k, name: li.dataset.name });
    };
    selDelete({
      items, el: document.getElementById("pl"), rowSel: "li[data-i]",
      ask: (picks, all) => ({ title: "删除播放列表？", msg: `将从 LMS 删除${whatOf(picks, all, "个播放列表")}，删除后无法恢复。只删列表，不删音乐文件；当前播放不受影响。`, ok: "删除", danger: true, icon: "trash" }),
      remove: async (picks) => {   // 删之前再读一次，名称和编号对不上就不删
        const now = new Map(((await LMS.playlists()).playlists_loop || []).map((p) => [String(p.id), p.playlist]));
        if (picks.some((p) => now.get(p.id) !== p.name)) throw new Error("播放列表刚刚有变化，请重新选择");
        for (const p of picks) await LMS.deletePlaylist(p.id);
        return picks.length;
      },
      done: (n) => `已删除 ${n} 个播放列表`,
      reload: () => go("playlists"),
    });
  }

  /* 播放列表里的曲目：「‹ 名称 N 首」，右侧「加入」「播放」；点曲目行把这一首加到当前播放末尾。
     窗口标题栏的「删除」用来从这个播放列表里删曲目（LMS 的 playlists edit cmd:delete，按位置删）：
     每删一首后面的位置都会往前挪，所以从后往前删；删之前再读一次曲目，位置和曲目对不上就不删 */
  async function playlistDetail(arg) {
    const { id, name } = arg;
    reset(empty("加载中…"));
    const me = current;
    const r = await LMS.playlistTracks(id);
    if (current !== me) return;
    const tracks = r.playlisttracks_loop || [];
    reset(tracks.length ? trackTable(tracks, { artist: true }) : empty("这个播放列表是空的"));
    setTitle(name, tracks.length, "首");
    const act0 = document.getElementById("view-act");
    act0.innerHTML = plBtns(id, name);
    act0.onclick = (e) => plAct(e);
    syncHead();
    bindTracks(() => {});
    const items = tracks.map((t, i) => ({ i, id: String(t.id), name: t.title || "" }));
    selDelete({
      items, el: content().querySelector(".tracks"), rowSel: "tbody tr[data-i]",
      ask: (picks, all) => ({ title: "从播放列表删除？",
        msg: `将把${whatOf(picks, all, "首")}从「${name}」里删除${all ? "，这个播放列表会变成空的（列表本身保留）" : ""}。只是移出这个播放列表，不会删除音乐文件；当前播放不受影响。`,
        ok: "删除", danger: true, icon: "trash" }),
      remove: async (picks) => {
        const now = (await LMS.playlistTracks(id)).playlisttracks_loop || [];
        if (now.length !== tracks.length || picks.some((p) => !now[p.i] || String(now[p.i].id) !== p.id)) throw new Error("播放列表刚刚有变化，请重新选择");
        for (const p of [...picks].sort((a, b) => b.i - a.i)) await LMS.playlistDeleteTrack(id, p.i);
        return picks.length;
      },
      done: (n) => `已从「${name}」删除 ${n} 首`,
      reload: () => go("playlist", arg),
    });
  }

  /* 我的喜爱。删除不用左滑（和「向左滑关闭窗口」抢手势），用窗口标题栏的「删除」（见 selDelete）。
     LMS 每删一项，后面的条目号都会往前挪，所以从号大的往号小的删；删之前再读一次列表核对，对不上就不删 */
  const favKey = (f) => String(f.id).replace(/^[0-9a-f]{8}\./i, "");   // "e94ffc7d.8" → "8"；子目录里是 "3.2"
  const favLast = (k) => Number(String(k).split(".").pop());
  async function favRemove(arg, picks) {
    const now = (await LMS.favorites(arg && arg.id)).loop_loop || [];
    const map = new Map(now.map((f) => [favKey(f), f]));
    if (picks.some((p) => { const f = map.get(p.key); return !f || f.name !== p.name || (f.url || "") !== p.url; })) throw new Error("喜爱列表刚刚有变化，请重新选择");
    for (const p of [...picks].sort((a, b) => favLast(b.key) - favLast(a.key))) await LMS.favDelete(p.key);
    return picks.length;
  }
  /* 喜爱核对：LMS 的喜爱只记文件路径，文件被删、改名、换格式后，这一项就放不出来了。
     打开「我的喜爱」时到磁盘上看一眼（readdirectory 只读目录，不碰曲库）：
     - 文件还在：不动；
     - 文件不在，但同一文件夹里有同名不同格式的音乐文件（如 .wav 换成了 .flac）：标「已换成 FLAC」，可一键更新；
     - 都找不到：标「文件已不在」，点这一行问要不要从喜爱删除。
     所在的盘（如 NAS）整个读不到时当成暂时离线，什么都不标，免得误报。 */
  const AUDIO_EXT = /\.(flac|wav|aiff?|m4a|alac|ape|dsf|dff|mp3|ogg|oga|opus|wv|mp4|aac|wma|mpc)$/i;
  const fileOf = (url) => { try { return decodeURIComponent(String(url).replace(/^file:\/\//, "").replace(/#.*$/, "")); } catch (_) { return ""; } };
  const splitPath = (path) => { const i = path.lastIndexOf("/"); return [path.slice(0, i), path.slice(i + 1)]; };
  const stem = (n) => n.replace(/\.[^.]+$/, "");
  const extOf = (n) => (/\.([^.]+)$/.exec(n) || ["", ""])[1].toUpperCase();
  async function favCheck(items) {
    const songs = items.filter((it) => !it.more && /^file:\/\//.test(it.url));
    if (!songs.length) return 0;
    const roots = await LMS.mediaDirs().catch(() => []);
    const dirs = new Map(), mounts = new Map();
    const list = async (d) => { if (!dirs.has(d)) dirs.set(d, LMS.dirList(d).then((r) => (r.fsitems_loop || []).map((x) => x.name)).catch(() => null)); return dirs.get(d); };
    // 所在的盘：音乐根目录下的头两级（如 Network Drives/NAS）；读不到任何东西就当离线
    const mountOf = (path) => {
      const root = roots.find((r) => path.startsWith(r.replace(/\/$/, "") + "/"));
      if (!root) return "";
      const rest = path.slice(root.replace(/\/$/, "").length + 1).split("/");
      return root.replace(/\/$/, "") + "/" + rest.slice(0, Math.min(2, rest.length - 1)).join("/");
    };
    const online = async (path) => {
      const m = mountOf(path);
      if (!mounts.has(m)) mounts.set(m, list(m).then((n) => !!(n && n.length)));
      return mounts.get(m);
    };
    let bad = 0;
    for (const it of songs) {
      const path = fileOf(it.url);
      if (!path || !mountOf(path)) continue;        // 不在音乐目录里（或读不到设置）：判断不了，不标
      const [dir, name] = splitPath(path);
      const names = await list(dir);
      if (names === null) continue;                 // 查询失败：不下结论
      if (names.includes(name)) continue;           // 文件还在
      if (!names.length && !(await online(path))) continue;   // 整个盘读不到：可能暂时离线
      const twin = it.url.includes("#") ? null : names.find((n) => n !== name && stem(n) === stem(name) && AUDIO_EXT.test(n));
      it.gone = twin ? { dir, name, twin } : { dir, name };
      bad++;
    }
    return bad;
  }
  /* 把一项喜爱换成同一文件夹里的新文件：在原位置插入新的，再删掉原来那项（插入后它往后挪了一位）。
     新文件的 url 用 LMS 自己给的写法（括号、& 等它不转义，自己拼会对不上）；新文件已经在喜爱里了，就只删旧的 */
  async function favReplace(arg, picks) {
    const now = (await LMS.favorites(arg && arg.id)).loop_loop || [];
    const map = new Map(now.map((f) => [favKey(f), f]));
    if (picks.some((p) => { const f = map.get(p.key); return !f || f.name !== p.name || (f.url || "") !== p.url; })) throw new Error("喜爱列表刚刚有变化，请重新打开");
    // 先查好每一项的新文件 url；同一个新文件对应几项（同一首收藏了两次）时，只把最前面那项换成新文件，其余的删掉
    const have = new Set(now.map((f) => f.url)), jobs = [];
    for (const p of picks) {
      const dirUrl = p.url.slice(0, p.url.lastIndexOf("/"));
      const hit = ((await LMS.folderFiles(dirUrl)).folder_loop || []).find((x) => x.url && fileOf(x.url).endsWith("/" + p.gone.twin));
      if (hit) jobs.push({ p, url: hit.url });
    }
    const first = new Map();
    for (const j of [...jobs].sort((a, b) => favLast(a.p.key) - favLast(b.p.key))) if (!have.has(j.url) && !first.has(j.url)) first.set(j.url, j);
    // 从号大的往号小的做：原位插入再删旧的，条目数不变；只删的那种只影响后面的号
    let n = 0;
    for (const { p, url } of jobs.sort((a, b) => favLast(b.p.key) - favLast(a.p.key))) {
      if (first.get(url) && first.get(url).p === p) {
        const title = p.name === p.gone.name ? p.gone.twin : p.name;   // 名字原来就是文件名时跟着换，自己起的名字保留
        await LMS.favAddAt(p.key, url, title);
        const parts = String(p.key).split(".");
        parts[parts.length - 1] = String(favLast(p.key) + 1);
        await LMS.favDelete(parts.join("."));
      } else await LMS.favDelete(p.key);
      n++;
    }
    return n;
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
        name: f.name, id: f.id, more: dir, key: favKey(f), url: f.url || "",
        ...(dir ? { lead: lead("folder") } : { thumb: coverFromImage(f.image) }),
        add: Number(f.isaudio) ? () => LMS.addFavorite(f.id) : null,
      };
    });
    list(arg ? arg.name : "", items, (f) => {
      if (f.more) open("favorites", { id: f.id, name: f.name });
    });
    const me = current, mine = () => current === me;
    const reload = () => go("favorites", arg);
    const fixable = () => items.filter((it) => it.gone && it.gone.twin);
    const fixAll = async (picks) => {
      if (!picks.length) return;
      const one = picks.length === 1 ? picks[0] : null;
      if (!await ask({ title: "更新喜爱？", icon: "restart", ok: "更新",
        msg: one ? `「${one.gone.name}」已不在，同一文件夹里有「${one.gone.twin}」。\n把这一项换成新文件？`
          : `${picks.length} 项喜爱的原文件已不在，同一文件夹里都有同名的新格式文件（如 .wav 换成了 .flac）。\n把它们换成新文件？位置不变。` }) || !mine()) return;
      try { const n = await favReplace(arg, picks); toast(n ? `已更新 ${n} 项喜爱` : "没找到新文件，未更新"); } catch (e) { toast("更新失败：" + e.message); }
      if (mine()) reload();
    };
    const draw = selDelete({
      items, el: document.getElementById("ls"), rowSel: "li[data-i]",
      ask: (picks, all) => ({ title: "从喜爱删除？", msg: `将把${picks.length === 1 ? `「${picks[0].name}」` : all ? `这里的全部 ${picks.length} 项` : `选中的 ${picks.length} 项`}从「我的喜爱」里删除。只是移出喜爱，不会删除音乐文件。`, ok: "删除", danger: true, icon: "trash" }),
      remove: (picks) => favRemove(arg, picks),
      done: (n) => `已从喜爱删除 ${n} 项`,
      reload,   // 删后 LMS 重新编号，整页重读
      tools: () => (fixable().length ? `<button class="pill fav-b fav-fix" data-favtool>更新（${fixable().length}）</button>` : ""),
      tool: () => fixAll(fixable()),
    });
    // 列表先显示出来，再到磁盘上核对；核对完给失效的行加标记
    if (!(await favCheck(items)) || !mine()) return;
    const ls = document.getElementById("ls");
    items.forEach((it, i) => {
      if (!it.gone) return;
      const li = ls && ls.querySelector(`li[data-i="${i}"]`);
      if (!li) return;
      li.classList.add("fav-gone");
      const g = li.querySelector(".grow");
      g.insertAdjacentHTML("beforeend", `<div class="sub gone">${it.gone.twin ? `已换成 ${esc(extOf(it.gone.twin))}：${esc(it.gone.twin)}` : "文件已不在（被删除、改名或移动）"}</div>`);
      it.tap = it.gone.twin ? () => fixAll([it]) : async () => {
        if (!await ask({ title: "文件已不在", icon: "trash", danger: true, ok: "从喜爱删除",
          msg: `「${it.name}」在原来的位置找不到了，可能被删除、改名或移动过，放不出来。\n从「我的喜爱」里删除这一项？（不会删除任何音乐文件）` }) || !mine()) return;
        try { await favRemove(arg, [it]); toast("已从喜爱删除 1 项"); } catch (e) { toast("删除失败：" + e.message); }
        if (mine()) reload();
      };
    });
    draw();
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
      ${ar.length ? `<div class="section-h">艺人</div><ul class="list">${ar.map((a) => `<li data-artist="${a.contributor_id}" data-name="${esc(a.contributor)}">${lead("artist")}<div class="grow">${esc(a.contributor)}</div><span style="color:var(--text3)">›</span></li>`).join("")}</ul>` : ""}
      ${al.length ? `<div class="section-h">专辑</div><ul class="list">${al.map((a) => `<li data-album="${a.album_id}" data-name="${esc(a.album)}">${lead("disc")}<div class="grow">${esc(a.album)}</div>${plusBtn(`data-add="${a.album_id}"`)}<span style="color:var(--text3)">›</span></li>`).join("")}</ul>` : ""}
      ${tr.length ? `<div class="section-h">歌曲</div><ul class="list">${tr.map((t) => `<li data-id="${t.track_id}" data-title="${esc(t.track)}">${lead("song")}<div class="grow">${esc(t.track)}</div>${favBtn()}</li>`).join("")}</ul>` : ""}`;
    bindTracks((e) => {
      const ab = e.target.closest("[data-add]");
      if (ab) {   // 专辑行的「＋」：整张加到当前播放末尾，不进入专辑
        const nm = ab.closest("li").dataset.name;
        return addOnce(ab, async () => { await LMS.loadAlbum(ab.dataset.add, "add"); toast(`已加入：${nm}`); flashDone(ab); });
      }
      const li = e.target.closest("li");
      if (!li) return;
      if (li.dataset.artist) open("artist", { id: li.dataset.artist, name: li.dataset.name });
      else if (li.dataset.album) open("album", li.dataset.album);
    });
    markRows(S.cur);
  }

  /* ---------- 路由 ---------- */
  /* ---------- CD播放器（LMS 的 CDplayer 插件） ---------- */
  /* 插件报错文字末尾括号里是光驱状态码：-1 打不开设备（没接光驱）、1 没放盘、2 仓门开着、3 没准备好、101–104 数据盘 */
  const CD_ERR = {
    "-1": ["nodrive", "没有检测到 CD 机", "请把光驱接到 Daphile 主机上，再点右上角「重新读取」。", -1],
    "0": ["reading", "正在读盘...", ""],   // 光驱说不出自己的状态：仓门在走、刚收进去时都是这样
    "1": ["empty", "请放入音乐CD", "读取到光盘会自动显示", 1],
    "2": ["empty", "请放入音乐CD", "读取到光盘会自动显示", 2],
    "3": ["reading", "正在读盘...", ""],
  };
  function cdError(msg) {
    const m = /\((-?\d+)(?: but true)?\)\s*$/.exec(msg || ""), code = m ? m[1] : "";
    if (CD_ERR[code]) return CD_ERR[code];
    if (/^10[1-4]$/.test(code)) return ["nodisc", "这不是音乐 CD", "光驱里是数据光盘，放不了。请换一张音乐 CD。"];
    if (/in use|another user/i.test(msg)) return ["busy", "CD 机正忙", "另一个设备正在读盘，等几秒再点右上角「重新读取」。"];
    if (/failed to get response/i.test(msg)) return ["nodb", "连不上 CD 曲名服务器", ""];
    if (/No CD in drive/i.test(msg)) return ["unread", "读不出这张光盘", "光盘可能放反了、太脏或有划痕。取出检查后再点右上角「重新读取」。"];
    return ["fail", "读取 CD 失败", String(msg || "")];
  }
  /* 「01. 曲名 (4:52.65)」→ 曲名和秒数；曲目地址里带轨号、专辑名、艺人、每轨起点和长度（1/75 秒） */
  function cdTrack(it, i) {
    const url = (it.presetParams && it.presetParams.favorites_url) || "";
    const qs = new URLSearchParams(url.split("?")[1] || "");
    const m = /^(?:(\d+)\.\s*)?(.*?)\s*\((\d+):(\d+)(?:\.\d+)?\)\s*$/.exec(it.text || "");
    const len = Number(qs.get("Lengths")) || 0;
    return {
      url, num: Number((/^cdplay:\/\/(\d+)/.exec(url) || [])[1]) || i + 1,
      title: (qs.get("TrackTitle") || (m && m[2]) || it.text || "").trim(),
      artist: (qs.get("TrackArtist") || qs.get("AlbumArtist") || "").trim(),
      album: (qs.get("AlbumTitle") || "").trim(), albumArtist: (qs.get("AlbumArtist") || "").trim(),
      duration: len ? len / 75 : m ? Number(m[3]) * 60 + Number(m[4]) : 0,
      offset: Number(qs.get("Offsets")) || 0, len,
    };
  }

  /* 读盘：返回 { ok, tracks, named, canEject } 或 { ok:false, err:[kind, 标题, 说明] }。
     根菜单里：type=playlist 且不是「raw format」的是查到曲名的版本，raw 只有轨号，Eject 表示能退盘 */
  async function cdRead() {
    let r = await LMS.cdItems(), nodb = false;
    // 曲名服务器连不上：插件整个报错，但光盘目录它已经读到了。带一个 item_id 再问一次，
    // 插件就直接给出已有的结果（只有轨号的列表），CD 照样能放
    if (r.networkerror && cdError(r.networkerror)[0] === "nodb") {
      nodb = true;
      r = await LMS.cdItems(Math.random().toString(16).slice(2, 10).padEnd(8, "0"));
    }
    const items = r.item_loop || [];
    if (r.networkerror || !items.length) return { ok: false, err: cdError(r.networkerror || (nodb ? "failed to get response" : "")) };
    const urlOf = (x) => (x.presetParams && x.presetParams.favorites_url) || "";
    const canEject = items.some((x) => /Command=eject/.test(urlOf(x)));
    const lists = items.filter((x) => x.type === "playlist");
    const raw = lists.find((x) => /CD-RAW\.opml/.test(urlOf(x)));
    const named = lists.find((x) => x !== raw);
    if (!named && !raw) return { ok: false, canEject, err: cdError("No CD in drive") };
    const read = async (x) => ((await LMS.cdItems(x.params.item_id)).item_loop || []).filter((t) => t.type === "audio").map(cdTrack);
    // 带曲名的那一项要再向曲名服务器取一次曲目；取不到（断网、超时）就退回只有轨号的列表
    let tracks = [], gotNames = false;
    if (named) { try { tracks = await read(named); gotNames = tracks.length > 0; } catch (_) { /* 退回轨号列表 */ } }
    if (!tracks.length && raw) { tracks = await read(raw); if (named) nodb = true; }
    if (!tracks.length) return { ok: false, canEject, err: cdError("No CD in drive") };
    return { ok: true, tracks, named: gotNames, canEject, nodb };
  }

  /* 封面：插件不给封面。用每轨起点拼出光盘目录，到 MusicBrainz 查这张盘，再从 Cover Art Archive 取正面图。
     同一份目录可能对上几张不同的盘，所以只在专辑名对得上（或只有一个结果）时才用；查不到、连不上就显示光盘图标。
     结果按目录记在 localStorage，同一张盘不重复查 */
  async function cdCover(tracks, album) {
    const last = tracks[tracks.length - 1];
    if (!last || !last.len || !tracks[0].offset) return "";
    const toc = [1, tracks.length, last.offset + last.len, ...tracks.map((t) => t.offset)].join("+");
    const key = "daphile.cdcover." + toc;
    try { const c = localStorage.getItem(key); if (c !== null) return c; } catch (_) { /* 记不住就每次查 */ }
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 8000);
    let url = "";
    try {
      const res = await fetch(`https://musicbrainz.org/ws/2/discid/-?toc=${toc}&fmt=json&cdstubs=no`, { signal: ctl.signal });
      if (!res.ok) return "";
      const rel = ((await res.json()).releases || []).filter((x) => x["cover-art-archive"] && x["cover-art-archive"].front);
      const norm = (s) => String(s || "").toLowerCase().replace(/[\s\p{P}]/gu, "");
      const hit = rel.find((x) => album && norm(x.title) === norm(album)) || (rel.length === 1 && !album ? rel[0] : null);
      if (hit) url = `https://coverartarchive.org/release/${hit.id}/front-500`;
    } catch (_) { return ""; } finally { clearTimeout(tm); }
    try { localStorage.setItem(key, url); } catch (_) { /* 同上 */ }
    return url;
  }

  /* CD 页：标准专辑页样式 */
  const DISC = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/><path d="M12 6.2a5.8 5.8 0 0 1 5.8 5.8M6.2 12a5.8 5.8 0 0 0 5.8 5.8"/></svg>`;
  const EJECT = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 2.6 13.4 9H2.6z" fill="currentColor"/><path d="M2.8 12.4h10.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  /* 窗口右上角的两个按键（管的是光驱，不属于哪张专辑）：重新读取、弹出。
     弹出：检测到 CD 机 → 黑色实心可点；没检测到 → 灰色不可点，字样换成「无 CD 机」。busy：读盘或仓门在动时两个都先不让点 */
  const cdTools = (drive, busy) => {
    const box = document.getElementById("cd-tools");
    box.innerHTML = `<button class="pill pill-line" data-cdreload ${busy ? "disabled" : ""}>重新读取</button>
      <button class="pill cd-eject${drive === false ? " none" : ""}" data-cdeject ${busy || drive === false ? "disabled" : ""}>${EJECT}${drive === false ? "无 CD 机" : "弹出"}</button>`;
    box.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled || !current || current.view !== "cd") return;
      if (b.hasAttribute("data-cdreload")) { cdKeep = null; go("cd"); } else cdEject();
    };
  };
  const cdMsg = (title, tip, spin) => `<div class="empty cd-msg"><span class="cd-big${spin ? " spin" : ""}">${DISC}</span>${title ? `<b>${esc(title)}</b>` : ""}${tip ? `<span>${esc(tip)}</span>` : ""}</div>`;
  const cdKey = (url) => { const m = /^cdplay:\/\/(\d+)\?.*?Offsets=(\d+)/.exec(url || ""); return m ? m[1] + "@" + m[2] : ""; };
  /* CD 页。读盘 → 显示；没有光盘（或仓门开着、正在读盘、光驱忙）时隔一秒再看一次，放进新光盘就自动读出来。
     只在 CD 页开着、网页在前台时才看；光驱里没盘时这一问只查状态，不会让光驱转 */
  let cdSeq = 0, cdTimer = 0, cdNow = null;
  /* 暂存：读出来的这张 CD 记在 cdKeep 里，再打开 CD 页直接用它，不再让光驱读盘。
     只在三种时候丢掉重读：按「弹出」、按「重新读取」、整个网页重新打开 */
  let cdKeep = null;
  const cdMine = (seq) => seq === cdSeq && current && current.view === "cd";
  /* 光驱在不在：读到「打不开光驱」就是没接，其余情况都算接着。记在本机，并通知外面
     （侧栏「CD播放器」的图标：没接 CD 机时变灰）。true / false / null（还不知道） */
  let cdDrive = null;
  const cdDriveHooks = [];
  const cdSetDrive = (has) => {
    if (has === cdDrive) return;
    cdDrive = has;
    try { localStorage.setItem("daphile.cddrive", has ? "1" : "0"); } catch (_) { /* 记不住也不影响 */ }
    cdDriveHooks.forEach((f) => { try { f(has); } catch (_) { /* 忽略 */ } });
  };
  /* 打开网页时查一次光驱在不在（只发一次查询）。上次记着「接着光驱」时外面不会调用它：
     光驱里有盘的话这一问会让光驱读盘，等用户点开 CD 页时自然会知道 */
  async function cdProbe() {
    let r;
    try { r = await LMS.cdItems(); } catch (_) { return; }
    cdSetDrive(!(r.networkerror && cdError(r.networkerror)[0] === "nodrive"));
  }
  const cdLoad = async () => {
    try { return await cdRead(); } catch (e) { return { ok: false, err: ["fail", "读取 CD 失败", "与 Daphile 的连接出了问题：" + e.message] }; }
  };
  const cdSame = (a, b) => !!a && !!b && a.ok === b.ok && (a.ok
    ? a.named === b.named && a.nodb === b.nodb && a.tracks.length === b.tracks.length && a.tracks[0].url === b.tracks[0].url
    : a.err[1] === b.err[1]);
  /* 等待中的几种状态：empty 没盘或仓门开着、reading 正在读盘、busy 光驱被占用。这几种都接着查，其余的停下来等人处理 */
  const cdWaits = (d) => !d.ok && (d.err[0] === "empty" || d.err[0] === "busy" || d.err[0] === "reading");
  const READING = { ok: false, err: ["reading", "正在读盘...", ""] };
  /* 入仓后分两段：先是光驱认盘（这时插件一问就回「没准备好」）→「正在读盘...」；
     认好以后插件才去读目录、查曲名，这一问要好几秒才回 → 迟迟不回就是第二段，显示「正在获取CD信息...」 */
  const GETTING = { ok: false, err: ["reading", "正在获取CD信息...", ""] };
  /* 光驱刚收进去的头几十秒里，它还在转、在认盘，这时插件会报各种错（读不出、状态未知、读取失败），都不是真的。
     cdHold：在这个时刻之前，这类报错一律当作「正在读盘」接着等；过了时限还报错才显示出来。
     cdShut：按「弹出」关仓后的头几秒，仓门还没走到位，查到的「仓门开着」也当作「正在读盘」 */
  const CD_HOLD = 40000;
  let cdHold = 0, cdShut = 0, cdTok = 0;
  const cdSettle = (d) => {
    const now = Date.now();
    if (d.ok) { cdHold = cdShut = 0; return d; }
    const k = d.err[0];
    if (k === "reading") {   // 一直「没准备好」超过时限：不再转了，说实话
      if (!cdHold) cdHold = now + CD_HOLD;
      return now < cdHold ? d : { ok: false, err: ["unread", "读不出这张光盘", "光驱一直没有准备好。光盘可能放反了、太脏或有划痕；取出检查后再点右上角「重新读取」。"] };
    }
    if (k === "empty") { if (now < cdShut) return READING; cdHold = cdShut = 0; return d; }
    if (k === "nodb" || k === "nodisc" || d.err[3] === -1) return d;   // 这几种是确定的结果，不用等
    return now < cdHold ? READING : d;
  };
  /* 只画提示（光盘图标 + 文字），不安排下一次查询 */
  function cdPaint(d) {
    cdNow = d; cdKeep = null;
    const k = d.err[0];
    if (k !== "fail") cdSetDrive(k !== "nodrive");   // fail 可能是与 Daphile 的连接出了问题，光驱在不在还不知道
    const tip = k === "nodb" ? "光盘读到了，但连不上曲名服务器，轨号列表也没取到。请检查 Daphile 能不能上网，再点右上角「重新读取」。" : d.err[2];
    document.getElementById("pick-count").textContent = "";
    reset(cdMsg(d.err[1], tip, k === "reading" || k === "moving"));
    content().onclick = null;
  }
  /* 没盘、仓门开着、正在读盘时每秒查一次（这时插件只看一眼光驱状态，毫秒级回话，光驱不会转）。
     状态正常了插件才真去读盘，要好几秒才回话——所以这一问过了 0.7 秒还没回，就知道光驱已经收进去在读盘了，
     马上把页面换成转动的光盘 */
  function cdWatch(seq) {
    clearTimeout(cdTimer);
    const tok = ++cdTok;
    cdTimer = setTimeout(async () => {
      if (!cdMine(seq) || tok !== cdTok) return;
      if (document.hidden || !pickerOpen()) return cdWatch(seq);
      const was = cdNow;
      const slow = setTimeout(() => {
        if (!cdMine(seq) || tok !== cdTok || cdNow !== was || was === GETTING) return;
        if (was.err[0] !== "reading") cdHold = Date.now() + CD_HOLD;
        cdPaint(GETTING);
      }, 700);
      const raw = await cdLoad();
      clearTimeout(slow);
      if (!cdMine(seq) || tok !== cdTok) return;
      // 刚才还是「没盘 / 仓门开着」，现在变成别的报错：光驱刚收进去，开始计「正在读盘」的宽限
      if (was && !was.ok && was.err[0] === "empty" && !raw.ok && raw.err[0] !== "empty" && Date.now() > cdHold) cdHold = Date.now() + CD_HOLD;
      const d = cdSettle(raw);
      // 已经显示「正在获取CD信息」，这一问等了半天回来的是过渡性报错：不退回「正在读盘」，接着查
      if (cdNow === GETTING && d === READING && raw.err[0] !== "reading") return cdWatch(seq);
      if (cdSame(d, cdNow)) { cdNow = d; cdWatch(seq); } else cdShow(d, seq);
    }, cdNow && !cdNow.ok && cdNow.err[0] === "empty" ? 1000 : 2000);
  }
  async function cd() {
    const seq = ++cdSeq;
    clearTimeout(cdTimer); cdTok++; cdNow = null;
    setTitle("");
    if (cdKeep) return cdShow(cdKeep, seq);
    if (Date.now() > cdHold) cdHold = 0;
    cdTools(null, true);
    document.getElementById("pick-count").textContent = "";
    reset(cdMsg(READING.err[1], "", true));
    const slow = setTimeout(() => { if (cdMine(seq) && cdNow === null) reset(cdMsg(GETTING.err[1], "", true)); }, 700);
    const d = await cdLoad();
    clearTimeout(slow);
    if (cdMine(seq)) cdShow(cdSettle(d), seq);
  }
  function cdShow(d, seq) {
    cdNow = d;
    cdKeep = d.ok ? d : null;
    clearTimeout(cdTimer); cdTok++;
    const drive = d.ok || d.err[0] !== "nodrive";
    if (d.ok) cdSetDrive(true);   // 读不出的情况在 cdPaint 里记
    cdTools(drive, false);
    if (!d.ok) {
      cdPaint(d);
    } else {
      const t0 = d.tracks[0], total = d.tracks.reduce((s, t) => s + t.duration, 0);
      const album = d.named ? t0.album || "音乐 CD" : "音乐 CD";
      const note = d.nodb ? "连不上 CD 曲名服务器，先按轨号显示，CD 可以正常播放。请检查 Daphile 能不能上网，再点右上角「重新读取」。"
        : d.named ? "" : "曲名库里没有查到这张光盘，按轨号显示。";
      setCount(d.tracks.length);
      reset(`
        <div class="album-head">
          <div class="art cd-art${d.cover ? " has" : ""}" id="cd-art">${d.cover ? `<img src="${esc(d.cover)}" alt="">` : DISC}</div>
          <div style="min-width:0">
            <h2>${esc(album)}</h2>
            <div class="artist">${esc((d.named && t0.albumArtist) || "未知艺人")}</div>
            <div class="meta">${d.tracks.length} 首 · ${fmtTime(total)}</div>
            <div class="np-fmt"><span>CD</span><span>44.1 kHz</span><span>16 bit</span></div>
            <div class="actions cd-actions"><button class="pill" data-cdall>＋ 全部播放</button></div>
          </div>
        </div>
        ${note ? `<div class="cd-note">${esc(note)}</div>` : ""}
        <table class="tracks"><thead><tr><th class="num">#</th><th>标题</th><th class="dur">时长</th></tr></thead><tbody>
        ${d.tracks.map((t, i) => `<tr data-cd="${i}" data-cdkey="${esc(cdKey(t.url))}" data-title="${esc(d.named ? t.title : "第 " + t.num + " 轨")}">
          <td class="num">${t.num}</td><td class="ttl">${esc(d.named ? t.title : "第 " + t.num + " 轨")}</td>
          <td class="dur">${t.duration ? fmtTime(t.duration) : ""}</td></tr>`).join("")}</tbody></table>`);
      if (d.named && !d.cover) cdCover(d.tracks, t0.album).then((u) => {
        if (u) d.cover = u;
        const box = document.getElementById("cd-art");
        const id = /[?&]CDDBDiscid=([0-9a-f]+)/i.exec(d.tracks[0].url);   // 按光盘编号再记一份，播放条和「正在播放」取用（app.js 的 cdArt）
        if (u && id) { try { localStorage.setItem("daphile.cdcover.id." + id[1], u); } catch (_) { /* 记不住就只显示「CD」字样 */ } }
        if (u && box && cdMine(seq) && cdNow === d) { const img = new Image(); img.onload = () => { if (box.isConnected) { box.innerHTML = ""; box.appendChild(img); box.classList.add("has"); } }; img.alt = ""; img.src = u; }
      });
      markRows(S.cur);
    }
    const ttl = (i) => { const t = d.tracks[i]; return d.named ? t.title : `CD 第 ${t.num} 轨`; };
    content().onclick = (e) => {
      if (!d.ok) return;
      const all = e.target.closest("[data-cdall]");
      if (all) return addOnce(all, async () => {
        for (let i = 0; i < d.tracks.length; i++) await LMS.cdAdd(d.tracks[i].url, ttl(i));
        toast(`已把整张 CD（${d.tracks.length} 首）加到当前播放末尾`);
      });
      const row = e.target.closest("tr[data-cd]");
      if (row) addRow(row, () => LMS.cdAdd(d.tracks[row.dataset.cd].url, ttl(row.dataset.cd)), row.dataset.title);
    };
    if (cdWaits(d)) cdWatch(seq);
  }
  /* 弹出：仓门关着就打开，开着就关上。按下后马上清掉页面上这张 CD 的信息。
     出仓：只转光盘图标、不出字，查到仓门确实开了才显示「请放入音乐CD」。
     入仓：马上显示转动的光盘 +「正在读盘...」，一直到读出光盘（或确定读不出）为止。
     正在放 CD 时先问一句并停止播放（光驱还在读盘时不能开仓）；放的是曲库里的歌则不受影响 */
  let cdBusy = false;
  async function cdEject() {
    if (cdBusy) return;
    const seq = cdSeq, before = cdNow;
    const cur = S.cur, wasCd = !!(cur && /^cdplay:/.test(cur.url || "")) && !!S.st && S.st.mode !== "stop";
    if (wasCd && !await ask({ title: "先停止播放 CD？", msg: "光驱正在放这张 CD，要先停下来才能打开仓门。", ok: "停止并弹出" })) return;
    if (!cdMine(seq)) return;
    cdBusy = true; cdTools(true, true);
    clearTimeout(cdTimer); cdTok++;
    try { await cdTray2(seq, before, wasCd); } finally { cdBusy = false; }
  }
  async function cdTray2(seq, before, wasCd) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const closing = !!before && !before.ok && before.err[0] === "empty" && before.err[3] === 2;   // 按之前仓门开着 → 这一下是关仓
    // 指令发出去之前就先把页面换掉，按下去马上有反应
    cdHold = cdShut = 0;
    cdPaint(closing ? READING : { ok: false, err: ["moving", "", ""] });
    let sent = false;
    try {
      if (wasCd) { await LMS.cdStop(); await wait(1200); }
      await LMS.cdTray(); sent = true;
    } catch (_) { /* 发不出去：下面改用插件的办法 */ }
    if (!cdMine(seq)) return;
    if (closing) {
      if (!sent) { toast("弹出指令发不出去，请按光驱上的按钮"); return cdShow(before, seq); }
      cdShut = Date.now() + 6000; cdHold = Date.now() + CD_HOLD;
      cdTools(true, false);
      return cdWatch(seq);
    }
    // 出仓：等仓门走出来，查到「仓门开着」为止；中途光驱报的各种错都不算数，接着转
    let d = sent ? null : before;
    const hadDisc = !!before && before.ok;
    for (let i = 0; sent && i < 7; i++) {
      await wait(i ? 1000 : 2500);
      // 按之前没读出光盘，这一问又迟迟不回：光驱其实是收进去在读盘了，先把「正在读盘」亮出来
      const slow = hadDisc ? 0 : setTimeout(() => { if (cdMine(seq) && cdNow && cdNow.err && cdNow.err[0] === "moving") { cdHold = Date.now() + CD_HOLD; cdPaint(GETTING); } }, 700);
      d = await cdLoad();
      clearTimeout(slow);
      if (!cdMine(seq)) return;
      if (d.err && (d.err[0] === "empty" || d.err[0] === "nodrive")) break;
      // 按之前就没读出光盘，按完却不是「没盘 / 仓门开着」：这一下其实是把仓门关上了（有的光驱分不清开和关），照入仓处理
      if (!hadDisc) { cdHold = Date.now() + CD_HOLD; cdTools(true, false); if (d.ok) return cdShow(d, seq); if (cdNow !== GETTING || d.err[0] === "reading") cdPaint(READING); return cdWatch(seq); }
      if (d.ok && i >= 1) break;
    }
    // 原来读得出光盘、按完还是同一张盘在里面：这条路没起作用（不是 Daphile 系统，或它的网页不让用）。
    // 改用 CDplayer 插件自带的退盘，它只会开、不会关
    if (before && before.ok && d && d.ok && cdSame(before, d)) {
      try { await LMS.cdEject(false); await wait(2500); d = await cdLoad(); }
      catch (e) { d = { ok: false, err: ["fail", "仓门没有动", "弹出指令没有起作用：" + e.message] }; }
      if (!cdMine(seq)) return;
      if (d.ok && cdSame(before, d)) toast("仓门没有动，请按光驱上的按钮");
    }
    if (!sent && !hadDisc) toast("弹出指令发不出去，请按光驱上的按钮");
    // 仓门走了这么久还没查到「仓门开着」：光驱还在忙，报的错先不算数，接着转、接着查
    if (sent && d && !d.ok && d.err[0] !== "empty") { cdHold = Date.now() + CD_HOLD; d = cdSettle(d); }
    cdShow(d || { ok: false, err: ["fail", "仓门没有动", "弹出指令发不出去，请按光驱上的按钮。"] }, seq);
  }

  const ROUTES = {
    cd: () => cd(),
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
  const TOP = new Set(["albums", "recent", "artists", "songs", "folders", "playlists", "favorites", "search", "cd"]);

  let rootView = "albums";   // 从侧边栏打开的分类
  async function go(view, arg) {
    current = { view, arg };
    content().onclick = null;
    // 标题行右侧的按键（播放列表的「删除」「加入」「播放」），换页面时清掉
    const va = document.getElementById("view-act"); va.innerHTML = ""; va.onclick = null;
    document.getElementById("cd-tools").hidden = view !== "cd";                    // 右上角的「重新读取」「弹出」只在 CD 页出现
    document.getElementById("picker").classList.toggle("is-cd", view === "cd");
    const ft = document.getElementById("fav-tools");                                // 右上角的「删除」键：我的喜爱、播放列表、播放列表里的曲目
    ft.hidden = !["favorites", "playlists", "playlist"].includes(view); ft.innerHTML = ""; ft.onclick = null;
    va.hidden = false;
    if (view !== "cd") clearTimeout(cdTimer);
    if (TOP.has(view)) setCols(view);   // 换分类时重设一栏/两栏；进入详情时左栏保持不动
    // 两栏里从详情再点进下一层（艺人 → 专辑，有返回栈）：左栏再缩到 1/5，专辑页占 4/5；返回到详情恢复 2/5
    else cols().classList.toggle("deep", stack.length > 0 && cols().classList.contains("detail"));
    document.getElementById("btn-back").hidden = !stack.length;
    // 文件夹里往下走时，「‹ 文件夹名」这一行上移，顶替窗口顶部的「文件夹 N 项」
    document.getElementById("picker").classList.toggle("head-up", rootView === "folders" && stack.length > 0);
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
    const main = document.getElementById("main");
    const clearDrag = () => { p.style.transform = p.style.transition = main.style.transition = ""; app.style.removeProperty("--pick-dx"); };
    if (on) {
      closeTok++;
      clearDrag();
      p.classList.remove("closing");
      p.hidden = false;
      app.classList.add("picker-open");
      return;
    }
    if (p.hidden) return;
    if (swiped) main.style.transition = "padding-left .18s ease-in";   // 和窗口滑出用同一条曲线，「当前播放」的左边一直贴着窗口右边线
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
  /* 从信息面板点专辑名：选曲窗口滑入，直接打开这首曲目所在的文件夹；返回键回到「文件夹」顶层 */
  async function openFolder(trackUrl) {
    const dir = String(trackUrl).replace(/\/[^/]*$/, "");
    const r = await LMS.folderByUrl(dir).catch(() => ({}));
    const f = (r.folder_loop || [])[0];
    if (!f || f.type !== "folder" || !f.id) return toast("找不到这首曲目所在的文件夹");
    stack.length = 0;
    rootView = "folders";
    document.getElementById("filter").value = "";
    document.querySelectorAll(".nav-item").forEach((x) => x.classList.toggle("active", x.dataset.view === "folders"));
    showPicker(true);
    setCols("folders");
    stack.push({ view: "folders" });
    // depth 2：按专辑样式显示目录里的曲目；net 只影响前两层图标
    go("folder", { id: f.id, name: f.filename, depth: 2, net: /\/Network%20Drives\//i.test(dir) });
  }
  function root(view) {
    stack.length = 0;
    rootView = view;
    document.getElementById("filter").value = "";
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    showPicker(true);
    go(view);
  }

  /* 曲目行状态：正在播放的那首高亮；其余已在当前播放列表里的（只在选曲窗口）变灰 */
  function markRows(cur) {
    const id = cur && String(cur.id);
    const inQ = new Set(((S.st && S.st.playlist_loop) || []).map((x) => String(x.id)));
    document.querySelectorAll(".tracks tr[data-id]").forEach((tr) => tr.classList.toggle("playing", tr.dataset.id === id));
    document.querySelectorAll("#picker tr[data-id], #picker li[data-id]").forEach((el) =>
      el.classList.toggle("queued", el.dataset.id !== id && inQ.has(el.dataset.id)));
    // CD 页的曲目没有曲库 id，按「轨号@起点」对：同一张盘的同一轨才算
    const rows = document.querySelectorAll("#picker tr[data-cdkey]");
    if (!rows.length) return;
    const ck = cdKey(cur && cur.url);
    const cdQ = new Set(((S.st && S.st.playlist_loop) || []).map((x) => cdKey(x.url)).filter(Boolean));
    rows.forEach((tr) => {
      tr.classList.toggle("playing", !!ck && tr.dataset.cdkey === ck);
      tr.classList.toggle("queued", tr.dataset.cdkey !== ck && cdQ.has(tr.dataset.cdkey));
    });
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

  /* ---------- 两栏分隔线（艺人 / 播放列表）----------
     三种状态：浏览（左栏 3/5）→ 选中条目看详情（2/5）→ 详情里点进专辑（1/5，专辑页占 4/5）。
     拖动：调整当前状态下左栏的占比，三种状态各记各的，存在 localStorage；双击恢复当前状态的默认值。
     滑动左栏（手指竖向滑动、鼠标滚轮、拖滚动条）表示还要接着选：左栏重新变宽回浏览状态 */
  const SPLIT_KEY = "daphile.split";
  const SPLIT_DEF = { b: 0.6, d: 0.4, a: 0.2 };
  const SPLIT_MIN = 140;                 // 每栏至少 140px，与 style.css 一致
  let split = { ...SPLIT_DEF };
  function applySplit() {
    const st = document.documentElement.style;
    st.setProperty("--split-b", String(split.b));
    st.setProperty("--split-d", String(split.d));
    st.setProperty("--split-a", String(split.a));
  }
  /* 三档左栏始终 浏览 ≥ 详情 ≥ 专辑：越往里点，右栏只会变宽、不会变窄。
     改了哪一档就以它为准：比上一档宽就顶到上一档为止，下一档比它宽就跟着收窄 */
  function orderSplit(k) {
    if (k !== "a") split.d = Math.min(split.d, split.b);
    split.a = Math.min(split.a, split.d);
  }
  const saveSplit = () => { try { localStorage.setItem(SPLIT_KEY, JSON.stringify(split)); } catch (_) { /* 记不住也不影响使用 */ } };
  function bindSplit() {
    try {
      const v = JSON.parse(localStorage.getItem(SPLIT_KEY) || "null");
      if (v && v.b > 0 && v.b < 1 && v.d > 0 && v.d < 1) split = { b: v.b, d: v.d, a: v.a > 0 && v.a < 1 ? v.a : SPLIT_DEF.a };
    } catch (_) { /* 用默认比例 */ }
    orderSplit("b");                     // 以前存下的比例若顺序不对（专辑档比详情档宽等），读进来就纠正
    applySplit();
    const h = document.getElementById("pick-split"), c = cols(), pl = pickList();
    const key = () => (c.classList.contains("deep") ? "a" : c.classList.contains("detail") ? "d" : "b");
    h.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      c.classList.add("splitting");
      const r = c.getBoundingClientRect(), k = key();
      const lo = k === "a" ? Math.max(0.1, 80 / r.width) : Math.max(0.2, SPLIT_MIN / r.width);   // 专辑页状态左栏可窄到 80px
      const hi = Math.min(0.8, 1 - SPLIT_MIN / r.width);
      const move = (ev) => {
        if (lo >= hi) return;
        split[k] = Math.round(Math.min(hi, Math.max(lo, (ev.clientX - r.left) / r.width)) * 1000) / 1000;
        orderSplit(k);
        applySplit();
      };
      // 松手、取消或指针捕获丢失（任一先到）都结束拖动，不会卡在拖动状态
      const up = () => {
        h.removeEventListener("pointermove", move);
        ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) => h.removeEventListener(t, up));
        window.removeEventListener("pointerup", up);
        c.classList.remove("splitting");
        saveSplit();
      };
      h.addEventListener("pointermove", move);
      ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) => h.addEventListener(t, up));
      window.addEventListener("pointerup", up);
    });
    h.addEventListener("dblclick", () => { const k = key(); split[k] = SPLIT_DEF[k]; orderSplit(k); applySplit(); saveSplit(); });

    const expand = () => { if (c.classList.contains("detail")) setDetail(false); };
    // 手指：竖向滑动超过 10px 才算（点一下选艺人不算，横滑留给「左滑关闭窗口」）
    let tx = 0, ty = 0, moved = false;
    pl.addEventListener("touchstart", (e) => { const t = e.touches[0]; tx = t.clientX; ty = t.clientY; moved = false; }, { passive: true });
    pl.addEventListener("touchmove", (e) => {
      if (moved) return;
      const t = e.touches[0], dx = t.clientX - tx, dy = t.clientY - ty;
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { moved = true; expand(); }
    }, { passive: true });
    // 滚轮 / 触控板：只认点选之后新开始的一串滚动；点选前那一下的触控板惯性滚动不算，否则刚缩回去又弹开
    let wStart = 0, wLast = -1e9;
    pl.addEventListener("wheel", (e) => {
      const now = performance.now();
      if (now - wLast > 200) wStart = now;
      wLast = now;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && wStart > pickedAt) expand();
    }, { passive: true });
    // 鼠标按在左栏滚动条上
    pl.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.target === pl && e.offsetX >= pl.clientWidth) expand();
    });
  }

  /* ---------- 向左滑动关闭选曲窗口：窗口跟着手指左移，拉过窗口宽度 1/4（或快速一甩）松手即关闭，不够就弹回 ----------
     分隔条、输入框上不接管；竖向移动留给列表滚动 */
  /* 选曲窗口跟手左移（x ≤ 0） */
  let pd = null;
  /* 「当前播放」跟着窗口右边线走：窗口左移多少（x ≤ 0），主区左边让出的宽度就少多少（style.css 的 --pick-dx） */
  const mainFollow = (x, trans) => {
    document.getElementById("main").style.transition = trans;
    const st = document.getElementById("app").style;
    if (x) st.setProperty("--pick-dx", x + "px"); else st.removeProperty("--pick-dx");
  };
  function pickDrag(x, t) {
    const p = document.getElementById("picker");
    x = Math.max(x, -p.offsetWidth);                            // 最多拉到整个窗口藏进边栏
    if (!pd) { pd = { x: 0, t: 0, v: 0 }; p.style.transition = "none"; }
    if (pd.t) pd.v = (x - pd.x) / Math.max(8, t - pd.t);        // 速度 px/ms，负数是向左
    pd.x = x; pd.t = t;
    p.style.transform = `translateX(${x}px)`;
    mainFollow(x, "none");
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
    mainFollow(0, "padding-left .2s ease");                     // 弹回：「当前播放」跟着一起回去
    setTimeout(() => { if (!p.style.transform) { p.style.transition = ""; if (!pd) document.getElementById("main").style.transition = ""; } }, 220);
    return false;
  }

  function bindSwipeClose() {
    const p = document.getElementById("picker");
    const START = 12;
    let g = null;
    p.addEventListener("pointerdown", (e) => {
      g = null;
      if (e.button > 0 || !pickerOpen()) return;
      if (e.target.closest("#picker-resize, #pick-split, input, textarea, select")) return;
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
    bindSplit();
    bindSwipeClose();
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

  /* 保存新播放列表后：如果窗口正开着「播放列表」，重新载入一览 */
  function refreshPlaylists() {
    if (pickerOpen() && rootView === "playlists") { stack.length = 0; go("playlists"); }
  }

  /* 当前播放列表的「更新」也用同一套磁盘核对（app.js checkQueue） */
  return { init, markRows, refreshPlaylists, openFolder, pickerOpen, closePicker: () => showPicker(false),
    checkFiles: favCheck, fileOf, extOf,
    cdProbe, onDrive: (f) => { cdDriveHooks.push(f); if (cdDrive !== null) f(cdDrive); } };
})();
