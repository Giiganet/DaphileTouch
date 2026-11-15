# Changelog

All notable changes to this project are documented here.
Versions follow [Semantic Versioning](https://semver.org/).

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
