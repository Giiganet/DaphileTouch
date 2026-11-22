/* LMS JSON-RPC 封装
   作为 LMS 插件运行时（/plugins/DaphileTouch/…）页面与 LMS 同源，直接请求；
   开发时经 tools/dev-server.py 打开，请求走 /lms/ 反向代理。 */
const LMS = (() => {
  const BASE = location.pathname.startsWith("/plugins/") ? "" : "/lms";
  // A：按角色返回 composer/conductor/band/albumartist 等；g：流派
  const STATUS_TAGS = "tags:aAcdglKNoxrTIjJQytu";   // u：文件路径，信息面板点专辑名跳到所在文件夹用
  let playerId = null;

  async function rpc(player, cmd) {
    const res = await fetch(BASE + "/jsonrpc.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 1, method: "slim.request", params: [player, cmd] }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    return j.result || {};
  }

  const q = (cmd) => rpc(0, cmd);                 // 全局查询
  const p = (cmd) => rpc(playerId, cmd);          // 播放器命令

  /* 封面地址：只缩小不放大，原图约 447px */
  function cover(id, size) {
    if (!id) return "";
    return `${BASE}/music/${encodeURIComponent(id)}/cover_${size}x${size}.jpg`;
  }

  /* 不想出现的设备请在 LMS 里停用（如 RaopBridge 设置里取消勾选），网页不再自带隐藏名单 */
  const visible = (list) => list || [];

  async function findPlayer() {
    const r = await q(["players", 0, 10]);
    const list = visible(r.players_loop);
    let saved = null;
    try { saved = localStorage.getItem("daphile.player"); } catch (e) { /* 无痕模式等 */ }
    const pick = list.find((x) => x.playerid === saved) || list.find((x) => Number(x.connected) === 1) || list[0];
    if (!pick) throw new Error("没有找到播放器");
    playerId = pick.playerid;
    return pick;
  }

  /* 曲目原始音频文件地址（支持 Range 分段读取，节奏灯用） */
  const audio = (id) => `${BASE}/music/${encodeURIComponent(id)}/download`;

  return {
    findPlayer,
    cover,
    audio,
    get playerId() { return playerId; },
    /* 网络上所有 LMS 播放器（name、playerid、connected、power、model） */
    players: async () => visible((await q(["players", 0, 50])).players_loop),
    setPlayer: (id) => { playerId = id; },

    /* 状态：当前曲目 + 整个队列（队列一般不长，最多取 500 条） */
    status: () => p(["status", 0, 500, STATUS_TAGS]),

    /* 播放控制 */
    toggle: () => p(["pause"]),
    play: () => p(["play"]),
    prev: () => p(["button", "jump_rew"]),
    next: () => p(["playlist", "index", "+1"]),
    seek: (sec) => p(["time", String(Math.max(0, sec))]),
    jump: (idx) => p(["playlist", "index", String(idx)]),
    shuffle: (v) => p(["playlist", "shuffle", String(v)]),
    repeat: (v) => p(["playlist", "repeat", String(v)]),
    power: (v) => p(["power", String(v)]),
    /* 静音：v 为 0 / 1 / toggle。静音时 status 里的 "mixer volume" 变为负数 */
    mute: (v) => p(["mixer", "muting", String(v)]),
    /* 设音量 0–100：网页用它实现静音（RaopBridge 1.8.12 下 AirPlay 设备执行 muting 1 会出错） */
    volume: (v) => p(["mixer", "volume", String(v)]),
    clear: () => p(["playlist", "clear"]),
    deleteAt: (idx) => p(["playlist", "delete", String(idx)]),
    /* 队列第 idx 首的真实文件地址（只读）。曲库里已删掉的曲目 status 不列出来，要靠它问 */
    /* 停着时把当前位置移到第 idx 首但不开始放（noplay） */
    cueAt: (idx) => p(["playlist", "index", String(idx), "", "1"]),
    queuePath: async (idx) => (await p(["playlist", "path", String(idx), "?"]))._path || "",
    /* 把一首插到正在放的那首后面（不重新打乱随机顺序），返回它在队列里的位置 */
    insertNext: async (trackId) => Number((await p(["playlistcontrol", "cmd:insert", "track_id:" + trackId])).index),
    /* 清除当前播放但保留正在播放的那首：先从队尾往前删它后面的，再逐个删第 0 首直到它成为第一首。
       删的都不是当前曲目，LMS 只顺移当前位置，不会中断播放。返回删掉的曲目数。 */
    clearOthers: async () => {
      const st = await p(["status", "-", 1]);
      const n = Number(st.playlist_tracks) || 0;
      const cur = Number(st.playlist_cur_index) || 0;
      for (let i = n - 1; i > cur; i--) await p(["playlist", "delete", String(i)]);
      for (let i = 0; i < cur; i++) await p(["playlist", "delete", "0"]);
      return Math.max(0, n - 1);
    },
    /* 把队列里第 from 首移到第 to 位（从 0 开始），LMS 会自动修正正在播放的位置 */
    move: (from, to) => p(["playlist", "move", String(from), String(to)]),
    /* AirPlay 转移：把 from 的整个队列、当前曲目和进度搬到 to 上，to 原来的队列会被替换。
       原来在放：to 接着放，from 暂停。
       原来暂停：to 只停在那一首、不出声（LMS 的停止状态），返回 resume = {idx, id, t}，
       由网页记住进度，按播放时再从 t 秒接着放（见 app.js Resume）。
       注意不能「先放再暂停」：playlist index 后 LMS 处在缓冲状态，这时的 pause 会被忽略（StreamingController
       状态表 Pause/BUFFERING = _NoOp），缓冲完就响了——这就是以前暂停时转过去会自动播放的原因。 */
    transfer: async (from, to, tKnown = null) => {   // tKnown：from 自己也是停着的、进度由网页记着时传入
      const st = await rpc(from, ["status", 0, 1000, "tags:u"]);
      if (tKnown != null) { st.time = tKnown; st.can_seek = 1; }
      const readAt = Date.now();
      const loop = st.playlist_loop || [];
      if (!loop.length) throw new Error("当前播放列表是空的");
      const idx = Number(st.playlist_cur_index) || 0;
      const playing = st.mode === "play";
      const run = (cmd) => rpc(to, cmd);
      // 第二个参数 1 = noplay：开机时不按「开机恢复播放」设置自动续播 to 原来的队列
      await run(["power", "1", "1"]);
      await run(["playlist", "clear"]);
      // 按原顺序加入：本地曲目成批按 track_id 加，网络电台等（id 为负）按地址加
      let ids = [];
      const flush = async () => { if (ids.length) { await run(["playlistcontrol", "cmd:add", "track_id:" + ids.join(",")]); ids = []; } };
      for (const x of loop) {
        if (Number(x.id) > 0) ids.push(x.id);
        else if (x.url) { await flush(); await run(["playlist", "add", x.url]); }
      }
      await flush();
      await run(["playlist", "repeat", String(st["playlist repeat"] || 0)]);
      const t = Number(st.time || 0) + (playing ? (Date.now() - readAt) / 1000 : 0);
      const seek = t > 1 && Number(st.can_seek);
      if (playing) {
        await rpc(from, ["pause", "1"]);                     // 先停原设备，避免两边同时出声
        await run(["playlist", "index", String(idx)]);
        if (seek) await run(["time", String(t)]);
        return { n: loop.length, resume: null };
      }
      // 原来暂停（或停止）：playlist index <idx> <fadein> <noplay=1>，播放器停着时只移到这一首、不开始放
      await run(["playlist", "index", String(idx), "", "1"]);
      const cur = loop.find((x) => Number(x["playlist index"]) === idx);
      return { n: loop.length, resume: seek && cur ? { idx, id: String(cur.id), t: Math.round(t * 10) / 10 } : null };
    },
    /* 从第 idx 首的 t 秒开始放（暂停时转过来、停在那一首的设备按播放时用） */
    resumeAt: async (idx, t) => {
      await p(["playlist", "index", String(idx)]);
      if (t > 1) await p(["time", String(t)]);
    },
    /* 把当前播放队列存成播放列表（LMS 写到 playlistdir 下的 <名称>.m3u；同名会覆盖） */
    savePlaylist: (name) => p(["playlist", "save", name]),

    /* 加载到队列：cmd 为 load（替换并播放）/ add（加到末尾）/ insert（下一首） */
    loadAlbum: (albumId, cmd = "load", playIndex) => {
      const c = ["playlistcontrol", "cmd:" + cmd, "album_id:" + albumId];
      if (playIndex != null) c.push("play_index:" + playIndex);
      return p(c);
    },
    loadPlaylist: (plId, cmd = "load") => p(["playlistcontrol", "cmd:" + cmd, "playlist_id:" + plId]),
    loadFolder: (folderId, cmd = "load") => p(["playlistcontrol", "cmd:" + cmd, "folder_id:" + folderId]),
    addFavorite: (itemId) => p(["favorites", "playlist", "add", "item_id:" + itemId]),
    /* 按给定顺序把多首曲目加到当前播放末尾（track_id 可用逗号连接） */
    addTracks: (ids) => p(["playlistcontrol", "cmd:add", "track_id:" + ids.join(",")]),

    /* 资料库查询 */
    albums: (start, n, extra = []) => q(["albums", start, n, "tags:ljaySsyw", ...extra]),
    albumTracks: (albumId) => q(["titles", 0, 500, "album_id:" + albumId, "tags:acdtjJKsoTIrQye", "sort:tracknum"]),
    songs: (start, n, extra = []) => q(["titles", start, n, "tags:acdtjlJKe", "sort:title", ...extra]),
    artists: (start, n, extra = []) => q(["artists", start, n, ...extra]),
    folder: (folderId) => q(["musicfolder", 0, 500, "tags:dcuj", ...(folderId ? ["folder_id:" + folderId] : [])]),
    // 只看目录里的第一项：是曲目就说明这是专辑目录，coverid 即目录封面（LMS 扫描时已把 cover 文件关联到曲目）
    // 服务器状态：needsrestart / newplugins / pluginsdownloading 用来判断插件更新是否已下载、等重启安装
    serverStatus: () => q(["serverstatus", 0, 0]),
    restartServer: () => q(["restartserver"]),
    folderPeek: (folderId) => q(["musicfolder", 0, 1, "tags:cj", "folder_id:" + folderId]),
    // 按目录路径查这个文件夹本身（return_top 返回它的 id 和名称）
    folderByUrl: (url) => q(["musicfolder", 0, 1, "tags:u", "url:" + url, "return_top:1"]),
    // 单曲详情：songinfo 返回 [{id},{title},…] 一键一项，这里合并成一个对象（专辑名、艺人、年份、album_id、格式）
    songInfo: async (trackId) => {
      const r = await q(["songinfo", 0, 100, "track_id:" + trackId, "tags:alyeoTIc"]);
      return Object.assign({}, ...(r.songinfo_loop || []));
    },
    playlists: () => q(["playlists", 0, 200]),
    /* 删除已保存的播放列表（LMS 播放列表目录里的 .m3u 文件一起删掉；曲目文件不动） */
    deletePlaylist: (plId) => q(["playlists", "delete", "playlist_id:" + plId]),
    /* 从已保存的播放列表里删一首（index 从 0 起；删后后面的位置往前挪） */
    playlistDeleteTrack: (plId, index) => q(["playlists", "edit", "cmd:delete", "playlist_id:" + plId, "index:" + index]),
    // 带上当前设备查询：列表里有网络流（电台 http/m3u8）时，LMS 不带设备会直接断开连接（浏览器报 502 / 网络错误）
    playlistTracks: (plId) => rpc(playerId || 0, ["playlists", "tracks", 0, 500, "playlist_id:" + plId, "tags:acdtjJKl"]),
    favorites: (itemId) => q(["favorites", "items", 0, 200, "want_url:1", ...(itemId ? ["item_id:" + itemId] : [])]),
    /* 喜爱（LMS 收藏夹）：exists 可直接用曲目 id，返回 {exists, index}；删除用 index，加入要文件 url */
    favExists: (trackId) => q(["favorites", "exists", String(trackId)]),
    favAdd: (url, title) => q(["favorites", "add", "url:" + url, "title:" + title, "type:audio"]),
    favDelete: (index) => q(["favorites", "delete", "item_id:" + index]),
    /* 喜爱核对：喜爱只记文件 url，文件被删、改名或换格式后不会跟着变。
       dirList 直接列出磁盘上某个文件夹里的文件（只读，不碰曲库；文件夹不存在时 count 为 0）；
       不用 songinfo url: 查——LMS 发现文件不在会顺手把它从曲库删掉，NAS 临时断开时会误删。
       folderFiles 取同一文件夹里新文件的 url；favAddAt 在指定位置插入一项（原来这个位置及后面的往后挪一位），用来「原地换成新文件」 */
    dirList: (path) => q(["readdirectory", 0, 5000, "folder:" + path]),
    mediaDirs: async () => (await q(["pref", "mediadirs", "?"]))._p2 || [],
    /* 某个文件夹（url）里的曲目：取新文件的 url（LMS 自己的写法，括号、& 等不转义）。
       注意别和上面的 folderByUrl 重名——那个带 return_top:1，返回文件夹本身，信息面板点专辑名要用它 */
    folderFiles: (url) => q(["musicfolder", 0, 5000, "url:" + url, "tags:u"]),
    favAddAt: (index, url, title) => q(["favorites", "add", "item_id:" + index, "url:" + url, "title:" + title, "type:audio"]),
    /* 节奏灯用：文件路径（CUE 分轨带 #起-止）、格式、大小、码率、时长 */
    fileInfo: async (trackId) => ({ id: trackId, ...(((await q(["titles", 0, 1, "track_id:" + trackId, "tags:uofrdT"])).titles_loop || [])[0] || {}) }),
    trackUrl: async (trackId) => ((await q(["titles", 0, 1, "track_id:" + trackId, "tags:u"])).titles_loop || [])[0] || {},
    search: (term) => q(["search", 0, 30, "term:" + term]),

    /* ---------- CD（靠 LMS 的 CDplayer 插件：读盘、查曲名、cdplay:// 播放都在插件里） ---------- */
    /* 插件在不在：can 是只读查询，在 = 1 */
    cdHas: async () => Number((await q(["can", "cdplayer", "items", "?"]))._can) === 1,
    /* 读盘菜单：不带 itemId 会让光驱读一次目录（几秒），带 itemId 只读插件已有的结果。
       出错时结果里是 networkerror（文字后面括号里是光驱状态码），count 为 0 */
    cdItems: (itemId) => p(["cdplayer", "items", 0, 120, "menu:1", ...(itemId ? ["item_id:" + itemId] : [])]),
    /* 把一首 CD 曲目（cdplay://轨号?…）加到当前播放末尾 */
    cdAdd: (url, title) => p(["playlist", "add", url, title || ""]),
    /* 弹出（仓门开着就关，关着就开）：借用 Daphile 系统自带「CD Ripper」页上的 Eject 按钮，它两个方向都能动。
       那个页面在主机的 80 端口，和 LMS 不同源，只能发出去、读不到回应，结果靠随后再查光驱状态来确认。
       drive 固定 sr0（Daphile 给第一台光驱起的名字） */
    cdTray: async () => {
      const host = BASE ? (await q(["serverstatus", 0, 0])).ip : location.hostname;   // 开发预览时页面在本机，要问 LMS 它自己的地址
      if (!host) throw new Error("不知道 Daphile 主机的地址");
      await fetch(`http://${host}/cgi-bin/CD%20Ripper`, { method: "POST", mode: "no-cors", credentials: "include", body: new URLSearchParams({ drive: "sr0", ACTION: "Eject" }) });
    },
    cdStop: () => p(["stop"]),
    /* 备用的出仓办法（只能开、不能关），上面那条路不通时才用（比如不是 Daphile 系统）。
       插件只在「播放 cdplay://99?Command=eject」时才执行 eject，
       所以用 LMS 的试听（preview）：先存下当前队列 → 播这条地址 → 再恢复队列。
       wasCd：当前正在放 CD，先停掉（插件在 CD 播放中不会退盘），退盘后不再续播 */
    cdEject: async (wasCd) => {
      const st = await p(["status", "-", 1]);
      const playing = st.mode === "play", t = Number(st.time || 0), seek = Number(st.can_seek);
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      if (wasCd) { await p(["stop"]); await wait(1200); }
      await p(["playlist", "preview", "url:cdplay://99?Command=eject&TrackTitle=Eject%20CD&AlbumTitle=Eject%20CD", "title:Eject CD"]);
      await wait(1500);
      await p(["playlist", "preview", "cmd:stop"]);
      if (playing && !wasCd) {
        await wait(300);
        await p(["play"]);
        if (t > 1 && seek) await p(["time", String(t)]);
      }
    },
  };
})();
