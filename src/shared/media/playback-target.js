export const PLAYBACK_TARGET_AIRPLAY = "airplay";

const DEFAULT_SOURCE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_SOURCES = 12;
const REMOTE_PLAYBACK_PROMPT = "remote-playback";
const WEBKIT_AIRPLAY_PROMPT = "webkit-airplay";

function resolveAirPlayPromptMethod(video) {
  if (typeof video?.remote?.prompt === "function") {
    return REMOTE_PLAYBACK_PROMPT;
  }
  if (typeof video?.webkitShowPlaybackTargetPicker === "function") {
    return WEBKIT_AIRPLAY_PROMPT;
  }
  return "";
}

function resolveMediaSourceType(video) {
  if (video?.srcObject) return "media-stream";
  const source = String(video?.currentSrc || video?.src || "").toLowerCase();
  if (!source) return "none";
  if (source.startsWith("blob:")) return "blob";
  if (source.includes(".m3u8")) return "hls";
  if (source.includes(".mp4")) return "mp4";
  return "url";
}

export function resolveBrowserPlaybackTargetSupport({
  video = null,
  windowObj = globalThis.window,
} = {}) {
  return {
    airplay:
      typeof video?.remote?.prompt === "function" ||
      typeof video?.webkitShowPlaybackTargetPicker === "function" ||
      typeof windowObj?.HTMLVideoElement?.prototype
        ?.webkitShowPlaybackTargetPicker === "function",
  };
}

export function configureReceiverVideo(video, source) {
  if (!video || !source?.url) return false;
  video.preload = "none";
  video.playsInline = true;
  video.controls = false;
  video.setAttribute?.("playsinline", "");
  video.setAttribute?.("webkit-playsinline", "");
  allowAirPlayVideo(video);
  if (video.src !== source.url) {
    video.src = source.url;
  }
  return true;
}

export function allowAirPlayVideo(video) {
  if (!video) return false;
  video.disableRemotePlayback = false;
  video.setAttribute?.("x-webkit-airplay", "allow");
  return true;
}

export async function promptAirPlayVideo(video, { load = true } = {}) {
  const remotePrompt = video?.remote?.prompt;
  if (typeof remotePrompt === "function") {
    try {
      if (load) video.load?.();
      await remotePrompt.call(video.remote);
      return true;
    } catch (_) {
      return false;
    }
  }
  const prompt = video?.webkitShowPlaybackTargetPicker;
  if (typeof prompt !== "function") return false;
  try {
    if (load) video.load?.();
    prompt.call(video);
    return true;
  } catch (_) {
    return false;
  }
}

export function clearBrowserMediaSession(
  navigatorObj = globalThis.navigator,
) {
  const mediaSession = navigatorObj?.mediaSession;
  if (!mediaSession) return false;
  try {
    mediaSession.playbackState = "none";
    mediaSession.metadata = null;
    return true;
  } catch (_) {
    return false;
  }
}

export class BrowserPlaybackTargetController {
  constructor({
    getContext,
    resolveSource,
    getMount,
    createVideo = () => globalThis.document?.createElement?.("video"),
    promptAirPlay = (video, options) => promptAirPlayVideo(video, options),
    getWindow = () => globalThis.window,
    getNavigator = () => globalThis.navigator,
    getNowMs = () => Date.now(),
    onStatus = () => {},
    onSupportChange = () => {},
    onDiagnostic = () => {},
  } = {}) {
    this._getContext = getContext;
    this._resolveSource = resolveSource;
    this._getMount = getMount;
    this._createVideo = createVideo;
    this._promptAirPlay = promptAirPlay;
    this._getWindow = getWindow;
    this._getNavigator = getNavigator;
    this._getNowMs = getNowMs;
    this._onStatus = onStatus;
    this._onSupportChange = onSupportChange;
    this._onDiagnostic = onDiagnostic;
    this._sources = new Map();
    this._sourceInFlight = new Map();
    this._videos = new Map();
    this._displayedVideos = new Map();
  }

