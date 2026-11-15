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

function render() {
  const st = S.st;
  if (!st) return;
  const loop = st.playlist_loop || [];
  const curIdx = Number(st.playlist_cur_index);
  const cur = loop.find((x) => Number(x["playlist index"]) === curIdx) || null;
  S.cur = cur;
  const on = Number(st.power) === 1;
  const playing = st.mode === "play";

  $("player").classList.toggle("off", !on);
  $("btn-play").textContent = playing ? "⏸" : "▶";
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
  if (typeof Views !== "undefined") Views.markPlaying(cur);
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
  $("np-meta").innerHTML = rows.map(([k, val]) => `<dt>${k}</dt><dd>${esc(val)}</dd>`).join("");
}

/* ---------- 把当前播放存成播放列表 ----------
   名称里去掉文件名不允许的字符和冒号（冒号会被 LMS 当成「键:值」参数）；同名先确认再覆盖。 */
async function saveQueue() {
  const n = (S.st && Number(S.st.playlist_tracks)) || 0;
  if (!n) return toast("当前播放是空的，没有可保存的曲目");
  const d = new Date(), p2 = (x) => String(x).padStart(2, "0");
  const def = `当前播放 ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}`;
  const raw = prompt(`新建播放列表（${n} 首），名称为：`, def);
  if (raw == null) return;                                   // 取消
  const name = raw.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  if (!name) return toast("名称不能为空");
  await act(async () => {
    const list = (await LMS.playlists()).playlists_loop || [];
    const same = list.find((x) => String(x.playlist).toLowerCase() === name.toLowerCase());
    if (same && !confirm(`播放列表「${same.playlist}」已存在，覆盖它吗？\n（原来的内容会被当前播放替换）`)) return;
    await LMS.savePlaylist(name);
    toast(`已存为播放列表：${name}（${n} 首）`);
    if (typeof Views !== "undefined" && Views.refreshPlaylists) Views.refreshPlaylists();
  });
}

function renderQueue(loop, curIdx) {
  if (S.dragging) return;   // 拖动排序时不重绘，松手后再刷新
  const key = Number(S.st.playlist_timestamp) + ":" + curIdx;
  if (key === S.queueKey) return;
  S.queueKey = key;
  const box = $("cur-list");
  $("cur-count").textContent = loop.length ? loop.length + " 首" : "";
  $("btn-save").disabled = !loop.length;   // 空队列不能保存
  $("btn-clear").disabled = !loop.length;  // 空队列不能清除：灰色不可点
  if (!loop.length) {
    box.innerHTML = `<div class="empty">当前播放列表是空的。<br>从左侧资料库选择分类，在右侧弹出的窗口里选曲加入。</div>`;
    return;
  }
  box.innerHTML = `<table class="tracks cur-table"><thead><tr>
      <th class="num">#</th><th class="cv"></th><th>标题</th><th>艺人</th><th>专辑</th><th class="dur">时长</th>
    </tr></thead><tbody>${loop.map((t) => {
    const i = Number(t["playlist index"]);
    const cls = i === curIdx ? "playing" : i < curIdx ? "past" : "";
    const cid = coverOf(t);
    return `<tr class="${cls}" data-idx="${i}">
      <td class="num">${i === curIdx ? "▶" : i + 1}</td>
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
  } catch (e) {
    S.fails++;
    if (S.fails === 3) { toast("与 Daphile 失去连接，正在重试…"); }
  }
  // 页面在后台时降低频率
  poll._t = setTimeout(poll, document.hidden ? 5000 : 1000);
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

/* 向左滑动删除：横向拖动整行，右边露出红底垃圾篓；滑过 96px 松手即删除，不够就弹回。
   rowSel：可滑动的行；onDelete(row) 负责删除并重绘（可返回 Promise）。拖动排序进行中不触发。 */
