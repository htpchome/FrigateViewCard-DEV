# Live Transport Known-Good Baseline

## Current Baseline

`v1.1.10-dev.46` fixes a stale-denial handoff in the selected startup-audio
owner. Physical iOS Companion testing of dev.45 showed that disabling the
WKWebView audio user-action requirement allowed startup audio, while the normal
setting still required a tap. The ACC comparison then exposed a state mismatch:
after an early audible request was denied, the shared playback owner cleared
its denial for ACC's later media-loaded action, but the adopted-camera attempt
retained a second `blocked` value. `resolveStartupMuted()` therefore forced that
later action back to muted even though it was specifically the retry that ACC
permits after muted playback has started. The startup owner remains the source
of truth for its denial and clears it only for the one loaded-media action;
manual mute, hidden-page, camera-identity and cancellation guards remain
unchanged. A regression reproduces early `NotAllowedError`, successful muted
playback, adoption before data, and an unmuted loaded-media retry.

`v1.1.10-dev.45` removes the remaining WebKit-visible differences from ACC
8.1.0's selected-media startup sequence. Physical Safari and iOS Companion
testing rejected dev.44: startup still required a tap. A corrected production
call trace showed that ACC acts once after render and once on its media-loaded
event, with asynchronous controller boundaries between unmute and play.
FrigateView additionally acted at source attachment, `loadedmetadata`,
`canplay`, and sometimes again during committed-player adoption. Its HA Direct
path also suppressed ACC's first action until media data existed. Those extra
actions and the HA data gate are removed. Both transports now retain ACC's
pre-data unmute/play action and one loaded-data reassertion. The selected helper
preserves ACC's asynchronous unmute/play boundaries; general playback recovery
keeps its existing readiness retries.

`v1.1.10-dev.44` follows the complete Advanced Camera Card 8.1.0 action trace
rather than copying only its mute state. ACC creates its selected go2rtc video
muted, then its carousel controller immediately calls `unmute()` followed by
`play()` while transport negotiation is still underway and independently
repeats that action on its media-loaded event. FrigateView now gives exactly one
selected go2rtc race candidate the same pre-source and loaded-media actions.
Other candidates retain ordinary muted autoplay, and adoption of an already
audible owner does not add a third request. HA Direct keeps audio-capable stream
selection separate from output: the child loads output-muted with autoplay
held, then receives unmute-before-play at loaded data. Denial still falls back
to muted playback and interaction recovery. No transport delay, reconnect,
simulated gesture or Web Audio path is added.

Physical Safari and iOS Companion testing later showed dev.44 still required a
tap. Its remaining source/readiness/adoption playback actions and HA Direct
data gate were not present in ACC and could alter WebKit's decision before the
real loaded-data action; dev.45 removes those mismatches.

`v1.1.10-dev.43` attempted to carry ACC's selected-output state across the
source-attachment boundary while deliberately omitting ACC's early `play()`
request. Physical Safari and iOS Companion testing showed no improvement. Its
premise that pre-source unmute alone was sufficient was therefore rejected;
dev.44 replaces it with ACC's complete selected-media action sequence.

`v1.1.10-dev.42` corrects the remaining ordering mismatch found through direct
comparison with Advanced Camera Card 8.1.0. ACC invokes its selected action
early, but its provider exposes no media-player controller until media has
loaded, so that early action cannot issue `play()`. Its first effective audible
request is the `media:loaded` unmute-before-play action. FrigateView's raw video
is available earlier, so dev.41 incorrectly made an effective audible request
while `readyState < HAVE_CURRENT_DATA`; Safari can deny that request before the
intended loaded-media action. Native autoplay remains held before attachment or
provider connection, while the selected output now waits for loaded data before
its first unmuted play request. Connection, negotiation and decoding remain
eager and unchanged.

`v1.1.10-dev.41` corrects two remaining differences from Advanced Camera Card
8.1.0's selected-media lifecycle. A configured-unmuted go2rtc WebRTC video is
now given its startup owner and has native autoplay disabled before it enters
the document; previously it was inserted with autoplay enabled and only then
disabled, allowing WebKit to establish an unintended muted playback session.
HA Direct likewise holds the provider's public autoplay input before the
provider is connected. Once the selected output exists, the shared audio owner
performs ACC's immediate unmute-before-play action and independently repeats it
when loaded data arrives. An interrupted source keeps the audio intent for that
loaded-media action; an actual audible-autoplay denial still resumes muted
playback and retains interaction recovery. Source connection, transport racing,
decoding and muted-camera startup are not delayed.

