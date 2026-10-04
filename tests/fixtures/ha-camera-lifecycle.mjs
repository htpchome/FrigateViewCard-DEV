import { upstreamHaCameraStreamSelector } from "./ha-camera-stream-selector.mjs";

// A lifecycle harness, not a substitute for physical HA integration testing.
// It uses HA's pinned selection contract and real browser video decoders.
// Disconnect deliberately stops playback, as the real HA child players do.
export function installHaCameraLifecycleFixture({ webRtc, supportedTypes = ["hls", "web_rtc"], holdReadinessAudit = false }) {
  const rtcPlayers = new Map();
  const providers = new Set();
  const heldReadyEntities = new Set();
  const mediaReady = () => [...providers].filter((provider) => [...provider.players.values()].some((player) =>
    !player.classList.contains("hidden") && player.video.videoWidth > 0 &&
    (player.video.readyState >= 2 || player.video.getVideoPlaybackQuality().totalVideoFrames > 0)))
    .map((provider) => provider.stateObj.entity_id);
  const audit = {
    starts: [], stops: [], providerDisconnects: 0, readyEntities: new Set(), verifications: [],
    rtcOffers: [], iceRestarts: [], closedPeers: [],
    startReadiness: [],
    failIce: (entity) => {
      const peer = rtcPlayers.get(entity)?._peerConnection;
      if (!peer || peer.iceConnectionState === "closed") return;
      peer.iceConnectionState = "failed";
      peer.dispatchEvent(new Event("iceconnectionstatechange"));
    },
    releaseReadinessAudit: () => {
      for (const entity of heldReadyEntities) audit.readyEntities.add(entity);
      heldReadyEntities.clear();
    },
    releaseWebRtc: () => { for (const player of rtcPlayers.values()) player.startMedia(); },
    failCamera: (entity) => {
      for (const provider of providers) {
        if (provider.stateObj?.entity_id !== entity) continue;
        provider.hls = { hasVideo: false, hasAudio: false };
        provider.rtc = { hasVideo: false, hasAudio: false };
        provider.render();
      }
    },
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
      // Decoding can precede loadeddata, and readyState can drop after a frame.
      // Inspect visible media and its frame history, not event bookkeeping.
      audit.startReadiness.push({
        entity: this.entityid, eventReady: [...audit.readyEntities], ready: mediaReady(),
        states: [...providers].map((provider) => ({
          entity: provider.stateObj.entity_id,
          status: provider.haDirectSession?.get(provider.stateObj.entity_id)?.status,
          players: [...provider.players.values()].map((player) => ({
            type: player.localName, hidden: player.classList.contains("hidden"),
            readyState: player.video.readyState, width: player.video.videoWidth,
            paused: player.video.paused, time: player.video.currentTime,
            frames: player.video.getVideoPlaybackQuality().totalVideoFrames,
          })),
        })),
      });
      if (this.localName === "ha-web-rtc-player") rtcPlayers.set(this.entityid, this);
      if (this.localName === "ha-web-rtc-player" && webRtc === "ice-retry") {
        // Like HA: fetch configuration before creating the peer, and restart
        // failed ICE without emitting a parent streams:false event.
        queueMicrotask(() => {
          if (!this.isConnected) return;
          const peer = new EventTarget();
          peer.iceConnectionState = "checking";
          peer.addEventListener("iceconnectionstatechange", () => {
            if (peer.iceConnectionState !== "failed") return;
            audit.iceRestarts.push(this.entityid);
            this.retryTimer = setTimeout(() => {
              if (!this.isConnected) return;
              audit.rtcOffers.push(this.entityid);
              peer.iceConnectionState = "checking";
              this.retryTimer = setTimeout(() => audit.failIce(this.entityid), 20);
            }, 0);
          });
          this._peerConnection = peer;
          audit.rtcOffers.push(this.entityid);
        });
        return;
      }
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
        (holdReadinessAudit ? heldReadyEntities : audit.readyEntities).add(this.entityid);
        this.dispatchEvent(new CustomEvent("streams", {
          detail: { hasAudio: false, hasVideo: true }, bubbles: true, composed: true,
        }));
      }, { once: true });
      this.video.src = `/media.mp4?entity=${this.entityid}&type=${this.localName}`;
      void this.video.play().catch(() => {});
    }
    disconnectedCallback() {
      audit.stops.push(`${this.localName}:${this.entityid}`);
      clearTimeout(this.retryTimer);
      if (this._peerConnection) {
        this._peerConnection.iceConnectionState = "closed";
        audit.closedPeers.push(this.entityid);
      }
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
    }
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
      providers.add(this);
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