  _diagnose(scope, entry, event, sourceEvent = null) {
    const video = entry?.video;
    if (!video) return;
    const nowMs = this._getNowMs();
    this._onDiagnostic?.({
      scope,
      event,
      method: entry.promptMethod || resolveAirPlayPromptMethod(video) || "none",
      elapsedMs: entry.promptStartedAt
        ? Math.max(0, nowMs - entry.promptStartedAt)
        : 0,
      isTrusted:
        typeof sourceEvent?.isTrusted === "boolean"
          ? sourceEvent.isTrusted
          : null,
      muted: video.muted === true,
      defaultMuted: video.defaultMuted === true,
      volume: Number.isFinite(Number(video.volume))
        ? Number(video.volume)
        : null,
      paused: video.paused === true,
      readyState: Number.isFinite(Number(video.readyState))
        ? Number(video.readyState)
        : null,
      sourceType: resolveMediaSourceType(video),
      remoteState: String(video.remote?.state || "unavailable"),
      webkitWireless:
        video.webkitCurrentPlaybackTargetIsWireless === true,
    });
  }

  _contextForScope(scope) {
    const context = this._getContext?.(scope) || {};
    const sourceKey = String(context.sourceKey || "").trim();
    return sourceKey ? { ...context, scope, sourceKey } : null;
  }

  _videoForScope(scope) {
    const existing = this._videos.get(scope);
    if (existing) {
      if (existing.video.isConnected === false) {
        this._getMount?.()?.appendChild?.(existing.video);
      }
      return existing.video;
    }
    const video = this._createVideo?.();
    if (!video) return null;
    video.className = "fvc-receiver-video";
    if (video.style) {
      video.style.cssText =
        "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none";
    }
    const entry = {
      video,
      availability: null,
      prompted: false,
      wirelessActive: false,
      promptMethod: "",
      promptStartedAt: 0,
      onAvailabilityChanged: null,
      onWirelessTargetChanged: null,
      onRemoteConnecting: null,
      onRemoteConnect: null,
      onRemoteDisconnect: null,
      onVolumeChange: null,
      playOnWirelessTarget: null,
      releaseOnTerminal: null,
    };
    const onAvailabilityChanged = (event) => {
      entry.availability = event?.availability || null;
      this._onSupportChange?.();
    };
    const playOnWirelessTarget = () => {
      if (video.webkitCurrentPlaybackTargetIsWireless !== true) return;
      entry.wirelessActive = true;
      video.play?.().catch?.(() => {});
    };
    const releaseOnTerminal = () => this._releaseVideo(scope);
    const onWirelessTargetChanged = () => {
      if (video.webkitCurrentPlaybackTargetIsWireless === true) {
        this._diagnose(scope, entry, "webkit-wireless-connect");
        playOnWirelessTarget();
        return;
      }
      this._diagnose(scope, entry, "webkit-wireless-disconnect");
      this._releaseVideo(scope);
    };
    const onRemoteConnecting = (event) =>
      this._diagnose(scope, entry, "remote-connecting", event);
    const onRemoteConnect = (event) => {
      entry.wirelessActive = true;
      this._diagnose(scope, entry, "remote-connect", event);
      this._playVideo(video);
    };
    const onRemoteDisconnect = (event) => {
      this._diagnose(scope, entry, "remote-disconnect", event);
      this._releaseVideo(scope);
    };
    const onVolumeChange = (event) => {
      if (!entry.prompted && !entry.wirelessActive) return;
      this._diagnose(scope, entry, "volumechange", event);
    };
    entry.onAvailabilityChanged = onAvailabilityChanged;
    entry.onWirelessTargetChanged = onWirelessTargetChanged;
    entry.onRemoteConnecting = onRemoteConnecting;
    entry.onRemoteConnect = onRemoteConnect;
    entry.onRemoteDisconnect = onRemoteDisconnect;
    entry.onVolumeChange = onVolumeChange;
    entry.playOnWirelessTarget = playOnWirelessTarget;
    entry.releaseOnTerminal = releaseOnTerminal;
    this._videos.set(scope, entry);
    video.addEventListener?.(
      "webkitplaybacktargetavailabilitychanged",
      onAvailabilityChanged,
    );
    video.addEventListener?.(
      "webkitcurrentplaybacktargetiswirelesschanged",
      onWirelessTargetChanged,
    );
    video.remote?.addEventListener?.("connecting", onRemoteConnecting);
    video.remote?.addEventListener?.("connect", onRemoteConnect);
    video.remote?.addEventListener?.("disconnect", onRemoteDisconnect);
    video.addEventListener?.("volumechange", onVolumeChange);
    video.addEventListener?.("loadedmetadata", playOnWirelessTarget);
    video.addEventListener?.("canplay", playOnWirelessTarget);
    video.addEventListener?.("ended", releaseOnTerminal);
    video.addEventListener?.("error", releaseOnTerminal);
    this._getMount?.()?.appendChild?.(video);
    return video;
  }

