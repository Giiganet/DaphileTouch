/* 播放条、队列、轮询（资料库视图在 views.js） */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtTime = (s) => {
  s = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

const S = { st: null, cur: null, polledAt: 0, seeking: false, queueKey: "", fails: 0, cmdAt: 0, volDrag: false };

/* 暂停时 AirPlay 转过来的设备：LMS 里是「停止」状态，停在那一首但没有进度。
   网页按设备记住进度 {idx, id, t}（存 localStorage），显示成「暂停在 t 秒」；按播放时从 t 秒接着放，
   拖进度条只改记住的位置、不发命令。设备一旦不再是停在这一首（开始放了、换了曲、清空了），记录作废。 */
const Resume = {
  key: (pid) => "daphile.resume." + pid,
  get(pid = LMS.playerId) { try { return JSON.parse(localStorage.getItem(this.key(pid)) || "null"); } catch (_) { return null; } },
  set(pid, r) { try { r ? localStorage.setItem(this.key(pid), JSON.stringify(r)) : localStorage.removeItem(this.key(pid)); } catch (_) { /* 忽略 */ } },
  /* 用当前设备的 status 核对；还有效就返回记录，否则删掉 */
  check(st) {
    const r = this.get();
    if (!r) return null;
    const cur = (st.playlist_loop || []).find((x) => Number(x["playlist index"]) === Number(st.playlist_cur_index));
    if (st.mode === "stop" && Number(st.playlist_cur_index) === r.idx && cur && String(cur.id) === r.id) return r;
    this.set(LMS.playerId, null);
    return null;
  },
  /* 轮询拿到的状态：有记录就显示成暂停在记住的位置 */
  apply(st) {
    const r = this.check(st);
    if (r) { st.mode = "pause"; st.time = r.t; st._resume = r; }
    return st;
  },
};

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2200);
}

/* 执行命令后立刻刷新一次状态；命令返回前发出的轮询结果作废（见 poll） */
async function act(fn, errMsg = "操作失败") {
  try { await fn(); } catch (e) { toast(errMsg + "：" + e.message); }
  S.cmdAt = Date.now();
  setTimeout(poll, 150);
}

/* ---------- 加入中：当前播放标题行转圈，曲目进入列表后消失 ----------
   「全部播放」要等 LMS 处理完才返回，会有几秒空白；这期间显示「正在加入…」。
   命令返回后，等轮询看到 playlist_timestamp 变化（曲目已进列表）再隐藏，最多再等 5 秒兜底。 */
const Adding = { n: 0, ts: "", until: 0 };
const showAdding = (on) => { const el = $("cur-adding"); if (el) el.hidden = !on; document.body.classList.toggle("q-adding", on); };
async function addAct(fn, errMsg = "加入失败") {
  if (!Adding.n && !Adding.until) Adding.ts = S.st ? String(S.st.playlist_timestamp) : "";
  Adding.n++;
  Adding.until = 0;
  showAdding(true);
  /* 加入只把曲目放到当前播放末尾，不管列表是空的、停止还是暂停，都不自动开始播放；
     当前播放严格按列表顺序走，要听时自己按播放键。 */
  let ok = true;
  try { await fn(); } catch (e) { ok = false; toast(errMsg + "：" + e.message); }
  Adding.n--;
  if (!Adding.n) { if (ok) Adding.until = Date.now() + 5000; else showAdding(false); }
  setTimeout(poll, 150);
}
function checkAdding() {
  if (Adding.n || !Adding.until || !S.st) return;
  if (String(S.st.playlist_timestamp) !== Adding.ts || Date.now() > Adding.until) { Adding.until = 0; showAdding(false); }
}

function render() {
  const st = S.st;
  if (!st) return;
  const loop = st.playlist_loop || [];
  const curIdx = Number(st.playlist_cur_index);
  const cur = loop.find((x) => Number(x["playlist index"]) === curIdx) || null;
  S.cur = cur;
  const on = Number(st.power) === 1;
  const playing = st.mode === "play";
  const clr = playing ? "清除其他曲目（保留正在播放）" : "清除当前播放";
  if ($("btn-clear").title !== clr) { $("btn-clear").title = clr; $("btn-clear").setAttribute("aria-label", clr); }

  $("player").classList.toggle("off", !on);
  $("btn-play").classList.toggle("playing", playing);   // 只切换显示哪个 SVG 图形，不写字符
  $("btn-play").setAttribute("aria-label", playing ? "暂停" : "播放");
  $("btn-shuffle").classList.toggle("on", Number(st["playlist shuffle"]) > 0);
  const rep = Number(st["playlist repeat"]);
  $("btn-repeat").classList.toggle("on", rep > 0);
  $("btn-repeat").classList.toggle("badge-one", rep === 1);
  // 喇叭键点开音量面板。网页静音 = 音量设 0（取消时恢复原音量）；音量为负数是 LMS 自带静音留下的状态，也算静音
  // 音量控制设为「固定输出」（digital_volume_control = 0）的播放器会忽略音量：喇叭键变灰，面板里的滑块灰掉不能拖
  const fixed = st.digital_volume_control !== undefined && Number(st.digital_volume_control) === 0;
  const vol = Number(st["mixer volume"]);
  const muted = !fixed && vol <= 0;
  const mb = $("btn-mute");
  mb.classList.toggle("fixed", fixed);
  mb.classList.toggle("muted", muted);
  mb.setAttribute("aria-label", fixed ? "音量（此设备为固定音量输出，不能调节）" : muted ? "音量（已静音）" : "音量");
  mb.title = fixed ? "此设备为固定音量输出，不能在这里调节音量" : "";
  renderVol(fixed, vol, muted);
  renderGroupVol(st);
  // 「当前播放设备」标题后显示设备名（灰色，只显示不能点）；用播放条的 AirPlay 换设备后，下一次刷新即更新
  const devName = st.player_name || "";
  if ($("cur-dev-name").textContent !== devName) {
    $("cur-dev-name").textContent = devName;
    $("cur-dev").title = devName ? "当前播放设备：" + devName + "（换设备请用播放条右侧的 AirPlay）" : "";
    $("cur-dev").hidden = $("cur-sep").hidden = !devName;
  }

  if (cur) {
    $("lcd-title").textContent = cur.title || "未知曲目";
    $("lcd-sub").textContent = [cur.artist, cur.album].filter(Boolean).join(" — ");
    const cid = coverOf(cur);
    const src = cid ? LMS.cover(cid, 100) : cdArt(cur);
    const img = $("lcd-cover");
    if (img.dataset.src !== src) { img.dataset.src = src; if (src) img.src = src; }
    img.hidden = !src;   // 没封面时隐藏图片，露出外框的灰色圆角方块
    img.parentNode.classList.toggle("cd-mark", isCd(cur) && !src);   // CD 曲目又没封面：方块里写「CD」
    const fm = src ? "" : fmtOfTrack(cur);                               // 普通曲目没封面：方块里写文件格式
    img.parentNode.classList.toggle("fmt-mark", !!fm);
    img.parentNode.dataset.fmt = fm;
  } else {
    $("lcd-title").textContent = loop.length ? "" : "未在播放";
    $("lcd-sub").textContent = "";
    $("lcd-cover").hidden = true;
    $("lcd-cover").parentNode.classList.remove("cd-mark", "fmt-mark");
  }
  renderFav(cur);
  renderTime();
  if (typeof Rhythm !== "undefined") Rhythm.setTrack(cur && !cur.qhidden ? cur.id : null);   // 补出来的「已不在」曲目没有曲库 id
  renderNowPlaying(cur);
  renderQueue(loop, curIdx);
  if (typeof Views !== "undefined") Views.markRows(cur);
}

/* 本地插值让进度条每秒走动，轮询再校正 */
function renderTime() {
  const st = S.st;
  if (!st || S.seeking) return;
  const dur = Number(st.duration || (S.cur && S.cur.duration) || 0);
  let t = Number(st.time || 0);
  if (st.mode === "play") t += (Date.now() - S.polledAt) / 1000;
  if (dur) t = Math.min(t, dur);
  $("t-cur").textContent = fmtTime(t);
  $("t-left").textContent = dur ? "-" + fmtTime(dur - t) : "";
  $("bar-fill").style.width = dur ? (t / dur) * 100 + "%" : "0";
}

/* 音量面板：滑块位置、数值、静音键。--p 是已填充（蓝色）部分的长度，按圆钮中心算（圆钮 22px） */
function setVolUI(v) {
  const r = $("vol-range");
  r.value = v;
  r.style.setProperty("--p", `calc(11px + (100% - 22px) * ${v / 100})`);
  $("vol-num").textContent = v;
}
function renderVol(fixed, vol, muted) {
  const vm = $("vol-mute");
  $("vol-pop").classList.toggle("fixed", fixed);
  $("vol-range").disabled = vm.disabled = fixed;
  $("vol-note").hidden = !fixed;
  vm.classList.toggle("muted", muted);
  vm.setAttribute("aria-label", muted ? "取消静音" : "静音");
  if (!S.volDrag) setVolUI(fixed ? 100 : Number.isFinite(vol) ? Math.max(0, Math.round(vol)) : 0);
  if (fixed) $("vol-num").textContent = "";
}

/* ---------- 合并播放时的音量：面板里每台设备一行，各调各的 ----------
   组员来自 status 的 sync_master / sync_slaves；正在控制的那台用轮询的 S.st，其余面板开着时每 1.5 秒查一次 status。
   每行的喇叭键只静音这一台（和单台时一样：记住音量 → 设 0，再点恢复）。不改 LMS 的「同步音量」设置 */
const Grp = { ids: [], info: {}, at: 0, busy: false, drag: {}, cmdAt: {} };
function groupIds(st) {
  if (!st || !st.sync_master) return [];
  const all = [st.sync_master, ...String(st.sync_slaves || "").split(",")].filter(Boolean);
  return all.includes(LMS.playerId) ? [LMS.playerId, ...all.filter((x) => x !== LMS.playerId)] : [];   // 正在控制的排第一
}
const grpInfo = (st, id) => ({
  name: st.player_name || id,
  fixed: st.digital_volume_control !== undefined && Number(st.digital_volume_control) === 0,
  vol: Number(st["mixer volume"]),
});
function renderGroupVol(st) {
  const ids = groupIds(st), me = LMS.playerId;
  const changed = ids.join(",") !== Grp.ids.join(",");
  Grp.ids = ids;
  if (ids.length > 1 && !Grp.drag[me] && S.polledAt >= (Grp.cmdAt[me] || 0)) Grp.info[me] = grpInfo(st, me);
  // 面板开着每 1.5 秒查一次；关着每 10 秒（播放条喇叭键的灰 / 静音状态要看组里其他台）；组员变了马上查
  const every = $("vol-pop").hidden ? 10000 : 1500;
  if (ids.length > 1 && (changed || Date.now() - Grp.at > every)) refreshGroup();
  renderGroup();
}
async function refreshGroup() {
  if (Grp.busy) return;
  Grp.busy = true; Grp.at = Date.now();
  const sent = Date.now(), ids = Grp.ids.filter((x) => x !== LMS.playerId);
  try {
    const rs = await Promise.all(ids.map((id) => LMS.statusOf(id).catch(() => null)));
    rs.forEach((st, k) => {
      const id = ids[k];
      if (st && !Grp.drag[id] && sent >= (Grp.cmdAt[id] || 0)) Grp.info[id] = grpInfo(st, id);   // 拖动中 / 命令前发出的旧状态不用
    });
  } finally { Grp.busy = false; }
  renderGroup();
}
function setRowVol(row, v) {
  const r = row.querySelector(".vol-range");
  r.value = v;
  r.style.setProperty("--p", `calc(11px + (100% - 22px) * ${v / 100})`);
  row.querySelector(".vol-num").textContent = v;
}
function renderGroup() {
  const box = $("vol-group"), pop = $("vol-pop"), on = Grp.ids.length > 1;
  pop.classList.toggle("group", on);
  box.hidden = !on;
  if (!on) { box.dataset.key = ""; return; }
  const key = Grp.ids.join(",");
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    const ico = $("vol-mute").innerHTML;
    // 静音图标里的斜线缝是 SVG mask，id 不能重复（单台那一行此时隐藏，引用它的 mask 会画不出来）：每行换成自己的 id
    box.innerHTML = Grp.ids.map((id, k) => `<div class="vg-item" data-pid="${esc(id)}">
      <div class="vg-name"><span class="vg-nm"></span><small></small></div>
      <div class="vol-row"><button class="icon-btn mute-btn vol-mute">${ico.replace(/m-slash2/g, "m-slash-g" + k)}</button>
      <input class="vol-range" type="range" min="0" max="100" step="1" value="0"><span class="vol-num"></span></div></div>`).join("");
  }
  let anyCtl = false, allMuted = true;
  for (const row of box.querySelectorAll(".vg-item")) {
    const id = row.dataset.pid, i = Grp.info[id];
    const fixed = !i || i.fixed, vol = i ? i.vol : 0, muted = !fixed && vol <= 0;
    if (!fixed) { anyCtl = true; if (!muted) allMuted = false; }
    row.classList.toggle("fixed", fixed);
    row.querySelector(".vg-nm").textContent = i ? i.name : id;
    row.querySelector("small").textContent = !i ? "…" : fixed ? "固定输出" : "";
    const mb = row.querySelector(".vol-mute"), r = row.querySelector(".vol-range");
    mb.disabled = r.disabled = fixed;
    mb.classList.toggle("muted", muted);
    mb.setAttribute("aria-label", (muted ? "取消静音：" : "静音：") + (i ? i.name : id));
    r.setAttribute("aria-label", "音量：" + (i ? i.name : id));
    if (!Grp.drag[id]) setRowVol(row, fixed ? 100 : Number.isFinite(vol) ? Math.max(0, Math.round(vol)) : 0);
    if (fixed) row.querySelector(".vol-num").textContent = "";
  }
  // 播放条上的喇叭键：组里有能调的设备就不灰；能调的都静音了才显示静音
  const b = $("btn-mute");
  b.classList.toggle("fixed", !anyCtl);
  b.classList.toggle("muted", anyCtl && allMuted);
  b.setAttribute("aria-label", "音量（合并播放，每台单独调）");
  b.title = "";
}

