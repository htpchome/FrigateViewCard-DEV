# Live Transport Known-Good Baseline

## Current Baseline

`v1.1.8-dev.193` restores the inline video's pre-PiP mute state when Catalyst
PiP closes via Close or Return, without suppressing native PiP audio. Live
controls are synchronized on return; closing PiP for a camera that is no longer
selected leaves that retained camera muted without changing the current camera. Popup media uses
the same opt-in restoration. Failed entry and controller disposal remove the
exit listeners. Other browsers, fullscreen audio, transport startup and HLS
foreground recovery are unchanged. Tests cover native-exit events and the
production bundle's Catalyst-only policy; physical Catalyst validation remains
required. The editor-retention test now waits for the independent card's full
sequential warm-up before counting failure-induced reconnects.

`v1.1.8-dev.192` requests a fresh HA HLS URL before restarting a previously
usable player emptied by HA's hidden-tab cleanup. Physical dev.191 testing
confirmed eventual recovery but reported two restart waves; a real-Hls.js
regression reproduces the expired-master fetch followed by a fresh-master fetch.
The explicitly approved, instance-local visibility adapter replaces only that
foreground restart, using HA's public URL update on the same retained player.
HA's hidden timer, short tab switches, picture-in-picture, cold startup and
engine ownership remain intact. Pending resumes are deduplicated; cached parent
metadata cannot cancel a URL retry, and hidden/stale responses cannot restart
released media. The existing five-second failure retry bound is unchanged.
Native listeners are restored on child replacement or disposal. WebRTC policy,
Catalyst, Frigate go2rtc, and view/editor session retention are unchanged.
Synthetic media tests check fresh-only master requests and decoded playback;
physical HA/go2rtc connection-count verification is still required.

`v1.1.8-dev.191` corrects the event-ordering defect missed by dev.190. Physical
Firefox diagnostics showed retained providers with no HLS child at all, while
failed WebRTC retries continued. HA emits missing-codec metadata before it
attaches MediaSource, but the parent evaluates its selector asynchronously,
after the cleared-video evidence is gone. The recovery owner now captures that
evidence at the child's `streams` event and associates it with the exact player
and status object until selection runs. No HA state, transport or player method
is patched. Success, child replacement and disposal clear the captured failure.
The browser harness now models deferred, coalesced HA rendering and reproduces
the missing-player failure on dev.190. Tests assert that the original HLS child
survives and resumes decoded video with HLS-only and blocked-WebRTC selection.
No new polling, retry timer, engine, or connection policy is introduced. Physical
HA background/foreground retesting is still required.

`v1.1.8-dev.190` addressed two normal HA Direct HLS recovery cases but did not
resolve the reported physical background-return loop: its synchronous selector
test harness missed the deferred-render failure corrected above. After background-tab
cleanup, HA may report missing stream codecs from an expired master before it
constructs Hls.js or emits an error; a previously usable, emptied player must
remain mounted as pending. Attaching a MediaSource and clearing the native error
does not by itself cancel the authenticated URL refresh. A failed manifest
startup also needs HA's public URL update lifecycle when HA returns the same URL:
Hls.js `startLoad` cannot reload a manifest that never parsed. This reuses the
same provider, HA child and video; HA disposes and recreates only its own failed
engine. Ordinary buffered interruptions keep HA's native retry behavior.
Recovery URL requests wait while the document is hidden and resume on return;
the existing five-second request bound and late-response guards remain.
Short background returns and healthy players are not restarted. WebRTC,
Catalyst, Frigate go2rtc, session ownership, and editor/view handoff are unchanged.
Tests exercise repeated hidden cleanup/return with expired masters and unparsed
manifests using real Hls.js and decoded synthetic media, both HLS-only and
blocked-WebRTC selection, including an unselected retained camera. Physical HA
background/foreground verification is still required.

`v1.1.8-dev.189` restores standard HLS for normal HA Direct's HA-owned Hls.js
players. A documented instance-local configuration adapter supplies
`lowLatencyMode: false` and filters LL-HLS playlist instructions before parsing.
This also prevents blocking `_HLS_msn`/`_HLS_part`/`_HLS_skip` reloads and partial
segment requests; setting the low-latency flag alone did not guarantee that.
Complete segments, authenticated URLs, discontinuities and HA's remaining
configuration are preserved. HA still owns its engine and recovery; the same
adapter applies when it constructs an engine again after URL recovery.
WebRTC selection, permanent provider retention, native-video playback, Catalyst,
Frigate go2rtc and other cards are unchanged. No global HA setting is required.
Tests use real Hls.js and decoded synthetic fMP4 media with an LL-advertising
playlist; retained-provider tests also verify the policy on initial construction
and recovery. Physical HA verification is still needed; unrelated HTTP errors
are not claimed fixed.

