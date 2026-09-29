# Live Transport Known-Good Baseline

## Current Baseline

`v1.1.8-dev.90` replaces the rejected HA Direct startup race with one explicit
session: mount Home Assistant HLS first, commit its first usable video, and only
then attempt an optional low-latency upgrade. The upgrade may replace HLS only
after it renders usable media. A failed or unavailable upgrade leaves HLS
untouched. Physical browser and Mac Catalyst validation is required before this
candidate replaces `v1.1.8-dev.89` as the fallback point.

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
It remains the pre-rewrite fallback point, but physical testing found its
first-load and camera-switch latency unacceptable.

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
- `ha_direct` mounts HLS without a competing media negotiation. After HLS is
  usable, a capable browser may establish one optional low-latency upgrade.
  HA Direct sessions are not cached across cameras or transferred between card
  and editor instances.
- HA Direct WebRTC takeover and HA Direct two-way-talk negotiation work, but
  remain slower than desired. This is accepted for this baseline. Treat faster
  negotiation as deferred optimization, not an active defect requiring a
  speculative change.

Do not change unrelated popup, fullscreen, iOS, aspect-ratio, resize, zoom, or
layout behavior while optimizing either transport.

## HA Direct Startup Contract

Preserve all of these behaviors together:

1. Create and mount exactly one Home Assistant HLS player first.
2. Do not start the optional low-latency request before HLS is usable.
3. Keep the snapshot refresh visible only while HLS is starting or unavailable.
4. Start at most one optional upgrade for the active session.
5. Replace HLS only after the upgrade has rendered usable media.
6. If the upgrade is unavailable or fails, leave playing HLS untouched.
7. When the camera changes, destroy the complete HA Direct session and mount a
   fresh HLS player for the new camera.
8. Do not put HA Direct sessions in the Frigate live grace pool or transfer them
   through the editor handoff channel.
9. Do not begin browse-data requests ahead of the selected camera's live mount.

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
- `v1.1.8-dev.90` removes the HA Direct race, release barrier, grace pool, and
  editor handoff. It mounts HLS before browse work on camera changes and starts
  one optional low-latency upgrade only after HLS becomes usable.

## Validation Expectations

Any future live-transport change must test the two connection modes separately
and must include physical checks for:

- first-picture time on WebRTC-capable and non-WebRTC clients;
- eventual WebRTC takeover on a capable client;
- stable HLS playback when WebRTC cannot complete;
- retained Frigate WebRTC/MSE connection counts during fast camera switching
  and fresh HA Direct HLS player creation on every HA Direct camera entry;
- complete teardown without increasing connection or subscription counts;
- HA Direct two-way-talk incoming and outgoing audio;
- unchanged `frigate_go2rtc` startup, fallback, switching, and talk behavior.

## Opt-In HA Direct Timing Diagnostics

Chrome can retain HA Direct timing logs across reloads without changing the
transport policy. Enable the recorder in the DevTools Console and reload:

```js
localStorage.setItem("frigate-view-card:ha-direct-diagnostics", "1");
location.reload();
```

Each attempt is logged with a relative timestamp. After reproducing both a fast
and a slow connection, copy the structured records from the Console:

```js
copy(window.__fvcHaDirectDiagnostics.export());
```

The recorder also marks the HA HLS player's update, first newly completed HLS
resource type, video discovery, and video readiness events. Resource records
contain only their class, duration, and transfer size; signed URLs are never
stored. Comparing these marks between a fast and slow attempt distinguishes a
delay before the first playlist from a later segment or media-readiness delay.

Disable the recorder when finished:

```js
localStorage.removeItem("frigate-view-card:ha-direct-diagnostics");
location.reload();
```

The recorder logs lifecycle milestones and outcome metadata only. It does not
record SDP, ICE candidates, signed URLs, credentials, or media data.
