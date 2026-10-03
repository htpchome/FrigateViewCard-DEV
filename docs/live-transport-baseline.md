# Live Transport Known-Good Baseline

## Current Baseline

`v1.1.8-dev.169` is a normal-HA-Direct provider-deck experiment based on the
`v1.1.8-dev.168` rollback point. Non-Catalyst HA Direct playback now creates one
stable `ha-camera-stream` provider per loaded camera and delegates HLS/WebRTC
selection, signaling, fallback, and child-player lifecycle to Home Assistant.
The card retains ownership only of creation order, permanent camera slots,
visibility, retention/release, snapshot presentation, and editor/layout
handoff. Mac Catalyst remains on its separate native HLS-only path. Physical
validation is required before this experiment replaces `v1.1.8-dev.168` as a
known-good rollback point.

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

`v1.1.8-dev.161` makes Mac Catalyst the single documented exception to the
configured transport boundary. On Catalyst, cameras configured for either
`frigate_go2rtc` or `ha_direct` resolve to the dedicated Home
Assistant-authenticated HLS path before startup; the selected primary player
uses native HLS. Catalyst therefore does not create or race the Frigate
WebRTC/MSE attempts, while the saved camera configuration remains unchanged.
Non-Catalyst clients still follow the selected connection mode without this
override.

`v1.1.8-dev.162` gave the initially selected Catalyst HLS player the same
media-failure recovery contract as players promoted from the background deck.
Physical testing found that this did not address the underlying page-layout
handoff: a moved native player could remain paused or fall back to a snapshot
until an unmute action called `play()`.

`v1.1.8-dev.163` coordinates Catalyst HLS with preserved page-layout changes.
Transient media errors are held while the live shell moves, then the selected
native player and every retained background player receive an explicit playback
resume after the new layout paints. A player that still cannot resume follows
the established failure/reconnect path. The authenticated HLS URLs and player
instances remain owned by the Catalyst deck throughout the handoff.

`v1.1.8-dev.164` extends the sequential warm-deck model to normal HA Direct
playback without merging transport modes. After the card shell gets its first
paint, cameras whose effective non-Catalyst mode is `ha_direct` establish Home
Assistant HLS sessions one at a time. Selecting a warmed camera displays its
already-live HLS player immediately while starting a WebRTC takeover attempt.
WebRTC remains preferred for the selected camera, and successful WebRTC
players stay retained when that camera is left.

Retained HLS custom elements are born inside the full-sized HA Direct deck and
are only shown or hidden there. They are never reparented after connection;
ordinary HLS players that were not created in that deck remain ineligible for
retention. A selected camera can promote an in-progress HLS warm-up, and
retained players remain reusable across camera and page changes. Cameras
configured for `frigate_go2rtc` are excluded from this deck even when the same
card contains both transport modes.

`v1.1.8-dev.165` makes each normal HA Direct background warm-up a sequential,
camera-scoped HLS/WebRTC race. A rendered WebRTC connection is the retained
winner; otherwise the already-ready HLS player remains retained. Selecting the
camera while its race is pending promotes that same pair into the visible mount.
Every candidate is bound to both its camera entity and mount generation, so a
late result cannot replace a newer camera selection. Retained HLS players are
also checked for advancing media time; a playlist session that stops advancing
is released and remounted instead of remaining stuck in Home Assistant's
playlist retry loop. On browsers that use Home Assistant's `ha-hls-player`, the
card disables Hls.js low-latency mode before the player loads its first
playlist. Standard HLS avoids the blocking `_HLS_msn`/`_HLS_part` request path
and its practical low concurrent-session limit while retaining Home Assistant
authentication and player ownership. Catalyst remains on its separate native
HLS path.

`v1.1.8-dev.166` keeps every retained HA Direct WebRTC video mounted and
playing at full size, but explicitly transparent while dormant. Adoption clears
that dormant presentation before moving the selected camera into the live
slot. A background camera completing its connection therefore cannot paint
over the selected camera.

`v1.1.8-dev.167` treats a matching request from an actual config-preview card
as sufficient editor-entry evidence. It also distinguishes an established HA
Direct WebRTC connection that is safe to transfer from one that is healthy
enough for unattended grace-pool retention. Editor reparenting may briefly
pause the video element while its peer connection and live track remain valid;
that transient presentation pause no longer rejects the transfer and starts a
new HLS-first race. Camera, transport, slot, Grid, Preview, and two-way-talk
eligibility checks remain in place.

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

- Non-Catalyst `frigate_go2rtc` connections are good. Preserve their established
  WebRTC/MSE startup, connection retention, camera-switch behavior, fallbacks,
  and two-way-talk behavior exactly unless a request explicitly targets this
  mode. Catalyst must resolve to its HA Direct HLS exception before any
  Frigate race is created.
