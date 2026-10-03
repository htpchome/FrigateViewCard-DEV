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

`v1.1.8-dev.111` restores the HA Direct startup implementation from
`v1.1.8-dev.106`. The successive startup and takeover rewrites in
`v1.1.8-dev.107` through `v1.1.8-dev.110` were rejected by physical testing.
HA Direct once again starts HLS and WebRTC concurrently, commits the first
usable HLS picture immediately, and lets a ready WebRTC connection take over.

`v1.1.8-dev.145` separates Mac Catalyst from that normal HA Direct startup
controller. Catalyst uses a dedicated Home Assistant-authenticated native HLS
mount with no receive-only WebRTC creation, startup race, retained WebRTC
handoff, or later WebRTC takeover. Non-Catalyst HA Direct behavior retains the
established HLS/WebRTC race and takeover contract below.

`v1.1.8-dev.146` keeps that Catalyst-only orchestration boundary but replaces
the direct native video wrapper with Home Assistant's `ha-hls-player`, matching
the Frigate Modern Hass Card approach. The Catalyst connection remains HLS-only
and does not create or race a receive-only WebRTC player.

`v1.1.8-dev.147` keeps Catalyst isolated from normal HA Direct orchestration and
uses the authenticated Home Assistant `camera/stream` URL with the card's lazy
HLS.js asset. Low-latency mode is explicitly enabled for this Catalyst-only
experiment; other HA Direct clients and all Frigate go2rtc paths are unchanged.

`v1.1.8-dev.148` removes that LL-HLS/HLS.js experiment after physical testing
still showed smooth playback with the ordinary HLS delay. Catalyst keeps its
isolated HA Direct side path and explicit authenticated HLS request, but assigns
the resulting URL directly to a native video element. It still does not create
or race a WebRTC player.

`v1.1.8-dev.149` allows that native Catalyst HLS element to participate in the
existing editor live-handoff lifecycle. The established connection transfers
from the dashboard card into the config preview and between replacement preview
instances, while ownership of error and recovery handling follows the element.
Other HLS implementations remain ineligible for editor retention.

`v1.1.8-dev.150` keeps the one-second Catalyst loading snapshot refresh, but
decodes each replacement in a cloned image before atomically replacing the
displayed fallback. This keeps the previous snapshot painted during Chromium's
image update instead of exposing the cache-busted source change as a flash.

`v1.1.8-dev.152` removes the stricter Catalyst presented-frame gate added in
`v1.1.8-dev.151` because it could leave a viable native HLS connection on the
snapshot fallback without resolving the startup flash. Catalyst again uses the
`v1.1.8-dev.150` readiness and late-recovery behavior.

`v1.1.8-dev.153` gives Catalyst native HLS its own connection-grace pool. Up to
three ready native video connections remain eligible for reuse for 20 seconds
across camera switches and same-dashboard navigation. Catalyst stays outside
the normal HA Direct WebRTC retention pool, and expired or evicted entries are
released through the Catalyst-only owner.

`v1.1.8-dev.154` changes Catalyst camera-switch retention to match the retained
HA-player lifecycle used by Advanced Camera Card. A visited camera's native HLS
player remains mounted in a hidden card-local host, but is paused and changed
to metadata-only preload while unselected so the Frigate/go2rtc media demand
can become idle. Re-selecting the camera reactivates that same HA-facing player
before attempting a new `camera/stream` request. The retained-player pool is
bounded by the card's configured-camera limit and is released with the card;
normal HA Direct and Frigate go2rtc retention are unchanged.

`v1.1.8-dev.155` separates dormant HA-session retention from reuse of its
native HLS URL. The hidden player may continue retaining Home Assistant state,
but after the existing 20-second switch window Catalyst releases that aged URL
and requests a fresh one when the camera is selected. Reuse inside the window
must also demonstrate new playback progress within 3.5 seconds; a player that
only exposes old buffered readiness is replaced through the same fresh mount.
During either check the selected camera's snapshot remains visible and refreshes
instead of declaring the stale element to be live HLS.

`v1.1.8-dev.156` replaces that dormant Catalyst experiment with an intentionally
live Catalyst HLS deck. After the selected camera reaches its first usable paint,
the remaining configured HA Direct cameras warm sequentially in configuration
order. Selecting an unwarmed camera promotes or interrupts the current background
warm-up so the selection is never queued behind it. Successfully warmed native
HLS players remain mounted, muted, and playing until the card is torn down; this
trades ongoing bandwidth and decoder use for immediate return to visited or
prewarmed cameras. Other HA Direct clients and Frigate go2rtc remain unchanged.

`v1.1.8-dev.157` keeps the sequential Catalyst warm-up players in a full-sized
stack beneath the visible live player. The earlier offscreen one-pixel host could
be classified as non-visible media by WebKit, preventing Catalyst from starting
the background HLS requests until a camera was selected. The deck has no hidden,
transparent, or offscreen styling; the selected player and snapshot layers keep
it visually covered. Other clients and transports remain unchanged.

`v1.1.8-dev.158` routes live and popup fullscreen requests through Catalyst's
native video fullscreen API because its WKWebView does not reliably implement
element/document fullscreen. Live fullscreen resolves the selected engine video
before inspecting the surrounding stage, so a warmed player in the Catalyst deck
cannot become the fullscreen target. Safari and other clients retain their
existing fullscreen path.

`v1.1.8-dev.159` preserves the exact muted or unmuted state of Catalyst live and
popup video across native fullscreen. A Catalyst-only state guard reapplies the
pre-fullscreen value if the native player changes it during entry. An intentional
mute change made in the native fullscreen controls is then carried back to the
live or popup video on exit. Other clients retain their existing audio and
fullscreen behavior.

`v1.1.8-dev.160` extends that Catalyst-only mute guard across the asynchronous
native fullscreen transition. Muted entry also holds the media volume at zero
through that one-second transition window because Catalyst can initialize its
native presentation after the synchronous fullscreen request. Once entry is
settled, native mute changes are accepted and still carried back on exit.

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
- HA Direct WebRTC takeover and HA Direct two-way-talk negotiation work, but
  remain slower than desired. This is accepted for this baseline. Treat faster
  negotiation as deferred optimization, not an active defect requiring a
  speculative change.

Do not change unrelated popup, fullscreen, iOS, aspect-ratio, resize, zoom, or
layout behavior while optimizing either transport.

## HA Direct Startup Contract

Preserve all of these behaviors together:

1. Start HLS and WebRTC asynchronously for a WebRTC-capable HA Direct camera.
2. Commit ready HLS immediately; do not delay the first picture while waiting
   for WebRTC.
3. Keep the pending WebRTC attempt explicitly owned after HLS is committed.
4. Replace HLS only after WebRTC has rendered usable media.
5. Release HLS after a successful WebRTC takeover.
6. If WebRTC fails, keep the already-playing HLS connection.
7. When the camera changes, cancel the pending takeover before retaining or
   releasing the current HLS engine so no WebRTC session is orphaned.
8. Preserve card-owned HA Direct WebRTC retention and reuse across camera
   switches. Do not retain or reparent Home Assistant's `ha-hls-player` custom
   element; release it on departure and create a fresh player on return.
9. On browsers where WebRTC is unavailable or cannot complete, use HA HLS and
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