  _releaseVideo(scope) {
    const entry = this._videos.get(scope);
    if (!entry) return;
    const wasWireless =
      entry.prompted ||
      entry.wirelessActive ||
      ["connecting", "connected"].includes(entry.video.remote?.state) ||
      entry.video.webkitCurrentPlaybackTargetIsWireless === true;
    const {
      video,
      onAvailabilityChanged,
      onWirelessTargetChanged,
      onRemoteConnecting,
      onRemoteConnect,
      onRemoteDisconnect,
      onVolumeChange,
      playOnWirelessTarget,
      releaseOnTerminal,
    } = entry;
    video.removeEventListener?.(
      "webkitplaybacktargetavailabilitychanged",
      onAvailabilityChanged,
    );
    video.removeEventListener?.(
      "webkitcurrentplaybacktargetiswirelesschanged",
      onWirelessTargetChanged,
    );
    video.remote?.removeEventListener?.("connecting", onRemoteConnecting);
    video.remote?.removeEventListener?.("connect", onRemoteConnect);
    video.remote?.removeEventListener?.("disconnect", onRemoteDisconnect);
    video.removeEventListener?.("volumechange", onVolumeChange);
    video.removeEventListener?.("loadedmetadata", playOnWirelessTarget);
    video.removeEventListener?.("canplay", playOnWirelessTarget);
    video.removeEventListener?.("ended", releaseOnTerminal);
    video.removeEventListener?.("error", releaseOnTerminal);
    try {
      video.pause?.();
      video.disableRemotePlayback = true;
      video.setAttribute?.("x-webkit-airplay", "deny");
      if ("srcObject" in video) video.srcObject = null;
      video.removeAttribute?.("src");
      video.load?.();
    } catch (_) {}
    video.remove?.();
    this._videos.delete(scope);
    if (wasWireless) {
      clearBrowserMediaSession(this._getNavigator?.());
    }
  }

  _playVideo(video) {
    try {
      video?.play?.()?.catch?.(() => {});
    } catch (_) {}
  }

