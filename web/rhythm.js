/* 节奏灯（频谱）：按播放进度分段读取当前曲目的音频文件，在本机解码做 FFT，
   左右声道合成一组频谱柱（任一声道有声就亮，两声道都静音才不亮），画在进度条那一格。
   支持 FLAC / WAV / MP3（含 CUE 分轨）；ALAC、AAC、APE、DSD 等格式不显示。
   每次只读当前位置往后约 8 秒（FLAC 约 1 MB），不整首下载。 */
const Rhythm = (() => {
  const KEY = "daphile.vu";
  const SPAN = 8;          // 每段秒数
  const FPS = 30;          // 每秒频谱帧数
  const NB = 40;           // 频段（细柱）数
  const FMIN = 50, FMAX = 16000;
  const DBMIN = -66, DBMAX = -6;   // 柱高 0–满格对应的 dB 范围
  const KEY_BIG = "daphile.vubig";
  let on = false, cv = null, g = null, ac = null, getPos = null, delay = 0;
  let big = false, bcv = null, bg = null;   // 大频谱：从进度条那一格往上拖出来，浮在播放条上方
  let trk = null;          // 当前曲目的文件信息与解码所需的文件头
  let busy = false, failUntil = 0;
  const bars = new Float32Array(NB);
  let raf = 0;
  const active = () => on || big;

  try { on = localStorage.getItem(KEY) === "1"; big = localStorage.getItem(KEY_BIG) === "1"; } catch (_) { /* 忽略 */ }

  /* Range 读取 [a, b]；服务器不支持分段时宁可放弃，也不整首下载 */
  /* cache: "no-store"：分段请求不进浏览器缓存。Safari 等浏览器对带 Range 的缓存处理不一致，
     第二段起可能拿到缓存里的整文件（200）或错位的片段，频谱就只亮第一段约 8 秒 */
  async function range(url, a, b) {
    // 超过 8 秒没读完就放弃这一次（3 秒后重试），免得一次卡住的请求让后面的段再也不读
    const ctl = window.AbortController ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` }, cache: "no-store", signal: ctl ? ctl.signal : undefined });
      const cr = /bytes (\d+)-/.exec(r.headers.get("Content-Range") || "");
      if (r.status !== 206 || (cr && Number(cr[1]) !== a)) {
        try { r.body && r.body.cancel(); } catch (_) { /* 忽略 */ }
        throw new Error("no range " + r.status);
      }
      return new Uint8Array(await r.arrayBuffer());
    } finally { clearTimeout(timer); }
  }
  const u32le = (d, i) => d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] * 16777216);
  const tag = (d, i) => String.fromCharCode(d[i], d[i + 1], d[i + 2], d[i + 3]);
  const cat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

  /* 读文件头：记下音频数据起点、每秒字节数，以及解码时要拼在片段前面的最小文件头 */
  async function prepare(info) {
    const url = LMS.audio(info.id);
    const m = /#([\d.]+)-([\d.]+)$/.exec(info.url || "");      // CUE 分轨：在整个文件里的起止秒数
    const t = { id: String(info.id), url, type: info.type, off: m ? Number(m[1]) : 0,
                bps: (parseInt(info.bitrate, 10) || 0) * 125, start: 0, head: new Uint8Array(0) };
    if (t.type === "flc") {
      const h = await range(url, 0, 41);
      if (tag(h, 0) !== "fLaC") throw new Error("not flac");
      const si = h.slice(8, 42);
      t.block = (si[0] << 8) | si[1];
      t.fixed = t.block === ((si[2] << 8) | si[3]);           // 固定块长：帧头里记的是帧号
      t.rate = (si[10] << 12) | (si[11] << 4) | (si[12] >> 4);
      let pos = 4, b = h.slice(4, 8);
      for (let i = 0; i < 64; i++) {                         // 跳过元数据块（封面可能几 MB，只读块头）
        pos += 4 + ((b[1] << 16) | (b[2] << 8) | b[3]);
        if (b[0] & 0x80) break;
        b = await range(url, pos, pos + 3);
      }
      t.start = pos;
      t.head = cat(new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]), si);
    } else if (t.type === "wav") {
      const h = await range(url, 0, 4095);
      if (tag(h, 0) !== "RIFF") throw new Error("not wav");
      for (let p = 12; p + 8 <= h.length;) {
        const id = tag(h, p), len = u32le(h, p + 4);
        if (id === "fmt ") t.fmt = h.slice(p, p + 8 + len);
        if (id === "data") { t.start = p + 8; break; }
        p += 8 + len + (len & 1);
      }
      if (!t.fmt || !t.start) throw new Error("bad wav");
      t.align = t.fmt[20] | (t.fmt[21] << 8);
      t.bps = u32le(t.fmt, 16);
    } else if (t.type === "mp3") {
      const h = await range(url, 0, 9);
      if (tag(h, 0).startsWith("ID3")) t.start = 10 + (((h[6] & 127) << 21) | ((h[7] & 127) << 14) | ((h[8] & 127) << 7) | (h[9] & 127));
      // LMS 报的码率是取整的（如 320k 的文件报「319kbps」），一小时的文件会差出十来秒；非 CUE 时按「音频字节 ÷ 时长」算
      if (!m && Number(info.filesize) > t.start && Number(info.duration) > 0) t.bps = (Number(info.filesize) - t.start) / Number(info.duration);
    } else throw new Error("unsupported");
    if (!t.bps && info.filesize && info.duration) t.bps = Number(info.filesize) / Number(info.duration);
    if (!t.bps) throw new Error("no bitrate");
    return t;
  }

  /* FLAC 帧头：同步码 + CRC-8 校验，返回该帧起始采样号（找不到返回 -1） */
  function crc8(d, a, b) {
    let c = 0;
    for (let i = a; i < b; i++) { c ^= d[i]; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 7) & 255 : (c << 1) & 255; }
    return c;
  }
  function flacFrame(d, i, t) {
    if (d[i] !== 0xff || (d[i + 1] & 0xfe) !== 0xf8 || i + 16 > d.length) return -1;
    const bs = d[i + 2] >> 4, sr = d[i + 2] & 15;
    if (bs === 0 || sr === 15 || (d[i + 3] & 1)) return -1;
    let p = i + 4, n = d[p++], extra = 0;
    if (n >= 0x80) {                                     // UTF-8 形式的变长整数
      let m = 0x40; while (n & m) { extra++; m >>= 1; }
      if (extra < 1 || extra > 6) return -1;
      n &= m - 1;
      for (let k = 0; k < extra; k++) { const c = d[p++]; if ((c & 0xc0) !== 0x80) return -1; n = n * 64 + (c & 0x3f); }
    }
    if (bs === 6) p += 1; else if (bs === 7) p += 2;
    if (sr === 12) p += 1; else if (sr === 13 || sr === 14) p += 2;
    if (crc8(d, i, p) !== d[p]) return -1;
    return (d[i + 1] & 1) ? n : n * t.block;             // 变块长记采样号，固定块长记帧号
  }

  /* MP3 帧头（只认 Layer III）：返回帧长，不是合法帧头返回 0 */
  const MP3_BR = [[0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],      // MPEG-2 / 2.5
                  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]];  // MPEG-1
  function mp3Frame(d, i) {
    if (i + 4 > d.length || d[i] !== 0xff || (d[i + 1] & 0xe0) !== 0xe0) return 0;
    const ver = (d[i + 1] >> 3) & 3, layer = (d[i + 1] >> 1) & 3, bi = d[i + 2] >> 4, si = (d[i + 2] >> 2) & 3;
    if (ver === 1 || layer !== 1 || bi === 0 || bi === 15 || si === 3) return 0;
    const sr = [44100, 48000, 32000][si] / (ver === 3 ? 1 : ver === 2 ? 2 : 4);
    return Math.floor((ver === 3 ? 144000 : 72000) * MP3_BR[ver === 3 ? 1 : 0][bi] / sr) + ((d[i + 2] >> 1) & 1);
  }
  /* 从任意字节起点找到第一个真正的帧头（后面连着两个帧头都对得上才算），找不到返回 -1。
     Safari 解码 MP3 时要求数据从帧头开始；Chrome 会自己跳过开头的半帧，所以只在 Safari 出问题 */
  function mp3Sync(d) {
    for (let i = 0; i + 4 < d.length; i++) {
      const n1 = mp3Frame(d, i); if (!n1) continue;
      const n2 = mp3Frame(d, i + n1); if (!n2 || (d[i + n1 + 1] & 0xfe) !== (d[i + 1] & 0xfe)) continue;
      if (mp3Frame(d, i + n1 + n2)) return i;
    }
    return -1;
  }

  function decode(bytes) {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    return new Promise((ok, bad) => {
      const p = ac.decodeAudioData(bytes.buffer, ok, bad);
      if (p && p.catch) p.catch(bad);
    });
  }

  /* 读并解码从曲目内第 sec 秒开始的一段；返回 {t0, t1, sp}，t0/t1 为曲目内秒数，sp 为这一段的频谱 */
  async function segment(t, sec) {
    const span = Math.max(2, Math.min(SPAN, 3e6 / t.bps));
    const abs = t.off + sec;
    // 估算位置往前留 1 秒余量，保证第一帧落在目标时间之前
    let a = Math.floor(t.start + (abs - 1) * t.bps * (t.corr || 1));
    for (let tries = 0; tries < 3; tries++) {
      a = Math.max(t.start, a);
      let bytes, t0, rate = t.bps;
      if (t.type === "wav") {
        a = t.start + Math.floor((a - t.start) / t.align) * t.align;
        const n = Math.floor(span * t.bps / t.align) * t.align;
        const data = await range(t.url, a, a + n - 1);
        const len = data.length - (data.length % t.align);
        const hd = new Uint8Array(12 + t.fmt.length + 8), dv = new DataView(hd.buffer);
        hd.set([82, 73, 70, 70]); dv.setUint32(4, hd.length - 8 + len, true); hd.set([87, 65, 86, 69], 8);
        hd.set(t.fmt, 12); const q = 12 + t.fmt.length;
        hd.set([100, 97, 116, 97], q); dv.setUint32(q + 4, len, true);
        bytes = cat(hd, data.subarray(0, len)); t0 = (a - t.start) / t.bps;
      } else if (t.type === "flc") {
        const data = await range(t.url, a, a + Math.floor(span * t.bps * 1.15) + 65535);
        // 候选帧头；只认前后采样号接得上的帧，排除数据里碰巧像帧头的字节
        const c = [];
        for (let i = 0; i < data.length - 16; i++) {
          if (data[i] !== 0xff) continue;
          const s = flacFrame(data, i, t);
          if (s >= 0) c.push([i, s]);
        }
        const ok = (p, q) => q[1] > p[1] && q[1] - p[1] <= 65535 && (!t.fixed || q[1] - p[1] === t.block);
        let k = 0;
        while (k + 1 < c.length && !ok(c[k], c[k + 1])) k++;
        if (k + 1 >= c.length) throw new Error("no frame");
        let prev = c[k];
        for (let j = k + 1; j < c.length; j++) if (ok(prev, c[j])) prev = c[j];
        const first = c[k][0], last = prev[0];
        bytes = cat(t.head, data.subarray(first, last)); t0 = c[k][1] / t.rate;   // 去掉最后一帧（可能不完整）
        if (prev[1] > c[k][1]) rate = (last - first) / ((prev[1] - c[k][1]) / t.rate);   // 这一段的实际每秒字节数
        if (t0 > 1 && a > t.start) t.corr = ((first + a - t.start) / t0) / t.bps; // 用实际位置校正下次估算
        a += first;
      } else {
        const data = await range(t.url, a, a + Math.floor(span * t.bps));
        const k = mp3Sync(data);                          // 从第一个完整帧开始，丢掉开头的半帧
        if (k < 0) throw new Error("no mp3 frame");
        bytes = data.slice(k); t0 = (a + k - t.start) / t.bps;
      }
      const buf = await decode(bytes);
      const t1 = t0 + buf.duration;
      if (t.type === "flc" && (abs < t0 - 0.3 || abs > t1 - 0.5)) {
        // 落点偏了（VBR 码率前后不均）：按这一段的实际码率，从已知帧位置推算目标位置再读
        a = Math.floor(a + (abs - 1 - t0) * rate);
        continue;
      }
      return { t0: t0 - t.off, t1: t1 - t.off, sp: spectrum(buf) };
    }
    throw new Error("seek miss");
  }

  /* ---------- 频谱 ----------
     每 1/FPS 秒取一个窗口做 FFT，FMIN–FMAX（50 Hz–16 kHz）按对数分成 NB 段；
     左右声道各算一遍，每段取较大的那个（任一声道有声即亮，都静音才不亮）。
     结果按 0–255 存成 Uint8Array（每帧 NB 个值）。 */
  const tables = {};
  function table(N) {
    if (tables[N]) return tables[N];
    const cos = new Float32Array(N / 2), sin = new Float32Array(N / 2), win = new Float32Array(N), rev = new Uint32Array(N);
    for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / N); sin[i] = -Math.sin(2 * Math.PI * i / N); }
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));   // 汉宁窗
    for (let i = 0, j = 0; i < N; i++) {
      rev[i] = j;
      let bit = N >> 1; while (j & bit) { j ^= bit; bit >>= 1; } j |= bit;
    }
    return (tables[N] = { cos, sin, win, rev });
  }
  function fft(re, im, T) {
    const N = re.length;
    for (let i = 0; i < N; i++) { const j = T.rev[i]; if (j > i) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; } }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let s = 0; s < N; s += size) {
        for (let k = 0; k < half; k++) {
          const c = T.cos[k * step], si = T.sin[k * step], a = s + k, b = a + half;
          const xr = re[b] * c - im[b] * si, xi = re[b] * si + im[b] * c;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
  }
  function spectrum(buf) {
    const sr = buf.sampleRate;
    let N = 1024; while (N < sr / 21) N *= 2;                 // 频率分辨率约 20 Hz（44.1k 为 2048 点）
    const T = table(N), hop = sr / FPS, n = Math.floor(buf.length / hop);
    const out = new Uint8Array(n * NB), re = new Float32Array(N), im = new Float32Array(N);
    const lo = [], hi = [], tilt = [], ref = 10 * Math.log10((N / 4) * (N / 4));   // 满幅正弦 = 0 dB
    for (let b = 0; b < NB; b++) {
      const f0 = FMIN * Math.pow(FMAX / FMIN, b / NB), f1 = FMIN * Math.pow(FMAX / FMIN, (b + 1) / NB);
      lo[b] = Math.max(1, Math.round(f0 * N / sr)); hi[b] = Math.max(lo[b] + 1, Math.round(f1 * N / sr));
      tilt[b] = 3 * Math.log2(Math.sqrt(f0 * f1) / 1000);     // 高频每倍频程补 3 dB，看起来更均匀
    }
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const x = buf.getChannelData(c);
      for (let k = 0; k < n; k++) {
        const s0 = Math.round(k * hop + hop / 2 - N / 2);
        for (let i = 0; i < N; i++) { const j = s0 + i; re[i] = j >= 0 && j < x.length ? x[j] * T.win[i] : 0; im[i] = 0; }
        fft(re, im, T);
        for (let b = 0; b < NB; b++) {
          let p = 0;
          for (let i = lo[b]; i < hi[b]; i++) { const q = re[i] * re[i] + im[i] * im[i]; if (q > p) p = q; }
          const db = 10 * Math.log10(p + 1e-20) - ref + tilt[b];
          const v = Math.max(0, Math.min(255, Math.round((db - DBMIN) / (DBMAX - DBMIN) * 255)));
          const o = k * NB + b;
          if (v > out[o]) out[o] = v;
        }
      }
    }
    return out;
  }

  let segs = [], curId = null, want = null, color = "#6e6e73", colorAt = 0;

  /* 换歌：读新曲目的文件头；不支持的格式记下来，灯就不亮 */
  function setTrack(id) { curId = id == null ? null : String(id); if (active()) load(); }
  async function load() {
    const id = curId;
    if (want === id) return;
    want = id; trk = null; segs = []; failUntil = 0;
    mark(false);
    if (!id) return;
    try {
      const t = await prepare(await LMS.fileInfo(id));
      if (want === id) trk = t;
    } catch (_) {
      if (want === id) mark(true);
    }
  }

  /* 当前段快放完（剩不到 3 秒）时预读下一段，接在后面，不断档 */
  async function fill(pos) {
    if (busy || !trk || Date.now() < failUntil) return;
    const cur = segs.find((s) => pos >= s.t0 && pos < s.t1);
    if (cur && (cur.t1 - pos > 3 || segs.some((s) => s.t0 <= cur.t1 + 0.1 && s.t1 > cur.t1 + 1))) return;
    busy = true;
    const t = trk;
    const at0 = cur ? cur.t1 : pos;
    try {
      // 整段（读取 + 解码）最多等 15 秒：个别浏览器的解码偶尔不回调，不能让 busy 一直卡住
      const s = await Promise.race([segment(t, at0),
        new Promise((_, bad) => setTimeout(() => bad(new Error("timeout")), 15000))]);
      if (t === trk) segs = segs.filter((x) => x.t1 > pos - 1).concat(s).slice(-3);
    } catch (_) { failUntil = Date.now() + 3000; }   // 读或解码失败：3 秒后再试
    busy = false;
  }
  /* 取当前位置那一帧的 NB 个频段值（0–255），没有数据返回 null */
  function at(pos) {
    for (const s of segs) if (pos >= s.t0 && pos < s.t1) {
      const k = Math.floor((pos - s.t0) * FPS) * NB;
      return k + NB <= s.sp.length ? s.sp.subarray(k, k + NB) : null;
    }
    return null;
  }

  function frame() {
    raf = 0;
    if (!active() || !cv) return;
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    if (now - colorAt > 1000) { colorAt = now; color = getComputedStyle(cv).getPropertyValue("--text2").trim() || color; }
    const p = getPos ? getPos() : null;          // {pos: 曲目内秒数, playing}
    let v = null;
    if (p && p.playing && trk) {
      const pos = Math.max(0, p.pos - delay);     // AirPlay 等设备出声比进度晚，往回对齐
      fill(pos);
      v = at(pos);
    }
    let any = false;
    for (let b = 0; b < NB; b++) {
      const t = v ? v[b] / 255 : 0;
      bars[b] = t > bars[b] ? bars[b] + (t - bars[b]) * 0.7 : bars[b] * 0.86 + t * 0.14;   // 快起慢落
      if (bars[b] > 0.02) any = true;
    }
    if (on && !big) draw(cv, g, any, 2, 3);       // 大频谱打开时，小格换回进度条，不画
    if (big && bcv) draw(bcv, bg, any, 3, 5);
  }

  /* LED 梯格频谱：每个频段一根细柱，柱子由一格格短横条叠成，单色；两声道都没声音时全部熄灭。
     seg 为每格横条高，pitch 为格距（小格 2/3，大频谱 3/5） */
  function draw(c, ctx, any, seg, pitch) {
    const w = c.clientWidth, h = c.clientHeight, r = window.devicePixelRatio || 1;
    if (!w || !h) return;
    if (c.width !== Math.round(w * r) || c.height !== Math.round(h * r)) { c.width = Math.round(w * r); c.height = Math.round(h * r); }
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!any) return;
    const gap = Math.max(1, Math.round(w / NB * 0.35)), bw = (w - gap * (NB - 1)) / NB;
    const levels = Math.floor((h - 2) / pitch), base = h - 1;
    const snap = (v) => Math.round(v * r) / r;            // 对齐物理像素，横条边缘清楚
    ctx.fillStyle = color;
    for (let b = 0; b < NB; b++) {
      const n = Math.round(bars[b] * levels), x = snap(b * (bw + gap)), xw = Math.max(1 / r, snap(bw));
      for (let k = 0; k < n; k++) ctx.fillRect(x, base - k * pitch - seg, xw, seg);
    }
  }

  /* 不能显示的格式：这一格（和大频谱）显示灰色「不可用」 */
  function mark(na) {
    if (cv) cv.parentNode.classList.toggle("na", na);
    if (bcv) bcv.parentNode.classList.toggle("na", na);
  }

  function save() {
    try { localStorage.setItem(KEY, on ? "1" : "0"); localStorage.setItem(KEY_BIG, big ? "1" : "0"); } catch (_) { /* 忽略 */ }
  }
  /* 小格是否显示频谱（vu-on）、大频谱是否打开（big-on）；两者都关时停止取数 */
  function apply() {
    if (!cv) return;
    cv.parentNode.classList.toggle("vu-on", on && !big);
    if (bcv) bcv.parentNode.classList.toggle("big-on", big);
    document.body.classList.toggle("bigvu-open", big);
    if (active()) { load(); if (!raf) raf = requestAnimationFrame(frame); }
  }
  function setOn(v) { on = !!v; save(); apply(); }
  /* 打开大频谱：小格换回进度条；关闭大频谱：小格也回到进度条（不再恢复频谱） */
  function setBig(v) { big = !!v; if (big) on = false; save(); apply(); }
  function attach(canvas, pos, bigCanvas) {
    cv = canvas; g = cv.getContext("2d"); getPos = pos;
    if (bigCanvas) { bcv = bigCanvas; bg = bcv.getContext("2d"); }
    if (big) on = false;
    apply();
  }

  return {
    attach, setTrack, setOn, setBig,
    get on() { return on; },
    get big() { return big; },
    setDelay: (s) => { delay = Number(s) || 0; },
  };
})();
