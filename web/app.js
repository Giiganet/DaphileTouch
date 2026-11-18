/* 播放条、队列、轮询（资料库视图在 views.js） */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtTime = (s) => {
  s = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

const S = { st: null, cur: null, polledAt: 0, seeking: false, queueKey: "", fails: 0 };

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2200);
}

/* 执行命令后立刻刷新一次状态 */
async function act(fn, errMsg = "操作失败") {
  try { await fn(); } catch (e) { toast(errMsg + "：" + e.message); }
  setTimeout(poll, 150);
}

/* ---------- 加入中：当前播放标题行转圈，曲目进入列表后消失 ----------
   整张加入要等 LMS 处理完才返回，会有几秒空白；这期间显示「正在加入…」。
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
  // 网页静音 = 音量设 0（取消时恢复原音量）；音量为负数是 LMS 自带静音留下的状态，也算静音
  // 音量控制设为「固定输出」（digital_volume_control = 0）的播放器会忽略音量，按钮灰掉不可点
  const canMute = st.digital_volume_control === undefined || Number(st.digital_volume_control) !== 0;
  const muted = canMute && Number(st["mixer volume"]) <= 0;
  const mb = $("btn-mute");
  mb.disabled = !canMute;
  mb.classList.toggle("muted", muted);
  mb.setAttribute("aria-label", !canMute ? "静音不可用（此设备为固定音量输出）" : muted ? "取消静音" : "静音");
  mb.title = !canMute ? "此设备为固定音量输出，无法静音" : "";
  // 「当前播放设备」标题后显示设备名（换设备后下一次刷新即更新）
  const devName = st.player_name || "";
  if ($("cur-dev-name").textContent !== devName) {
    $("cur-dev-name").textContent = devName;
    $("cur-dev").title = devName ? "当前播放设备：" + devName + "（点按换到另一台设备，连同它自己的播放列表）" : "";
    $("cur-dev").hidden = $("cur-sep").hidden = !devName;
  }

  if (cur) {
    $("lcd-title").textContent = cur.title || "未知曲目";
    $("lcd-sub").textContent = [cur.artist, cur.album].filter(Boolean).join(" — ");
    const cid = coverOf(cur);
    const src = cid ? LMS.cover(cid, 100) : "";
    const img = $("lcd-cover");
    if (img.dataset.src !== src) { img.dataset.src = src; if (src) img.src = src; }
    img.hidden = !src;   // 没封面时隐藏图片，露出外框的灰色圆角方块
  } else {
    $("lcd-title").textContent = loop.length ? "" : "未在播放";
    $("lcd-sub").textContent = "";
    $("lcd-cover").hidden = true;
  }
  renderTime();
  if (typeof Rhythm !== "undefined") Rhythm.setTrack(cur ? cur.id : null);
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
const coverOf = (t) => (t && Number(t.coverart) !== 0 ? t.coverid || t.artwork_track_id || null : null);
document.addEventListener("error", (e) => {
  const img = e.target;
  // 只处理已在页面上的图片；文件夹行首的封面是加载成功才插入的，失败时保留光盘图标
  if (img.tagName === "IMG" && img.isConnected && img.src !== BLANK) img.src = BLANK;
}, true);

/* 「正在播放」信息面板：只在换歌时重绘 */
const JUNK = new Set(["No Artist", "No Album", "No Genre", "0", ""]);
function renderNowPlaying(cur) {
  const key = cur ? String(cur.id) : "";
  if (key === S.npKey) return;
  S.npKey = key;
  const img = $("np-art");
  const coverId = coverOf(cur);   // 没封面时显示 #np-art-empty（灰色圆角方块）
  img.hidden = !coverId;
  $("np-art-empty").hidden = !!coverId;
  if (coverId) img.src = LMS.cover(coverId, 300);
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
  const furl = /^file:\/\//.test(cur.url || "") ? cur.url : "";   // 只有本地或网络盘上的文件才有文件夹
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

/* ---------- 确认弹窗：代替浏览器自带的 confirm，返回 true（确认）/ false（取消） ----------
   title 标题；msg 说明（\n 换行）；ok 确认按钮文字；danger 确认按钮和图标用红色；icon 图标（trash / restart）。
   点「取消」、点弹窗外的暗处或按 Esc 为取消；外接键盘按回车为确认。 */
const ASK_ICON = {
  trash: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13M10 11v5.5M14 11v5.5"/></svg>`,
  restart: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5v5h-5"/></svg>`,
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
   名称里文件名不允许的字符和冒号（冒号会被 LMS 当成「键:值」参数）换成「-」。
   打开时取一次已有播放列表的名称：输入同名时弹窗里直接提示，「保存」变成红色「覆盖」，不再另弹确认框。 */
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
  const same = () => { const k = cleanName(inp.value).toLowerCase(); return names && names.find((x) => x.toLowerCase() === k); };
  const check = () => {
    const name = cleanName(inp.value), dup = name && same();
    ok.disabled = !name;
    ok.textContent = dup ? "覆盖" : "保存";
    ok.classList.toggle("danger", !!dup);
    $("save-clear").hidden = !inp.value;
    const msg = dup ? `已有同名播放列表「${dup}」，覆盖后它原来的内容会被当前播放替换。`
      : BAD_CH.test(inp.value) ? `名称里的 \\ / : * ? " < > | 会换成「-」。` : "";
    note.textContent = msg;
    note.hidden = !msg;
    note.classList.toggle("warn", !!dup);
  };
  const loaded = LMS.playlists().then((r) => { names = (r.playlists_loop || []).map((x) => String(x.playlist)); check(); })
    .catch(() => { names = []; });

  inp.value = `当前播放 ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}`;
  check();
  dlg.hidden = false;
  inp.focus();
  inp.select();

  const name = await new Promise((done) => {
    const close = (v) => { dlg.hidden = true; document.removeEventListener("keydown", key); inp.blur(); done(v); };
    const submit = async () => {
      if (ok.disabled) return;
      if (!names) {   // 名称还没取回：先等它，若发现同名就停在弹窗里显示提示，让用户再点一次「覆盖」
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
    $("save-clear").onclick = () => { inp.value = ""; check(); inp.focus(); };
    $("save-cancel").onclick = () => close(null);
    ok.onclick = submit;
    dlg.onclick = (e) => { if (e.target === dlg) close(null); };   // 点弹窗外的暗处 = 取消
  });
  if (!name) return;
  await act(async () => {
    await LMS.savePlaylist(name);
    toast(`已存为播放列表：${name}（${n} 首）`);
    if (typeof Views !== "undefined" && Views.refreshPlaylists) Views.refreshPlaylists();
  }, "保存失败");
}

/* 队列里当前曲目的标记：播放 ▶、暂停 ❙❙、停止 ■。用 SVG 画，避免 iOS 把符号显示成彩色 emoji */
const QMARK = {
  play: `<svg class="qmark" viewBox="0 0 12 12" aria-label="播放中"><path d="M2.5 1.5v9l8-4.5z"/></svg>`,
  pause: `<svg class="qmark" viewBox="0 0 12 12" aria-label="已暂停"><rect x="2" y="1.5" width="3" height="9" rx=".8"/><rect x="7" y="1.5" width="3" height="9" rx=".8"/></svg>`,
  stop: `<svg class="qmark" viewBox="0 0 12 12" aria-label="已停止"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>`,
};

function renderQueue(loop, curIdx) {
  if (S.dragging) return;   // 拖动排序时不重绘，松手后再刷新
  const mode = QMARK[S.st.mode] ? S.st.mode : "stop";
  const key = Number(S.st.playlist_timestamp) + ":" + curIdx + ":" + mode;   // 播放 / 暂停切换时也要重绘标记
  if (key === S.queueKey) return;
  S.queueKey = key;
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
    return `<tr class="${cls}" data-idx="${i}">
      <td class="num">${i === curIdx ? QMARK[mode] : i + 1}</td>
      <td class="cv">${cid ? `<img src="${LMS.cover(cid, 100)}" alt="" loading="lazy">` : `<span class="ph"></span>`}</td>
      <td>${esc(t.title)}</td><td>${esc(t.artist || "")}</td><td>${esc(t.album || "")}</td>
      <td class="dur">${t.duration ? fmtTime(t.duration) : ""}</td>
    </tr>`;
  }).join("")}</tbody></table>`;
}

async function poll() {
  clearTimeout(poll._t);
  try {
    S.st = await LMS.status();
    S.polledAt = Date.now();
    S.fails = 0;
    render();
    checkAdding();
  } catch (e) {
    S.fails++;
    if (S.fails === 3 && !Upd.since) { toast("与 Daphile 失去连接，正在重试…"); }   // 重启 LMS 期间不提示
  }
  // 页面在后台时降低频率
  poll._t = setTimeout(poll, document.hidden ? 5000 : 1000);
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

/* 向左滑动删除：横向拖动整行，右边露出红底。
   默认模式（当前播放列表）：红色按钮最宽 76px，垃圾篓居中；拉到按钮露满（垃圾篓到按钮正中）就停住不再变长，此时松手即删除，不够就弹回。
   reveal 模式（喜爱页）：左滑只露出红色「移出」按钮并停住，再点按钮才删除；
     按钮露满后手指不松开、继续左滑，就交给 over（选曲窗口跟手左移，够远松手关闭窗口）；
     轻点这一行、点别处、右滑、列表滚动都会收回——误滑不会丢东西。
   rowSel：可滑动的行；onDelete(row) 负责删除并重绘（可返回 Promise）。拖动排序进行中不触发。 */
function bindSwipe(box, rowSel, onDelete, { reveal = false, over = null } = {}) {
  // 当前播放：按钮宽 76px，拉满（72px 起）可删，之后几乎不再变长（最多 +4px 弹性）；喜爱页（reveal）沿用原尺寸
  const THRESH = reveal ? 88 : 72, MAX = reveal ? 110 : 76, ELASTIC = reveal ? 14 : 4, START = 10;
  const OPEN = 88;   // reveal 模式停住时露出的按钮宽度；拉过一半松手就停住
  const HANDOFF = 8;   // 按钮露满后再多拉这么多，才开始拖动页面（让按钮先完整露出一下）
  let sw = null, open = null;   // open：reveal 模式下当前停住、露出按钮的那一行
  const back = (row) => {
    if (row === open) open = null;
    row.classList.remove("sw-move", "swipe-arm", "sw-del", "sw-open", "sw-press");
    row.style.setProperty("--sx", "0px");
    setTimeout(() => { if (!row.classList.contains("sw-move")) { row.classList.remove("swiping"); row.style.removeProperty("--sx"); } }, 220);
  };
  const close = () => { if (open) back(open); };
  const remove = (row) => {
    if (row === open) open = null;
    row.classList.remove("sw-move", "sw-open", "sw-press");
    row.classList.add("sw-del");   // 停在原位淡出，不再整行滑出（否则会露出整条红底）
    Promise.resolve(onDelete(row)).catch(() => {})
      .finally(() => setTimeout(() => { if (row.isConnected) back(row); }, 2500));   // 删除失败或未重绘就弹回
  };
  if (reveal) {
    // 点列表以外的任何地方（标题栏、关闭钮、播放条……）或列表滚动，都把露出的按钮收回
    document.addEventListener("pointerdown", (e) => { if (open && !box.contains(e.target)) close(); }, true);
    // 列表滚动也收回：scroll 不冒泡，真正滚动的是外层容器，所以在 document 上用捕获阶段监听
    document.addEventListener("scroll", (e) => { if (open && e.target.contains && e.target.contains(open)) close(); }, { capture: true, passive: true });
  }
  box.addEventListener("pointerdown", (e) => {
    sw = null;
    if (e.button > 0 || S.dragging) return;
    if (open && !open.isConnected) open = null;   // 列表已重绘
    const row = e.target.closest(rowSel);
    let base = 0;
    if (open) {
      if (row !== open) { close(); swallowClick(box); return; }   // 点别的行：只收回，不当成点击
      base = OPEN;
      // 「移出」按钮是行右侧露出的红色区域（行已左移，按钮在行框右边）
      if (e.clientX >= row.getBoundingClientRect().right) {
        row.classList.add("sw-press");
        sw = { row, press: true, x: e.clientX, y: e.clientY, id: e.pointerId };
        return;
      }
    }
    if (row && box.contains(row)) sw = { row, x: e.clientX, y: e.clientY, dx: -base, base, on: false, id: e.pointerId };
  });
  box.addEventListener("pointermove", (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (sw.press) {   // 按着按钮移动了就不算点按钮
      if (Math.hypot(dx, dy) > START) { sw.row.classList.remove("sw-press"); sw = null; }
      return;
    }
    if (!sw.on) {
      if (S.dragging || Math.abs(dy) > START) { sw = null; return; }   // 竖向移动是滚动或排序
      if (sw.base ? Math.abs(dx) <= START : dx > -START) return;   // 已停住的行可左右拖，没停住的只认左滑
      sw.on = true;
      sw.row.classList.add("swiping", "sw-move");
      try { box.setPointerCapture(sw.id); } catch (_) { /* 忽略 */ }
    }
    e.preventDefault();
    const pull = Math.max(0, sw.base - dx);   // 行向左移的总距离
    if (over) {   // 行最多左移到按钮露满；超出的部分交给页面
      const extra = pull - OPEN - HANDOFF;
      sw.dx = -Math.round(Math.min(pull, OPEN));
      sw.row.style.setProperty("--sx", sw.dx + "px");
      if (extra > 0 || sw.over) { sw.over = true; over.drag(-Math.max(0, extra), e.timeStamp); }
      return;
    }
    // 超过 MAX 后只有很小的弹性余量，最多再多出 ELASTIC
    const shown = pull <= MAX ? pull : MAX + ELASTIC * (1 - 1 / (1 + (pull - MAX) / 60));
    sw.dx = -Math.round(shown);
    sw.row.style.setProperty("--sx", sw.dx + "px");
    if (!reveal) sw.row.classList.toggle("swipe-arm", -sw.dx >= THRESH);   // 变深红 = 松手就删；reveal 模式松手不删，不变色
  });
  const end = (ok) => (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const { row, on, dx, base, press, over: handed } = sw;
    sw = null;
    if (press) {   // 点了「移出」按钮
      row.classList.remove("sw-press");
      if (!ok) return;
      swallowClick(box);
      return remove(row);
    }
    if (!on) {   // 轻点已停住的行：收回，不当成点击
      if (base) { close(); swallowClick(box); }
      return;
    }
    swallowClick(box);
    if (handed && over.release(ok)) return back(row);   // 页面滑走了（窗口关闭）：这一行复位；没滑走就按下面停住或弹回
    if (reveal) {
      if (!ok || -dx < OPEN / 2) return back(row);
      row.classList.remove("sw-move", "swipe-arm");
      row.classList.add("sw-open");
      row.style.setProperty("--sx", -OPEN + "px");
      open = row;
      return;
    }
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
  $("btn-play").onclick = () => act(async () => {
    if (S.st && Number(S.st.power) !== 1) await LMS.power(1);
    await (S.st && S.st.mode === "stop" ? LMS.play() : LMS.toggle());
  });
  // 静音不用 LMS 的 muting（RaopBridge 1.8.12 下 AirPlay 设备会出错），改为：记住音量 → 设 0；取消时恢复
  $("btn-mute").onclick = () => act(async () => {
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
  $("btn-queue").onclick = () => { if (q.hidden) setQueue(true); else closeQueue(); };
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
  $("np-meta").onclick = (e) => { const b = e.target.closest("[data-folder]"); if (b) Views.openFolder(b.dataset.folder); };
  bindReorder();
  // 当前播放：向左滑动一行即从队列移除
  bindSwipe($("cur-list"), "tbody tr[data-idx]", (row) => {
    S.queueKey = "";   // 下一次轮询按 LMS 的新队列重绘
    return act(() => LMS.deleteAt(row.dataset.idx), "移除失败");
  });
  $("cur-list").onclick = (e) => {
    if (S.justDragged) return;   // 刚拖完松手产生的点击，不当作「播放这首」
    const tr = e.target.closest("tr[data-idx]");
    if (!tr) {                   // 点在列表的空白处（不在任何一行上）：收起右侧详情
      if (!e.target.closest("button, a, input, th")) closeQueue();
      return;
    }
    act(async () => {
      if (S.st && Number(S.st.power) !== 1) await LMS.power(1);
      await LMS.jump(tr.dataset.idx);
    });
  };

  /* 播放设备：列出网络上的 LMS 播放器，打勾的是当前控制的设备 */
  const SPEAKER = `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="6" y="2.5" width="12" height="19" rx="2.5" fill="currentColor"/><circle cx="12" cy="14.5" r="3.4" fill="var(--bar-solid)"/><circle cx="12" cy="7" r="1.6" fill="var(--bar-solid)"/></svg>`;
  /* 把播放器列表填进某个 ul：播放条的 AirPlay 弹窗和标题下拉菜单共用 */
  async function fillDevices(ul) {
    ul.innerHTML = `<li class="dev-empty">正在查找设备…</li>`;
    try {
      const list = await LMS.players();
      ul.innerHTML = list.length ? list.map((p) => {
        const online = Number(p.connected) === 1;
        const cur = p.playerid === LMS.playerId;
        const cls = [cur ? "cur" : "", online ? "" : "offline"].join(" ");
        return `<li data-pid="${esc(p.playerid)}" class="${cls}" role="option" aria-selected="${cur}">
          <span class="dev-ico">${SPEAKER}</span>
          <span class="dev-name">${esc(p.name)}${online ? "" : `<small>离线</small>`}</span>
          <span class="dev-chk"></span></li>`;
      }).join("") : `<li class="dev-empty">没有找到播放设备</li>`;
    } catch (err) { ul.innerHTML = `<li class="dev-empty">查找失败：${esc(err.message)}</li>`; }
  }
  const devName = (li) => li.querySelector(".dev-name").firstChild.textContent.trim();
  /* 「当前播放」旁的下拉菜单：换成控制另一台设备（各设备的队列互不影响） */
  function switchPlayer(li, msg = "已切换到 ") {
    const pid = li.dataset.pid;
    if (pid === LMS.playerId) return;
    LMS.setPlayer(pid);
    try { localStorage.setItem("daphile.player", pid); } catch (err) { /* 忽略 */ }
    S.queueKey = ""; S.npKey = null;
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
      await LMS.transfer(LMS.playerId, pid);
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
  // 「当前播放设备 · 设备名 ⌄」标题下拉菜单：换成控制另一台设备，连同它自己的播放列表（切换环境）
  const devMenu = $("dev-menu"), devBtn = $("cur-dev");
  const closeDevMenu = () => { devMenu.hidden = true; devBtn.classList.remove("open"); devBtn.setAttribute("aria-expanded", "false"); };

  $("btn-devices").onclick = (e) => {
    e.stopPropagation();
    if (!devBox.hidden) return closeDevices();
    closeDevMenu();
    devBox.hidden = false;
    $("btn-devices").classList.add("on");
    fillDevices($("device-list"));
  };
  $("device-list").onclick = (e) => {
    const li = pickedDevice(e); if (!li) return;
    closeDevices(); transferTo(li);
  };
  devBtn.onclick = (e) => {
    e.stopPropagation();
    if (!devMenu.hidden) return closeDevMenu();
    closeDevices();
    // 菜单左边对齐设备名按钮
    const b = devBtn.getBoundingClientRect(), t = devMenu.parentElement.getBoundingClientRect();   // 父级是 position:relative 的标题栏
    devMenu.style.left = Math.max(8, Math.round(b.left - t.left - 6)) + "px";
    devMenu.hidden = false;
    devBtn.classList.add("open"); devBtn.setAttribute("aria-expanded", "true");
    fillDevices($("dev-menu-list"));
  };
  $("dev-menu-list").onclick = (e) => {
    const li = pickedDevice(e); if (!li) return;
    closeDevMenu(); switchPlayer(li);
  };
  document.addEventListener("click", (e) => {
    if (!devBox.hidden && !e.target.closest(".dev-wrap")) closeDevices();
    if (!devMenu.hidden && !e.target.closest("#dev-menu, #cur-dev")) closeDevMenu();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDevMenu(); closeDevices(); } });

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
  const NEED_TIME = 44 + 10 + 56 + 10 + 140;   // 封面 + 间距 + 曲名至少 56 + 间距 + 时间/进度条至少 140，才显示时间组
  const NEED_COVER = 44;              // 封面本身
  /* .tiny 会收窄按钮和间距，若直接按当前尺寸量，收窄后空间又「够了」→ 去掉 .tiny → 又不够 → 来回闪。
     所以每次都先去掉 .tiny、按未收紧的尺寸量，再决定；另留 8px 回差，拖动窗口到临界点也不抖。 */
  const HYS = 8;
  const ttl = $("lcd-title"), mc = document.createElement("canvas").getContext("2d");
  const oneChar = () => {
    const t = (ttl.textContent || "").trim(); if (!t) return 0;
    const cs = getComputedStyle(ttl); mc.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    return Math.ceil(mc.measureText(Array.from(t)[0]).width + mc.measureText("\u2026").width);
  };
  const fit = () => {
    const wasNarrow = p.classList.contains("narrow"), wasTiny = p.classList.contains("tiny");
    if (wasTiny) p.classList.remove("tiny");
    const cs = getComputedStyle(p);
    const inner = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const gap = parseFloat(cs.columnGap || cs.gap) || 12;
    const room = inner - tr.offsetWidth - tl.offsetWidth - gap * 2;
    p.classList.toggle("narrow", room < NEED_TIME + (wasNarrow ? HYS : 0));
    p.classList.toggle("tiny", room < NEED_COVER + (wasTiny ? HYS : 0));
    /* 曲目名被挤到最后一个字也显示不出（标题宽度 < 首字 + 省略号，或封面标题整段隐藏）时，大频谱也关掉 */
    if (Rhythm.big && (p.classList.contains("tiny") || txt.clientWidth < oneChar())) Rhythm.setBig(false);
  };
  fit();
  if (window.ResizeObserver) new ResizeObserver(fit).observe(p);
  else window.addEventListener("resize", fit);
}

async function start() {
  if (!start.bound) { bindPlayer(); bindUpdate(); start.bound = true; }   // 连接失败重试时不重复绑定事件
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
}

start();