function bindSwipe(box, rowSel, onDelete) {
  const THRESH = 88, MAX = 110, ELASTIC = 14, START = 10;   // 拉满 88px 可删；最多露出 110px（+14px 弹性）
  let sw = null;
  const back = (row) => {
    row.classList.remove("sw-move", "swipe-arm", "sw-del");
    row.style.setProperty("--sx", "0px");
    setTimeout(() => { if (!row.classList.contains("sw-move")) { row.classList.remove("swiping"); row.style.removeProperty("--sx"); } }, 220);
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
      if (dx > -START) return;
      sw.on = true;
      sw.row.classList.add("swiping", "sw-move");
      try { box.setPointerCapture(sw.id); } catch (_) { /* 忽略 */ }
    }
    e.preventDefault();
    const pull = Math.max(0, -dx);   // 手指向左拉的距离
    // 超过 MAX 后只有很小的弹性余量，最多再多出 ELASTIC
    const shown = pull <= MAX ? pull : MAX + ELASTIC * (1 - 1 / (1 + (pull - MAX) / 60));
    sw.dx = -Math.round(shown);
    sw.row.style.setProperty("--sx", sw.dx + "px");
    sw.row.classList.toggle("swipe-arm", -sw.dx >= THRESH);
  });
  const end = (ok) => (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const { row, on, dx } = sw;
    sw = null;
    if (!on) return;
    swallowClick(box);
    if (!ok || -dx < THRESH) return back(row);
    row.classList.remove("sw-move");
    row.classList.add("sw-del");   // 停在原位淡出，不再整行滑出（否则会露出整条红底）
    Promise.resolve(onDelete(row)).catch(() => {})
      .finally(() => setTimeout(() => { if (row.isConnected) back(row); }, 2500));   // 删除失败或未重绘就弹回
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
  $("btn-queue").onclick = () => {
    const q = $("queue");
    q.hidden = !q.hidden;
    $("app").classList.toggle("queue-open", !q.hidden);
    $("btn-queue").classList.toggle("on", !q.hidden);
  };
  $("btn-clear").onclick = () => { if (confirm("清除整个播放队列？")) act(LMS.clear); };
  $("btn-save").onclick = saveQueue;
  bindReorder();
  // 当前播放：向左滑动一行即从队列移除
  bindSwipe($("cur-list"), "tbody tr[data-idx]", (row) => {
    S.queueKey = "";   // 下一次轮询按 LMS 的新队列重绘
    return act(() => LMS.deleteAt(row.dataset.idx), "移除失败");
  });
  $("cur-list").onclick = (e) => {
    if (S.justDragged) return;   // 刚拖完松手产生的点击，不当作「播放这首」
    const tr = e.target.closest("tr[data-idx]");
    if (tr) act(async () => {
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

  /* 「时间 + 进度条 + 剩余时间」整组与频谱共用一格：点一下整组切换；进度条模式下在进度条上按住左右拖动才是跳转 */
  const bar = $("bar"), box = $("lcd-time");
  const ratio = (e) => {
    const r = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  box.addEventListener("pointerdown", (e) => {
    const x0 = e.clientX, vu = Rhythm.on;
    const dur = Number(S.st?.duration || 0);
    const canSeek = !vu && e.target.closest("#bar") && dur && Number(S.st?.can_seek);
    let dragging = false;
    box.setPointerCapture(e.pointerId);
    const show = (ev) => {
      const t = ratio(ev) * dur;
      $("bar-fill").style.width = ratio(ev) * 100 + "%";
      $("t-cur").textContent = fmtTime(t);
      $("t-left").textContent = "-" + fmtTime(dur - t);
    };
    box.onpointermove = (ev) => {
      if (!canSeek) return;
      if (!dragging && Math.abs(ev.clientX - x0) < 6) return;   // 6px 以内算点按，不算拖动
      dragging = S.seeking = true;
      show(ev);
    };
    box.onpointerup = box.onpointercancel = (ev) => {
      box.onpointermove = box.onpointerup = box.onpointercancel = null;
      if (!dragging) { if (ev.type === "pointerup") Rhythm.setOn(!vu); return; }
      const t = ratio(ev) * dur;
      S.st.time = t; S.polledAt = Date.now();
      S.seeking = false;
      act(() => LMS.seek(t));
    };
  });
}

async function start() {
  if (!start.bound) { bindPlayer(); start.bound = true; }   // 连接失败重试时不重复绑定事件
  try {
    await LMS.findPlayer();
  } catch (e) {
    toast("连接 Daphile 失败：" + e.message);
    setTimeout(start, 5000);
    return;
  }
  poll();
  setInterval(renderTime, 500);
  Rhythm.attach($("vu"), () => {
    const st = S.st;
    if (!st || !S.cur || S.seeking) return null;
    const playing = st.mode === "play";
    return { pos: Number(st.time || 0) + (playing ? (Date.now() - S.polledAt) / 1000 : 0), playing };
  });
  syncRhythmDelay();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  if (typeof Views !== "undefined") Views.init();
}

start();