  _bindDisplayedVideo(scope, video) {
    const existing = this._displayedVideos.get(scope);
    if (existing?.video === video) return;
    this._releaseDisplayedVideo(scope);

    const entry = {
      video,
      availability: null,
      prompted: false,
      wirelessActive: false,
      promptMethod: "",
      promptStartedAt: 0,
      onAvailabilityChanged: null,
      onWirelessTargetChanged: null,
      onRemoteConnecting: null,
      onRemoteConnect: null,
      onRemoteDisconnect: null,
      onVolumeChange: null,
    };
    const onAvailabilityChanged = (event) => {
      entry.availability = event?.availability || null;
      this._onSupportChange?.();
    };
    const onWirelessTargetChanged = () => {
      const wireless =
        video.webkitCurrentPlaybackTargetIsWireless === true;
      if (wireless) {
        entry.wirelessActive = true;
        this._diagnose(scope, entry, "webkit-wireless-connect");
      } else if (entry.wirelessActive) {
        this._diagnose(scope, entry, "webkit-wireless-disconnect");
        entry.prompted = false;
        entry.wirelessActive = false;
        clearBrowserMediaSession(this._getNavigator?.());
      }
      this._onSupportChange?.();
    };
    const onRemoteConnecting = (event) =>
      this._diagnose(scope, entry, "remote-connecting", event);
    const onRemoteConnect = (event) => {
      entry.wirelessActive = true;
      this._diagnose(scope, entry, "remote-connect", event);
      this._onSupportChange?.();
    };
    const onRemoteDisconnect = (event) => {
      this._diagnose(scope, entry, "remote-disconnect", event);
      entry.prompted = false;
      entry.wirelessActive = false;
      clearBrowserMediaSession(this._getNavigator?.());
      this._onSupportChange?.();
    };
    const onVolumeChange = (event) => {
      if (!entry.prompted && !entry.wirelessActive) return;
      this._diagnose(scope, entry, "volumechange", event);
    };
    entry.onAvailabilityChanged = onAvailabilityChanged;
    entry.onWirelessTargetChanged = onWirelessTargetChanged;
    entry.onRemoteConnecting = onRemoteConnecting;
    entry.onRemoteConnect = onRemoteConnect;
    entry.onRemoteDisconnect = onRemoteDisconnect;
    entry.onVolumeChange = onVolumeChange;
    this._displayedVideos.set(scope, entry);
    // WebKit discovers and monitors routes while this listener is present.
    video.addEventListener?.(
      "webkitplaybacktargetavailabilitychanged",
      onAvailabilityChanged,
    );
    video.addEventListener?.(
      "webkitcurrentplaybacktargetiswirelesschanged",
      onWirelessTargetChanged,
    );
    video.remote?.addEventListener?.("connecting", onRemoteConnecting);
    video.remote?.addEventListener?.("connect", onRemoteConnect);
    video.remote?.addEventListener?.("disconnect", onRemoteDisconnect);
    video.addEventListener?.("volumechange", onVolumeChange);
  }

  _releaseDisplayedVideo(scope) {
    const entry = this._displayedVideos.get(scope);
    if (!entry) return;
    const shouldEndSession =
      entry.prompted ||
      entry.wirelessActive ||
      ["connecting", "connected"].includes(entry.video.remote?.state) ||
      entry.video.webkitCurrentPlaybackTargetIsWireless === true;
    entry.video.removeEventListener?.(
      "webkitplaybacktargetavailabilitychanged",
      entry.onAvailabilityChanged,
    );
    entry.video.removeEventListener?.(
      "webkitcurrentplaybacktargetiswirelesschanged",
      entry.onWirelessTargetChanged,
    );
    entry.video.remote?.removeEventListener?.(
      "connecting",
      entry.onRemoteConnecting,
    );
    entry.video.remote?.removeEventListener?.("connect", entry.onRemoteConnect);
    entry.video.remote?.removeEventListener?.(
      "disconnect",
      entry.onRemoteDisconnect,
    );
    entry.video.removeEventListener?.("volumechange", entry.onVolumeChange);
    if (shouldEndSession) {
      try {
        entry.video.pause?.();
        entry.video.disableRemotePlayback = true;
        entry.video.setAttribute?.("x-webkit-airplay", "deny");
        if ("srcObject" in entry.video) entry.video.srcObject = null;
        entry.video.removeAttribute?.("src");
        entry.video
          .querySelectorAll?.("source")
          .forEach((source) => source.remove?.());
        entry.video.load?.();
      } catch (_) {}
      clearBrowserMediaSession(this._getNavigator?.());
    }
    this._displayedVideos.delete(scope);
  }

  observe(scope = "popup", video = null) {
    if (!video) {
      this._releaseDisplayedVideo(scope);
      return false;
    }
    allowAirPlayVideo(video);
    this._bindDisplayedVideo(scope, video);
    return true;
  }

  getSupport(scope = "popup") {
    const observedEntry =
      this._displayedVideos.get(scope) || this._videos.get(scope);
    const support = resolveBrowserPlaybackTargetSupport({
      video: observedEntry?.video,
      windowObj: this._getWindow?.(),
    });
    const availability = observedEntry?.availability;
    return {
      ...support,
      airplay: support.airplay && availability !== "not-available",
    };
  }