`v1.1.10-dev.36` corrects the actual first-play mismatch with Advanced Camera
Card. ACC lets a selected provider load without playing; its media-loaded event
first commits the visible surface, then the selected-media action unmutes and
plays it. FrigateView previously made an audible request while go2rtc candidates
were still in hidden race slots, and HA Direct could do the same before its
selected child was handed to the visible audio owner. Safari rejected that
hidden audible request, after which the card deliberately established muted
playback. The later visible unmute therefore required a tap.

Configured-unmuted go2rtc candidates now load without playing and use loaded
media—not advancing muted playback—as their startup readiness boundary. After
the winner is visibly adopted, its first play request is unmuted. HA Direct
holds the selected native child's autoplay before its initial render, reports
that loaded child to the visible audio owner, and follows the same first-play
ordering. A real audible-autoplay denial still falls back to muted playback and
the existing interaction recovery. Ordinary muted startup, Preview, stream
selection, race preference, source negotiation and video loading remain eager
and unchanged. The rejected dev.35 early-route activation has been removed.
Physical Safari and Companion verification remains required.

`v1.1.10-dev.35` moved configured-unmuted Mobile View and live Single View
activation ahead of the shared preparation barrier. Physical Safari and
Companion testing showed no improvement, disproving that startup-barrier theory;
dev.36 removes the behavior and restores the established route startup order.

`v1.1.10-dev.34` corrects the two-phase selected-media lifecycle found by
tracing Advanced Camera Card. ACC does not synthesize a click or user
activation. It applies the selected target's audio/play action immediately and
then independently repeats that action from its media-loaded handler. The
previous FrigateView implementation marked a resolved immediate play complete,
which suppressed its claimed loaded-media reapply; physical Safari and
Companion testing therefore showed no change. Frigate go2rtc and HA Direct now
make both requests even when WebKit resolves the first request. HA's native
autoplay remains held until startup ownership is handed back so it cannot race
between those two actions. Source connection and decoding are not delayed. A
denied audible request still retries muted immediately and retains
first-interaction recovery. Physical Safari and Companion verification remains
required.

`v1.1.10-dev.33` attempted only the loaded-media half of that lifecycle. It
kept output muted during eager loading and performed the paired unmute/play
operation at the loaded-data boundary. Physical Safari and Companion testing
showed no improvement, so dev.34 restores the immediate target action and makes
the loaded-media action genuinely independent of its result.

`v1.1.10-dev.32` corrects the remaining cold-load difference from Advanced
Camera Card. On a hard load, ACC marks the selected visible output unmuted
before source attachment, leaves autoplay off, and makes its first play request
only when that player reports loaded data. The previous implementation instead
allowed muted autoplay to establish the first Safari playback session and tried
to promote it later; physical Safari and Companion testing showed that this
still required a tap even though later dashboard navigation could unmute. The
selected Frigate go2rtc and HA Direct startup paths now use ACC's actual
boundary: source connection and decoding begin immediately, the selected output
uses eager preload, is unmuted before the source's first play, and `loadeddata`
triggers that play.
An audible-autoplay denial immediately retries muted and retains the existing
first-interaction recovery. No timer, transport retry, extra connection,
`defaultMuted` rewrite, dormant-player unmute, or Preview audio change is
included. Physical Safari and Companion testing still required a tap because
this revision unmuted during loading rather than at ACC's loaded-media action;
dev.33 replaces that ordering.

`v1.1.10-dev.31` replaces the card-owned audible-first startup sequence with
an attempted selected-media lifecycle based on Advanced Camera Card. Frigate go2rtc
now performs ordinary muted startup; only after the winning video is committed
does the audio controller change that video's output mute and request play. It
does not disable autoplay, rewrite `defaultMuted`, or synchronize racing and
dormant candidates. HA Direct now keeps stream-selection intent separate from
visible output mute: a selected camera configured for startup audio asks HA for
the audio-capable stream while its visible child starts output-muted, then the
same selected-media action unmutes it after ready. Once HA audio has been
selected, later output mute does not downgrade the provider to an audio-less
stream. However, it still allowed the visible player to establish muted autoplay
before the unmute request. Physical Safari and Companion testing reported no
improvement on a hard load, so dev.32 replaces that ordering. An audible-play
denial still restores muted playback and retains the
existing first-interaction fallback; registering that fallback does not cancel
or replace automatic startup. Preview and hidden players remain muted.

`v1.1.10-dev.28` makes Preview an explicit muted-audio boundary. Entering
Preview cancels any pending selected-camera audible startup and mutes the
retained primary player before Preview snapshot or live tiles take ownership.
This prevents configured or manually unmuted audio from continuing behind
Preview. Preview live tiles remain muted, and leaving Preview can still prepare
the selected camera's configured startup-audio preference for its destination.