/* 节奏灯对时：经 RaopBridge 的 AirPlay 设备出声约晚 2 秒，本机 D10s 约 0.1 秒 */
async function syncRhythmDelay() {
  try {
    const p = (await LMS.players()).find((x) => x.playerid === LMS.playerId);
    Rhythm.setDelay(p && /raop/i.test(p.modelname || "") ? 2.0 : 0.1);
  } catch (_) { /* 拿不到就沿用上次 */ }
}

/* ---------- 封面兜底 ----------
   有封面：LMS 的 coverid 已包含目录里的 cover 文件（扫描时关联），直接用；
   没有封面（coverart=0）：不请求，显示灰色圆角方块；
   请求失败（文件丢失、NAS 未开等）：换成透明图，露出图片自身的灰色圆角底色。 */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const isCd = (t) => !!t && /^cdplay:/.test(t.url || "");   // CDplayer 插件的曲目地址
const coverOf = (t) => (t && !isCd(t) && Number(t.coverart) !== 0 ? t.coverid || t.artwork_track_id || null : null);
/* CD 曲目的封面：CD 页查到封面后按光盘编号记在本机（views.js 的 cd()），这里取出来给播放条和「正在播放」用；没有就显示「CD」字样 */
const cdArt = (t) => { if (!isCd(t)) return ""; const m = /[?&]CDDBDiscid=([0-9a-f]+)/i.exec(t.url); try { return (m && localStorage.getItem("daphile.cdcover.id." + m[1])) || ""; } catch (_) { return ""; } };
document.addEventListener("error", (e) => {
  const img = e.target;
  // 只处理已在页面上的图片；文件夹行首的封面是加载成功才插入的，失败时保留光盘图标
  if (img.tagName === "IMG" && img.isConnected && img.src !== BLANK) img.src = BLANK;
}, true);

/* ---------- 播放条曲名后面的心形 ----------
   换歌时问一次 LMS 这首在不在喜爱里（favorites exists，只读）；在别处改了喜爱（选曲窗口的心形、「我的喜爱」删除 / 更新）
   由 views.js 调 S.favChanged() 重新问；另外每 30 秒顺带再问一次，兜住在其他设备上改的。
   点心形和选曲窗口里的一样：空心 → 加入喜爱；实心 → 移出喜爱。CD、曲库里已不在的曲目不显示 */
const Fav = { key: "", on: false, at: 0, seq: 0, busy: false };
/* 队列里的临时条目（tmp://）对回曲库（见 views.js libTracks）：已对上的直接顶替，没查过的在后台查，
   查到后让队列重绘，下一次轮询就有封面和心形。加喜爱用曲库里的 file:// 地址（libUrl） */
const Lib = { busy: false };
function libApply(st) {
  const loop = st && st.playlist_loop;
  if (!loop || !loop.some((t) => /^tmp:/.test(t.url || ""))) return st;
  const want = loop.filter((t) => Views.libWant(t.url)).map((t) => t.url);
  if (want.length && !Lib.busy) {
    Lib.busy = true;
    Views.libTracks(want).then((m) => { if (m.size) S.queueKey = ""; }).catch(() => {}).finally(() => { Lib.busy = false; });
  }
  return { ...st, playlist_loop: loop.map((t) => { const l = !t.libUrl && Views.libPeek(t.url); return l ? Views.libMerge(t, l) : t; }) };
}
const favable = (cur) => !!cur && !cur.qhidden && !isCd(cur) && Number(cur.id) > 0 && !!cur.url;
function paintFav() {
  const b = $("lcd-fav");
  b.classList.toggle("on", Fav.on);
  const t = Fav.on ? "移出喜爱" : "加入喜爱";
  if (b.title !== t) { b.title = t; b.setAttribute("aria-label", t); }
}
async function checkFav(force) {
  const cur = S.cur;
  if (!favable(cur)) return;
  const key = String(cur.id);
  if (!force && key === Fav.key && Date.now() - Fav.at < 30000) return;
  const seq = ++Fav.seq;
  Fav.at = Date.now();
  if (key !== Fav.key) { Fav.key = key; Fav.on = false; paintFav(); }   // 换歌：先灰，问到了再变
  try {
    const ex = await LMS.favExists(key);
    if (seq !== Fav.seq || !S.cur || String(S.cur.id) !== key) return;
    Fav.on = Number(ex.exists) > 0;
    paintFav();
  } catch (_) { /* 查不到就保持原样 */ }
}
function renderFav(cur) {
  const show = favable(cur);
  $("lcd-fav").hidden = !show;
  if (!show) { Fav.key = ""; return; }
  if (!Fav.busy) checkFav(false);
}
S.favChanged = () => { if (!Fav.busy) checkFav(true); };
async function toggleFav() {
  const cur = S.cur;
  if (!favable(cur) || Fav.busy) return;
  const b = $("lcd-fav"), key = String(cur.id), title = cur.title || "";
  Fav.busy = true; b.disabled = true; Fav.seq++;
  try {
    const ex = await LMS.favExists(key);
    if (Fav.on) {                                  // 实心红：再点即移出喜爱
      if (Number(ex.exists)) await LMS.favDelete(ex.index);
      Fav.on = false; toast(`已从喜爱移除：${title}`);
    } else if (Number(ex.exists)) {               // 其实已在喜爱里（别处加的）：只刷新成实心
      Fav.on = true; toast("已在喜爱列表中");
    } else {
      await LMS.favAdd(cur.libUrl || cur.url, title);
      Fav.on = true; toast(`已加入喜爱：${title}`);
    }
    Fav.key = key; Fav.at = Date.now();
    if (typeof Views !== "undefined" && Views.favChanged) Views.favChanged();   // 选曲窗口开着「我的喜爱」时跟着刷新
  } catch (e) { toast("喜爱操作失败：" + e.message); }
  Fav.busy = false; b.disabled = false;
  if (!S.cur || String(S.cur.id) !== key) Fav.key = "";   // 操作期间换了歌：下次刷新重新问
  paintFav();
}

/* 「正在播放」信息面板：只在换歌时重绘 */
const JUNK = new Set(["No Artist", "No Album", "No Genre", "0", ""]);
function renderNowPlaying(cur) {
  const key = cur ? String(cur.id) : "";
  if (key === S.npKey) return;
  S.npKey = key;
  const img = $("np-art");
  const coverId = coverOf(cur);   // 没封面时显示 #np-art-empty（灰色圆角方块）
  const art = coverId ? LMS.cover(coverId, 300) : cdArt(cur);
  img.hidden = !art;
  $("np-art-empty").hidden = !!art;
  const npFmt = !art && cur && !isCd(cur) ? fmtOfTrack(cur) : "";   // 没封面：灰色方块里写文件格式
  $("np-art-empty").textContent = isCd(cur) && !art ? "CD" : npFmt;
  $("np-art-empty").classList.toggle("fmt", !!npFmt);
  if (art) img.src = art;
  $("np-title").textContent = cur ? cur.title || "未知曲目" : "未在播放";
  $("np-artist").textContent = cur && !JUNK.has(cur.artist || "") ? cur.artist : "";
  $("np-fmt").innerHTML = cur ? fmtChips(cur).map((x) => `<span>${esc(x)}</span>`).join("") : "";
  if (!cur) { $("np-meta").innerHTML = ""; return; }
  const v = (x) => (x == null || JUNK.has(String(x)) ? "" : String(x));
  const rows = [
    ["专辑", v(cur.album)],
    ["专辑艺人", cur.albumartist && cur.albumartist !== cur.artist ? v(cur.albumartist) : ""],
    ["作曲", v(cur.composer)],
    ["指挥", v(cur.conductor)],
    ["乐团", v(cur.band)],
    ["流派", v(cur.genre)],
    ["年份", v(cur.year)],
    ["曲号", v(cur.tracknum)],
    ["时长", cur.duration ? fmtTime(cur.duration) : ""],
  ].filter((r) => r[1]);
  // 专辑名可点：选曲窗口滑入，直接打开这张专辑（全部曲目）
  const furl = [cur.libUrl, cur.url].find((u) => /^file:\/\//.test(u || "")) || "";   // 只有本地或网络盘上的文件才有文件夹
  $("np-meta").innerHTML = rows.map(([k, val]) => `<dt>${k}</dt><dd>${k === "专辑" && furl
    ? `<button class="np-link" data-folder="${esc(furl)}">${esc(val)}</button>` : esc(val)}</dd>`).join("");
}

/* ---------- 文件格式小标签：格式  位深  采样率（如 FLAC  16bit  44.1kHz），没有的项不显示 ----------
   LMS 的 type 是三字母代号；DSD 的 samplerate 是 1 bit 的位率（DSD64 = 2.8224 MHz = 64 × 44.1 kHz）。 */
const FMT_NAME = { flc: "FLAC", wav: "WAV", aif: "AIFF", alc: "ALAC", mp3: "MP3", aac: "AAC", mp4: "AAC", ogg: "Ogg",
  ops: "Opus", dsf: "DSD", dff: "DSD", wvp: "WavPack", ape: "APE", wma: "WMA" };
function fmtChips(t) {
  const type = String(t.type || "");
  const rate = Number(t.samplerate) || 0;
  const bits = Number(t.samplesize) || 0;
  return [
    FMT_NAME[type] || type.toUpperCase(),
    bits ? `${bits}bit` : "",
    !rate ? "" : rate >= 1e6 ? `${+(rate / 1e6).toFixed(1)}MHz` : `${+(rate / 1000).toFixed(1)}kHz`,
  ].filter(Boolean);
}
/* 没有封面时，缩略图里写文件格式。最多 4 个字母，32px 的小方块也放得下；
   t.type 是 LMS 的三字母代号，补出来的「已不在」曲目没有 type，就从文件名的扩展名取 */
const FMT_SHORT = { flc: "FLAC", flac: "FLAC", alc: "ALAC", aif: "AIFF", aiff: "AIFF", mp4: "AAC", ops: "OPUS", opus: "OPUS",
  dsf: "DSD", dff: "DSD", wvp: "WV", ogg: "OGG" };
const fmtShort = (x) => { const k = String(x || "").toLowerCase(); return FMT_SHORT[k] || k.toUpperCase().slice(0, 4); };
const fmtOfTrack = (t) => !t || isCd(t) ? ""
  : fmtShort(t.type || (/^file:/.test(t.url || "") ? Views.extOf(Views.fileOf(t.url)) : ""));

/* ---------- 确认弹窗：代替浏览器自带的 confirm，返回 true（确认）/ false（取消） ----------
   title 标题；msg 说明（\n 换行）；ok 确认按钮文字；danger 确认按钮和图标用红色；icon 图标（trash / restart）。
   点「取消」、点弹窗外的暗处或按 Esc 为取消；外接键盘按回车为确认。 */
const ASK_ICON = {
  trash: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13M10 11v5.5M14 11v5.5"/></svg>`,
  restart: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5v5h-5"/></svg>`,
  power: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v8"/><path d="M7.2 6.4a7.5 7.5 0 1 0 9.6 0"/></svg>`,
  speakers: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="8" height="16" rx="2"/><rect x="13" y="4" width="8" height="16" rx="2"/><circle cx="7" cy="14" r="2"/><circle cx="17" cy="14" r="2"/></svg>`,
};
function ask({ title, msg = "", ok = "确定", danger = false, icon = "" }) {
  const dlg = $("ask-dlg"), b = $("ask-ok"), ic = $("ask-icon");
  $("ask-title").textContent = title;
  $("ask-msg").textContent = msg;
  $("ask-msg").hidden = !msg;
  ic.innerHTML = ASK_ICON[icon] || "";
  ic.hidden = !ASK_ICON[icon];
  ic.classList.toggle("danger", danger);
  b.textContent = ok;
  b.classList.toggle("danger", danger);
  dlg.hidden = false;
  return new Promise((done) => {
    const close = (v) => { dlg.hidden = true; document.removeEventListener("keydown", key); done(v); };
    const key = (e) => {
      if (e.key === "Escape") close(false);
      else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); close(true); }
    };
    document.addEventListener("keydown", key);
    $("ask-cancel").onclick = () => close(false);
    b.onclick = () => close(true);
    dlg.onclick = (e) => { if (e.target === dlg) close(false); };
  });
}

/* ---------- 把当前播放存成播放列表（自定义弹窗） ----------
   顶上两个选项（11-25）：
   - 新建列表：输入名称；和已有列表同名时不让存，提示换名或改用「覆盖现有列表」。
     名称里文件名不允许的字符和冒号（冒号会被 LMS 当成「键:值」参数）换成「-」。
   - 覆盖现有列表：从已有播放列表里选一个，它原来的内容换成当前播放（红色「覆盖」）。
     当前播放是从某个播放列表载入的（status 带 playlist_name）时，预先选中它，并标「来源」。
   覆盖就是按同名再存一次（LMS 按文件地址更新同一个列表，编号不变），只写一次 .m3u，Daphile 只扫一次曲库。 */
const BAD_CH = /[\\/:*?"<>|]/;
const cleanName = (s) => s.replace(new RegExp(BAD_CH, "g"), "-").replace(/\s+/g, " ").trim();
async function saveQueue() {
  const loop = (S.st && S.st.playlist_loop) || [];
  const n = (S.st && Number(S.st.playlist_tracks)) || loop.length;
  if (!n) return toast("当前播放是空的，没有可保存的曲目");
  const d = new Date(), p2 = (x) => String(x).padStart(2, "0");
  const dlg = $("save-dlg"), inp = $("save-name"), ok = $("save-ok"), note = $("save-note");

  // 左边的封面：取队列里前 4 张不同的封面拼成 2×2；只有 1–3 张时用第一张；没有封面时显示列表图标
  const covers = [...new Set(loop.map(coverOf).filter(Boolean))];
  const art = $("save-art");
  art.classList.toggle("quad", covers.length >= 4);
  art.innerHTML = covers.length >= 4 ? covers.slice(0, 4).map((c) => `<img src="${LMS.cover(c, 80)}" alt="">`).join("")
    : covers.length ? `<img src="${LMS.cover(covers[0], 160)}" alt="">`
    : `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h12M4 12h12M4 17h8"/><circle cx="18.5" cy="17" r="2"/><path d="M20.5 17V9.5"/></svg>`;
  const sec = loop.reduce((s, x) => s + (Number(x.duration) || 0), 0);
  $("save-meta").textContent = [`${n} 首`, sec ? fmtTime(sec) : ""].filter(Boolean).join(" · ");

  let names = null;   // 已有播放列表名称；取到之前为 null
  let mode = "new", pick = "";
  const src = S.st && S.st.playlist_name ? String(S.st.playlist_name) : "";
  const seg = $("save-seg"), list = $("save-list"), field = $("save-input");
  const same = () => { const k = cleanName(inp.value).toLowerCase(); return names && names.find((x) => x.toLowerCase() === k); };
  const drawList = () => {
    list.innerHTML = !names ? `<li class="empty">读取中…</li>`
      : names.map((x, i) => `<li data-n="${i}" class="${x === pick ? "on" : ""}" role="radio" aria-checked="${x === pick}"><span class="rd"></span><span class="nm">${esc(x)}</span>${x === src ? `<span class="src">来源</span>` : ""}</li>`).join("");
    const on = list.querySelector("li.on");
    if (on) on.scrollIntoView({ block: "nearest" });
  };
  const check = () => {
    const over = mode === "over";
    seg.querySelectorAll("button").forEach((b) => { b.classList.toggle("on", b.dataset.m === mode); b.setAttribute("aria-checked", b.dataset.m === mode); });
    seg.querySelector('[data-m="over"]').disabled = !!names && !names.length;
    field.hidden = over;
    list.hidden = !over;
    let msg = "", warn = false;
    if (over) {
      ok.disabled = !pick;
      ok.textContent = "覆盖";
      ok.classList.add("danger");
      msg = pick ? `「${pick}」原来的内容会被当前播放的 ${n} 首替换。` : "选一个要覆盖的播放列表。";
      warn = !!pick;
    } else {
      const name = cleanName(inp.value), dup = name && same();
      ok.disabled = !name || !!dup;
      ok.textContent = "保存";
      ok.classList.remove("danger");
      $("save-clear").hidden = !inp.value;
      msg = dup ? `已有同名播放列表「${dup}」。换个名字，或改用「覆盖现有列表」。`
        : BAD_CH.test(inp.value) ? `名称里的 \\ / : * ? " < > | 会换成「-」。` : "";
      warn = !!dup;
    }
    note.textContent = msg;
    note.hidden = !msg;
    note.classList.toggle("warn", warn);
  };
  const setMode = (m) => {
    mode = m;
    if (m === "over") { if (!pick && names && names.includes(src)) pick = src; drawList(); inp.blur(); }
    check();
    if (m === "new") inp.focus();
  };
  const loaded = LMS.playlists().then((r) => { names = (r.playlists_loop || []).map((x) => String(x.playlist)); })
    .catch(() => { names = []; }).then(() => { if (mode === "over") drawList(); check(); });

  inp.value = `当前播放 ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}`;
  mode = "new"; pick = "";
  check();
  dlg.hidden = false;
  inp.focus();
  inp.select();

  const name = await new Promise((done) => {
    const close = (v) => { dlg.hidden = true; document.removeEventListener("keydown", key); inp.blur(); done(v); };
    const submit = async () => {
      if (ok.disabled) return;
      if (mode === "over") return close(pick);
      if (!names) {   // 名称还没取回：先等它，若发现同名就停在弹窗里显示提示
        await loaded;
        if (same()) return check();
      }
      close(cleanName(inp.value));
    };
    // 中文输入法选字时的回车不算提交
    const key = (e) => {
      if (e.key === "Escape") close(null);
      else if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(); }
    };
    document.addEventListener("keydown", key);
    inp.oninput = check;
    seg.onclick = (e) => { const b = e.target.closest("button[data-m]"); if (b && !b.disabled && b.dataset.m !== mode) setMode(b.dataset.m); };
    list.onclick = (e) => { const li = e.target.closest("li[data-n]"); if (!li) return; pick = names[li.dataset.n]; drawList(); check(); };
    $("save-clear").onclick = () => { inp.value = ""; check(); inp.focus(); };
    $("save-cancel").onclick = () => close(null);
    ok.onclick = submit;
    dlg.onclick = (e) => { if (e.target === dlg) close(null); };   // 点弹窗外的暗处 = 取消
  });
  if (!name) return;
  await act(async () => {
    const r = await LMS.savePlaylist(name);
    if (r && Number(r.writeError)) throw new Error("曲库正在扫描，稍后再存");
    toast(`${mode === "over" ? "已覆盖播放列表" : "已存为播放列表"}：${name}（${n} 首）`);
    if (typeof Views !== "undefined" && Views.refreshPlaylists) Views.refreshPlaylists();
  }, "保存失败");
}

