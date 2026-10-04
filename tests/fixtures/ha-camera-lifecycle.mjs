import { upstreamHaCameraStreamSelector } from "./ha-camera-stream-selector.mjs";

// A lifecycle harness, not a substitute for physical HA integration testing.
// It uses HA's pinned selection contract and real browser video decoders.
// Disconnect deliberately stops playback, as the real HA child players do.
export function installHaCameraLifecycleFixture({ webRtc, supportedTypes = ["hls", "web_rtc"] }) {
  const rtcPlayers = new Map();
  const audit = {
    starts: [], providerDisconnects: 0, readyEntities: new Set(), verifications: [],
    startReadiness: [],
    releaseWebRtc: () => { for (const player of rtcPlayers.values()) player.startMedia(); },
    callWS: async (message) => {
      if (message.type !== "camera/stream" || message.format !== "hls") throw new Error("Unexpected HA request");
      audit.verifications.push(message.entity_id);
      return { url: "/api/hls/synthetic/master_playlist.m3u8" };
    },
  };
  class Player extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.video = document.createElement("video");
      this.video.style.cssText = "width:100%;height:100%";
      this.video.muted = true;
      this.video.playsInline = true;
      this.shadowRoot.append(this.video);
    }
    connectedCallback() {
      audit.starts.push(`${this.localName}:${this.entityid}`);
      audit.startReadiness.push({ entity: this.entityid, ready: [...audit.readyEntities] });
      if (this.localName === "ha-web-rtc-player") rtcPlayers.set(this.entityid, this);
      // A blocked ICE connection often emits neither success nor failure.
      if (this.localName === "ha-web-rtc-player" && webRtc === "pending") return;
      if (this.localName === "ha-web-rtc-player" && !webRtc) {
        queueMicrotask(() => this.dispatchEvent(new CustomEvent("streams", {
          detail: { hasAudio: false, hasVideo: false }, bubbles: true, composed: true,
        })));
        return;
      }
      this.startMedia();
    }
    startMedia() {
      if (this.video.hasAttribute("src")) return;
      this.video.addEventListener("loadeddata", () => {
        audit.readyEntities.add(this.entityid);
        this.dispatchEvent(new CustomEvent("streams", {
          detail: { hasAudio: false, hasVideo: true }, bubbles: true, composed: true,
        }));
      }, { once: true });
      this.video.src = `/media.mp4?entity=${this.entityid}&type=${this.localName}`;
      void this.video.play().catch(() => {});
    }
    disconnectedCallback() { this.video.pause(); this.video.removeAttribute("src"); this.video.load(); }
  }
  customElements.define("ha-hls-player", class extends Player {});
  customElements.define("ha-web-rtc-player", class extends Player {});
  customElements.define("ha-camera-stream", class extends HTMLElement {
    _streams = upstreamHaCameraStreamSelector;
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.updateComplete = Promise.resolve();
      this.players = new Map();
      this.addEventListener("streams", (event) => {
        if (event.composedPath()[0].localName === "ha-hls-player") this.hls = event.detail;
        else this.rtc = event.detail;
        this.render();
      });
    }
    connectedCallback() { this.render(); }
    requestUpdate() { queueMicrotask(() => this.render()); }
    disconnectedCallback() { audit.providerDisconnects += 1; }
    render() {
      if (!this.isConnected) return;
      const streams = this._streams(supportedTypes, this.hls, this.rtc, true);
      for (const [type, player] of this.players) {
        if (streams.some((stream) => stream.type === type)) continue;
        player.remove();
        this.players.delete(type);
      }
      for (const stream of streams) {
        if (stream.type === "mjpeg") continue;
        let player = this.players.get(stream.type);
        if (!player) {
          player = document.createElement(stream.type === "hls" ? "ha-hls-player" : "ha-web-rtc-player");
          player.entityid = this.stateObj.entity_id;
          this.players.set(stream.type, player);
          this.shadowRoot.append(player);
        }
        player.classList.toggle("hidden", !stream.visible);
        player.style.display = stream.visible ? "block" : "none";
      }
    }
  });
  return audit;
}