`v1.1.10-dev.27` keeps defensive two-way-talk cleanup from muting live audio
when no talk session exists. Mobile View and Card View perform that cleanup on
route activation; treating the empty cleanup as a real talk shutdown canceled
the selected camera's pending `start_unmuted` preference before transport
startup. Active talk sessions still mute incoming audio when stopped. Preview
tiles remain hardcoded muted.

`v1.1.10-dev.26` restores the per-camera startup-audio preference at page
ownership boundaries. Mobile View and Card View now reapply the preference
after their primary live mount settles, while ordinary page-shell handoffs
reapply it to an already retained selected player. Leaving Preview explicitly
prepares the selected camera before its retained-or-fresh primary player is
resumed; Preview tiles themselves remain hardcoded muted. Single View, Wide
View, and Mobile View can therefore honor the configured preference after a
Preview exit. Manual mute state, Grid media, background players, and transport
selection are unchanged.

`v1.1.10-dev.25` defers the initial selected audible request until loaded data,
not just the later selected-player retry. Receive-only go2rtc WebRTC gathers
received tracks once the peer connects, assigns one stream, and adds late tracks
without replacing that stream. Explicit-muted, microphone/talk, MSE and go2rtc
HLS startup paths retain their existing sequencing. Normal HA Direct temporarily
disables the active child's public autoplay inputs while its initial audible
request is owned by the card; playing, cancellation, replacement and disposal
restore HA's original inputs. Hidden candidates continue preloading muted.
Native HA source selection, signaling and teardown remain HA-owned.

The group audio synchronizer previously searched the engine container before
the committed player, including when no group was active. A browser test caught
it requesting audible playback on a hidden HLS candidate during WebRTC startup.
Primary audio synchronization now targets the selected HA child or committed
go2rtc video. Background candidates cannot steal that startup request. No layout,
retention identity, manual mute control, microphone permission or Catalyst
lifecycle change is included. Navigation still retains a manually chosen mute
state; it is not equivalent to a cold start. Automated sequencing checks and
synthetic-audio comparisons do not establish physical Safari/Companion success;
this version still requires real-client confirmation.

`v1.1.10-dev.24` gates the selected-player auto-unmute attempt on actual media
readiness (`readyState >= HAVE_CURRENT_DATA`). Transport adoption is not that
boundary: a synthetic-audio WebRTC comparison reproduced the production go2rtc
mounter adopting in WebKit while its video still reported `readyState = 0`.
The previous loaded-player attempt was rejected there, then ignored the real
`loadeddata` transition. The same controller with adoption after `playing`
unmuted successfully. The controller now keeps that attempt pending until
loaded data/canplay readiness; early notifications do not consume its retry
budget. Manual mute, camera changes, hidden documents and disposal still guard
the pending work. This does not alter transport adoption, peers, source
assignment, native HA autoplay, the mute button, or layout. Physical Safari
(desktop and iPhone) and Companion testing reported no improvement.

`v1.1.10-dev.23` reapplies the configured audio preference when the selected
player becomes usable, even after an early startup autoplay denial. It retires
the initial-playback handler before the loaded-player unmute/play attempt so
an old rejection cannot remute the selected player. A first usable audio
capability arriving after video readiness permits one additional attempt;
read-only stream/receiver/track listeners observe that transition without
polling, reconnecting or changing transport selection. Repeated buffering and
readiness events cannot loop denied autoplay. Manual mute, camera changes,
replacement and disposal cancel automatic work; hidden documents cannot retry.
The existing mute button remains visible. Catalyst's separate native lifecycle
is unchanged. Synthetic policy tests cover early denial followed by allowed
loaded playback. Physical iPhone Safari/Companion testing reported no improvement;
this version is not a verified fix for first-camera audible startup.

For audio investigations, do not treat the silent synthetic videos used by the
layout/lifecycle suite, or startup invoked through `page.evaluate`, as proof of
gesture-free audible playback. The test driver can supply user activation.
`node tests/diagnostics/compare-startup-audio.mjs /path/to/acc-source file`
(or `webrtc`) runs ACC's actual media-actions/video controllers alongside this
card's live-audio controller using a synthetic tone and video. The WebRTC run
also exercises the production Frigate go2rtc mounter/frame-readiness code with
local synthetic signaling and no public STUN. Receivers start
from page scripts and report over HTTP without test-driver evaluation; the
WebRTC sender runs in a separate browser. The script asserts no receiver user
activation and reports playback decisions, decoded-media evidence and received
audio statistics. It requires an existing ACC source checkout and never accesses
live cameras. This is a controller-level experiment, not full native HA/ACC
integration or an iPhone/Companion reproduction. Missing decoded frames or audio
statistics must not be reported as a passing WebRTC/audio comparison, and
received audio energy alone does not prove speaker output.

