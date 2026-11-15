# Changelog

All notable changes to this project are documented here.
Versions follow [Semantic Versioning](https://semver.org/).

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
