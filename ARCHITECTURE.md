# Frigate View Card Contract

## 1. Product Goal

This app exists to do four things well:

- show a live camera quickly and predictably
- let the user switch cameras and keep state coherent
- let the user browse alerts, reviews, clips, and recordings clearly
- let the user configure per-camera behavior without hidden transport surprises

## 2. Non-Negotiable Rules

- The top-level shell is orchestration only.
- Files are grouped by stable responsibility, not where they were last used.
- No catch-all folders for miscellaneous helpers.
- No mixed-responsibility modules.
- No feature work is allowed to create new architectural ambiguity.
- If a requirement is impossible in the chosen transport model, the code must say so plainly instead of simulating it with hacks.
- `frigate_go2rtc` and `ha_direct` are separate configured modes and must stay
  separate in code paths and tests, except for the explicit Mac Catalyst
  playback override defined below.

## 3. Transport Decision

Chosen model:

- `frigate_go2rtc` is the primary card-managed live transport mode.
- `ha_direct` is the explicit Home Assistant-managed live transport mode.

Meaning of `frigate_go2rtc`:

- the card owns transport selection, startup policy, race behavior, fallback behavior, and live-mode orchestration
- the card may use Home Assistant-exposed Frigate/go2rtc surfaces to implement that behavior
- the mode must not silently collapse into the Home Assistant camera-stream path
  on ordinary browser clients

Meaning of `ha_direct`:

- Home Assistant owns stream playback behavior
- the card delegates live playback to Home Assistant stream components and Home Assistant-selected transport behavior
- the card must not run its own go2rtc race in this mode
- on non-Catalyst clients, each loaded camera owns one stable
  `ha-camera-stream` provider; Home Assistant selects and manages its HLS or
  WebRTC child player without a parallel card-owned transport race
- providers are created in permanent, camera-scoped HA Direct mounts and
  are shown or hidden in place across camera and page changes. Each mount is
  a stable light-DOM child of the owning `home-assistant` application root.
  Camera-specific slot relays project the stationary players into the active
  main view, Grid/Preview tiles, or editor stage, including the native dialog.
  Replacing a card or page shell must never disconnect a provider subtree
- after the selected provider renders usable video, remaining configured HA
  Direct cameras may warm sequentially; camera N+1 must not start until camera
  N has usable media or has failed
- the card owns provider creation, deck visibility, retention and release,
  snapshot fallback presentation, and editor/layout presentation ownership; it
  does not own the provider's signaling or internal media-player lifecycle
- Grid and Preview live tiles subscribe to the same normal HA Direct session;
  they must not create additional HA players or bypass its HLS compatibility
  adapter. Tile cleanup releases presentation only, not the retained connection.
  Snapshot-only tiles do not request live presentation. Frigate and Catalyst
  tiles keep their separate existing transport owners
- in Wide View, a camera displayed in the main stage must use a refreshing
  snapshot in its companion tile, even with live companions or an active alert.
  Selection changes update only the affected tiles; they must not restart
  unrelated companions or create a second provider for the main camera
- page and layout changes keep each native provider in its permanent slot.
  Dashboard/editor handoff changes only the slot-relay chain and the subscribed
  presentation client. Neither providers nor their slots, videos or child
  players are moved, cloned or lent. The session is scoped to one HA application
  root, websocket connection and card identity, not to camera names alone.
  The stationary application-root mount is an explicit exception to card-local
  ownership; it must retain HA's context and must never use `document.body`
- saving the editor explicitly identifies the replacement configuration before
  HA rebuilds the dashboard card. That one-shot handoff keeps the same session
  even while the old pre-editor card is still connected; matching camera lists
  alone must never merge independent cards. A camera failure or targeted eviction
  must not dispose or restart other camera records