`v1.1.10-dev.22` moves the selected camera's startup audio intent ahead of
initial playback. Frigate go2rtc WebRTC/MSE/HLS uses a tracked first play request;
only one racing candidate can request audio. Normal HA Direct passes the
selected camera's public `muted` input before creating native child players,
and observes a play request before waiting for first-frame readiness. An audible
autoplay denial immediately retries muted video and leaves the existing
mute/unmute button and interaction retry available. Hidden/background cameras
start muted. Camera changes, manual overrides and disposal cancel stale startup
audio work. Native HA still owns sources, transport selection and peers.
No microphone access, extra audio control or pause/unmute/play sequence is added;
Catalyst's separate startup and background recovery remain unchanged.
Automated startup-order and denial coverage does not establish physical iPhone
Safari/Companion success. Physical testing reported no improvement; the early
denial latch still prevented the selected-player loaded-media attempt.

`v1.1.10-dev.21` makes startup audio a single tracked play request after
synchronous unmute, without the manual control's delayed playback calls.
Only `NotAllowedError` resumes muted playback and defers to the existing user
interaction handler. Other startup rejections preserve audio intent and permit
up to two retries on media readiness or a subsequent selected-stream readiness
notification. Pending requests are coalesced; denial cannot create a retry loop.
Camera changes, manual mute and disposal remove readiness listeners, and hidden
documents cannot trigger automatic retries. HA's selected-child audio restoration,
transport startup/selection, retention, Catalyst background recovery and layouts
are unchanged. Physical iPhone Safari/Companion validation remains required;
this does not bypass browser autoplay permissions. Physical iPhone testing
reported no improvement; its late unmute did not cover the first playback request.

`v1.1.10-dev.20` adds background audio suspension to Catalyst native HLS.
Document visibility/page lifecycle events synchronously mute native videos,
including retained and tile players, cancel recovery timers and invalidate late
URL responses without unloading existing streams. Foreground return reapplies
the selected camera's startup audio preference once usable playback resumes;
dormant players stay muted. A single 1.5-second maximum progress
check retains advancing playback, ending early on success. Only emptied, failed
or stalled players request fresh HA URLs on the same native element. Re-hiding
and release cancel verification; there is no ongoing polling. Fresh page startup
still honors the configured audio preference. Generic recovery cannot replace a
native player during its own suspend/resume. Explicit PiP playback keeps its
native lifecycle; leaving PiP while hidden mutes inline media.
Normal HA Direct,
Frigate go2rtc, iPhone behavior and layout calculations are unchanged. Automated
lifecycle coverage does not replace physical Catalyst red-X/reopen validation,
which remains required.

`v1.1.10-dev.19` makes Companion HA Direct resume selective. Released peers,
ended tracks and emptied HLS players are discarded immediately, before native
foreground restart. Potentially healthy providers remain mounted while a single
1.5-second maximum check verifies progress. WebRTC requires both decoded-video
progress and new inbound video bytes from the same peer/receiver; a connected
flag or buffered frame alone is insufficient. HLS retains advancing playback,
with later network failure still handled by its existing native recovery.
Successful checks end early. Unverified players alone re-enter the normal
sequential startup queue. Paused playback can receive play() without any mute
change; autoplay denial preserves the connection instead of reconnecting.
Re-hiding/disposal cancels checks, and stale results cannot remove new players.
There is no duration-away threshold, cold-start timeout, or perpetual watchdog.
Ordinary browsers, Catalyst, go2rtc, audio controls and layouts are unchanged.
Physical iPhone Companion verification remains required.

`v1.1.10-dev.18` replaces the rejected dev.17 ten-second WebRTC progress check
with a Companion-only session restart. On return from document/page
backgrounding, retire the old normal HA Direct providers before their native
foreground listeners run, then use the existing selected-first sequential
startup queue. Each camera must become usable or fail before the next starts.
This also applies to brief background returns: no elapsed-time threshold or
cached peer-health flag decides whether to restart. Duplicate foreground events
and stale callbacks cannot start additional queues. Backgrounding pauses queue
advancement; picture-in-picture retains its existing behavior. Selected camera,
mute choice and presentation clients survive the restart. Browser resumes,
go2rtc, Catalyst, audio restoration and editor/layout retention are unchanged.
Physical iPhone Companion background-return verification remains required.

`v1.1.10-dev.17` was rejected in physical Companion testing. Its foreground
progress check did not restore playback and has been removed.