/* 队列里当前曲目的标记：播放 ▶、暂停 ❙❙、停止 ■。用 SVG 画，避免 iOS 把符号显示成彩色 emoji */
/* ---------- 当前播放：曲目文件被删除 / 换了格式 ----------
   当前播放列表只记着当初加进来的那个文件。文件被删、改名，或 .wav 换成了 .flac，
   这一首就放不出来；曲库重扫后，LMS 的 status 甚至不再列出它（但队列里还占着位置，
   后面曲目的「playlist index」会整体错一位，点歌、删除都会对不上）。
   所以：
   1. status 列出的首数少于 playlist_tracks 时，逐个问「playlist path」取真实地址，按真实位置重排（fixLoop）；
   2. 到磁盘上核对每首的文件还在不在（和「我的喜爱」同一套，只读目录，NAS 整个读不到时不标）；
   3. 有异动才在标题栏出现「更新（N）」：换了格式的原位换成新文件，已不在的移出当前播放。
   每次队列变化（playlist_timestamp）核对一次，之后每分钟再看一次（文件变化不会改队列时间戳）。 */
const QF = { tried: "", at: 0, busy: false, ts: "", paths: null, gone: new Map(), ver: 0 };
const stemOf = (u) => { const f = (typeof Views !== "undefined" && Views.fileOf(u)) || ""; return f.slice(f.lastIndexOf("/") + 1).replace(/\.[^.]+$/, ""); };
function fixLoop(st) {
  const n = Number(st.playlist_tracks) || 0, loop = st.playlist_loop || [];
  if (!QF.paths || QF.ts !== String(st.playlist_timestamp) || QF.paths.length !== n || loop.length >= n) return st;
  const out = []; let j = 0;
  for (let i = 0; i < n; i++) {
    const v = loop[j], url = QF.paths[i];
    if (v && v.url === url) { out.push({ ...v, "playlist index": i }); j++; }
    else out.push({ id: "q-hidden-" + i, title: stemOf(url) || "（未知曲目）", url, "playlist index": i, qhidden: 1 });
  }
  return { ...st, playlist_loop: out };
}
async function checkQueue() {
  const st = S.st;
  if (!st || QF.busy || typeof Views === "undefined") return;
  const ts = String(st.playlist_timestamp), n = Number(st.playlist_tracks) || 0;
  QF.busy = true; QF.tried = ts; QF.at = Date.now();
  try {
    let paths = null;
    if ((st.playlist_loop || []).length < n && n <= 500) {   // status 最多取 500 首；更长的队列不逐首问，免得太慢
      paths = new Array(n);
      for (let i = 0; i < n; i += 8) {   // 8 个一批并发问，几百首也只要一两秒
        await Promise.all(Array.from({ length: Math.min(8, n - i) }, (_, k) => LMS.queuePath(i + k).then((u) => { paths[i + k] = u; })));
      }
    }
    if (!S.st || String(S.st.playlist_timestamp) !== ts) return;   // 核对期间队列又变了：下次再查
    QF.ts = ts; QF.paths = paths;
    const loop = fixLoop(S.st).playlist_loop || [];
    const seen = new Map();
    for (const t of loop) if (t.url && !seen.has(t.url)) seen.set(t.url, { url: t.url });
    const items = [...seen.values()];
    await Views.checkFiles(items);
    if (!S.st || String(S.st.playlist_timestamp) !== ts) return;
    const gone = new Map(items.filter((x) => x.gone).map((x) => [x.url, x.gone]));
    const key = (m) => [...m].map(([u, g]) => u + ">" + (g.twin || "")).join("|");
    if (key(gone) !== key(QF.gone) || paths) { QF.gone = gone; QF.ver++; S.queueKey = ""; S.st = libApply(fixLoop(S.st)); render(); }
  } catch (_) { /* 查不到就当没变化，下次再查 */ }
  finally { QF.busy = false; }
}
/* 有异动的曲目：[{i, url, gone}]，按队列位置 */
function queueGone() {
  const loop = (S.st && S.st.playlist_loop) || [];
  return loop.filter((t) => QF.gone.has(t.url)).map((t) => ({ i: Number(t["playlist index"]), url: t.url, title: t.title, gone: QF.gone.get(t.url) }));
}
function renderQfix() {
  const b = $("btn-qfix"), n = queueGone().length;
  b.hidden = !n;
  b.textContent = n ? `更新（${n}）` : "";
  b.title = n ? `有 ${n} 首的文件被删除或换了格式，点这里处理` : "";
}
/* 处理：换了格式的原位换成新文件（加到末尾 → 移到它后面 → 删掉旧的），已不在的移出当前播放。
   从后往前做，前面的位置不受影响。正在播放 / 暂停的那首不动（删掉它会打断播放）；随机打开时不做（位置对不上） */
async function fixQueue(picks) {
  const st = S.st || {};
  if (Number(st["playlist shuffle"]) > 0) return toast("随机播放打开时没法按原位置更新，请先关掉随机");
  const cur = Number(st.playlist_cur_index), busy = st.mode !== "stop";
  const keep = busy ? picks.filter((p) => p.i === cur) : [];
  picks = picks.filter((p) => !keep.includes(p));
  if (!picks.length) return toast("正在播放的这首先不动，停止后再更新");
  const tw = picks.filter((p) => p.gone.twin), del = picks.length - tw.length;
  const one = picks.length === 1 ? picks[0] : null;
  const msg = one
    ? (one.gone.twin ? `「${one.title}」原来的文件已不在，同一文件夹里有「${one.gone.twin}」。\n换成新文件（位置不变）？`
                     : `「${one.title}」的文件找不到了，可能被删除、改名或移动过，放不出来。\n从当前播放移除？（不会删除任何音乐文件）`)
    : [tw.length ? `${tw.length} 首换成同一文件夹里的新格式文件（位置不变）` : "", del ? `${del} 首文件已不在，移出当前播放` : ""].filter(Boolean).join("；") + "。\n不会删除任何音乐文件。";
  const kept = keep.length ? "\n正在播放的那首先不动，停止后再更新。" : "";
  if (!await ask({ title: one && !one.gone.twin ? "文件已不在" : "更新当前播放？", msg: msg + kept,
    ok: one && !one.gone.twin ? "移除" : "更新", danger: !tw.length, icon: tw.length ? "" : "trash" })) return;
  S.queueKey = "";
  act(async () => {
    // 动手前再核对一次：位置上还是那个文件才改，免得别处刚改过队列
    for (const p of picks) if ((await LMS.queuePath(p.i)) !== p.url) throw new Error("当前播放刚刚有变化，请再点一次");
    const dirs = new Map();
    for (const p of tw) {
      const d = p.url.slice(0, p.url.lastIndexOf("/"));
      if (!dirs.has(d)) dirs.set(d, ((await LMS.folderFiles(d)).folder_loop || []));
      const hit = dirs.get(d).find((x) => x.type === "track" && x.id && Views.fileOf(x.url).endsWith("/" + p.gone.twin));
      p.newId = hit ? hit.id : null;
    }
    let cnt = Number(st.playlist_tracks) || 0, rep = 0, rm = 0, miss = 0;
    for (const p of [...picks].sort((a, b) => b.i - a.i)) {
      if (p.gone.twin && !p.newId) { miss++; continue; }   // 新文件还没进曲库：先不动
      if (p.newId) {
        await LMS.addTracks([p.newId]);                         // 加到末尾（停着时不会自动开始放）
        if (cnt !== p.i + 1) await LMS.move(cnt, p.i + 1);      // 移到旧的那首后面
        await LMS.deleteAt(p.i);                                // 删掉旧的，新的就到了原位置
        rep++;
      } else { await LMS.deleteAt(p.i); cnt--; rm++; }
    }
    QF.tried = ""; QF.gone = new Map(); QF.ver++;
    toast([rep ? `已换成新文件 ${rep} 首` : "", rm ? `已移除 ${rm} 首` : "", miss ? `${miss} 首的新文件还没进曲库，稍后再试` : ""].filter(Boolean).join("，") || "没有可更新的曲目");
  }, "更新失败");
}

