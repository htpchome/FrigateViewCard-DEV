# Live Transport Known-Good Baseline

## Current Baseline

`v1.1.8-dev.70` restores the `v1.1.8-dev.68` HA Direct pipeline after physical
testing rejected the native `ha-camera-stream` provider-deck experiment in
`v1.1.8-dev.69`. The experiment was no faster in browsers and left Mac Catalyst
on the snapshot instead of live HLS. Begin further HA Direct optimization from
`v1.1.8-dev.70` and preserve the transport contracts below.

`v1.1.8-dev.71` is a candidate latency/presentation improvement and does not
replace the physical fallback point until browser and Mac Catalyst validation.
It refreshes the visible HA camera snapshot once per second while HA Direct is
negotiating, and allows a fresh Home Assistant HLS player to replace that image
at its native `loadeddata` boundary. WebRTC takeover and post-failure HLS
recovery retain their stronger presented-frame checks.

`v1.1.8-dev.89` prevents connected, resize, and intersection recovery callbacks
from replacing an HA Direct mount while its first usable media is still
starting. Mount ownership now remains active until HLS or the alternate HA
player is committed, fails, or is cancelled. A later optional takeover remains
independent after HLS has committed. This removes the repeated initial player
construction and teardown recorded by the `v1.1.8-dev.88` diagnostics without
changing transport selection or retaining HLS players across camera switches.

`v1.1.8-dev.90` was rejected by physical testing and reverted. Its HLS-first
rewrite improved connection start time, but playback was choppy on iPhone and
delayed and choppy on Mac Safari. Catalyst playback was comparatively smooth,
with the expected HLS delay.

`v1.1.8-dev.91` begins from the restored `v1.1.8-dev.89` pipeline. For HA
Direct HLS on iOS, Mac Catalyst, and Safari, it requests the authenticated HLS
URL through Home Assistant's `camera/stream` WebSocket command and assigns it
directly to a native video element. This bypasses Home Assistant's hls.js
selection on Apple clients without changing the HA Direct takeover, retention,
two-way-talk, Frigate go2rtc, or non-Apple playback paths.

`v1.1.8-dev.109` corrects the candidate deterministic startup introduced in
`v1.1.8-dev.108`. HA Direct starts HLS without issuing a WebRTC offer. A
rendered HLS stream starts the optional WebRTC upgrade. An HLS readiness timeout
can start WebRTC, but it does not classify the still-running HLS player as a
Snapshot connection. HLS recovery remains active, and Snapshot is published
only for an explicit HLS failure or after both startup transports fail. Mac
Catalyst remains a native-HLS-only pipeline and does not create or signal a
WebRTC attempt.

`v1.1.8-dev.110` makes Home Assistant's advertised camera stream type the
authority for WebRTC eligibility. An HA Direct camera whose current
`frontend_stream_type` is `hls` never creates a `camera/webrtc/offer`
subscription, never adopts a cached WebRTC engine, and never accepts an editor
or dashboard WebRTC handoff. If an active camera stops advertising WebRTC, its
existing WebRTC session is released and the camera remounts through HLS.

`v1.1.8-dev.65` remains the fallback point predating HA playback-component
preloading. It restores the behavior from `v1.1.8-dev.57` after reverting the
Catalyst-native Frigate go2rtc HLS/MP4 experiments from `v1.1.8-dev.58` through
`v1.1.8-dev.64`.

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
- `ha_direct` HLS supplies the first picture nearly
  immediately, a capable WebRTC connection may take over when ready, retained
  WebRTC connections are reused, and browsers that cannot complete WebRTC
  remain on HLS.
- HA Direct WebRTC takeover and HA Direct two-way-talk negotiation can take
  several seconds. Keep ordinary live startup on HLS while that negotiation
  runs so WebRTC latency cannot delay the first picture.

Do not change unrelated popup, fullscreen, iOS, aspect-ratio, resize, zoom, or
layout behavior while optimizing either transport.

## HA Direct Startup Contract

Preserve all of these behaviors together:

1. Start HLS alone for a WebRTC-capable HA Direct camera.
2. Commit ready HLS immediately, then begin the optional WebRTC upgrade.
3. If HLS reaches its readiness timeout, begin WebRTC without publishing a
   Snapshot state or cancelling HLS recovery.
4. Never attempt WebRTC in the Mac Catalyst HA Direct pipeline.
5. Never attempt or retain WebRTC unless the camera currently advertises
   `frontend_stream_type: web_rtc` (or `webrtc`).
6. Keep the pending WebRTC attempt explicitly owned by HLS.
7. Replace HLS only after WebRTC has rendered usable media.
8. Release HLS after a successful WebRTC takeover.
9. If WebRTC fails, keep the already-playing HLS connection.
10. When the camera changes, cancel the pending takeover before retaining or
   releasing the current HLS engine so no WebRTC session is orphaned.
11. Preserve card-owned HA Direct WebRTC retention and reuse across camera
   switches. Do not retain or reparent Home Assistant's `ha-hls-player` custom
   element; release it on departure and create a fresh player on return.
12. On browsers where WebRTC is unavailable or cannot complete, use HA HLS and
   do not force the stream down to snapshots while HLS is viable.

Home Assistant owns the HA Direct HLS player lifecycle. Removing or reparenting
`ha-hls-player` invokes its disconnect cleanup, which destroys browser-side HLS
playback. The card must therefore keep the snapshot visible while a fresh HLS
player starts and hide it only after rendered-media readiness. Home Assistant
may independently keep its backend camera stream warm; that backend reuse must
not be simulated by caching the browser custom element.

Do not add a short WebRTC selection cutoff. A prior three-second first-track
cutoff rejected connections that would have succeeded and caused the wrong
transport to win.

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

Future latency work should first measure the time spent in client-config
fetching, offer/session/answer signaling, ICE connection, and first rendered
media. Do not change selection timers or fallback policy without evidence that
one of those policies is the cause.

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
  for configured HA Direct cameras without changing the working direct-HLS and
  card-owned WebRTC race.
- `v1.1.8-dev.69` was rejected by physical testing. Its retained native
  `ha-camera-stream` provider deck did not improve browser startup and failed to
  advance Mac Catalyst beyond the snapshot.
- `v1.1.8-dev.70` restores the `v1.1.8-dev.68` transport implementation and is
  the new baseline for measured, incremental HA Direct latency work.
- `v1.1.8-dev.71` matches Home Assistant/Advanced Camera Card's fresh-HLS
  `loadeddata` handoff and keeps the fallback camera image updating during
  negotiation. It does not retain or reparent HA HLS elements and does not
  weaken WebRTC takeover or failed-HLS recovery readiness.

## Validation Expectations

Any future live-transport change must test the two connection modes separately
and must include physical checks for:

- first-picture time on WebRTC-capable and non-WebRTC clients;
- eventual WebRTC takeover on a capable client;
- stable HLS playback when WebRTC cannot complete;
- retained WebRTC/MSE connection counts during fast camera switching and fresh
  HA Direct HLS player creation on return;
- complete teardown without increasing connection or subscription counts;
- HA Direct two-way-talk incoming and outgoing audio;
- unchanged `frigate_go2rtc` startup, fallback, switching, and talk behavior.