  _freshSource(sourceKey) {
    const entry = this._sources.get(sourceKey);
    if (!entry || entry.expiresAt <= this._getNowMs()) {
      this._sources.delete(sourceKey);
      return null;
    }
    return entry.source;
  }

  prepare(scope = "popup", { notifyErrors = false } = {}) {
    const context = this._contextForScope(scope);
    if (!context) return Promise.resolve(null);

    const cached = this._freshSource(context.sourceKey);
    if (cached) return Promise.resolve(cached);
    const current = this._sourceInFlight.get(context.sourceKey);
    if (current) return current;

    const pending = Promise.resolve(this._resolveSource?.(context))
      .then((source) => {
        if (!source?.url) {
          throw new Error(
            source?.message || "A receiver-compatible video URL is unavailable.",
          );
        }
        this._sources.set(context.sourceKey, {
          source,
          expiresAt:
            this._getNowMs() +
            (Number(source.ttlMs) || DEFAULT_SOURCE_TTL_MS),
        });
        while (this._sources.size > MAX_CACHED_SOURCES) {
          this._sources.delete(this._sources.keys().next().value);
        }
        return source;
      })
      .catch((error) => {
        if (notifyErrors) {
          this._onStatus?.(
            error?.message || "The video could not be prepared for playback.",
          );
        }
        return null;
      })
      .finally(() => {
        this._sourceInFlight.delete(context.sourceKey);
      });
    this._sourceInFlight.set(context.sourceKey, pending);
    return pending;
  }

  async prompt(target, { scope = "popup", displayedVideo = null } = {}) {
    if (target !== PLAYBACK_TARGET_AIRPLAY) return false;
    if (displayedVideo) {
      this.observe(scope, displayedVideo);
      const entry = this._displayedVideos.get(scope);
      const method = resolveAirPlayPromptMethod(displayedVideo);
      if (entry) {
        entry.prompted = true;
        entry.promptMethod = method;
        entry.promptStartedAt = this._getNowMs();
        this._diagnose(scope, entry, "prompt-start");
      }
      const prompted =
        (await this._promptAirPlay?.(displayedVideo, { load: false })) === true;
      if (prompted) {
        if (entry) this._diagnose(scope, entry, "prompt-resolved");
        return true;
      }
      if (entry) {
        entry.prompted = false;
        this._diagnose(scope, entry, "prompt-rejected");
      }
      if (method === REMOTE_PLAYBACK_PROMPT) {
        this._onStatus?.("Remote Playback was cancelled or unavailable.");
        return false;
      }
      this._releaseDisplayedVideo(scope);
    }

    const context = this._contextForScope(scope);
    const source = context ? this._freshSource(context.sourceKey) : null;
    if (!source) {
      void this.prepare(scope, { notifyErrors: true });
      this._onStatus?.(
        "Preparing video for AirPlay. Tap again in a moment.",
      );
      return false;
    }

    const video = this._videoForScope(scope);
    configureReceiverVideo(video, source);
    const entry = this._videos.get(scope);
    if (entry) {
      entry.prompted = true;
      entry.promptMethod = resolveAirPlayPromptMethod(video);
      entry.promptStartedAt = this._getNowMs();
      this._diagnose(scope, entry, "prompt-start");
    }
    const prompted =
      (await this._promptAirPlay?.(video, { load: true })) === true;
    if (entry) {
      entry.prompted = prompted;
      this._diagnose(
        scope,
        entry,
        prompted ? "prompt-resolved" : "prompt-rejected",
      );
    }
    if (!prompted) {
      this._onStatus?.("AirPlay is not supported in this browser.");
    }
    return prompted;
  }

  release(scope = "") {
    if (scope) {
      this._releaseVideo(scope);
      this._releaseDisplayedVideo(scope);
      return;
    }
    const scopes = new Set([
      ...this._videos.keys(),
      ...this._displayedVideos.keys(),
    ]);
    for (const activeScope of scopes) {
      this._releaseVideo(activeScope);
      this._releaseDisplayedVideo(activeScope);
    }
  }

  dispose() {
    this.release();
    this._sources.clear();
    this._sourceInFlight.clear();
  }
}