const QMARK = {
  play: `<svg class="qmark" viewBox="0 0 12 12" aria-label="播放中"><path d="M2.5 1.5v9l8-4.5z"/></svg>`,
  pause: `<svg class="qmark" viewBox="0 0 12 12" aria-label="已暂停"><rect x="2" y="1.5" width="3" height="9" rx=".8"/><rect x="7" y="1.5" width="3" height="9" rx=".8"/></svg>`,
  stop: `<svg class="qmark" viewBox="0 0 12 12" aria-label="已停止"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>`,
};

function renderQueue(loop, curIdx) {
  if (S.dragging) return;   // 拖动排序时不重绘，松手后再刷新
  const mode = QMARK[S.st.mode] ? S.st.mode : "stop";
  const key = Number(S.st.playlist_timestamp) + ":" + curIdx + ":" + mode + ":" + QF.ver;   // 播放 / 暂停切换时也要重绘标记
  if (key === S.queueKey) return;
  S.queueKey = key;
  renderQfix();
  const box = $("cur-list");
  $("cur-count").textContent = loop.length ? loop.length + " 首" : "";
  $("btn-save").disabled = !loop.length;   // 空队列不能保存
  $("btn-clear").disabled = !loop.length;  // 空队列不能清除：灰色不可点
  document.body.classList.toggle("q-empty", !loop.length);   // 空列表加入中：转圈放列表中间，标题行不重复显示
  if (!loop.length) {
    box.innerHTML = `<div class="empty"><span class="e-msg">当前播放列表是空的。<br>从左侧资料库选择分类，在右侧弹出的窗口里选曲加入。</span><span class="e-add"><svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2"/><path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>正在加入…</span></div>`;
    return;
  }
  box.innerHTML = `<table class="tracks cur-table"><thead><tr>
      <th class="num">#</th><th class="cv"></th><th>标题</th><th>艺人</th><th>专辑</th><th class="dur">时长</th>
    </tr></thead><tbody>${loop.map((t) => {
    const i = Number(t["playlist index"]);
    const cls = i === curIdx ? "playing" : i < curIdx ? "past" : "";
    const cid = coverOf(t);
    const cd = isCd(t);   // CD 曲目：封面位置换成醒目的「CD」标记
    const g = QF.gone.get(t.url);
    const note = g ? `<span class="q-note">${g.twin ? `已换成 ${esc(Views.extOf(g.twin))}` : "文件已不在"}</span>` : "";
    return `<tr class="${cls}${cd ? " is-cd" : ""}${g ? " q-gone" : ""}" data-idx="${i}">
      <td class="num">${i === curIdx ? QMARK[mode] : i + 1}</td>
      <td class="cv">${cd ? `<span class="ph cd-tag" aria-label="CD 曲目">CD</span>` : cid ? `<img src="${LMS.cover(cid, 100)}" alt="" loading="lazy">` : (() => { const f = fmtOfTrack(t); return `<span class="ph${f ? " fmt" : ""}">${esc(f)}</span>`; })()}</td>
      <td>${note ? `<div class="q-cell"><span class="q-tt">${esc(t.title)}</span>${note}</div>` : esc(t.title)}</td><td>${esc(t.artist || "")}</td><td>${esc(t.album || "")}</td>
      <td class="dur">${t.duration ? fmtTime(t.duration) : ""}</td>
    </tr>`;
  }).join("")}</tbody></table>`;
}

/* 轮询：同一时间只发一个 status 请求（正在等回复时又被叫到，就等这次回来后立刻再查一次）。
   发出时间早于最近一次按键命令的回复一律丢掉——那是命令生效前的旧状态，
   套用上去会让刚按下的播放 / 暂停键先跳回原样，下一秒才变过来，看起来像「滞后」。 */
async function poll() {
  clearTimeout(poll._t);
  if (poll.busy) { poll.again = true; return; }
  poll.busy = true; poll.again = false;
  const sentAt = Date.now();
  try {
    const st = await LMS.status();
    S.fails = 0;
    if (sentAt >= S.cmdAt) {
      S.st = libApply(fixLoop(Resume.apply(st)));
      S.polledAt = Date.now();
      // status 在扫描期间带 rescan:1：页面开着时别处发起的扫描（LMS 设置页、定时插件、自动重扫）也显示进度
      if (Number(st.rescan) === 1 && !Scan.on && !Scan.probe) { Scan.probe = true; scanTick().finally(() => { Scan.probe = false; }); }
      render();
      checkAdding();
      const n = Number(S.st.playlist_tracks) || 0;
      if (!n) { if (QF.gone.size) { QF.gone = new Map(); QF.ver++; } QF.tried = ""; }
      else if (QF.tried !== String(S.st.playlist_timestamp) || Date.now() - QF.at > 60000) checkQueue();
    }
  } catch (e) {
    S.fails++;
    if (S.fails === 3 && !Upd.since && !Halt.since) { toast("与 Daphile 失去连接，正在重试…"); }   // 重启 LMS、关机期间不提示
  }
  poll.busy = false;
  // 页面在后台时降低频率
  poll._t = setTimeout(poll, poll.again ? 0 : document.hidden ? 5000 : 1000);
}

/* ---------- 插件更新提示（侧栏左下，主题开关上方） ----------
   LMS 下载好插件更新后，serverstatus 返回 needsrestart:1，newplugins 末尾括号里是插件名；要重启 LMS 才会装上。
   每分钟查一次；点提示框确认后发 restartserver，等 LMS 重新上线、不再需要重启时刷新页面，载入新版。 */
const Upd = { since: 0, t: 0 };
async function checkUpdate() {
  clearTimeout(Upd.t);
  let r = null;
  try { r = await LMS.serverStatus(); } catch (_) { /* 连不上：下次再查 */ }
  const box = $("upd-box");
  if (Upd.since) {
    const waited = Date.now() - Upd.since;
    if (r && !Number(r.needsrestart) && waited > 5000) return location.reload();
    if (waited > 180000) {
      Upd.since = 0;
      box.classList.remove("busy");
      $("upd-title").textContent = "插件更新已就绪";
      $("upd-sub").textContent = "点此重启 LMS 安装";
      toast("LMS 没有按时重启完成，请到 Daphile 设置页查看");
    } else { Upd.t = setTimeout(checkUpdate, 3000); return; }
  }
  const ready = !!r && Number(r.needsrestart) === 1 && !Number(r.pluginsdownloading);
  if (ready) {
    const m = /\(([^()]*)\)\s*$/.exec(r.newplugins || "");
    $("upd-sub").textContent = (m ? m[1] + " · " : "") + "点此重启 LMS 安装";
  }
  box.hidden = !ready;
  Upd.t = setTimeout(checkUpdate, document.hidden ? 300000 : 60000);
}
function bindUpdate() {
  $("upd-box").onclick = async () => {
    if (Upd.since) return;
    const playing = S.st && S.st.mode === "play";
    const what = $("upd-sub").textContent.replace(/\s*·?\s*点此重启 LMS 安装$/, "");   // 如「DaphileTouch 0.4.1」
    if (!await ask({
      title: "重启 LMS 安装插件更新？", icon: "restart", ok: "重启", danger: playing,
      msg: [what && "要安装：" + what, playing && "正在播放的音乐会中断。", "重启约需一分钟，完成后页面自动刷新。"].filter(Boolean).join("\n"),
    })) return;
    if (Upd.since) return;   // 弹窗开着时已被别处触发
    Upd.since = Date.now();
    $("upd-box").classList.add("busy");
    $("upd-title").textContent = "正在重启 LMS…";
    $("upd-sub").textContent = "完成后页面会自动刷新";
    try { await LMS.restartServer(); } catch (_) { /* 重启时连接常被直接断开，属正常 */ }
    Upd.t = setTimeout(checkUpdate, 5000);
  };
}

/* 「当前播放」拖动排序：按住 0.3 秒提起整行，上下拖动，松手后用 playlist move 写回 LMS。
   按住前手指/鼠标移动超过 8px 视为滚动，不提起。 */
function bindReorder() {
  const box = $("cur-list");
  const HOLD_MS = 300, SLOP = 8, EDGE = 60;
  let timer = null, drag = null, sx = 0, sy = 0, pid = null, lastY = 0, raf = 0;

  const rows = () => [...box.querySelectorAll("tbody tr[data-idx]")];

  function lift(tr) {
    timer = null;
    drag = { tr, from: Number(tr.dataset.idx), baseY: sy + box.scrollTop };
    S.dragging = true;
    tr.classList.add("lifted");
    box.classList.add("reordering");
    try { box.setPointerCapture(pid); } catch (e) { /* 忽略 */ }
    if (navigator.vibrate) navigator.vibrate(10);
    tick();
  }

  // 跟随指针移动；越过相邻行的一半就和它交换位置
  function follow() {
    const tr = drag.tr;
    let dy = lastY + box.scrollTop - drag.baseY;
    let next = tr.nextElementSibling, prev = tr.previousElementSibling;
    while (next && dy > next.offsetHeight / 2) {
      next.after(tr); drag.baseY += next.offsetHeight; dy -= next.offsetHeight; next = tr.nextElementSibling;
    }
    while (prev && dy < -prev.offsetHeight / 2) {
      prev.before(tr); drag.baseY -= prev.offsetHeight; dy += prev.offsetHeight; prev = tr.previousElementSibling;
    }
    tr.style.transform = `translateY(${dy}px)`;
  }

  // 拖到列表上下边缘时自动滚动
  function tick() {
    if (!drag) return;
    const r = box.getBoundingClientRect();
    const v = lastY < r.top + EDGE ? -(r.top + EDGE - lastY) / 4 : lastY > r.bottom - EDGE ? (lastY - (r.bottom - EDGE)) / 4 : 0;
    if (v) { box.scrollTop += Math.max(-20, Math.min(20, v)); follow(); }
    raf = requestAnimationFrame(tick);
  }

  function finish(commit) {
    cancelAnimationFrame(raf);
    const { tr, from } = drag;
    const to = rows().indexOf(tr);
    tr.classList.remove("lifted");
    tr.style.transform = "";
    box.classList.remove("reordering");
    drag = null;
    S.dragging = false;
    S.justDragged = true;
    setTimeout(() => { S.justDragged = false; }, 80);
    S.queueKey = "";   // 强制按 LMS 的新顺序重绘
    if (commit && to >= 0 && to !== from) act(() => LMS.move(from, to), "调整顺序失败");
    else if (S.st) render();
  }

  box.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || e.target.closest("[data-del]")) return;
    const tr = e.target.closest("tbody tr[data-idx]");
    if (!tr) return;
    sx = e.clientX; sy = lastY = e.clientY; pid = e.pointerId;
    clearTimeout(timer);
    timer = setTimeout(() => lift(tr), HOLD_MS);
  });
  box.addEventListener("pointermove", (e) => {
    if (timer) {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > SLOP) { clearTimeout(timer); timer = null; }
      return;
    }
    if (!drag) return;
    e.preventDefault();
    lastY = e.clientY;
    follow();
  });
  const end = (commit) => () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (drag) finish(commit);
  };
  box.addEventListener("pointerup", end(true));
  box.addEventListener("pointercancel", end(false));
  // 触屏：提起后阻止页面滚动；长按不弹系统菜单
  box.addEventListener("touchmove", (e) => { if (drag) e.preventDefault(); }, { passive: false });
  box.addEventListener("contextmenu", (e) => { if (drag || timer) e.preventDefault(); });
}

/* 滑动删除后松手会产生一次 click，吞掉它，免得被当成「播放这首」或「进入」 */
function swallowClick(box) {
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
  box.addEventListener("click", stop, { capture: true, once: true });
  setTimeout(() => box.removeEventListener("click", stop, true), 400);
}

/* 向左滑动删除（当前播放列表）：横向拖动整行，右边露出红色按钮（最宽 76px，垃圾篓居中）。
   拉到按钮露满（72px 起，变深红）松手即删除，不够就弹回；之后几乎不再变长（最多 +4px 弹性）。
   rowSel：可滑动的行；onDelete(row) 负责删除并重绘（可返回 Promise）。拖动排序进行中不触发。 */
