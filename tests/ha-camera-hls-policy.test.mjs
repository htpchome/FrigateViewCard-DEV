import assert from "node:assert/strict";
import { test } from "node:test";
import { configureStandardHaHlsPlayer, standardHaHlsPlaylist } from "../src/integrations/home-assistant/camera-hls-policy.js";

test("standard HLS keeps complete media, authentication and discontinuities, removing only LL instructions", () => {
  const ordinary = ["#EXTM3U", "#EXT-X-TARGETDURATION:6", "#EXT-X-MEDIA-SEQUENCE:31",
    '#EXT-X-MAP:URI="init.mp4?auth=synthetic"', '#EXT-X-KEY:METHOD=AES-128,URI="key?auth=synthetic"',
    "#EXT-X-PROGRAM-DATE-TIME:2026-10-04T00:00:00Z", "#EXTINF:6.0,", "segment/31.m4s?auth=synthetic",
    "#EXT-X-DISCONTINUITY", "#EXTINF:6.0,", "segment/32.m4s?auth=synthetic", ""].join("\n");
  const lowLatency = ["#EXT-X-PART-INF:PART-TARGET=1", "#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,CAN-SKIP-UNTIL=36",
    '#EXT-X-PART:DURATION=1,URI="segment/33.0.m4s"', '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="segment/33.1.m4s"',
    '#EXT-X-RENDITION-REPORT:URI="other.m3u8",LAST-MSN=33,LAST-PART=0'].join("\n");
  assert.equal(standardHaHlsPlaylist(ordinary + lowLatency), ordinary);
  assert.equal(standardHaHlsPlaylist((ordinary + lowLatency).replaceAll("\n", "\r\n")), ordinary.replaceAll("\n", "\r\n"));
  assert.equal(standardHaHlsPlaylist(ordinary), ordinary);
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nplaylist.m3u8?auth=synthetic\n';
  assert.equal(standardHaHlsPlaylist(master), master);
  const bytes = new Uint8Array([1, 2]);
  assert.equal(standardHaHlsPlaylist(bytes), bytes);
});

test("HA owns one configured engine; ordinary HLS policy is instance-local and survives recovery", () => {
  const calls = [];
  class Loader {
    load(context, config, callbacks) { calls.push({ context, config, callbacks }); }
    abort() { this.aborted = true; }
    destroy() { this.destroyed = true; }
  }
  class Hls {
    static DefaultConfig = { lowLatencyMode: true, loader: Loader };
    constructor(config) { this.config = { ...Hls.DefaultConfig, ...config }; }
  }
  const config = Object.freeze({ lowLatencyMode: true, backBufferLength: 60, levelLoadingTimeOut: 30000 });
  const prototype = {
    _renderHLSPolyfill(video, Engine, url) {
      this.video = video;
      this.url = url;
      this.engine = new Engine(config);
      return this.engine;
    },
  };
  const original = prototype._renderHLSPolyfill;
  const owned = Object.create(prototype);
  const unrelated = Object.create(prototype);
  configureStandardHaHlsPlayer(owned);
  const wrapper = owned._renderHLSPolyfill;
  configureStandardHaHlsPlayer(owned);
  assert.equal(owned._renderHLSPolyfill, wrapper);
  const video = {};
  for (const url of ["/initial.m3u8", "/recovered.m3u8"]) {
    const engine = owned._renderHLSPolyfill(video, Hls, url);
    assert.equal(engine, owned.engine);
    assert.equal(owned.video, video);
    assert.equal(owned.url, url);
    assert.equal(engine.config.lowLatencyMode, false);
    assert.equal(engine.config.backBufferLength, 60);
    assert.equal(engine.config.levelLoadingTimeOut, 30000);
    const loader = new engine.config.pLoader();
    let received;
    const onError = () => {};
    const context = { url: "https://example.test/playlist.m3u8?auth=synthetic", type: "level" };
    const loaderConfig = { timeout: 30000 };
    loader.load(context, loaderConfig, { onSuccess: (...args) => { received = args; }, onError });
    const call = calls.at(-1);
    assert.equal(call.context, context);
    assert.equal(call.config, loaderConfig);
    assert.equal(call.callbacks.onError, onError);
    const response = { url: context.url, data: '#EXTM3U\n#EXT-X-PART:DURATION=1,URI="part.m4s"\n#EXTINF:6,\nfull.m4s\n' };
    const stats = {};
    const networkDetails = {};
    call.callbacks.onSuccess(response, stats, context, networkDetails);
    assert.equal(received[0].data, "#EXTM3U\n#EXTINF:6,\nfull.m4s\n");
    assert.equal(received[0].url, response.url);
    assert.deepEqual(received.slice(1), [stats, context, networkDetails]);
    assert.match(response.data, /EXT-X-PART/);
    loader.abort();
    loader.destroy();
    assert.equal(loader.aborted, true);
    assert.equal(loader.destroyed, true);
  }
  assert.equal(prototype._renderHLSPolyfill, original);
  assert.equal(unrelated._renderHLSPolyfill, original);
  assert.equal(unrelated._renderHLSPolyfill({}, Hls, "/other.m3u8").config.lowLatencyMode, true);
  assert.equal(Hls.DefaultConfig.lowLatencyMode, true);
  assert.throws(() => configureStandardHaHlsPlayer({}), /Unsupported Home Assistant HLS/);
});