- normal HA Direct must pass the real Home Assistant camera state to
  `ha-camera-stream`. It must not fabricate `frontend_stream_type`, patch HA
  HLS/WebRTC player internals (except the scoped HLS foreground-resume and
  standard-HLS configuration boundaries below), use a readiness timeout to replace the provider,
  or schedule a card-owned transport remount after HA startup. Four explicit,
  instance-local selector compatibility corrections are allowed:

  - when HA advertises only WebRTC, immediately verify HLS availability through
    HA's `camera/stream` API once per provider. Only a successful endpoint response
    permits HLS in that provider's selector inputs. Do not mutate HA's capabilities
    or camera state. Start no extra player or signaling subscription; HA creates
    its own HLS child while WebRTC is pending and keeps WebRTC once usable
  - when HA reports working HLS video and failed WebRTC but chooses MJPEG,
    preserve HLS regardless of mute
  - while HLS is usable, observe the native WebRTC child's peer state without
    modifying its methods, handlers, or signaling. On failed ICE/connection or
    an explicit failed WebRTC stream, select HLS alone so HA disposes its failed
    child and stops indefinite ICE restarts. Keep the provider and HLS player.
    Retry is eligible after two minutes, then five minutes for repeated failure,
    only on camera reselection; expiry, HA state updates, and same-camera
    page/editor handoffs do not start probes. Rendered WebRTC success resets
    history; failed HLS bypasses suppression. Cancelled, closed, disconnected,
    or superseded peers are not failed-connection evidence. This policy is
    camera-local and is not shared with Frigate go2rtc or Catalyst
  - a native HLS retryable error must not make the parent remove that player
    before HA's recovery runs. Treat that candidate as pending, not ready; after
    HA clears the error and video advances, correct the stale failure metadata
    for selection without mutating HA's state. Request a fresh authenticated
    `camera/stream` URL on failure through the native player's public `url`
    input. After hidden-tab cleanup, a previously usable but emptied HLS child
    reporting missing codecs is also pending: an expired master can report
    this before a native error exists. Capture that cleared-video evidence at
    the HLS child's `streams` event, before MediaSource attachment, and bind it
    to that exact child and status object for HA's deferred selector render.
    Checking the video only at render time is too late. MediaSource attachment
    alone must not cancel that recovery. If the URL is unchanged and the engine has no parsed
    manifest (or the video is still cleared), request the same public URL update
    so HA cleans up and restarts its own engine; `startLoad` alone cannot retry
    an unparsed manifest. Do not do this for a buffered fragment interruption.
    URL requests are deduplicated and bounded to one per five seconds during
    failure, deferred while the document is hidden, and resumed on visibility;
    rejected requests retry while that same failed child exists. Never recreate
    providers, touch healthy cameras, or delay a ready WebRTC takeover

  For foreground resume only, the HLS recovery owner may adapt this card's
  native HLS instance visibility handler. If HA's hidden cleanup has emptied
  a previously usable player, request a fresh authenticated URL before any
  restart instead of first fetching the expired URL. Restart through the same
  public `url` update lifecycle, including when HA returns the same URL. Keep
  HA's hidden cleanup timer, short-return cancellation, picture-in-picture and
  cold startup behavior. Deduplicate pending resumes, retain the existing URL
  retry bound, discard stale/hidden responses, and restore the native listener
  on replacement/disposal. Do not patch global handlers, create another player,
  change WebRTC retry/selection, or bypass HA's engine cleanup and construction.

  Other selector results are unchanged. Never patch HA's global components or
  their prototypes. Tests must cover WebRTC-only capabilities with indefinitely
  pending ICE, explicit failure, repeated native ICE failure, bounded retries,
  HLS-first/WebRTC-later selection and retention
- HA Direct browser HLS must not opt into low-latency playback. One explicit
  instance-local configuration exception is allowed: adapt the card-owned HA
  HLS child's `_renderHLSPolyfill` entry point before engine construction, using
  HA's supplied Hls.js constructor with `lowLatencyMode: false` and a playlist
  loader that removes LL-HLS part, preload, rendition-report and server-control
  instructions. Keep complete segments, URL authentication, discontinuities,
  and HA's other configuration intact. HA still owns engine construction,
  retries and teardown; never create another player, alter global defaults or
  prototypes, or use this to change WebRTC selection or retained session identity.
  This adapter does not affect HA's native-video branch or the separate Catalyst
  native path. Tests must verify actual playlist/segment requests, including
  recovery, not just a mocked low-latency flag
- the normal HA Direct deck contains only cameras whose effective configured
  mode is `ha_direct`
- cameras configured as `frigate_go2rtc` never enter the normal HA Direct warm
  deck, so mixed-transport camera lists preserve independent lifecycle owners

Mac Catalyst exception:

- the saved camera `connection_type` remains unchanged
- when the client is the Home Assistant Mac Catalyst app, effective live
  playback is always `ha_direct`, including cameras configured as
  `frigate_go2rtc`
- Catalyst uses the dedicated Home Assistant-authenticated HLS path (native HLS
  for the selected primary live player) and must not create or race Frigate
  WebRTC/MSE attempts
- the override must be explicit in the live-playback resolver, runtime source
  labels, lifecycle identity, tests, and user documentation
- non-Catalyst clients continue to follow the configured connection mode
- Catalyst's native video owns HLS error/ended recovery even while unselected.
  It refreshes its authenticated HA URL in place, with bounded retries and a
  ten-second no-progress check only after an interruption or recovery attempt.
  Healthy retained playback has no recovery polling. Recovering videos remain
  retained through camera/layout handoff; release cancels all listeners/retries

Why:

- this preserves the two-mode product behavior already exposed in config
- it avoids pretending that `frigate_go2rtc` is a truly browser-direct Frigate path when it is not
- it keeps card-managed live behavior and Home Assistant-managed live behavior distinct instead of blending them
- it gives Catalyst one documented compatibility exception after the Frigate
  integration proved unable to expose an authenticated HLS playlist suitable
  for the card-managed Frigate path

Browser is allowed to talk to:

- Home Assistant-exposed Frigate/go2rtc surfaces used by the card-managed `frigate_go2rtc` mode
- Home Assistant stream components and Home Assistant APIs used by `ha_direct`
- Lovelace and Home Assistant config persistence APIs

Browser must not assume:

