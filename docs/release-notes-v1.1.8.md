# FrigateView Card v1.1.8 release notes draft

Changes since v1.1.7. Draft for review before release.

This release combines substantial loading optimizations with updated HA Direct
playback, Home Assistant Mac app support, new camera controls, and layout and
usability improvements.

## Loading and performance

- **Code split into on-demand features:** Major views, Grid, Slideshow, PTZ,
  recording tools, Picture-in-Picture, and other optional controls now load
  separately when needed. Feature styles and language catalogs also load
  separately, keeping unused features out of the initial startup work.
- **Leaner core:** Removed unused code and dependencies, reduced duplicate
  styles and icons, and improved asset minification. The main JavaScript bundle
  is approximately **43% smaller than v1.1.7**—1.80 MB down to 1.02 MB before
  compression. This compares the main file, not the total installation size.
- **Better startup scheduling:** Nonessential mobile background work is
  deferred, while enabled Preview resources load early without delaying the
  landing camera. Disabling the calendar skips its activity prefetch.

## Live playback

- **Retained HA Direct connections:** HA Direct cameras start one at a time on
  card load, prioritizing the selected camera. Live connections are shared
  across views, live Grid and Preview tiles, dashboard editing, and configuration
  preview, including the return after Save.
- **WebRTC with HLS fallback:** HA Direct prefers usable WebRTC and supports
  standard HLS when WebRTC cannot connect. Improved recovery after background
  tabs and Frigate/go2rtc restarts, with fewer repeated failed WebRTC attempts.
- **Dedicated Mac app playback:** The Home Assistant Mac app (Catalyst) uses
  retained native HLS connections for both connection settings. Fullscreen,
  pinch gestures, and mute handling are improved; closing Picture-in-Picture
  restores the previous inline mute state.
- **Frigate go2rtc remains on demand:** Cameras connect when selected or shown
  in a live multi-camera view. Navigation during startup is more reliable, and
  failed WebRTC retries are limited without permanently locking cameras to MSE.

## New controls and layout options

- **Camera suspend and resume:** Control supported Frigate cameras from the
  live view, with confirmation dialogs and an Admin Only, Everyone, or Disabled
  setting. Admin Only is the default. Suspension stops Frigate processing,
  recording, and detection—not camera SD-card recording or direct go2rtc access.
  Existing media remains available, and a Frigate restart lifts the suspension.
- **Wide View width presets:** Choose Half Width, In-Between, Max Width, or a
  custom width. Companion cameras and browse controls adapt more reliably as
  available space changes.
- **Improved Timeline resizing:** Opens at its minimum width and can be dragged
  over the browse area once that area's minimum width is reached.
- **Snapshot refresh:** New 2-second and 5-second intervals for snapshot tiles.
- **Editor feedback:** Section titles highlight unsaved changes, not open
  sections. Pre-roll/post-roll durations update immediately in the preview.

## Media and usability

- Recording timelines mark missing footage, with improved seeking and segment
  selection across gaps. Alert playback and media actions resolve the matching
  event more reliably.
- Reduced snapshot-refresh flashing in Chrome and improved camera online
  indicators and mobile stream-source badges.
- Corrected footer visibility, browse-area sizing, Sections navigation, and
  constrained 4:3 camera resizing. Preview light controls are centered without
  adding extra metadata height.
- Wide View shows a refreshing snapshot for the selected camera's companion
  tile, reserving its retained live connection for the main view.

## Upgrade notes

- Retained HA Direct and Catalyst streams use ongoing bandwidth and decoder
  resources, including for cameras not currently selected.
- Wide View defaults to Max Width when no explicit width setting is saved.
- **Manual installations:** Update all companion and language files from the
  same release, not just the main JavaScript file. Keep them together in the
  existing resource folder, then refresh the browser. The card type and resource
  filename remain unchanged.
