import { upstreamHaCameraStreamSelector } from "./ha-camera-stream-selector.mjs";

// HA's visibility/URL/streams ordering with a real Hls.js engine. No real HA
// installation is involved. The test explicitly fires the 60s cleanup callback.
export function installHaHlsBackgroundFixture(Hls, { webRtc = false } = {}) {
  const audit = { starts: [], stops: [], engines: [], cleanups: [], errors: [] };
  class HlsPlayer extends HTMLElement {
    _errorIsFatal = false;
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.video = document.createElement("video");
      Object.assign(this.video, { muted: true, autoplay: true, playsInline: true });
      this.shadowRoot.append(this.video);
      this.video.addEventListener("loadeddata", () => this.dispatchEvent(new Event("load")));
    }
    _handleVisibilityChange = () => {
      if (document.pictureInPictureElement) return;
      if (document.hidden) {
        this._hiddenCleanupTimeout = () => { this._hiddenCleanupTimeout = undefined; this._cleanUp(); };
      } else if (this._hiddenCleanupTimeout) {
        this._hiddenCleanupTimeout = undefined;
      } else {
        this._error = undefined;
        void this._startHls();
      }
    };
    connectedCallback() {
      audit.starts.push(this.entityid);
      document.addEventListener("visibilitychange", this._handleVisibilityChange);
      this._url = `/master.m3u8?entity=${this.entityid}&generation=0`;
      void this._startHls();
    }
    disconnectedCallback() {
      audit.stops.push(this.entityid);
      document.removeEventListener("visibilitychange", this._handleVisibilityChange);
      this._hiddenCleanupTimeout = undefined;
      this._cleanUp();
    }
    _cleanUp() {
      audit.cleanups.push(this.entityid);
      this._hlsPolyfillInstance?.destroy();
      this._hlsPolyfillInstance = undefined;
      this.video.removeAttribute("src");
      this.video.load();
    }
    async _startHls() {
      const response = await fetch(this._url);
      const master = await response.text();
      if (!this.isConnected) return;
      const match = /#EXT-X-STREAM-INF:[^\n]*\n(.+)/.exec(master);
      const url = match ? new URL(match[1], new URL(this._url, location.href)).href : this._url;
      // HA reports missing codecs before constructing Hls.js, even on HTTP 404.
      this.dispatchEvent(new CustomEvent("streams", { bubbles: true, composed: true,
        detail: { hasVideo: Boolean(match), hasAudio: false } }));
      this._renderHLSPolyfill(this.video, Hls, url);
    }
    _renderHLSPolyfill(video, Engine, url) {
      // The synthetic live playlist is finite. Leave enough media ahead for
      // the other camera's bounded URL retry, unlike an endless real feed.
      const hls = new Engine({ lowLatencyMode: true, backBufferLength: 60, liveSyncDurationCount: 7 });
      this._hlsPolyfillInstance = hls;
      audit.engines.push(hls);
      hls.attachMedia(video);
      hls.on(Engine.Events.MEDIA_ATTACHED, () => { this._error = undefined; hls.loadSource(url); });
      hls.on(Engine.Events.FRAG_LOADED, () => { this._error = undefined; });
      hls.on(Engine.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        audit.errors.push(data.details);
        this._error = "Stream network error";
        this.dispatchEvent(new CustomEvent("streams", { bubbles: true, composed: true,
          detail: { hasAudio: false, hasVideo: false } }));
        hls.startLoad();
      });
    }
    set url(value) {
      const previous = this.url;
      this.publicUrl = value;
      if (previous !== value) this.requestUpdate("url", previous);
    }
    get url() { return this.publicUrl; }
    requestUpdate(name) {
      if (name !== "url") return;
      queueMicrotask(() => {
        if (!this.isConnected) return;
        this._cleanUp();
        this._error = undefined;
        this._url = this.url;
        void this._startHls();
      });
    }
  }
  customElements.define("ha-hls-player", HlsPlayer);
  customElements.define("ha-camera-stream", class extends HTMLElement {
    _streams = upstreamHaCameraStreamSelector;
    updateComplete = Promise.resolve();
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      // HA records the event synchronously, but its Lit render runs after the
      // child has attached MediaSource. A synchronous render hides that race.
      this.addEventListener("streams", (event) => { this.hls = event.detail; this.requestUpdate(); });
    }
    connectedCallback() { this.render(); }
    requestUpdate() {
      if (this.updatePending) return;
      this.updatePending = true;
      this.updateComplete = new Promise((resolve) => {
        queueMicrotask(() => {
          this.updatePending = false;
          this.render();
          resolve();
        });
      });
    }
    render() {
      if (!this.isConnected) return;
      // Blocked WebRTC emits no usable stream. HLS-only advertises no WebRTC.
      const streams = this._streams(webRtc ? ["hls", "web_rtc"] : ["hls"], this.hls, undefined, true);
      if (!streams.some((stream) => stream.type === "hls")) {
        this.player?.remove();
        return;
      }
      if (!this.player) {
        this.player = document.createElement("ha-hls-player");
        this.player.entityid = this.stateObj.entity_id;
        this.shadowRoot.append(this.player);
      }
    }
  });
  return audit;
}
