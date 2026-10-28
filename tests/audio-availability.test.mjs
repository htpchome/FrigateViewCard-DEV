import { test } from "node:test";
import assert from "node:assert/strict";
import { watchAudioAvailability } from "../src/shared/media/audio-availability.js";

for (const source of ["stream", "peer", "native"]) {
  test(`${source} reports late audio once and removes listeners`, () => {
    const track = Object.assign(new EventTarget(), { kind: "audio", readyState: "live", muted: true });
    const tracks = [];
    const video = Object.assign(new EventTarget(), {
      srcObject: Object.assign(new EventTarget(), { getAudioTracks: () => source === "stream" ? tracks : [] }),
      audioTracks: Object.assign(new EventTarget(), { length: 0 }),
    });
    const peer = Object.assign(new EventTarget(), { getReceivers: () => source === "peer" ? tracks.map((track) => ({ track })) : [] });
    let calls = 0;
    const stop = watchAudioAvailability(video, peer, () => { calls += 1; });
    tracks.push(track);
    (source === "peer" ? peer : video.srcObject).dispatchEvent(new Event(source === "peer" ? "track" : "addtrack"));
    assert.equal(calls, 0);
    track.muted = false;
    if (source === "native") {
      video.audioTracks.length = 1;
      video.audioTracks.dispatchEvent(new Event("addtrack"));
    } else track.dispatchEvent(new Event("unmute"));
    assert.equal(calls, 1);
    track.dispatchEvent(new Event("unmute"));
    video.dispatchEvent(new Event("canplay"));
    assert.equal(calls, 1);
    stop();
    const stopBeforeAudio = watchAudioAvailability(new EventTarget(), peer, () => { calls += 1; });
    stopBeforeAudio();
    peer.dispatchEvent(new Event("track"));
    assert.equal(calls, 1);
  });
}

test("audio already available at selection does not request another autoplay", () => {
  const track = { kind: "audio", readyState: "live", muted: false };
  const video = Object.assign(new EventTarget(), { srcObject: { getAudioTracks: () => [track] } });
  let calls = 0;
  const stop = watchAudioAvailability(video, null, () => { calls += 1; });
  video.dispatchEvent(new Event("loadeddata"));
  assert.equal(calls, 0);
  stop();
});