function bindSwipe(box, rowSel, onDelete) {
  const THRESH = 72, MAX = 76, ELASTIC = 4, START = 10;
  let sw = null;
  const back = (row) => {
    row.classList.remove("sw-move", "swipe-arm", "sw-del");
    row.style.setProperty("--sx", "0px");
    setTimeout(() => { if (!row.classList.contains("sw-move")) { row.classList.remove("swiping"); row.style.removeProperty("--sx"); } }, 220);
  };
  const remove = (row) => {
    row.classList.remove("sw-move");
    row.classList.add("sw-del");   // 停在原位淡出，不再整行滑出（否则会露出整条红底）
    Promise.resolve(onDelete(row)).catch(() => {})
      .finally(() => setTimeout(() => { if (row.isConnected) back(row); }, 2500));   // 删除失败或未重绘就弹回
  };
  box.addEventListener("pointerdown", (e) => {
    sw = null;
    if (e.button > 0 || S.dragging) return;
    const row = e.target.closest(rowSel);
    if (row && box.contains(row)) sw = { row, x: e.clientX, y: e.clientY, dx: 0, on: false, id: e.pointerId };
  });
  box.addEventListener("pointermove", (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (!sw.on) {
      if (S.dragging || Math.abs(dy) > START) { sw = null; return; }   // 竖向移动是滚动或排序
      if (dx > -START) return;   // 只认左滑
      sw.on = true;
      sw.row.classList.add("swiping", "sw-move");
      try { box.setPointerCapture(sw.id); } catch (_) { /* 忽略 */ }
    }
    e.preventDefault();
    const pull = Math.max(0, -dx);   // 行向左移的距离
    // 超过 MAX 后只有很小的弹性余量，最多再多出 ELASTIC
    const shown = pull <= MAX ? pull : MAX + ELASTIC * (1 - 1 / (1 + (pull - MAX) / 60));
    sw.dx = -Math.round(shown);
    sw.row.style.setProperty("--sx", sw.dx + "px");
    sw.row.classList.toggle("swipe-arm", -sw.dx >= THRESH);   // 变深红 = 松手就删
  });
  const end = (ok) => (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const { row, on, dx } = sw;
    sw = null;
    if (!on) return;
    swallowClick(box);
    if (!ok || -dx < THRESH) return back(row);
    remove(row);
  };
  box.addEventListener("pointerup", end(true));
  box.addEventListener("pointercancel", end(false));
}

/* 左下角深浅界面开关：默认跟随系统（iPad「自动」深浅色到点就切换）。
   手动拨开关只临时盖过系统：记成「主题@当时的系统主题」，系统下次切换时作废，重新跟随系统；
   拨回与系统相同的主题也等于恢复跟随。 */
function bindTheme() {
  const KEY = "daphile.themeOverride", root = document.documentElement, btn = $("btn-theme");
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const sysTheme = () => (mq.matches ? "dark" : "light");
  const sync = () => {
    const dark = root.dataset.theme === "dark";
    btn.setAttribute("aria-checked", String(dark));
    btn.title = dark ? "切换到浅色界面" : "切换到深色界面";
  };
  const apply = (t) => {
    root.classList.add("theme-anim");
    root.dataset.theme = t;
    clearTimeout(apply._t);
    apply._t = setTimeout(() => root.classList.remove("theme-anim"), 350);
    sync();
  };
  btn.onclick = () => {
    const t = root.dataset.theme === "dark" ? "light" : "dark", sys = sysTheme();
    try {
      if (t === sys) localStorage.removeItem(KEY);       // 与系统一致：回到跟随系统
      else localStorage.setItem(KEY, t + "@" + sys);
    } catch (e) { /* 存不了就只对本次有效 */ }
    apply(t);
  };
  const onSys = () => {
    try { localStorage.removeItem(KEY); } catch (_) { /* 忽略 */ }
    apply(sysTheme());
  };
  if (mq.addEventListener) mq.addEventListener("change", onSys);
  else if (mq.addListener) mq.addListener(onSys);         // 老版 Safari（iOS 13 及以前）
  sync();
}