`v1.1.10-dev.16` restores received WebRTC audio omitted by HA during muted
startup when the selected HA Direct camera is unmuted. The integration-owned
adapter synchronizes the selected child's public mute input within the user
gesture and adds only live receiver audio tracks missing from that child's
existing playback stream. This is the narrow received-audio exception documented
in `ARCHITECTURE.md`; HA still owns the peer, tracks, stream and cleanup.
No pause/restart, new connection, selector changes, or layout changes are made.
HLS only receives public mute synchronization. Catalyst and Frigate go2rtc are
unchanged. Browser autoplay permission is still required for audible startup;
this repair does not claim to bypass iPhone autoplay restrictions. Physical
iPhone Safari/Companion audio verification remains required.

`v1.1.9-dev.1` repairs normal HA Direct recovery after an established WebRTC
stream fails. HA can close its native peer on a signaling error without sending
new stream metadata; the retained `hasVideo` value previously left the dead
player selected. Read-only native failure observation now invalidates that
selection locally, and HA restores its advertised or verified HLS fallback.
Once HLS has playable video, HA may create one fresh WebRTC child automatically.
Terminal HLS errors also permit that attempt instead of blocking recovery.
Failure of that attempt retains usable HLS under the existing two-/five-minute
retry policy. No provider is moved or replaced; healthy cameras, HLS recovery,
Catalyst, Frigate go2rtc, sequential startup and editor/view retention keep their
existing owners. Temporary recovery media listeners are removed on success or
disposal; no additional polling or card-owned signaling is introduced.
Regression coverage includes stale successful metadata, native signaling and
ICE failures, selected and dormant cameras, and healthy-camera isolation.
Physical Frigate restart testing is still required.

`v1.1.8-dev.196` removes the temporary HA Direct talk timing diagnostics,
their opt-in console flag, instrumentation hooks and dedicated diagnostic tests.
The parallel microphone/configuration preparation and all functional talk tests
remain. Signaling, readiness, cancellation, cleanup, live playback and retention
are unchanged; no warm talk connection or transport exception is introduced.

`v1.1.8-dev.195` overlaps HA Direct talk microphone acquisition and the
per-attempt HA WebRTC client-configuration request after the Talk click. Both
must complete before the existing separate talk peer is created; configuration
is never cached across attempts and is bound to its camera and HA connection.
Cancellation and failed preparation release acquired or late microphone tracks
without negotiating a stale session. The existing SDP/transceiver shape, ICE
candidate ordering, audio/video readiness, ten-second media timeout, mute and
teardown behavior remain intact. Live providers, retention, Frigate go2rtc talk,
and Catalyst HLS playback are unchanged. The temporary startup timings added in
this version were removed in dev.196. There is no polling,
prewarmed microphone, additional talk connection, or background preparation.
Automated tests cover overlap, cancellation/failure races, stale camera/HA
identity, readiness, cleanup and the production bundle. No measured speedup is
claimed and no candidate queue changes are included.
The existing Wide View browser regression now observes explicit transition
completion instead of returning a pending promise to Playwright; its retention,
geometry and media-progress assertions and production behavior are unchanged.

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
    The explicit Companion background-return session reset above is not a
    timeout-based recovery and is the only provider-retention exception here.
    Only the instance-local verified-HLS capability, muted-HLS selector,
    failed-WebRTC retry, retryable-HLS recovery (including the scoped foreground
    visibility adapter), selected-startup public autoplay ownership,
    documented standard-HLS configuration, and scoped
    received-audio restoration corrections above are allowed;
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
- `v1.1.10-dev.29` keeps hidden Frigate go2rtc WebRTC, MSE, and HLS race
  candidates on muted autoplay. A candidate no longer consumes the selected
  camera's audible-start request before it wins and is presented; the adopted
  visible player remains the sole owner of `Start Camera Unmuted`.
- `v1.1.10-dev.30` removes the rejected go2rtc-only startup experiment and
  aligns the shared HA Direct/go2rtc startup-audio ordering with Advanced
  Camera Card: unmute the selected media before requesting playback, without
  waiting for loaded data, then reapply that same sequence once on
  `loadeddata`. A denied audible request still falls back to muted playback.
- `v1.1.10-dev.47` aligns first-camera construction with the connected media
  lifecycle used by Advanced Camera Card. If Home Assistant assigns `hass`
  while the custom card is detached, FrigateView records the pending startup
  and creates the first live player only from `connectedCallback`; already
  connected cards retain their existing immediate startup path. This keeps the
  first WebKit audible-play request out of a detached shadow tree and applies
  equally to HA Direct and Frigate go2rtc.

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
