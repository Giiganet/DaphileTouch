# DaphileTouch

A touch-friendly web player for [Daphile](https://www.daphile.com/) / [Lyrion Music Server (LMS)](https://lyrion.org/), designed for a tablet in landscape (iPad 1080×810, also 1024×768). The layout follows Apple Music on the Mac: Now Playing is always in the main area, and the library slides out from the sidebar.

为 Daphile / Lyrion Music Server 设计的平板网页播放界面（iPad 横屏），布局仿 Mac 版「音乐」app。中文说明见下方。

## Features

- Now Playing queue: long-press to reorder, swipe left to remove, clear, save as a new playlist
- Library: Search, Recently Added, Artists, Albums, Songs, Folders, Playlists, Favorites
- Add tracks or whole albums to the end of the queue; heart to add/remove favorites; remove several favorites at once with Delete and Select all
- Playlists: play one (replaces the queue, asks first) or add it to the end of the queue; delete playlists or tracks inside them
- CD player (with the LMS CDplayer plugin): the disc in the drive as an album page, eject / close tray on Daphile, CD tracks marked in the queue
- AirPlay button to move the queue, track and position to another device (any LMS player, including AirPlay devices through the AirPlay Bridge plugin); a paused queue stays paused
- Mute button that is greyed out for fixed-volume (bit-perfect) players
- Light / dark theme switch

## Install as an LMS plugin

1. Open LMS settings → **Plugins** (on Daphile: *Settings → Plugins*).
2. At the bottom, under **Additional Repositories**, add:

   ```
   https://github.com/giiganet/DaphileTouch/releases/latest/download/repo.xml
   ```

3. Apply, tick **DaphileTouch** in the list, apply again and restart LMS when asked.
4. On the tablet open:

   ```
   http://<your-lms-server>:9000/plugins/DaphileTouch/index.html
   ```

   On iPad, use *Share → Add to Home Screen* for a full-screen app.

Requires LMS 8.0 or later. The plugin only ships static web files; it talks to LMS through the standard JSON-RPC interface and adds no settings or background processes.

## Development

The page can be run from any computer with a small proxy (Python 3, standard library only):

```
python3 tools/dev-server.py --lms 192.168.1.20
```

Then open http://127.0.0.1:8765/ . Files are in `web/`; plugin files are in `plugin/`.

### Releasing

The version number lives only in `VERSION`.

```
python3 tools/build.py          # sync the version into the page and install.xml, build dist/
python3 tools/build.py --check  # only verify that all version numbers match
```

This creates `dist/DaphileTouch-<version>.zip` and `dist/repo.xml`. Create a GitHub release tagged `v<version>` and upload both files. Add the release notes to `CHANGELOG.md` first; `repo.xml` takes its change list from there.

## 中文说明

**安装**：在 LMS（Daphile）的「插件」设置页最下方「其他插件仓库」里填入
`https://github.com/giiganet/DaphileTouch/releases/latest/download/repo.xml`，
应用后在列表里勾选 DaphileTouch，再应用并按提示重启 LMS。
平板浏览器打开 `http://<LMS地址>:9000/plugins/DaphileTouch/index.html`，iPad 上可「添加到主屏幕」全屏使用。

**开发**：`python3 tools/dev-server.py --lms <LMS地址>`，然后打开 http://127.0.0.1:8765/ 。

**发版**：只改 `VERSION`，在 `CHANGELOG.md` 写更新说明，运行 `python3 tools/build.py`，把 `dist/` 里的 zip 和 repo.xml 上传到 GitHub Release（标签 `v<版本号>`）。

## License

[MIT](LICENSE)