`v1.1.8-dev.188` corrects normal HA Direct's readiness reporting after buffering.
WebKit can emit `waiting` and then advance media time without another `playing`
event. While that player is pending, public `timeupdate` events may restore its
ready presentation only when the same active video advances with usable data,
is not paused/ended, and neither it nor the HA child reports an error. The
listener is removed on readiness, player replacement, or disposal. No polling,
new connection, transport restart, or retention-policy change is involved.
The restart recovery from dev.187, Catalyst, and Frigate go2rtc are unchanged.
Retention tests now assert the same video resumes instead of dereferencing a
temporarily absent presentation video. WebKit stress runs use two CPU cores
and two workers to reproduce the GitHub failures; fixture media events are
included in failure diagnostics. The synthetic MP4 server now honors byte-range
requests, preventing WebKit from rejecting test media during startup/recovery.

`v1.1.8-dev.187` keeps retryable HA HLS failures from removing the native child
before its own recovery runs. The selector treats the failed child as pending;
HA error clearing plus fresh video progress repairs stale failure metadata
without rewriting HA state. Recovery requests an authenticated URL for only
that camera, applies changed URLs through the native player's public input,
and deduplicates/rate-limits requests to five seconds. Failed URL requests retry
even if no further media errors arrive. Ready WebRTC takeover does not insert
an artificial loading state. Persistent media events track subsequent recovery,
including replacement videos inside the same HA player.

Catalyst retains its separate native HLS owner. Every native player, including
unselected retained cameras, handles error/ended recovery and silent stalls in
place; a ten-second no-progress check starts only after waiting/stalled events
or a recovery attempt. Healthy playback has no recovery polling. Failed URL
requests retry at five-second intervals; resumed playback cancels retries and
late URLs cannot overwrite it. Recovering players remain reusable across camera
and layout changes; the existing layout-transfer grace still defers recovery of
transient move errors until playback resumes after paint. No normal HA provider,
healthy camera, Frigate go2rtc path,
editor/save identity, or two-way-talk lifecycle is reset by this recovery.
Tests simulate interrupted media, stale URLs, backend unavailability, silent
background stalls, release, and recovery followed by WebRTC takeover. Physical
HA restart and Catalyst validation is still required.

`v1.1.8-dev.186` bounds normal HA Direct's native WebRTC retries while usable
HLS continues. An instance-local, read-only peer observer detects failed ICE
even when HA does not emit a parent stream-failure event. The selector keeps
HLS alone, letting HA remove and clean up the failed WebRTC child without
replacing the provider or HLS player. First failure uses a two-minute cooldown;
subsequent failures use five minutes. Only camera reselection after expiry
requests another native attempt, not a timer or same-camera page/editor handoff.
WebRTC media success resets the history; unusable HLS bypasses suppression.
Peer discovery waits for HA's asynchronous creation; no peer methods, native
handlers, signaling, or global prototypes are patched. Each camera is isolated.
Catalyst, Frigate go2rtc, sequential warm-up, and retention policy are unchanged.
Mobile startup also preloads enabled Preview code/styles without awaiting it or
activating Preview media/timers; Preview landing still waits for preparation.
Synthetic regression coverage includes native ICE restart loops and delayed
Preview downloads. Physical Firefox/VPN and cellular validation remains required.

`v1.1.8-dev.185` replaces indefinite Frigate go2rtc MSE preference with bounded,
camera-scoped WebRTC retry history in the owning card runtime. When MSE works
but a complete WebRTC attempt fails, fresh connections use only MSE for two
minutes, then retry WebRTC on the next reconnect. Further failed checks use a
five-minute cooldown. A camera with prior rendered WebRTC success gets one
additional fresh attempt before the first cooldown; any new WebRTC success
clears the failure count and cooldown. MSE playback never extends the deadline.
Cancelled, aborted, superseded, or layout-interrupted attempts are not failure
evidence. Failed MSE and explicit WebRTC requests bypass suppression. Expiration
does not create background probes or restart healthy retained connections.
History is bounded and in memory only; a new card runtime or page reload starts
fresh. Grace retention, eligible race timing, mobile hedging, HA Direct,
Catalyst, and two-way talk are unchanged. Tests cover retry boundaries, late
results, cancellation, and the built bundle's MSE-only reconnect behavior;
physical browser/VPN and go2rtc connection-count validation remains required.