function bindPlayer() {
  $("btn-play").onclick = () => {
    // 先在界面上切换（按键图标、进度走停、频谱），不等 LMS 回复；命令失败时下一次轮询会改回真实状态
    const st = S.st;
    const wasOff = st && Number(st.power) !== 1, wasStop = st && st.mode === "stop";
    const r = st && st._resume; if (r) st._resume = null;   // 记住的进度只用一次（连按两下不会再跳一次）
    if (st && !wasOff && (S.cur || wasStop)) {
      const now = Date.now();
      if (st.mode === "play") st.time = Number(st.time || 0) + (now - S.polledAt) / 1000;
      S.polledAt = now;
      st.mode = st.mode === "play" ? "pause" : "play";
      S.cmdAt = now;                // 在这之前发出、还没回来的轮询作废
      render();
    }
    act(async () => {
      if (wasOff) await LMS.power(1);
      if (r) { Resume.set(LMS.playerId, null); await LMS.resumeAt(r.idx, r.t); }   // 暂停时转过来的：从记住的位置接着放
      else await (wasStop ? LMS.play() : LMS.toggle());
    });
  };
  // 静音不用 LMS 的 muting（RaopBridge 1.8.12 下 AirPlay 设备会出错），改为：记住音量 → 设 0；取消时恢复。按钮在音量面板里
  const toggleMute = () => act(async () => {
    const key = "daphile.mutevol." + LMS.playerId;
    const vol = Number(S.st && S.st["mixer volume"]);
    if (vol < 0) return LMS.mute(0);   // LMS 自带静音留下的状态：直接解除，音量自动恢复
    if (vol > 0) {
      try { localStorage.setItem(key, String(vol)); } catch (_) { /* 忽略 */ }
      return LMS.volume(0);
    }
    let back = 0;
    try { back = Number(localStorage.getItem(key)) || 0; } catch (_) { /* 忽略 */ }
    return LMS.volume(back > 0 ? back : 50);   // 没记录时恢复到 50
  }, "静音切换失败");
  $("btn-prev").onclick = () => act(LMS.prev);
  $("btn-next").onclick = () => act(LMS.next);
  $("btn-shuffle").onclick = () => act(() => LMS.shuffle(Number(S.st?.["playlist shuffle"]) > 0 ? 0 : 1));
  $("btn-repeat").onclick = () => act(() => LMS.repeat((Number(S.st?.["playlist repeat"]) + 1) % 3));
  bindTheme();
  // iOS Safari 只有页面上挂了 touchstart 监听时，手指按住才会触发 :active（行被点时的加深底色）
  document.addEventListener("touchstart", () => {}, { passive: true });
  /* 右侧曲目详情（正在播放信息）：按钮开关；点当前播放列表的空白处，或在详情上向右滑，都会向右收起 */
  const q = $("queue");
  const setQueue = (open) => {
    q.hidden = !open;
    q.classList.remove("closing");
    q.style.transition = q.style.transform = "";
    $("app").classList.toggle("queue-open", open);
    $("btn-queue").classList.toggle("on", open);
  };
  /* 向右收起：先滑出去（.closing 动画），动画结束再真正隐藏；from 为当前已拖出的距离 */
  const closeQueue = (from = 0) => {
    if (q.hidden || q.classList.contains("closing")) return;
    q.style.transition = "transform .2s ease-in";
    q.style.transform = `translateX(${from}px)`;
    q.classList.add("closing");
    requestAnimationFrame(() => { q.style.transform = "translateX(100%)"; });
    setTimeout(() => setQueue(false), 210);
  };
  /* 详情和左侧窗口（选曲页、CD 页等）不同时开着，谁后打开谁留下：
     - 打开详情时左侧窗口开着：先让详情出来，停一下再把左侧窗口缩回；
     - 详情开着时从左侧边栏打开一个页面：先让左侧窗口出来，停一下再把详情收起（S.pickerOpened，views.js 调用）。
     这样看得出是「新的来了、旧的走了」，而不是两边同时在动。两种情况共用一个计时器，后点的作废先点的 */
  let swapTimer = 0;
  const qOpen = () => !q.hidden && !q.classList.contains("closing");
  $("btn-queue").onclick = () => {
    clearTimeout(swapTimer);
    if (!q.hidden) return closeQueue();
    setQueue(true);
    if (typeof Views !== "undefined" && Views.pickerOpen())
      swapTimer = setTimeout(() => { if (qOpen() && Views.pickerOpen()) Views.closePicker(); }, 280);
  };
  S.pickerOpened = () => {
    clearTimeout(swapTimer);
    if (qOpen()) swapTimer = setTimeout(() => { if (qOpen() && Views.pickerOpen()) closeQueue(); }, 280);
  };
  S.closeQueue = closeQueue;   // fitPlayer 在窗口太窄放不下详情时调用
  /* 在详情上向右滑：面板跟着手指右移，拉过面板宽度 1/4（或快速一甩）松手即收起，不够就弹回；竖向移动留给滚动 */
  {
    const START = 12;
    let g = null;
    q.addEventListener("pointerdown", (e) => {
      g = null;
      if (e.button > 0 || q.hidden || q.classList.contains("closing")) return;
      g = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false, dx: 0, v: 0, t: e.timeStamp };
    });
    q.addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.on) {
        if (Math.abs(dy) > START) { g = null; return; }            // 竖向：是滚动
        if (dx < START || dx < Math.abs(dy) * 1.5) return;          // 还没确定是向右横滑
        g.on = true;
        q.style.transition = "none";
        try { q.setPointerCapture(g.id); } catch (_) { /* 忽略 */ }
      }
      e.preventDefault();
      const x = Math.max(0, dx - START);                           // 扣掉起步的 12px，面板不会突然一跳
      g.v = (x - g.dx) / Math.max(8, e.timeStamp - g.t);           // 速度 px/ms
      g.dx = x; g.t = e.timeStamp;
      q.style.transform = `translateX(${x}px)`;
    });
    const end = (ok) => (e) => {
      if (!g || e.pointerId !== g.id) return;
      const { on, dx, v } = g;
      g = null;
      if (!on) return;
      S.justSwiped = Date.now();                                   // 滑完松手产生的点击不当作点按
      if (ok && (dx > q.offsetWidth / 4 || (v > 0.6 && dx > 30))) return closeQueue(dx);
      q.style.transition = "transform .2s ease";
      q.style.transform = "";
      setTimeout(() => { if (!q.style.transform) q.style.transition = ""; }, 220);
    };
    q.addEventListener("pointerup", end(true));
    q.addEventListener("pointercancel", end(false));
    q.addEventListener("click", (e) => { if (Date.now() - (S.justSwiped || 0) < 300) { e.stopPropagation(); e.preventDefault(); } }, true);
  }
  // 正在播放时只清除其他曲目，当前这首保留并继续播放；暂停或停止时清除整个队列
  $("btn-clear").onclick = async () => {
    const st = S.st || {};
    const n = Number(st.playlist_tracks) || 0;
    if (st.mode === "play" && S.cur) {
      if (n <= 1) return toast("只有正在播放的这一首，没有其他曲目可清除");
      if (!await ask({ title: "清除其他曲目？", icon: "trash", ok: "清除", danger: true,
        msg: `保留正在播放的「${S.cur.title || "当前曲目"}」，清除其余 ${n - 1} 首。` })) return;
      S.queueKey = "";
      return act(async () => { const k = await LMS.clearOthers(); toast(`已清除 ${k} 首，正在播放的保留`); }, "清除失败");
    }
    if (await ask({ title: "清除当前播放？", icon: "trash", ok: "清除", danger: true,
      msg: `当前播放的 ${n} 首会全部移出列表（曲库里的文件不受影响）。` })) act(LMS.clear, "清除失败");
  };
  $("btn-save").onclick = saveQueue;
  $("lcd-fav").onclick = (e) => { e.stopPropagation(); toggleFav(); };
  $("btn-qfix").onclick = () => fixQueue(queueGone());
  $("np-meta").onclick = (e) => { const b = e.target.closest("[data-folder]"); if (b) Views.openFolder(b.dataset.folder); };
  bindReorder();
  // 当前播放：向左滑动一行即从队列移除
  bindSwipe($("cur-list"), "tbody tr[data-idx]", (row) => {
    S.queueKey = "";   // 下一次轮询按 LMS 的新队列重绘
    return act(() => LMS.deleteAt(row.dataset.idx), "移除失败");
  });
  /* 选曲窗口打开时，在当前播放列表里按下任何地方（鼠标或手指）：选曲窗口缩回。
     这一下只用来收起窗口，不播放、不开始拖动或滑动删除，免得误点切歌；收起后再点才生效 */
  $("cur-list").addEventListener("pointerdown", (e) => {
    if (typeof Views === "undefined" || !Views.pickerOpen()) return;
    Views.closePicker();
    S.pickerClosedAt = Date.now();
    e.stopPropagation();
  }, true);
  $("cur-list").addEventListener("click", (e) => {
    if (Date.now() - (S.pickerClosedAt || 0) < 800) { e.stopPropagation(); e.preventDefault(); S.pickerClosedAt = 0; }
  }, true);
  $("cur-list").onclick = (e) => {
    if (S.justDragged) return;   // 刚拖完松手产生的点击，不当作「播放这首」
    const tr = e.target.closest("tr[data-idx]");
    if (!tr) {                   // 点在列表的空白处（不在任何一行上）：收起右侧详情
      if (!e.target.closest("button, a, input, th")) closeQueue();
      return;
    }
    if (tr.classList.contains("q-gone")) {   // 文件已不在 / 已换格式：放不出来，改为问要不要更新这一首
      const p = queueGone().find((x) => String(x.i) === tr.dataset.idx);
      if (p) return fixQueue([p]);
    }
    act(async () => {
      if (S.st && Number(S.st.power) !== 1) await LMS.power(1);
      await LMS.jump(tr.dataset.idx);
    });
  };

  /* 播放设备：列出网络上的 LMS 播放器，打勾的是当前控制的设备 */
  const SPEAKER = `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="6" y="2.5" width="12" height="19" rx="2.5" fill="currentColor"/><circle cx="12" cy="14.5" r="3.4" fill="var(--bar-solid)"/><circle cx="12" cy="7" r="1.6" fill="var(--bar-solid)"/></svg>`;
  /* 把播放器列表填进播放条的 AirPlay 弹窗 */
  async function fillDevices(ul, quiet = false) {
    const multi = SyncOut.on;
    ul.classList.toggle("multi", multi);
    ul.setAttribute("aria-multiselectable", String(multi));
    $("dev-hint").hidden = !multi;
    if (!quiet) ul.innerHTML = `<li class="dev-empty">正在查找设备…</li>`;
    try {
      // 多选模式：当前设备 + 和它同组的设备打勾
      const [list, buddies] = await Promise.all([LMS.players(), multi ? LMS.syncedWith().catch(() => []) : []]);
      // 多选模式下只剩一台勾着：它的勾变灰、不能点（至少要留一台在放）
      const isOn = (p) => p.playerid === LMS.playerId || buddies.includes(p.playerid);
      const onCount = list.filter((p) => isOn(p) && Number(p.connected) === 1).length;
      ul.innerHTML = list.length ? list.map((p) => {
        const online = Number(p.connected) === 1;
        const cur = p.playerid === LMS.playerId;
        const on = isOn(p);
        const last = multi && on && online && onCount <= 1;
        const cls = [cur ? "cur" : "", multi && on ? "on" : "", online ? "" : "offline", last ? "last" : ""].join(" ");
        return `<li data-pid="${esc(p.playerid)}" class="${cls}" role="option" aria-selected="${multi ? on : cur}"${last ? ` aria-disabled="true" title="至少要勾选一台设备"` : ""}>
          <span class="dev-ico">${SPEAKER}</span>
          <span class="dev-name">${esc(p.name)}${online ? "" : `<small>离线</small>`}</span>
          <span class="dev-chk"></span></li>`;
      }).join("") : `<li class="dev-empty">没有找到播放设备</li>`;
    } catch (err) { ul.innerHTML = `<li class="dev-empty">查找失败：${esc(err.message)}</li>`; }
  }
  const devName = (li) => li.querySelector(".dev-name").firstChild.textContent.trim();
  /* 网页改为控制另一台设备（AirPlay 转移完成后调用） */
  function switchPlayer(li, msg = "已切换到 ") {
    const pid = li.dataset.pid;
    if (pid === LMS.playerId) return;
    LMS.setPlayer(pid);
    try { localStorage.setItem("daphile.player", pid); } catch (err) { /* 忽略 */ }
    S.queueKey = ""; S.npKey = null;
    S.cmdAt = Date.now();          // 切换前发出、还没回来的旧设备轮询作废（否则会拿旧设备的状态核对新设备记住的进度）
    toast(msg + devName(li));
    poll();
    syncRhythmDelay();
  }
  /* 播放条上的 AirPlay：把正在放的声音转到另一台设备（队列、当前曲目、进度一起带过去），
     原设备暂停，网页随后控制新设备 */
  async function transferTo(li) {
    const pid = li.dataset.pid;
    if (pid === LMS.playerId || transferTo.busy) return;
    transferTo.busy = true;
    toast("正在转到 " + devName(li) + "…");
    try {
      // 当前设备若是「暂停时转过来、停着」的，LMS 报不出进度，用网页记住的位置
      const r = S.st && S.st._resume;
      const { resume } = await LMS.transfer(LMS.playerId, pid, r ? r.t : null);
      Resume.set(pid, resume);
      if (r) Resume.set(LMS.playerId, null);
      switchPlayer(li, "已转到 ");
    } catch (err) {
      toast(err.message === "当前播放列表是空的" ? "当前没有正在播放的内容，无需转移" : "转移失败：" + err.message);
    } finally { transferTo.busy = false; }
  }
  const pickedDevice = (e) => {
    const li = e.target.closest("li[data-pid]");
    return li && !li.classList.contains("offline") ? li : null;   // 离线设备点了不响应
  };

  // 播放条上的 AirPlay 弹窗：把正在播放的内容转到另一台设备（切换喇叭）
  const devBox = $("devices");
  const closeDevices = () => { devBox.hidden = true; $("btn-devices").classList.remove("on"); };

  $("btn-devices").onclick = (e) => {
    e.stopPropagation();
    if (!devBox.hidden) return closeDevices();
    closeVol(); closeSet();
    devBox.hidden = false;
    $("btn-devices").classList.add("on");
    fillDevices($("device-list"));
  };
  $("device-list").onclick = (e) => {
    const li = pickedDevice(e); if (!li) return;
    if (SyncOut.on) return li.classList.contains("last") ? undefined : toggleSync(li);   // 最后一台：灰勾，点了不响应
    closeDevices(); transferTo(li);
  };
  /* 合并输出：勾上 = 开机（不自动续播它自己的列表）后加入当前设备的组，跟着放同一首；
     取消 = 退出组（那台停止，其余照常）。每台都能取消，但至少留一台：
     取消的是正在控制的设备时，网页改为控制组里还勾着的一台，音乐在那边接着放（LMS 会把播放列表交给它） */
  async function toggleSync(li) {
    const pid = li.dataset.pid, ul = $("device-list");
    if (ul.querySelector("li.busy")) return;
    const join = !li.classList.contains("on");
    const rest = [...ul.querySelectorAll("li.on[data-pid]")].filter((x) => x !== li && !x.classList.contains("offline"));
    if (!join && !rest.length) return toast("至少要勾选一台设备");
    li.classList.add("busy");
    await act(async () => {
      if (join) { await LMS.powerOf(pid, 1); await LMS.syncTo(pid, LMS.playerId); }
      else await LMS.unsync(pid);
      if (!join && pid === LMS.playerId) return switchPlayer(rest[0], `已退出：${devName(li)}，现在控制 `);
      toast((join ? "已加入：" : "已退出：") + devName(li));
    }, join ? "加入失败" : "退出失败");
    if (!devBox.hidden) await fillDevices(ul, true);
    else li.classList.remove("busy");
  }
  window.refreshDevices = () => { if (!devBox.hidden) fillDevices($("device-list"), true); };
  document.addEventListener("click", (e) => {
    if (!devBox.hidden && !e.target.closest(".dev-wrap")) closeDevices();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDevices(); closeVol(); } });

  /* 播放条上的音量面板：点喇叭键打开（与 AirPlay 弹窗互斥）。能调音量的设备拖滑块调；固定输出的设备滑块灰掉、不能拖 */
  const volBox = $("vol-pop"), volRange = $("vol-range");
  const closeVol = () => { volBox.hidden = true; $("btn-mute").classList.remove("on"); S.volDrag = false; };
  $("btn-mute").onclick = (e) => {
    e.stopPropagation();
    if (!volBox.hidden) return closeVol();
    closeDevices(); closeSet();
    volBox.hidden = false;
    $("btn-mute").classList.add("on");
    if (Grp.ids.length > 1) refreshGroup();   // 合并播放：打开时马上查一次各台音量
  };
  $("vol-mute").onclick = toggleMute;
  document.addEventListener("click", (e) => {
    if (!volBox.hidden && !e.target.closest(".vol-wrap")) closeVol();
  });
  /* 小窗口（AirPlay、音量、齿轮菜单）开着时，按在小窗口外面：这一下只用来关小窗口，
     不播放、不加歌、不开始拖动或滑动删除（和选曲窗口开着时点当前播放一样）。
     小窗口自己、打开它们的按键（点了是切换）、确认弹窗不算外面 */
  const POPS = ".dev-wrap, .vol-wrap, #set-pop, #btn-set, #ask-dlg";
  const popOpen = () => !devBox.hidden || !volBox.hidden || !$("set-pop").hidden;
  document.addEventListener("pointerdown", (e) => {
    if (!popOpen() || e.target.closest(POPS)) return;
    closeDevices(); closeVol(); closeSet();
    S.popClosedAt = Date.now();
    e.stopPropagation();
  }, true);
  document.addEventListener("click", (e) => {
    if (Date.now() - (S.popClosedAt || 0) < 800) { e.stopPropagation(); e.preventDefault(); S.popClosedAt = 0; }
  }, true);
  /* 拖动中每 150ms 最多发一条 mixer volume（不节流的话一次拖动会发出上百条，AirPlay 设备跟不上），松手时补发最后的值。
     拖动期间（S.volDrag）轮询照常，但不把滑块拨回旧值；松手的命令回来后（act 作废之前发出的轮询）才恢复跟随 */
  const VOL_GAP = 150;
  let volAt = 0, volTimer = 0, volSent = -1, volP = null;
  const volSend = (v) => {
    const neg = Number(S.st?.["mixer volume"]) < 0;   // LMS 自带静音留下的负数音量：先解除再设
    volAt = Date.now(); volSent = v;
    if (S.st) S.st["mixer volume"] = v;
    volP = (async () => { if (neg) await LMS.mute(0); await LMS.volume(v); })().catch((err) => toast("调节音量失败：" + err.message));
    return volP;
  };
  volRange.addEventListener("input", () => {
    const v = Number(volRange.value);
    S.volDrag = true;
    setVolUI(v);
    clearTimeout(volTimer);
    const wait = VOL_GAP - (Date.now() - volAt);
    if (wait <= 0) volSend(v);
    else volTimer = setTimeout(() => volSend(Number(volRange.value)), wait);
  });
  volRange.addEventListener("change", () => {
    clearTimeout(volTimer);
    const v = Number(volRange.value);
    act(async () => { if (v !== volSent) volSend(v); await volP; }).then(() => {
      // 等命令期间可能套上了命令生效前发出的轮询（旧音量），先写回松手的值再放开，滑块不会弹回去一下
      if (S.st) S.st["mixer volume"] = v;
      S.volDrag = false; render();
    });
  });

  /* 合并播放时每台一行：拖滑块只调这一台（同样每 150ms 最多一条，松手补发最后的值）；点这一行的喇叭键只静音这一台 */
  const gbox = $("vol-group"), gs = {};   // gs[pid] = { at, timer, sent, p }
  const gSet = (pid, v) => {
    const g = gs[pid] || (gs[pid] = { at: 0, timer: 0, sent: -1, p: null });
    const neg = Number(Grp.info[pid]?.vol) < 0;
    g.at = Date.now(); g.sent = v;
    if (Grp.info[pid]) Grp.info[pid].vol = v;
    if (pid === LMS.playerId && S.st) S.st["mixer volume"] = v;
    g.p = (async () => { if (neg) await LMS.muteOf(pid, 0); await LMS.volumeOf(pid, v); })()
      .catch((err) => toast("调节音量失败：" + err.message));
    return g.p;
  };
  const gRow = (e) => e.target.closest(".vg-item");
  gbox.addEventListener("input", (e) => {
    const row = gRow(e); if (!row || !e.target.matches(".vol-range")) return;
    const pid = row.dataset.pid, v = Number(e.target.value), g = gs[pid] || (gs[pid] = { at: 0, timer: 0, sent: -1, p: null });
    Grp.drag[pid] = true;
    if (pid === LMS.playerId) S.volDrag = true;
    setRowVol(row, v);
    clearTimeout(g.timer);
    const wait = VOL_GAP - (Date.now() - g.at);
    if (wait <= 0) gSet(pid, v);
    else g.timer = setTimeout(() => gSet(pid, Number(e.target.value)), wait);
  });
  gbox.addEventListener("change", async (e) => {
    const row = gRow(e); if (!row || !e.target.matches(".vol-range")) return;
    const pid = row.dataset.pid, v = Number(e.target.value), g = gs[pid];
    clearTimeout(g && g.timer);
    if (!g || v !== g.sent) gSet(pid, v);
    await gs[pid].p;
    Grp.cmdAt[pid] = Date.now(); S.cmdAt = Date.now();   // 命令回来之前发出的查询作废，滑块不弹回
    if (Grp.info[pid]) Grp.info[pid].vol = v;
    if (pid === LMS.playerId && S.st) S.st["mixer volume"] = v;
    Grp.drag[pid] = false;
    if (pid === LMS.playerId) S.volDrag = false;
    renderGroup();
  });
  // 静音不用 LMS 的 muting（AirPlay 设备会出错）：记住音量 → 设 0；再点恢复（没记录时 50）
  gbox.addEventListener("click", async (e) => {
    const mb = e.target.closest(".vol-mute"), row = gRow(e);
    if (!mb || !row || mb.disabled) return;
    const pid = row.dataset.pid, key = "daphile.mutevol." + pid, vol = Number(Grp.info[pid]?.vol);
    let v;
    if (vol < 0) { await LMS.muteOf(pid, 0).catch((err) => toast("静音切换失败：" + err.message)); Grp.at = 0; return refreshGroup(); }
    if (vol > 0) { try { localStorage.setItem(key, String(vol)); } catch (_) { /* 忽略 */ } v = 0; }
    else { let back = 0; try { back = Number(localStorage.getItem(key)) || 0; } catch (_) { /* 忽略 */ } v = back > 0 ? back : 50; }
    await gSet(pid, v);
    Grp.cmdAt[pid] = Date.now(); S.cmdAt = Date.now();
    if (Grp.info[pid]) Grp.info[pid].vol = v;
    if (pid === LMS.playerId && S.st) S.st["mixer volume"] = v;
    renderGroup();
  });

  /* 「时间 + 进度条 + 剩余时间」整组与频谱共用一格：点一下整组切换；进度条模式下在进度条上按住左右拖动才是跳转；
     频谱模式下按住往上拖，拉出播放条上方的大频谱（这一格随即换回进度条） */
  const bar = $("bar"), box = $("lcd-time"), big = $("vu-big");
  const PULL = 90;                     // 往上拖满 90px 视为完全拉出；松手时超过 40% 就打开
  const ratio = (e) => {
    const r = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  /* 拖动中让大频谱跟手：p 为 0（收起）到 1（完全展开） */
  const follow = (p) => {
    big.classList.add("dragging");
    big.style.opacity = p;
    big.style.transform = `translateY(${(1 - p) * 40}px) scale(${0.96 + 0.04 * p})`;
  };
  const settle = () => { big.classList.remove("dragging"); big.style.opacity = big.style.transform = ""; };
  box.addEventListener("pointerdown", (e) => {
    const x0 = e.clientX, y0 = e.clientY, vu = Rhythm.on && !Rhythm.big;
    const dur = Number(S.st?.duration || 0);
    const canSeek = !vu && e.target.closest("#bar") && dur && Number(S.st?.can_seek);
    let dragging = false, pulling = false, p = 0;
    box.setPointerCapture(e.pointerId);
    const show = (ev) => {
      const t = ratio(ev) * dur;
      $("bar-fill").style.width = ratio(ev) * 100 + "%";
      $("t-cur").textContent = fmtTime(t);
      $("t-left").textContent = "-" + fmtTime(dur - t);
    };
    box.onpointermove = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (vu) {
        if (!pulling && (dy > -8 || Math.abs(dy) < Math.abs(dx))) return;   // 往上为主、超过 8px 才算拉
        pulling = true;
        p = Math.min(1, Math.max(0, -dy / PULL));
        follow(p);
        return;
      }
      if (!canSeek) return;
      if (!dragging && Math.abs(dx) < 6) return;   // 6px 以内算点按，不算拖动
      dragging = S.seeking = true;
      show(ev);
    };
    box.onpointerup = box.onpointercancel = (ev) => {
      box.onpointermove = box.onpointerup = box.onpointercancel = null;
      if (pulling) {
        const open = ev.type === "pointerup" && p > 0.4;
        if (open) Rhythm.setBig(true);
        settle();                        // 去掉跟手样式，靠 CSS 过渡落到打开或收起的位置
        return;
      }
      if (!dragging) { if (ev.type === "pointerup" && !Rhythm.big) Rhythm.setOn(!Rhythm.on); return; }   // 大频谱开着时点按不切换
      const t = ratio(ev) * dur;
      S.st.time = t; S.polledAt = Date.now();
      S.seeking = false;
      const r = S.st._resume;
      if (r) { r.t = Math.round(t * 10) / 10; Resume.set(LMS.playerId, r); return; }   // 停着的设备：只改记住的位置，按播放时从这里放
      act(() => LMS.seek(t));
    };
  });

  /* 大频谱：按住往下滑收回（超过 40px 松手即关闭，这一格保持进度条）；点按不做任何事 */
  big.addEventListener("pointerdown", (e) => {
    if (!Rhythm.big) return;
    const y0 = e.clientY;
    let d = 0;
    big.setPointerCapture(e.pointerId);
    big.onpointermove = (ev) => {
      d = Math.max(0, ev.clientY - y0);
      if (d < 4) return;
      big.classList.add("dragging");
      big.style.opacity = Math.max(0, 1 - d / 140);
      big.style.transform = `translateY(${d}px)`;
    };
    big.onpointerup = big.onpointercancel = (ev) => {
      big.onpointermove = big.onpointerup = big.onpointercancel = null;
      if (ev.type === "pointerup" && d > 40) Rhythm.setBig(false);
      settle();
    };
  });
}

