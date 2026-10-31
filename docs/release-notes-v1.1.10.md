# FrigateView Card v1.1.10 release notes

Changes since v1.1.9.

- **Per-camera startup audio:** Cameras can start unmuted automatically, with
  separate settings for PC/tablet and mobile-phone clients. A user's manual
  mute choice is remembered while navigating the dashboard. Browser autoplay
  permissions still apply where required.
- **Frigate go2rtc substreams:** Choose a configured camera substream for live
  playback. Events, snapshots, recordings, two-way talk, and PTZ continue to
  use the main camera.
- **Better Bubble Card sizing:** Short mobile popups preserve the two-event
  minimum when other cards appear above FrigateView Card, allowing the popup
  content to scroll instead of collapsing the event area.
- **More reliable mobile live playback:** Improved retained-camera switching,
  MSE fallback stability, and fullscreen entry and return. Companion App
  rotation fullscreen is limited to the environment where it can cover the
  complete display.

## Upgrade notes

Update through the existing **FrigateView Card** listing in HACS, then refresh
the browser. No custom-repository registration is required. For manual
installations, replace every file from `dist/` with files from this release; do
not mix companion or language files from different versions. The card type and
resource filename remain unchanged.