- normal `ha_direct` playback is a stable Home Assistant `ha-camera-stream`
  provider. The active nested HLS or WebRTC player determines the displayed
  source label, and the card does not start a competing player or perform a
  later card-owned takeover.
- HA Direct two-way talk keeps its separate, explicit backchannel because the
  native receive-only provider does not own microphone publishing.

Do not change unrelated popup, fullscreen, iOS, aspect-ratio, resize, zoom, or
layout behavior while optimizing either transport.

## HA Direct Startup Contract

Preserve all of these behaviors together:

1. Create one `ha-camera-stream` provider for the selected HA Direct camera.
2. Set the camera state and preferred frontend stream type, then let Home
   Assistant create and manage the active HLS or WebRTC child player.
3. Keep the snapshot visible until the active Home Assistant player has usable
   video.
4. Do not create a parallel card-owned HLS player, RTCPeerConnection, signaling
   subscription, race, or takeover for normal HA Direct playback.
5. Create each provider inside a permanent, full-sized camera deck slot and
   retain it there across camera and page changes.
6. Hide and mute dormant providers without disconnecting their custom element.
7. Start background providers sequentially only after the selected provider is
   usable; wait for each background provider before starting the next one.
8. A newly selected camera preempts background work and promotes its existing
   provider when one is already loading or retained.
9. Preserve the explicit Catalyst native-HLS exception and the separate
   two-way-talk backchannel.

The card may observe the active nested player for readiness, source labels,
zoom, fullscreen, and recovery presentation, but Home Assistant remains the
owner of provider signaling and internal fallback behavior.

## HA Direct Two-Way-Talk Signaling

The former card-owned receive-only signaling path remains rollback history and
is not used by the normal `ha-camera-stream` provider. HA Direct two-way talk
still deliberately follows Home Assistant's frontend signaling behavior:

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
- `v1.1.8-dev.164` revisits the earlier retention conclusion without restoring
  custom-element reparenting. Normal HA Direct HLS players that participate in
  retention are created in a permanent full-sized deck slot, stay mounted
  there, and are shown or hidden in place. Background warm-up starts HLS rather
  than opening unnecessary receive-only WebRTC sessions for every camera.
- `v1.1.8-dev.165` extends normal HA Direct background warm-up to an owned
  HLS/WebRTC race and retains its best rendered connection. Visible takeover is
  permitted only while the candidate's camera entity and mount token still own
  the selected live view, retained engines are validated against that same
  entity identity, browser `ha-hls-player` instances use standard HLS rather
  than LL-HLS, and stalled retained HLS sessions are recycled.
- `v1.1.8-dev.166` makes dormant HA Direct WebRTC deck videos transparent and
  restores their visible presentation only when their entity is selected and
  adopted into the live slot.
- `v1.1.8-dev.167` lets a confirmed config-preview request claim a matching
  reusable WebRTC engine even if the dashboard donor has not yet observed the
  editor-open lifecycle transition, and permits the receiver to resume a
  transferred live WebRTC element after a transient editor reparent pause.
- `v1.1.8-dev.168` extends editor handoff from only the selected HA Direct
  camera to the donor card's retained per-camera WebRTC pool. Editor preview
  warm-up claims those established background connections before starting a
  new HLS/WebRTC race, preserves the selected camera's return target while the
  background cameras transfer, and keeps both pools available through the
  normal 20-second dashboard grace window for the reverse handoff on exit.
- `v1.1.8-dev.169` replaces that normal HA Direct card-owned HLS/WebRTC race
  with stable per-camera `ha-camera-stream` providers. Home Assistant owns the
  provider's transport selection and child-player lifecycle; the card owns the
  permanent provider deck, sequential warm-up, visibility, retention, snapshot
  presentation, and editor/layout ownership. Catalyst remains native HLS-only.

## Validation Expectations

Any future live-transport change must test the two connection modes separately
and must include physical checks for:

- first-picture time on WebRTC-capable and non-WebRTC clients;
- Home Assistant's selected WebRTC or HLS provider on the corresponding camera
  capability path;
- stable native-provider fallback when Home Assistant cannot complete WebRTC;
- retained WebRTC/MSE connection counts during fast camera switching, plus HA
  Direct HLS deck reuse without custom-element disconnect/reconnect callbacks;
- complete teardown without increasing connection or subscription counts;
- HA Direct two-way-talk incoming and outgoing audio;
- unchanged non-Catalyst `frigate_go2rtc` startup, fallback, switching, and talk
  behavior;
- Catalyst cameras configured for `frigate_go2rtc` use HA-authenticated HLS
  without starting Frigate WebRTC or MSE attempts.