`v1.1.8-dev.183` prevents remembered Frigate go2rtc MSE success from locking
later fresh connections to MSE alone. Only remembered WebRTC success uses the
single-transport startup shortcut; a remembered fallback runs the existing
WebRTC/MSE race again and permits the normal WebRTC takeover. Healthy retained
connections are not restarted. Explicit forced transports, mobile hedging,
race timings, HA Direct, Catalyst, and two-way talk are unchanged.

`v1.1.8-dev.182` keeps an in-progress Frigate go2rtc WebRTC/MSE race alive
when a page-layout change synchronously moves its preserved stream host. The
host checks at the next microtask whether it remains disconnected before
stopping its owned race. Genuine removal still releases the attempts, and an
old disconnect cannot stop a replacement race. This prevents navigation from
cancelling WebRTC and destroying a ready MSE candidate before adoption. Race
timings, established MSE fallback, HA Direct, Catalyst, and talk are unchanged.

`v1.1.8-dev.180` identifies the saved editor configuration before Home Assistant
rebuilds the dashboard card. A one-shot session handoff retains the camera
providers even while the old pre-editor card is still connected; unrelated
cards and websocket connections remain isolated. Regression coverage includes
changed configuration on Save, overlapping card/editor clients, per-camera
failure isolation, and HLS child disposal after WebRTC takeover. No transport
startup, Catalyst, Frigate go2rtc, or two-way-talk policy is changed.

HLS player disposal is distinct from HA's upstream stream lifetime. HA removes
and cleans up its HLS player when its selector keeps WebRTC alone. Its backend
stream worker expires through HA-owned idle/preload policy; stopping browser
playback does not provide a per-viewer API to force-close that shared upstream
connection. This change does not claim to eliminate the reported go2rtc
connection-count linger.

`v1.1.8-dev.179` reserves Wide View's selected camera connection for the main
stage. Its companion tile uses the configured snapshot refresh interval, even
when live companions or alert-driven live tiles are enabled. Camera switches
update the old and new selected tiles in place; unrelated companion media stays
mounted. The existing snapshot scheduler remains active in Wide View's live
companion mode. Provider creation, transport selection, and retention are unchanged.

`v1.1.8-dev.178` makes normal HA Direct Grid and Preview live tiles subscribers
of the existing retained session. The separate raw `ha-camera-stream` tile
factory is removed: it both duplicated WebRTC connections and bypassed the
verified HLS fallback. Each retained camera now owns an independently projected,
permanent application-root mount, allowing several cameras to appear in separate
tiles without moving their players. Grid pagination and tile cleanup change
presentation only; all providers remain connected. Cold Grid/Preview startup
uses the same sequential queue. Catalyst and Frigate go2rtc tile factories are
unchanged. Browser regressions exercise both transports, Grid entry from camera
1 or 3, pagination, Preview, return to Single View, and cold tile-page startup.
The separately reported HA low-latency HLS HTTP 400 responses are not claimed
fixed by this presentation change.

`v1.1.8-dev.177` addresses HA camera capabilities that advertise only WebRTC
even though the entity supplies an HA HLS stream source. The existing
instance-local selector adapter immediately makes one authenticated
`camera/stream` HLS request. A successful endpoint response permits HLS in
the selector inputs; a rejected or missing endpoint leaves HA's capabilities
unchanged. No ICE-failure event or artificial timeout is required. HA creates
and manages both child players, selects HLS while WebRTC is pending, and keeps
WebRTC alone when it becomes usable. The card does not create another player
or peer connection. The verification request and HA HLS player's own request
reuse HA's camera stream worker; they are not two card-owned HLS players.
Native HLS/WebRTC startup can overlap until HA selects usable WebRTC.
Permanent provider slots, session retention, Catalyst, Frigate go2rtc and
two-way talk are unchanged. Tests include WebRTC-only capabilities with
indefinitely pending and explicitly failed ICE, plus HLS-to-WebRTC promotion.

`v1.1.8-dev.176` fixes a production-build defect in `v1.1.8-dev.175`: the
declaration rewrite converted the mutable HA Direct session sequence to a
constant, throwing before the first provider could start. The build now uses
scope analysis to preserve `const` for fixed bindings and `let` for reassigned
ones. Generated-bundle binding checks and browser startup tests cover this
failure. No transport selection or retention policy changes are included.