/* 播放条变窄时逐级隐藏中间部分：先隐藏「时间 + 进度条（频谱）」，再隐藏封面。
   播放条宽度随窗口和右侧详情开关变化，所以不用媒体查询，而是量出中间那段（.lcd）能分到的宽度：
   可用宽度 = 播放条内宽 − 左侧播放按钮组 − 右侧工具按钮组 − 两处间距 */
function fitPlayer() {
  const p = $("player"), tr = p.querySelector(".transport"), tl = p.querySelector(".tools"), txt = p.querySelector(".lcd-text");
  const COVER = 44, TINY_GAP = 4, TINY_PADR = 8;   // 最小状态（.tiny）的间距和右内边距，与 style.css 一致
  const NEED_TIME = COVER + 10 + 56 + 28 + 10 + 140;   // 封面 + 间距 + 文字至少 56 + 心形（含间距）+ 间距 + 时间/进度条至少 140，才显示时间组
  const NEED_TITLE = COVER + 10 + 28;             // 封面 + 间距 + 曲名至少一个字和省略号，才显示曲名
  const NEED_FAV = NEED_TITLE + 28;               // 再加文字右边的心形；放不下时先藏心形（.nofav），曲名留着
  /* 量之前先去掉 .tiny/.mini，按正常间距量（否则收紧间距后空间又「够了」→ 去掉 → 又不够 → 来回闪）；另留 8px 回差。
     左侧播放按钮、右侧工具按钮的宽度都不随这些状态变化，只有中间那段在变 */
  const HYS = 8;
  const ttl = $("lcd-title"), mc = document.createElement("canvas").getContext("2d");
  const oneChar = () => {
    const t = (ttl.textContent || "").trim(); if (!t) return 0;
    const cs = getComputedStyle(ttl); mc.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    return Math.ceil(mc.measureText(Array.from(t)[0]).width + mc.measureText("\u2026").width);
  };
  /* 播放条最小状态 = 播放按钮 + 封面 + 工具按钮（.tiny）。若打开详情后连这个最小状态都放不下，
     就收起详情并隐藏详情按钮（.noq）；窗口放宽到能放下时再显示。按「详情打开时」的播放条宽度算，
     用未隐藏时的详情按钮宽度，判断不受 .noq / 详情开关本身影响；同样留 8px 回差 */
  const qb = $("btn-queue"), qp = $("queue");
  let qbW = qb.offsetWidth || 36;
  const fitQueue = (cs, trW, tlW) => {
    const had = p.classList.contains("noq");
    if (!had && qb.offsetWidth) qbW = qb.offsetWidth;
    const qw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--queue-w")) || 260;
    const open = !qp.hidden && !qp.classList.contains("closing");
    const openW = p.clientWidth - (open ? 0 : qw);                       // 详情打开时播放条的内框宽
    const need = parseFloat(cs.paddingLeft) + TINY_PADR
      + trW + TINY_GAP + COVER + TINY_GAP + tlW + (had ? qbW : 0) + 1;   // +1 抵消小数取整
    const noq = openW < need + (had ? HYS : 0);
    p.classList.toggle("noq", noq);
    if (noq && open && S.closeQueue) S.closeQueue();
  };
  const fit = () => {
    const was = { narrow: p.classList.contains("narrow"), nofav: p.classList.contains("nofav"), tiny: p.classList.contains("tiny"), mini: p.classList.contains("mini") };
    p.classList.remove("tiny", "mini");
    const cs = getComputedStyle(p);
    const inner = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const gap = parseFloat(cs.columnGap || cs.gap) || 12;
    const trW = tr.offsetWidth, tlW = tl.offsetWidth;
    const room = inner - trW - tlW - gap * 2;                            // 中间那段（.lcd）能分到的宽度
    const roomTiny = room + (gap - TINY_GAP) * 2 + (parseFloat(cs.paddingRight) - TINY_PADR);   // 收紧间距和右内边距后能分到的宽度
    p.classList.toggle("narrow", room < NEED_TIME + (was.narrow ? HYS : 0));
    p.classList.toggle("nofav", room < NEED_FAV + (was.nofav ? HYS : 0));
    p.classList.toggle("tiny", room < NEED_TITLE + (was.tiny ? HYS : 0));
    p.classList.toggle("mini", roomTiny < COVER + (was.mini ? HYS : 0));
    fitQueue(cs, trW, tlW);
    /* 曲名被挤到最后一个字也显示不出（标题宽度 < 首字 + 省略号，或曲名已隐藏）时，大频谱也关掉 */
    if (Rhythm.big && (p.classList.contains("tiny") || ttl.clientWidth < oneChar())) Rhythm.setBig(false);
  };
  fit();
  if (window.ResizeObserver) new ResizeObserver(fit).observe(p);
  else window.addEventListener("resize", fit);
}

/* 鼠标悬停高亮：鼠标在列表里移动时，指到的那一行出现一块圆角浅底，并随鼠标在行间平滑滑动（仿 macOS）。
   每个滚动区域放一块 .hover-glow（绝对定位，盖在行上、半透明、不挡点击），按行的位置移动；
   列表重绘把它冲掉时，下次移动再放回去。只响应鼠标 / 触控板（pointerType = mouse），手指触摸不显示。 */
function bindHoverGlow() {
  const AREAS = [
    ["cur-list", "tbody tr[data-idx]"],                                   // 当前播放
    ["content", ".tracks tbody tr, .list li, .grid .card"],               // 选曲窗口右栏：曲目表、各种列表、专辑网格
    ["pick-list", "li"],                                                  // 选曲窗口左栏
    ["sidebar", ".nav-item"],                                             // 左侧分类
    ["device-list", "li:not(.offline)"],                                  // AirPlay 设备弹窗
  ];
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  AREAS.forEach(([id, sel]) => {
    const box = $(id); if (!box) return;
    const glow = document.createElement("div");
    glow.className = "hover-glow"; glow.setAttribute("aria-hidden", "true");
    let row = null, mx = 0, my = 0, shown = false, tm = 0;
    const hide = () => { clearTimeout(tm); tm = 0; row = null; shown = false; glow.classList.remove("on"); };
    /* 经过行与行之间的空隙（分组标题、间距）时稍等一下再隐藏，鼠标很快进入下一行就直接滑过去，不闪 */
    const hideSoon = () => { if (!tm && shown) tm = setTimeout(hide, 140); else if (!shown) hide(); };
    const place = (el, instant) => {
      clearTimeout(tm); tm = 0;
      if (glow.parentNode !== box) { box.appendChild(glow); shown = false; }
      const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
      const x = r.left - b.left + box.scrollLeft, y = r.top - b.top + box.scrollTop;
      const jump = !shown || instant || still.matches;
      if (jump) glow.classList.add("jump");                                      // 第一次出现：直接在原地淡入，不从别处滑过来
      glow.style.width = r.width + "px"; glow.style.height = r.height + "px";
      glow.style.transform = `translate(${x}px, ${y}px)`;
      if (jump) { void glow.offsetWidth; glow.classList.remove("jump"); }
      glow.classList.add("on"); shown = true; row = el;
    };
    const update = () => {
      const t = document.elementFromPoint(mx, my);
      const el = t && box.contains(t) ? t.closest(sel) : null;
      if (S.dragging || (el && el.closest(".swiping"))) return hide();
      if (!el) return hideSoon();
      if (el !== row || glow.parentNode !== box) place(el);
    };
    box.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      mx = e.clientX; my = e.clientY; update();
    });
    box.addEventListener("pointerleave", hide);
    box.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") hide(); });
    box.addEventListener("scroll", () => { if (shown) { row = null; update(); } }, { passive: true });   // 滚轮滚动时，换成鼠标下面的新一行
    /* 列表变宽 / 变窄（选曲窗口缩回或打开、改窗口大小、拖分隔条）时，鼠标不动也要重新量：
       立刻贴合鼠标下那一行的新位置和宽度（不做滑动动画），鼠标下已没有行就隐藏 */
    new ResizeObserver(() => {
      if (!shown || glow.parentNode !== box) return;
      const t = document.elementFromPoint(mx, my);
      const el = t && box.contains(t) ? t.closest(sel) : null;
      if (el && !S.dragging) place(el, true); else hide();
    }).observe(box);
  });
}

/* 「支持合并输出」开关（存在本机浏览器里）：打开后 AirPlay 弹窗变成方框多选，勾上的设备加入当前设备的同步组 */
const SyncOut = {
  get on() { try { return localStorage.getItem("daphile.syncOut") === "1"; } catch (_) { return false; } },
  set on(v) { try { v ? localStorage.setItem("daphile.syncOut", "1") : localStorage.removeItem("daphile.syncOut"); } catch (_) { /* 忽略 */ } },
};

/* ---------- 侧栏左下的齿轮：设置菜单（重新扫描曲库 · 支持合并输出 · 关机） ----------
   菜单放在 body 下、position:fixed，按齿轮的位置往上弹；与 AirPlay 弹窗、音量面板互斥。 */
