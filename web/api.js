/* LMS JSON-RPC 封装
   作为 LMS 插件运行时（/plugins/DaphileTouch/…）页面与 LMS 同源，直接请求；
   开发时经 tools/dev-server.py 打开，请求走 /lms/ 反向代理。 */
const LMS = (() => {
  const BASE = location.pathname.startsWith("/plugins/") ? "" : "/lms";
  // A：按角色返回 composer/conductor/band/albumartist 等；g：流派
  const STATUS_TAGS = "tags:aAcdglKNoxrTIjJQyt";
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
    /* 把队列里第 from 首移到第 to 位（从 0 开始），LMS 会自动修正正在播放的位置 */
    move: (from, to) => p(["playlist", "move", String(from), String(to)]),
    /* AirPlay 转移：把 from 的整个队列、当前曲目和进度搬到 to 上接着放，from 暂停。
       to 原来的队列会被替换。返回转过去的曲目数。 */
    transfer: async (from, to) => {
      const st = await rpc(from, ["status", 0, 1000, "tags:u"]);
      const readAt = Date.now();
      const loop = st.playlist_loop || [];
      if (!loop.length) throw new Error("当前播放列表是空的");
      const idx = Number(st.playlist_cur_index) || 0;
      const playing = st.mode === "play";
      const run = (cmd) => rpc(to, cmd);
      await run(["power", "1"]);
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
      if (playing) await rpc(from, ["pause", "1"]);          // 先停原设备，避免两边同时出声
      await run(["playlist", "index", String(idx)]);
      const t = Number(st.time || 0) + (playing ? (Date.now() - readAt) / 1000 : 0);
      if (t > 1 && Number(st.can_seek)) await run(["time", String(t)]);
      if (!playing) await run(["pause", "1"]);               // 原来是暂停的，转过去也停在同一位置
      return loop.length;
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
    folderPeek: (folderId) => q(["musicfolder", 0, 1, "tags:cj", "folder_id:" + folderId]),
    // 单曲详情：songinfo 返回 [{id},{title},…] 一键一项，这里合并成一个对象（专辑名、艺人、年份、album_id、格式）
    songInfo: async (trackId) => {
      const r = await q(["songinfo", 0, 100, "track_id:" + trackId, "tags:alyeoTIc"]);
      return Object.assign({}, ...(r.songinfo_loop || []));
    },
    playlists: () => q(["playlists", 0, 200]),
    playlistTracks: (plId) => q(["playlists", "tracks", 0, 500, "playlist_id:" + plId, "tags:acdtjJKl"]),
    favorites: (itemId) => q(["favorites", "items", 0, 200, "want_url:1", ...(itemId ? ["item_id:" + itemId] : [])]),
    /* 喜爱（LMS 收藏夹）：exists 可直接用曲目 id，返回 {exists, index}；删除用 index，加入要文件 url */
    favExists: (trackId) => q(["favorites", "exists", String(trackId)]),
    favAdd: (url, title) => q(["favorites", "add", "url:" + url, "title:" + title, "type:audio"]),
    favDelete: (index) => q(["favorites", "delete", "item_id:" + index]),
    /* 节奏灯用：文件路径（CUE 分轨带 #起-止）、格式、大小、码率、时长 */
    fileInfo: async (trackId) => ({ id: trackId, ...(((await q(["titles", 0, 1, "track_id:" + trackId, "tags:uofrdT"])).titles_loop || [])[0] || {}) }),
    trackUrl: async (trackId) => ((await q(["titles", 0, 1, "track_id:" + trackId, "tags:u"])).titles_loop || [])[0] || {},
    search: (term) => q(["search", 0, 30, "term:" + term]),
  };
})();