`v1.1.8-dev.175` replaces normal HA Direct per-card pools and movable editor
handoffs with one persistent session per card. The session owns the camera
registry, sequential startup and readiness/transport subscriptions. Its deck
is mounted once under the owning `home-assistant` application root. Nested
Shadow DOM slot relays present it in the card, pre-editor or native editor
dialog without moving any provider, child player or video. Connected editor
clients keep the session alive after the original card is destroyed. Only a
session with no remaining clients receives a 20-second release timer.

HA still owns capabilities, authentication, HLS/WebRTC creation, signaling and
player internals. An explicit instance-local selector correction preserves
working HLS video when HA reports WebRTC failure but selects MJPEG while muted.
This defect was reproduced in upstream frontend 20260826.7 and 20260930.0.
Aside from the verified-HLS exception above, other HA selection decisions are
unchanged; there is no card-owned race or startup timeout. Catalyst, Frigate
go2rtc and two-way talk keep their existing transport owners.

Validation covers the pinned upstream selector, sequential/failure queues,
and real browser media advancing through replaced presentation clients and
native modals in Chromium, Firefox and WebKit. The browser HA provider harness
is synthetic: physical Home Assistant validation is still necessary and is not
claimed by those tests.

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
the normal HA Direct provider retention pool, and expired or evicted entries
are released through the Catalyst-only owner.

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
playlist. That implementation did not guarantee removal of blocking playlist
reloads: Hls.js can issue those even with low-latency playback disabled. The
dev.189 policy above restores the flag and filters LL delivery instructions.
Catalyst remains on its separate native HLS path.

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
2. Pass the unmodified Home Assistant camera state to the provider, then let
   Home Assistant query capabilities and create and manage its HLS/WebRTC child
   players. For WebRTC-only capabilities, immediately verify HLS through
   `camera/stream` once; enable the native HLS child only after HA supplies an
   endpoint. A stalled WebRTC connection must not prevent this verification.
3. Keep the snapshot visible until the selected HA child player has usable
   video. A hidden candidate failing is not whole-provider failure. When HA
   settles on its image fallback with no HLS verification pending, mark that
   camera failed and advance the queue without replacing or remounting its provider.
4. Do not create a parallel card-owned HLS player, RTCPeerConnection, signaling
   subscription, race, or takeover for normal HA Direct playback.
5. Create each provider inside its own permanent, full-sized application-root
   mount. Use camera-specific nested slot projection for main, tile and editor
   presentations. Never move the provider or its internal player, and never
   mount it under `document.body`.
6. Hide and mute dormant providers without disconnecting their custom element.
7. Start background providers sequentially only after the selected provider is
   usable; wait for each background provider before starting the next one.
8. A selected loaded camera uses its retained provider immediately. A queued
   selection moves to the front of the queue; finish the current startup first
   rather than disconnecting it or starting concurrent providers.
9. Preserve the explicit Catalyst native-HLS exception and the separate
   two-way-talk backchannel.
10. Do not fabricate `frontend_stream_type`, mutate HA's private HLS/WebRTC
    objects, extract the nested video, or run timeout-based provider recovery.
    Only the instance-local verified-HLS capability, muted-HLS selector,
    failed-WebRTC retry, retryable-HLS recovery (including the scoped foreground
    visibility adapter), and documented standard-HLS
    configuration corrections above are allowed;
    none affects HA's global
    components. Read-only native-peer observation may drive the bounded retry
    selector but must not patch player internals or own negotiation/teardown.

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
- `v1.1.8-dev.170` keeps the provider deck outside replaceable page shadow
  markup and projects it through a live-stage slot. Single, Mobile, Wide, Card,
  and Preview shell changes therefore leave every provider node connected. It
  also treats the native provider as editor-retainable whether Home Assistant's
  current child player is HLS or WebRTC. Editor handoff keeps the provider and
  HA connection in the permanent dashboard deck and lends only its plain video
  surface to the preview card, restoring that surface to the HA player when
  the editor returns it.
- `v1.1.8-dev.173` rejects that inner-video handoff and removes the obsolete
  card-owned HA Direct HLS/WebRTC implementation. The clean path passes the raw
  HA camera state into one `ha-camera-stream` and moves only the complete
  provider slot during cross-card editor ownership transfer. Physical testing
  rejected its interpretation of a hidden child player's `streams: false`
  event as failure of the complete provider and exposed ambiguous editor offers.
- `v1.1.8-dev.174` observes the frame presented by HA's currently visible child
  player after HA processes the child event and completes its provider render,
  rather than arbitrating child transport events. It therefore leaves HLS
  fallback under `ha-camera-stream` ownership when WebRTC is unavailable.
  Editor handoff also prefers the sole active provider over retained offers.

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