- that the Home Assistant Frigate integration is a generic direct Frigate tunnel
- that HA proxy routes are equivalent to true browser-direct Frigate access
- that HA-exposed PTZ/live/media endpoints exactly match upstream Frigate capabilities
- that `frigate_go2rtc` and `ha_direct` may share one blended startup path;
  Catalyst instead makes an explicit effective-mode decision before startup

## 4. Top-Level Shell

`src/card/` owns:

- card lifecycle
- active camera selection
- active page and tab selection
- high-level feature composition
- top-level event wiring between features
- choosing whether a camera is in `frigate_go2rtc` or `ha_direct` mode

`src/card/` must not own:

- live transport bootstrap details
- Frigate mapping or Frigate/go2rtc URL construction
- stream adapter logic
- HLS manifest rewriting
- PTZ action planning
- browse filtering or windowing logic
- popup media loading logic
- transport-specific retry logic

## 5. Folder Ownership

`src/card/`

- thin runtime shell and composition root only

`src/features/live/`

- live-only startup policy, transport orchestration, stream adapters, mount lifecycle, fallback policy, and the card-managed `frigate_go2rtc` path

`src/features/browse/`

- alerts, reviews, clips/recordings list behavior, filters, browse state, windowing, paging, and browse rendering decisions

`src/features/popup/`

- popup media state, popup playback UX, popup controls, drag/swipe, and carousel behavior

`src/features/ptz/`

- PTZ capability model, PTZ config normalization, action planning, and PTZ UI/controller behavior

`src/features/navigation/`

- pages, routes, deep links, page availability, and page transition rules

`src/features/localization/`

- Home Assistant user-language selection, bundled UI dictionaries, English fallback, and text-only localization updates for runtime and editor

`src/features/linked-entities/`

- per-camera links to Home Assistant entities, linked-control state and presentation, and interaction behavior such as light brightness adjustment

`src/integrations/frigate/`

- Frigate-specific mapping, Home Assistant-exposed Frigate/go2rtc surface resolution, transport capability resolution, and Frigate-specific API assumptions

`src/integrations/home-assistant/`

- explicit Home Assistant-owned playback adapters and helpers for `ha_direct`, plus Home Assistant entity-service adapters used by linked controls

`src/shared/media/`

- reusable video/audio/media element helpers, generic playback utilities, and media DOM primitives used by multiple features

`src/shared/`

- pure generic utilities only: data normalization, dates, strings, and small stateless helpers

## 6. Forbidden Ownership

Live transport code must not live in:

- `src/card/`
- `src/shared/`

Frigate-specific mapping must not live in:

- `src/features/live/`
- `src/card/`

Home Assistant direct-mode adapters must not live in:

- `src/features/live/`
- `src/integrations/frigate/`

Generic media primitives must not live in:

- `src/features/live/`
- `src/features/popup/`

Browse/filter/windowing logic must not live in:

- `src/card/`
- `src/shared/`

PTZ action planning must not live in:

- `src/card/`
- `src/shared/`

Popup media loading rules must not live in:

- `src/card/`

## 7. MVP

Version 1 is done when all of these are true:

- opening the card on one configured camera produces a stable live connection
- camera switching works without corrupting browse/live state
- alerts/reviews browsing works with coherent filtering and windowing
- config saves, reloads, and matches runtime behavior
- `frigate_go2rtc` and `ha_direct` are visibly distinct modes with distinct
  startup paths outside the documented Catalyst override

## 8. Out Of Scope For MVP

- PTZ presets beyond the core supported actions
- advanced live heuristics beyond the chosen transport design
- broad UI polish work
- transport experiments not required for the core live path
- convenience refactors unrelated to the MVP

## 9. Validation Rules

Every change must satisfy all of these:

- one subsystem at a time
- one behavior at a time
- one clear owning folder
- one narrow validation before broader validation
- no while-I-am-here edits
- no workaround that hides an architectural contradiction
- tests must assert which mode is active when the behavior depends on
  `frigate_go2rtc` versus `ha_direct`, including Catalyst's effective
  `ha_direct` override
- every config option that changes visible card output must be normalized,
  persisted, included in the editor preview draft, applied immediately to the
  live editor preview, and protected by focused regression coverage
- configuration editor changes must preserve the persistence and preview lanes
  defined in `docs/config-editor-contract.md`

## 10. AI Working Rules

- No web research unless explicitly requested.
- If the requested behavior conflicts with this contract, say so immediately.
- Do not describe `frigate_go2rtc` as truly browser-direct Frigate unless the runtime actually becomes that.
- Do not blend `frigate_go2rtc` and `ha_direct` into one hidden control flow.
  Resolve the documented Catalyst override before transport startup.
- Do not add new modules unless their folder ownership is already defined here without asking first.


## 11. Rejection Rule

A change must be rejected if it does any of the following:

- makes the shell fatter
- creates a mixed-responsibility file
- puts feature logic into `shared`
- puts generic media code into a feature folder
- mixes Frigate-specific assumptions into generic runtime code
- hides whether behavior is coming from `frigate_go2rtc`, configured
  `ha_direct`, or the explicit Catalyst effective-`ha_direct` override
- solves a symptom by hiding the transport or ownership problem instead of fixing it