const closeSet = () => { $("set-pop").hidden = true; $("btn-set").classList.remove("on"); $("btn-set").setAttribute("aria-expanded", "false"); fixOpts(false); };
/* 「重新扫描曲库」右边三个点：展开 / 收起附属选项「修复曲库」。
   收起（含关菜单）时取消勾选，免得看不见的勾让下次扫描变成清库；修复进行中不动它（勾选项本来就灰着） */
function fixOpts(on) {
  if (!on && Scan.on && Scan.fix) return;
  $("set-fix-row").hidden = !on;
  $("set-more").setAttribute("aria-expanded", String(!!on));
  if (!on) $("set-fix").checked = false;
}
function placeSet() {
  const r = $("btn-set").getBoundingClientRect(), pop = $("set-pop");
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + "px";
  pop.style.bottom = Math.max(8, innerHeight - r.top + 6) + "px";
}

/* 重新扫描曲库：发 rescan（增量扫描，不清空曲库），每 2 秒查一次 rescanprogress 画进度圆。
   LMS 分几步扫描（查找文件、读取标签、整理数据库……），步骤数事先不知道，所以进度圆显示「当前这一步」的百分比；
   这一步总数未知（-1）时进度圆转圈。扫描完 toast 一句，并刷新开着的播放列表一览。 */
const Scan = { t: 0, on: false, seen: false, since: 0, fix: false };
/* 修复曲库（wipecache）：清空曲库后全部重读。期间整个资料库停用（Views.setLocked），扫完自动恢复、取消勾选。
   别处发起的扫描（LMS 设置页、定时插件）分不出是不是清库：记下平时的曲目数，扫描中曲目数掉到一半以下就当作清库 */
const LIB_N = "daphile.libCount";
const libCountSaved = () => { try { return Number(localStorage.getItem(LIB_N)) || 0; } catch (_) { return 0; } };
async function libCountSave() {
  try { const n = await LMS.trackCount(); if (n > 0) localStorage.setItem(LIB_N, String(n)); } catch (_) { /* 记不住就算了 */ }
}
async function looksWiped() {
  const old = libCountSaved();
  if (!old) return false;
  try { return (await LMS.trackCount()) < old / 2; } catch (_) { return false; }
}
function fixMode(on) {
  Scan.fix = !!on;
  if (typeof Views !== "undefined") Views.setLocked(on);
  if (on) S.queueKey = "";   // 队列马上重画：已对回曲库的临时条目换回原样（旧 id 清库后作废）
}
const SCAN_STEP = [   // 步骤名取自 LMS strings.txt 的 *_PROGRESS
  [/^discovering/i, "查找文件"], [/_deleted$/i, "移除已删除的"], [/_new$|_media$/i, "读取新文件"], [/_changed$/i, "读取改动的文件"],
  [/^playlist/i, "播放列表"], [/^mergeva/i, "合并群星专辑"], [/artwork/i, "封面"], [/^cleanup/i, "清理数据库"],
  [/^dboptimize/i, "整理数据库"], [/^releasetypes/i, "专辑类型"], [/^virtuallibraries/i, "资料库视图"],
];
const scanStepName = (s) => (SCAN_STEP.find(([re]) => re.test(s)) || [0, "处理中"])[1];
function scanShow(r) {
  const item = $("set-scan"), ring = item.querySelector(".scan-ring"), sub = $("scan-sub");
  const on = !!r;
  item.classList.toggle("scanning", on);
  $("btn-set").classList.toggle("scanning", on);
  $("scan-title").textContent = on ? (Scan.fix ? "正在修复曲库…" : "正在扫描曲库…") : "重新扫描曲库";
  // 扫描期间「修复曲库」勾选项灰掉不能改；扫完取消勾选（不记住，每次要用再勾）
  const fix = $("set-fix");
  fix.disabled = on; $("set-fix-row").classList.toggle("off", on);
  if (!on) fixOpts(false);   // 扫完收起「修复曲库」并取消勾选
  sub.hidden = !on;
  if (!on) return;
  const steps = String(r.steps || "").split(",").filter(Boolean);
  const cur = steps.find((s) => Number(r[s]) < 100) || steps[steps.length - 1];
  const pct = cur === undefined ? -1 : Number(r[cur]);
  const known = pct >= 0;
  ring.classList.toggle("spin", !known);
  $("scan-fg").style.setProperty("--sp", known ? Math.min(100, pct) : 0);
  sub.textContent = cur === undefined ? "正在准备…"
    : `第 ${steps.indexOf(cur) + 1} 步 · ${scanStepName(cur)}${known ? " · " + Math.min(100, pct) + "%" : ""}`;
}
async function scanTick() {
  clearTimeout(Scan.t);
  let r = null;
  try { r = await LMS.rescanProgress(); } catch (_) { /* 连不上：下次再查 */ }
  if (r && Number(r.rescan) === 1) {
    // 不是本页发起的扫描（打开页面时已在扫、或别处刚发起）：看曲目数判断是不是清库重扫
    if (!Scan.on && !Scan.fix && await looksWiped()) fixMode(true);
    Scan.on = Scan.seen = true;
    scanShow(r);
  } else if (r && Scan.on) {
    // 刚发出 rescan 时扫描程序还没起来，会先报 rescan:0；10 秒内没见到过「扫描中」就继续等
    if (!Scan.seen && Date.now() - Scan.since < 10000) { Scan.t = setTimeout(scanTick, 1000); return; }
    const fixed = Scan.fix;
    Scan.on = false;
    if (fixed) fixMode(false);
    scanShow(null);
    toast(r.lastscanfailed ? (fixed ? "曲库修复失败：" : "曲库扫描失败：") + r.lastscanfailed : fixed ? "曲库修复完成" : "曲库扫描完成");
    if (fixed) S.queueKey = "";   // 临时条目重新对回曲库（新 id）
    if (typeof Views !== "undefined") Views.refreshPlaylists();
    libCountSave();
    return;
  }
  if (r && !Scan.on) libCountSave();   // 打开页面时没在扫描：记下平时的曲目数
  if (Scan.on) Scan.t = setTimeout(scanTick, document.hidden ? 10000 : 2000);
}
async function startScan() {
  if (Scan.on) return toast(Scan.fix ? "正在修复曲库，请稍候" : "正在扫描曲库，请稍候");
  const fix = $("set-fix").checked;
  const yes = await ask(fix ? {
    title: "修复曲库？", icon: "restart", ok: "修复", danger: true,
    msg: "先清空曲库，再把所有文件重新读一遍，比普通扫描慢得多。\n"
      + "修复期间资料库不能使用，只能控制正在播放的音乐；当前播放列表会保留，封面和心形要等修复完才恢复。\n"
      + "存好的播放列表和「我的喜爱」不受影响。",
  } : {
    title: "重新扫描曲库？", icon: "restart", ok: "扫描",
    msg: "只查找新增、改动和删除的文件，不会清空曲库。\n扫描期间可以照常播放；曲库很大时需要几分钟。",
  });
  if (!yes) { $("set-fix").checked = false; return; }   // 取消：勾选也一并取消，免得下次误点成修复
  if (Scan.on) return;
  Scan.on = true; Scan.seen = false; Scan.since = Date.now();
  if (fix) { await libCountSave(); fixMode(true); }
  scanShow({});          // 先出进度圆（转圈），等 LMS 报出步骤
  try { await (fix ? LMS.wipecache() : LMS.rescan()); }
  catch (err) { Scan.on = false; if (fix) fixMode(false); scanShow(null); return toast((fix ? "修复" : "扫描") + "没能开始：" + err.message); }
  Scan.t = setTimeout(scanTick, 1500);
}

/* 关机：确认后向 Daphile 系统网页（80 端口）发关机请求，整页盖上「正在关机」。
   之后每 5 秒查一次 LMS：先连不上（已关）、后来又连上（按电源键开机了）就刷新页面。
   90 秒内 LMS 一直连得上，说明关机没生效（比如这台不是 Daphile 系统），撤掉遮罩并提示。 */
const Halt = { since: 0, t: 0, down: false, wait: 90000 };
async function haltTick() {
  clearTimeout(Halt.t);
  let up = false;
  try { await LMS.serverStatus(); up = true; } catch (_) { /* 连不上 = 已关机或正在关 */ }
  if (!up) {   // 连不上了：改成「已关机」，一直等到再开机
    if (!Halt.down) {
      Halt.down = true;
      $("halt-title").textContent = "Daphile 已关机";
      $("halt-msg").textContent = "按主机电源键即可再开机；开机后此页会自动恢复。";
    }
  }
  else if (Halt.down) return location.reload();   // 关过机、又连上了：重新载入
  else if (Date.now() - Halt.since > Halt.wait) {
    Halt.since = 0; $("halt").hidden = true;
    return toast("Daphile 没有关机，请到 Daphile 系统页面操作");
  }
  Halt.t = setTimeout(haltTick, 5000);
}
async function shutdownDaphile() {
  closeSet();
  const playing = S.st && S.st.mode === "play";
  if (!await ask({
    title: "关闭 Daphile？", icon: "power", ok: "关机", danger: true,
    msg: [playing && "正在播放的音乐会停止。", "关机后只能按主机上的电源键再开机。"].filter(Boolean).join("\n"),
  })) return;
  Halt.since = Date.now(); Halt.down = false;
  try { await LMS.shutdown(); }
  catch (err) {
    // 关机过程中连接常被直接断开，属正常；只有「不知道主机地址」这种还没发出去的才算失败
    if (/主机的地址/.test(err.message)) { Halt.since = 0; return toast("关机失败：" + err.message); }
  }
  $("halt-title").textContent = "Daphile 正在关机"; $("halt-msg").textContent = "请稍候…";
  $("halt").hidden = false;
  Halt.t = setTimeout(haltTick, 5000);
}

function bindSettings() {
  const pop = $("set-pop"), btn = $("btn-set");
  btn.onclick = () => {
    if (!pop.hidden) return closeSet();
    pop.hidden = false;
    btn.classList.add("on"); btn.setAttribute("aria-expanded", "true");
    placeSet();
  };
  $("set-scan").onclick = startScan;
  $("set-more").onclick = () => fixOpts($("set-fix-row").hidden);
  $("set-off").onclick = shutdownDaphile;
  const chk = $("set-sync");
  chk.checked = SyncOut.on;
  chk.onchange = async () => {
    if (chk.checked) { SyncOut.on = true; toast("已打开合并输出：在 AirPlay 里勾选要一起播放的设备"); return window.refreshDevices(); }
    // 关掉时还有设备在组里：问一下是否让它们退出（退出的设备停止，正在控制的设备照常播放）
    let buddies = [];
    try { buddies = await LMS.syncedWith(); } catch (_) { /* 查不到就当没有 */ }
    if (buddies.length && !await ask({
      title: "关闭合并输出？", ok: "关闭", icon: "speakers",
      msg: `还有 ${buddies.length} 台设备在一起播放，关闭后它们会停止，只留正在控制的设备继续播放。`,
    })) { chk.checked = true; return; }
    SyncOut.on = false;
    if (buddies.length) await act(() => Promise.all(buddies.map((b) => LMS.unsync(b))), "退出合并输出失败");
    window.refreshDevices();
  };
  // 点菜单外关闭；确认弹窗是从菜单里打开的，点它不算「外面」（扫描开始后菜单留着，看得到进度圆）
  document.addEventListener("click", (e) => {
    if (!pop.hidden && !e.target.closest("#set-pop, #btn-set, #ask-dlg")) closeSet();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("ask-dlg").hidden) closeSet(); });
  addEventListener("resize", () => { if (!pop.hidden) placeSet(); });
  $("sidebar").addEventListener("scroll", () => { if (!pop.hidden) placeSet(); }, { passive: true });
  // 打开页面时 LMS 已经在扫描（别处发起的、或上次没扫完）：也显示进度
  scanTick();
}

async function start() {
  if (!start.bound) { bindPlayer(); bindUpdate(); bindSettings(); bindHoverGlow(); start.bound = true; }   // 连接失败重试时不重复绑定事件
  try {
    await LMS.findPlayer();
  } catch (e) {
    toast("连接 Daphile 失败：" + e.message);
    setTimeout(start, 5000);
    return;
  }
  poll();
  checkUpdate();
  setInterval(renderTime, 500);
  Rhythm.attach($("vu"), () => {
    const st = S.st;
    if (!st || !S.cur || S.seeking) return null;
    const playing = st.mode === "play";
    return { pos: Number(st.time || 0) + (playing ? (Date.now() - S.polledAt) / 1000 : 0), playing };
  }, $("vu-big-cv"));
  syncRhythmDelay();
  fitPlayer();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  if (typeof Views !== "undefined") Views.init();
  // CD播放器入口：LMS 装了 CDplayer 插件才显示（只读查询，查不到就一直不显示）
  LMS.cdHas().then((has) => {
    $("nav-cd").hidden = !has;
    if (!has) return;
    // 没接 CD 机时侧栏图标变灰。上次记着「接着光驱」就先不查（有盘时查一次会让光驱读盘），点开 CD 页时自然会更新
    Views.onDrive((d) => $("nav-cd").classList.toggle("nodrv", d === false));
    let last = null; try { last = localStorage.getItem("daphile.cddrive"); } catch (_) { /* 读不到就查 */ }
    if (last === "0") $("nav-cd").classList.add("nodrv");   // 先按上次的样子显示，查到结果再改
    if (last !== "1") Views.cdProbe();
  }).catch(() => {});
}

start();
