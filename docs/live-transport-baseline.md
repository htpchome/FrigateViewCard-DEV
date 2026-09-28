# Live Transport Known-Good Baseline

## Current Baseline

`v1.1.8-dev.65` remains the stable rollback point for live transport work. It
restores the behavior from `v1.1.8-dev.57` after reverting the Catalyst-native
Frigate go2rtc HLS/MP4 experiments from `v1.1.8-dev.58` through
`v1.1.8-dev.64`.

`v1.1.8-dev.69` is the HA Direct native-pipeline candidate. It replaces the
card-owned receive-only HLS/WebRTC race with Home Assistant's
`ha-camera-stream`, preloads that component stack, and retains each visited
camera provider in a connected full-size deck while the live view remains
mounted. Keep `v1.1.8-dev.65` available until this candidate completes physical
browser and Catalyst validation.

`v1.1.5-dev.63` established the original live connection baseline physically
tested on September 6, 2026. Later Mac Catalyst testing found that its HA Direct
HLS browser-player retention was not valid. `v1.1.7-dev.64` corrected that
lifecycle. `v1.1.7-dev.65` keeps the snapshot in place until fresh HLS has
presented a painted video frame and avoids applying the generic compositor
refresh transform to HA Direct HLS. Physical Catalyst validation remains
required.

- `frigate_go2rtc` connections are good. Preserve its established WebRTC/MSE
  startup, connection retention, camera-switch behavior, fallbacks, and
  two-way-talk behavior exactly unless a request explicitly targets this mode.
- `ha_direct` delegates HLS/WebRTC selection, negotiation, and promotion to
  Home Assistant's camera-stream component. The card owns presentation,
  connected-provider retention, snapshot fallback visibility, and controls.
- HA Direct two-way talk remains a separate peer and is not changed by the
  native receive-only pipeline.

Do not change unrelated popup, fullscreen, iOS, aspect-ratio, resize, zoom, or
layout behavior while optimizing either transport.

## HA Direct Startup Contract

Preserve all of these behaviors together:

1. Mount the raw Home Assistant camera entity through `ha-camera-stream`.
2. Let Home Assistant choose, start, and promote HLS/WebRTC. Do not create a
   second card-owned race around it.
3. Treat the visible leaf player's `loadeddata` state as first-picture
   readiness; keep the snapshot visible until then.
4. Lazily create a camera provider the first time that camera is selected.
5. Keep visited providers connected and full-size outside the viewport while
   another HA Direct camera is active. Do not reparent their inner players or
   place them in a 1x1 grace host.
6. Reuse the retained provider when returning to a camera and destroy the
   complete provider deck when live playback actually ends or changes to a
   different transport mode.
7. Use a one-way stream-selection mute latch: the first unmute may change HA's
   selected stream, but later muting changes only leaf audio and must not
   restart or downgrade playback.
8. Keep inactive providers muted so retained cameras cannot continue audible
   playback in the background.
9. Keep HA Direct two-way talk isolated from this receive-only lifecycle.

Home Assistant owns each retained camera-stream component and its inner player
lifecycle. The card may change which full-size provider is presented, but must
not disconnect or reparent a provider during an ordinary camera switch.

## HA Direct WebRTC Signaling

The `v1.1.5-dev.63` signaling path deliberately follows Home Assistant's
frontend behavior:

- receive transceivers are added in audio-then-video order;
- local ICE candidates already gathered by `setLocalDescription()` are
  included in the initial SDP offer;
- candidates gathered after the offer continue through
  `camera/webrtc/candidate` once the session ID exists;
- the signaling subscription remains non-resubscribing and is explicitly
  released by the owning engine.

HA Direct two-way talk keeps its separate peer connection and working media
shape. It also includes already-gathered local ICE candidates in the initial
offer. Do not change its transceiver/media layout merely to make it resemble
the receive-only live connection.

The card-owned signaling rules below remain relevant to HA Direct two-way talk
and to the `v1.1.8-dev.65` rollback path. Normal `v1.1.8-dev.69` HA Direct live
playback delegates receive-only signaling to Home Assistant.

## Relevant Development History

- `v1.1.5-dev.58` introduced a card-owned HA Direct WebRTC lifecycle with HLS
  fallback based on rendered media.
- `v1.1.5-dev.59` addressed orphaned WebRTC sessions, but its three-second
  first-track cutoff was too aggressive. That cutoff must not return.
- `v1.1.5-dev.60` raced WebRTC and HLS and retained winners, but a quick HLS win
  ended the WebRTC attempt before it could take over.
- `v1.1.5-dev.61` allowed WebRTC to replace provisional HLS, but treating HLS
  as provisional made the otherwise-fast HLS path feel slower.
- `v1.1.5-dev.62` established the current handoff: commit HLS as soon as it is
  ready while WebRTC continues as an owned pending takeover.
- `v1.1.5-dev.63` restored Home Assistant's audio/video ordering and initial
  ICE-candidate offer handling, and applied the initial-candidate optimization
  to HA Direct two-way talk without changing its media shape.
- `v1.1.7-dev.64` stopped grace-caching HA Direct HLS players after physical
  Catalyst testing showed that custom-element reparenting restarted playback
  and could leave video black while audio continued. HA Direct WebRTC and
  Frigate go2rtc retention remain unchanged.
- `v1.1.7-dev.65` made the HA Direct snapshot-to-HLS transition wait for
  presented-frame and paint-boundary evidence, preloaded replacement snapshots,
  and excluded HA Direct HLS from the generic video compositor refresh nudge.
- `v1.1.8-dev.68` preloaded Home Assistant's camera playback custom elements
  for configured HA Direct cameras.
- `v1.1.8-dev.69` adopted Home Assistant's native camera-stream pipeline,
  visible-leaf `loadeddata` readiness, connected full-size per-camera provider
  retention, and a separate output-mute latch.

## Validation Expectations

Any future live-transport change must test the two connection modes separately
and must include physical checks for:

- first-picture time on WebRTC-capable and non-WebRTC clients;
- eventual WebRTC takeover on a capable client;
- stable HLS playback when WebRTC cannot complete;
- retained WebRTC/MSE connection counts during fast camera switching and HA
  Direct provider reuse on return;
- complete teardown without increasing connection or subscription counts;
- HA Direct two-way-talk incoming and outgoing audio;
- unchanged `frigate_go2rtc` startup, fallback, switching, and talk behavior.
