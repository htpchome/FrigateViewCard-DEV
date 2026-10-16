# FrigateView Card v1.1.9 release notes

Changes since v1.1.8.

- **HA Direct recovery:** Cameras previously connected through WebRTC recover
  after Frigate/go2rtc outages, using HLS while WebRTC reconnects when available.
- **Accurate camera status:** Clear stale online dots and stream-source labels
  when the selected camera's live connection is no longer healthy.
- **Live video zoom:** Restore zoom input on HA Direct video and correct
  mouse-wheel zoom handling in Microsoft Edge on Windows.
- **Scrollable companion cameras:** Wide View's companion camera grid scrolls
  when the tiles exceed the available height, keeping its heading and resize
  controls accessible.
- **Notification links:** Prevent a stack overflow when a review points to an
  unavailable event, while allowing a later refresh to open the event if it
  becomes available. Thanks to [@beaugunderson](https://github.com/beaugunderson)
  for the fix and regression tests in
  [PR #11](https://github.com/htpchome/FrigateViewCard/pull/11).

## Upgrade notes

Update through HACS, then refresh the browser. For manual installations, replace
all files from `dist/` with those from this release; do not mix companion or
language files from different versions. The card type and resource filename
remain unchanged.
