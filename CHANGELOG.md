# Changelog

All notable changes to this project are documented here.
Versions follow [Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-11-18

### Added
- Mouse hover highlight (`bindHoverGlow()`): one absolutely positioned `.hover-glow` per scroll container (`#cur-list`, `#content`, `#pick-list`, `#sidebar`, `#device-list`, `#dev-menu-list`) slides to the row under the pointer (transform/size transition 0.16 s; first appearance fades in place via `.jump`). Mouse/trackpad only (`pointerType === "mouse"`); 140 ms grace when crossing gaps between rows; follows wheel scrolling; re-appended after list re-renders; hidden while drag-reordering or swiping. A ResizeObserver re-fits it immediately when the container resizes (library open/close, window resize, splitter drag) with the pointer still. Colour `--glow` is a light tint of the stripe grey: `rgba(60,60,100,.035)` light, `rgba(210,210,230,.05)` dark; reduced motion fades only.
- Library closes on any pointerdown in Now Playing (capture phase, `Views.pickerOpen()` / `Views.closePicker()` exported); that press and a click within 800 ms are swallowed, so it does not play, drag or swipe.
- `.noq`: when the player bar, measured as if the track info panel were open, cannot fit even its minimal state, `#btn-queue` is hidden and the panel is closed (8 px hysteresis).

### Changed
- Player bar minimal state: transport buttons keep their size and gaps at every width; `.tiny` now hides only the title and keeps the 44 px cover (gap 4 px, right padding 8 px); new fallback `.mini` hides the cover only when even that does not fit. `fitPlayer()` thresholds: `NEED_TIME` 260, `NEED_TITLE` 82.
- `.player .tools { margin-left: auto }` keeps the device/AirPlay/mute group at the right end when the centre section is hidden.
- Row press darkening (`:active` on `.list li`, `.tracks tbody tr`, `.device-list li`) applies only under `@media (hover: none)`, so mouse presses and double-clicks no longer flash.

## [0.4.2] - 2026-11-18

### Added
- Large spectrum (`#vu-big`): drag up on the small spectrum in the player bar (vertical-dominant, follows the finger after 8 px, opens past 40 % of 90 px) to open a 128 px LED spectrum floating above the player bar; swipe down on it (> 40 px) to close. The same band data is drawn to both canvases (segment/pitch 2/3 small, 3/5 large). Opening it turns the small cell back into the progress bar; state is kept in `localStorage` (`daphile.vubig`), and `body.bigvu-open` adds bottom room to the content and library. Width is capped at 800 px (iPad 1080 landscape) and centred on wider windows; it closes automatically when the player bar title can no longer show its first character plus an ellipsis.
- Track info panel (`#queue`) can be closed by tapping empty space in Now Playing or swiping it right (start 12 px, horizontal > 1.5 × vertical, closes past 1/4 width or > 0.6 px/ms); `setQueue()` / `closeQueue()` slide it out before hiding.
- `fitPlayer()`: a ResizeObserver measures the room left for the centre of the player bar. `.narrow` hides time and progress/spectrum; `.tiny` also hides cover and title and tightens gaps/buttons. Measurement is done without `.tiny` and with 8 px hysteresis so it no longer flips every pixel near the threshold. Title keeps at least 56 px and the time group at least 140 px, so with the track info panel open at 1080 px the title stays visible.

### Fixed
- Spectrum stopped after the first ~8 s segment on MP3 in Safari: later Range segments start mid-frame and Safari's `decodeAudioData` rejects them. `mp3Sync()` now skips to the first valid Layer III frame (three consecutive frame headers) before decoding, and the segment start time is corrected accordingly. Also: Range requests use `cache: "no-store"`, the returned Content-Range start is checked, reads time out after 8 s and read + decode after 15 s; MP3 bitrate is computed from file size when not a CUE track.
- Firefox dark mode showed a light classic scroll bar on the right of the library; `scrollbar-color` is now set for light and dark themes.

## [0.4.1] - 2026-11-16

### Added
- Generic confirm dialog `ask({title, msg, ok, danger, icon})` → Promise<boolean> (`#ask-dlg`, `role=alertdialog`), styled like the app: optional bin / restart icon, red button for destructive actions; Esc, tapping the backdrop or 取消 resolve false, Enter (ignoring IME composition) resolves true.

### Changed
- Save as playlist: the browser `prompt` is replaced by `#save-dlg` with a cover thumbnail (2×2 mosaic when the queue has 4+ different covers), track count and total length, a pre-selected default name “当前播放 YYYY-MM-DD HH.MM” and a clear button. Existing playlist names are fetched when it opens; a duplicate name shows an orange note and turns 保存 into a red 覆盖 (if the names have not arrived yet, submitting waits for them and stops on a duplicate instead of overwriting). Characters `\ / : * ? " < > |` are flagged and replaced with “-”; an empty name cannot be saved.
- Clear (keep playing track / clear whole queue) and restart-to-install-plugin-updates now use `ask()` instead of `confirm()`. The restart dialog lists the plugins to install, warns and turns red while music is playing, and re-checks that the update is still pending after confirmation. The app no longer uses `confirm`, `prompt` or `alert`.

## [0.4.0] - 2026-11-16

### Added
- Library: tracks already in the current queue are shown in grey (`.queued`, `--text3`) in album pages, folders, Songs (including pages loaded later) and search results; the playing track keeps its blue highlight and the heart stays active. A row turns grey right after a successful add and is re-marked on every status poll, so removed tracks return to normal. `Views.markPlaying` is renamed `Views.markRows`.

### Removed
- Auto-play on add (added in 0.3.8). Adding music only appends to the end of the queue in every state (empty, stopped, paused, powered off); it never jumps to the new tracks or powers the player on, so the queue always plays in order.

### Fixed
- Folders: a volume root (open depth 2, e.g. Daphile_Music) with loose tracks was shown as a mixed “多位艺人” album page with its sub-folders below the track table. Album pages now start at depth 3 (folders inside a volume); volumes are always plain folder lists.
- Folders: loose tracks showed 0:00 because musicfolder returns durations as text (“6:40”); they are now converted to seconds, and the file extension is dropped from track names.

## [0.3.9] - 2026-11-16

### Removed
- The 查找 filter box in the library header is hidden in every category except Search, which keeps its centred search box. The in-place album filter in Albums no longer has an entry point.

### Changed
- Folders: below the top level, the detail row (‹ back, folder name, track count) moves up into the library header in place of “文件夹 N 项”; the close button stays at the top right and the content starts 44px higher. Artist and album details are unchanged.

## [0.3.8] - 2026-11-16

### Added
- Auto-play on add: when the player is not playing (empty queue, stopped or paused; the UI has no stop button), any add starts playback at the first newly added track (`playlist index <previous length>`), powering the player on first if needed. Adds made while one is still pending jump only once.
- Search results: leading icons that match the sidebar (artist microphone, album disc, song note); section headings have none. Album results get a ＋ button that adds the whole album with the same spinner, double-add guard and auto-play, staying on the search page.

### Changed
- Search page: the search box is centred in the library header (three-column grid, up to 400px wide, shrinking with the library width). Other categories keep the small right-aligned filter.
- Sidebar: the grey “播放列表” group heading is replaced by an inset separator line; “所有播放列表” → “播放列表”, “喜爱” → “我的喜爱” (library title too).
- Album header ＋ 整张加入 moved 8px lower (margin-top 4px → 12px); the save-as-playlist button is 6px closer to the clear button.

## [0.3.7] - 2026-11-15

### Added
- Waiting indicator while adding music: every add (single track, whole album, folder, whole playlist, folder ＋) shows a blue spinner with “正在加入…” in the Now Playing header in place of the track count, or in the middle of an empty queue in place of the empty message. It hides once LMS reports a changed playlist timestamp (with a 5-second fallback) and immediately on failure.
- Whole-album / whole-playlist / folder add buttons are disabled and greyed while their request runs, so repeated taps no longer queue the same music several times.

### Fixed
- Swipe-to-remove in Now Playing: the red button now stops at 76px (arms at 72px, 4px elastic) with the bin icon centred, instead of growing to about 124px with the icon pinned to the right. The Favorites swipe button is unchanged.

## [0.3.6] - 2026-11-15

### Added
- Plugin update card above the theme switch: when LMS reports that a plugin update has been downloaded and needs a restart (`serverstatus` needsrestart, plugin name from newplugins), a card shows the plugin name. Tapping it asks for confirmation (warning that music will stop if playing) and sends `restartserver`; the page then waits for LMS to come back without needing a restart and reloads itself. Checked every minute (every 5 minutes in the background); the "connection lost" message is suppressed during the restart, and the card returns after 3 minutes if LMS has not come back.

## [0.3.5] - 2026-11-15

### Added
- In the track info panel the album name is a link: tapping it opens the library at the folder that holds the track, with all of its tracks listed. Tracks that are not files (internet radio) show the album as plain text.
- Album pages show format, bit depth and sample rate as grey tags like the track info panel; album pages opened from the Albums grid now show them as well (taken from the first track).
- Playlists in the library list have an icon in front of their names. The playlist icon (also used for playlist files in Folders) is now lines with a note.

### Changed
- Playlist pages: the first row shows the track count on the left and ＋ 整个加入 (Add whole playlist) on the right; the playlist name is no longer shown there.

### Fixed
- Playlists containing internet radio streams failed to open with HTTP 502: LMS 9 drops the connection when the tracks of such a playlist are queried without a player. The query is now sent for the current player.

## [0.3.4] - 2026-11-15

### Changed
- The clear button in Now Playing now keeps the current track while it is playing: it removes all the other tracks and the music carries on without a break. When playback is paused or stopped, it clears the whole queue as before.

### Fixed
- In Now Playing the current track was always marked with a play triangle, even when paused. It now shows a triangle while playing, two bars when paused and a square when stopped, drawn as icons so iPad does not turn them into colour emoji.

## [0.3.3] - 2026-11-15

### Added
- The track info panel (☰ on the player bar) shows the file format, bit depth and sample rate as small grey tags above the album, e.g. "FLAC 16bit 44.1kHz".

### Fixed
- In Favorites, swiping a row left removed it at once, so swiping to close the library often deleted a favorite by accident. A left swipe now only reveals a red 移出 (Remove) button, and the favorite is removed only when that button is tapped. Keep swiping left without lifting your finger and the swipe passes to the library, which slides closed as usual.

## [0.3.2] - 2026-11-15

### Fixed
- On iPad the pause button showed a colour emoji (⏸️) instead of a plain icon. The play / pause button is now drawn as an SVG icon like the previous / next buttons, so it looks the same on every device. The playing marker in the queue is also forced to text style.

## [0.3.1] - 2026-11-15

### Fixed
- After rotating an iPad to portrait and back to landscape, Safari kept laying the page out at the portrait height: the sidebar ran past the bottom of the screen and the theme switch could not be reached. The page height is now locked to the visible screen height (re-measured on rotation, resize and when returning to the page), and the sidebar, Now Playing list and queue panel each scroll inside that height. Before this, a tall Now Playing panel could already push the sidebar off screen right after loading.

### Changed
- Internal clean-up: removed the spectrum debug hook, unused element ids and outdated code comments. No visible change.

## [0.3.0] - 2026-11-15

### Added
- Spectrum display: tap the elapsed time / progress bar / remaining time group in the player bar to replace all three with a spectrum of the playing track; tap again to switch back (the choice is remembered). Dragging on the progress bar still seeks. Left and right channels are combined into one display (lit if either channel has sound, dark when both are silent or playback is paused). The page reads short sections of the track file around the play position via HTTP Range (about 8 s at a time) and analyses them in the browser (FFT, 40 log-spaced bands, 50 Hz–16 kHz, LED-ladder style). Works with FLAC, WAV and MP3, including CUE sheet tracks; ALAC, AAC, APE and DSD show “不可用” (unavailable). Delay compensation: 2.0 s for AirPlay (RaopBridge) players, 0.1 s otherwise.

### Changed
- The AirPlay button now moves what is playing to another device: the whole queue, current track and position are copied to the chosen player (its own queue is replaced), the previous player pauses, and the page switches to the new player. Repeat mode is carried over; shuffle is not (tracks keep the order being played).
- The Now Playing title reads “当前播放设备 · device ▾”. Choosing a device there switches to that player together with its own queue, without moving any playback.

## [0.2.0] - 2026-11-15

### Changed
- In the library browser, tap a track to add it to the end of the queue; the row flashes briefly to confirm. The **＋** button is now only on folders, favorite folders and album folders (and the "Add whole album" buttons).
- Favorites: tap a track to add it to the queue.
- The light / dark theme now follows the system setting automatically (including iPad's Automatic appearance). Flipping the switch overrides it until the system appearance changes next time.
- The output device list marks the current device with a small circle instead of a check box.

### Fixed
- Tapping a grey (alternating) row gave no visual feedback; it now darkens like the white rows.

## [0.1.2] - 2026-11-15

### Changed
- The library browser now has a slightly darker background than Now Playing, so the two areas are easier to tell apart (light and dark themes).
- Swipe the library browser to the left to close it (past a quarter of its width, or a quick flick). Swiping a Favorites row still removes it from Favorites.

### Fixed
- Swipe-to-remove in the library browser no longer makes the list jump sideways.
- Swipe-to-remove in Now Playing no longer shows a thin red outline around the row on iPad.

## [0.1.1] - 2026-11-15

### Fixed
- The player page `/plugins/DaphileTouch/index.html` returned 404 after installing the plugin. LMS only serves `.html` files from plugin folders when a page handler is registered, so the plugin now registers one and returns the page as-is (also at `/plugins/DaphileTouch/`).

## [0.1.0] - 2026-11-15

First public preview.

- Now Playing as the main view; library browser slides out from the sidebar (Search, Recently Added, Artists, Albums, Songs, Folders, Playlists, Favorites).
- Add tracks or whole albums to the end of the queue; save the queue as a new playlist.
- Queue editing: long-press to reorder, swipe left to remove, clear button (disabled when the queue is empty).
- Favorites (heart) using the LMS Favorites plugin.
- Output device picker in the title bar and in the AirPlay button; works with any LMS player, including AirPlay devices via the AirPlay Bridge plugin.
- Mute button: greyed out for fixed-volume (bit-perfect) players; on other players mutes by setting volume to 0 and restores it afterwards.
- Light / dark theme switch, remembered per device.
- Version number shown under the theme switch.
