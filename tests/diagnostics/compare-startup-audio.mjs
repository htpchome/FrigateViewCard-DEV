import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from '@playwright/test';

// Optional controller-level comparison, not a full ACC/HA integration test.
// Usage: node tests/diagnostics/compare-startup-audio.mjs /path/to/acc [file|webrtc] [browser-profile]
// Uses an existing ACC checkout; never installs it or accesses live cameras.
// Only the separate synthetic WebRTC sender is driven through page.evaluate.
// Receiver startup and reporting are page-owned, with no injected user gesture.
const root = fileURLToPath(new URL('../../', import.meta.url));
if (!process.argv[2]) throw new Error('Provide the path to an existing ACC source checkout.');
const acc = resolve(process.argv[2]);
const transport = process.argv[3] || 'file';
if (!['file', 'webrtc'].includes(transport)) throw new Error('Expected file or webrtc.');
const browserFilter = process.argv[4];
if (browserFilter && !['chromium-allow', 'chromium-block', 'firefox-allow', 'firefox-block', 'webkit'].includes(browserFilter)) {
  throw new Error('Unknown browser profile.');
}
console.log(JSON.stringify({ transport, accRevision: execFileSync('git', ['-C', acc, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim() }));
const bundle = await build({ stdin: {contents: `export {VideoMediaPlayerController} from './src/components-lib/media-player/video.ts'; export {MediaActionsController} from './src/components-lib/media-actions-controller.ts';`, resolveDir: acc},
  bundle: true, format: 'esm', write: false,
  plugins: [{name: 'unused-date-format', setup(b) {
    b.onResolve({filter: /^date-fns$/}, () => ({path: 'date-fns', external: true, sideEffects: false}));
  }}],
});
const movie = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=15:duration=12',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
  '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], {maxBuffer: 8*1024*1024});
const script = `
import { VideoMediaPlayerController, MediaActionsController } from '/acc.js';
import { LiveAudioController } from '/src/features/live/audio.ctrl.js';
import { createGo2RtcMounter } from '/src/features/live/go2rtc-mounter.js';
import { waitForMediaStart } from '/src/shared/media/first-frame.js';
const mode = new URL(location.href).searchParams.get('mode');
const transport = new URL(location.href).searchParams.get('transport');
let video = document.createElement('video');
video.muted = true;
video.playsInline = true;
video.preload = 'auto';
document.body.append(video);
window.audit = { mode, events: [], plays: [], initialActivation: navigator.userActivation?.hasBeenActive };
const observeVideo = element => {
  for (const e of ['loadedmetadata','loadeddata','canplay','play','playing','pause','volumechange','error']) {
    element.addEventListener(e, () => audit.events.push({event: e, muted: element.muted, ready: element.readyState}));
  }
  const play = element.play.bind(element);
  element.play = () => {
    const record = {muted: element.muted, ready: element.readyState, activation: navigator.userActivation?.hasBeenActive};
    audit.plays.push(record);
    return play().then(() => {record.result = 'ok';}, error => {record.result = error.name; throw error;});
  };
};
observeVideo(video);
const host = {_activeCam: {entity: 'camera.test', start_unmuted: true}, _engine: null,
 _renderMuteButton() {}, _findVideoDeep: e => e?.video};
let ready = false;
let fvcController;
if (mode.startsWith('acc')) {
  const controller = new VideoMediaPlayerController({updateComplete: Promise.resolve(), addController() {}}, () => video);
  const player = document.createElement('div');
  player.className = 'player';
  player.getMediaPlayerController = async () => mode === 'acc-ha' && !ready ? null : controller;
  document.body.append(player);
  player.append(video);
  const actions = new MediaActionsController();
  actions.setOptions({playerSelector: '.player', autoUnmuteConditions: ['selected'], autoPlayConditions: ['selected']});
  actions.setRoot(document.body);
  void actions.setTarget(0, true);
  video.addEventListener('loadeddata', () => {ready = true; player.dispatchEvent(new Event('advanced-camera-card:media:loaded'));});
} else {
  const controller = new LiveAudioController(host, {interactionTarget: document});
  fvcController = controller;
  controller.prepareCameraStart(host._activeCam);
  if (mode === 'fvc') {
    const startup = controller.createInitialPlayback(video, {entity: 'camera.test'});
    video.addEventListener('playing', () => {
      host._engine = {video};
      controller.applyCameraStartPreference();
    }, {once:true});
    window.startup = startup;
  }
}
let pc;
if (mode === 'fvc-go2rtc') {
  // Production mounter and frame-readiness code; only signaling is local.
  // Disable public STUN for this loopback experiment, not in production.
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    constructor(config) {super({...config, iceServers:[]}); pc = this;}
  };
  window.WebSocket = class extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor() {super(); setTimeout(() => this.dispatchEvent(new Event('open')), 0);}
    async send(data) {
      const message = JSON.parse(data);
      if (message.type !== 'webrtc/offer') return;
      if (pc.iceGatheringState !== 'complete') await new Promise(resolve => pc.addEventListener('icegatheringstatechange', () => {if(pc.iceGatheringState==='complete') resolve();}));
      const answer = await (await fetch('/answer', {method:'POST',body:JSON.stringify(pc.localDescription)})).json();
      this.dispatchEvent(new MessageEvent('message', {data:JSON.stringify({type:'webrtc/answer',value:answer.sdp})}));
    }
    close() {this.readyState = 3;}
  };
  const slot = document.createElement('div');document.body.append(slot);
  const mounter = createGo2RtcMounter({
    resolver: {resolveMountRequest: options => ({...options,commit:true}), websocketUrlForEntity: async () => 'ws://localhost/synthetic'},
    getStreamMuted: () => host._streamMuted,
    createStartupPlayback: (element, options) =>
      fvcController.createInitialPlayback(element, options),
    attachVideoFit: element => {video.remove(); video = element; observeVideo(video);},
    assignCommittedEngine: engine => {host._engine = engine;},
    onCommittedStream: () => fvcController.applyCameraStartPreference(),
    scheduleResumeLive() {}, isFirefox: () => navigator.userAgent.includes('Firefox'),
    waitForStreamStart: (element, timeout, options) => waitForMediaStart(element, timeout, {...options,resolveVideo: root => root.querySelector('video')}),
  });
  audit.mounted = await mounter.tryMountWebRtc(slot, {waitMs:12000}, {entity:'camera.test',negotiationTimeoutMs:12000});
} else if (transport === 'webrtc') {
  pc = new RTCPeerConnection({iceServers:[]});
  pc.addTransceiver('video', {direction:'recvonly'});
  pc.addTransceiver('audio', {direction:'recvonly'});
  if (mode === 'acc-go2rtc') {
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected' && !video.srcObject) {
        video.srcObject = new MediaStream(pc.getReceivers().map(r => r.track));
      }
    });
  } else {
    pc.addEventListener('track', e => {
      video.srcObject ??= new MediaStream();
      video.srcObject.addTrack(e.track);
      if (mode === 'fvc') void window.startup.play();
    });
  }
  await pc.setLocalDescription(await pc.createOffer());
  if (pc.iceGatheringState !== 'complete') await new Promise(resolve => pc.addEventListener('icegatheringstatechange', () => {if(pc.iceGatheringState==='complete') resolve();}));
  const answer = await (await fetch('/answer', {method:'POST',body:JSON.stringify(pc.localDescription)})).json();
  await pc.setRemoteDescription(answer);
} else {
  video.src = '/media.mp4';
  if (mode === 'fvc') void window.startup.play();
}
setTimeout(async () => {audit.final = {muted: video.muted, paused: video.paused, time: video.currentTime,
 audioTracks: video.audioTracks?.length, decodedAudio: video.webkitAudioDecodedByteCount, mozHasAudio: video.mozHasAudio,
 activation: navigator.userActivation?.hasBeenActive, width: video.videoWidth, readyState: video.readyState,
 peerState: pc?.connectionState, iceState: pc?.iceConnectionState};
 if(pc) audit.audioStats = [...(await pc.getStats()).values()].filter(s => s.type==='inbound-rtp' && (s.kind==='audio' || s.mediaType==='audio')).map(s => ({bytes:s.bytesReceived,energy:s.totalAudioEnergy,samples:s.totalSamplesReceived}));
 fetch('/report', {method:'POST', body:JSON.stringify(audit)});}, 3000);
`;
let report;
let senderPage;
const server = createServer(async (req,res) => {
 const url = new URL(req.url, 'http://localhost');
 if (url.pathname === '/sender') {res.setHeader('Content-Type','text/html'); res.end('<!doctype html><body>');}
 else if (url.pathname === '/answer') {
   let body = ''; for await (const chunk of req) body += chunk;
   const answer = await senderPage.evaluate(async offer => {
     window.senderPc?.close();
     // Each sample gets a fresh tone, not a capture spanning an MP4 loop.
     window.senderVideo?.pause();
     window.senderVideo?.remove();
     const video = document.createElement('video');video.muted=true;video.src='/media.mp4';
     document.body.append(video);await video.play();window.senderVideo=video;
     const stream = window.senderVideo.captureStream();
     const pc = new RTCPeerConnection({iceServers:[]}); window.senderPc=pc;
     await pc.setRemoteDescription(offer);
     for(const track of stream.getTracks()) pc.addTrack(track,stream);
     await pc.setLocalDescription(await pc.createAnswer());
     if(pc.iceGatheringState!=='complete') await new Promise(r => pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete')r();}));
     return pc.localDescription.toJSON();
   }, JSON.parse(body));
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(answer));
 } else if (url.pathname === '/report') {
   let body = ''; for await (const chunk of req) body += chunk;
   report(JSON.parse(body)); res.end();
 } else if (url.pathname === '/acc.js') {res.setHeader('Content-Type','text/javascript'); res.end(bundle.outputFiles[0].text);}
 else if (url.pathname === '/start.js') {res.setHeader('Content-Type','text/javascript'); res.end(script);}
 else if (url.pathname.startsWith('/src/')) {
   try {res.setHeader('Content-Type','text/javascript'); res.end(await readFile(root + url.pathname));}
   catch {res.statusCode=404;res.end();}
 } else if (url.pathname === '/media.mp4') {
   const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
   const start = range ? Number(range[1]) : 0;
   const end = range?.[2] ? Math.min(Number(range[2]),movie.length-1) : movie.length-1;
   res.writeHead(range?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,
     ...(range?{'Content-Range':`bytes ${start}-${end}/${movie.length}`}:{})});
   res.end(movie.subarray(start,end+1));
 } else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><body><script type="module" src="/start.js"></script>');}
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const senderBrowser = await chromium.launch({headless:true, args:['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns']});
senderPage = await senderBrowser.newPage();
await senderPage.goto(`http://127.0.0.1:${server.address().port}/sender`);
try {
 for (const [name,type,options] of [
  ['chromium-allow',chromium,{args:['--autoplay-policy=no-user-gesture-required']}], ['chromium-block',chromium,{args:['--autoplay-policy=document-user-activation-required']}],
  ['firefox-allow',firefox,{firefoxUserPrefs:{'media.autoplay.default':0}}], ['firefox-block',firefox,{firefoxUserPrefs:{'media.autoplay.default':1,'media.autoplay.blocking_policy':2}}],
  ['webkit',webkit,{}],
 ]) {
  if (browserFilter && name !== browserFilter) continue;
  const browser = await type.launch({headless:true,...options});
  try {for (const mode of ['acc-ha','acc-go2rtc','fvc', ...(transport === 'webrtc' ? ['fvc-go2rtc'] : [])]) {
   const context = await browser.newContext();
   const page = await context.newPage();
   page.on('pageerror',e=>console.log(name,mode,'PAGEERROR',e.message));
   let deadline;
   const completed = new Promise((resolveReport, reject) => {
     deadline = setTimeout(() => reject(new Error('Receiver did not report within 20 seconds')), 20000);
     report = resolveReport;
     page.on('pageerror', reject);
   });
   await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}&transport=${transport}`);
   try {
     const result = await completed;
     assert.equal(result.initialActivation, false, 'Receiver must not start with user activation');
     assert.equal(result.final.activation, false, 'Test driver must not activate the receiver');
     const receivedAudio = transport === 'webrtc'
       ? result.audioStats?.some(stats => stats.bytes > 0 && stats.energy > 0)
       : result.final.audioTracks > 0 || result.final.decodedAudio > 0 || result.final.mozHasAudio === true;
     const decodedVideo = result.final.width > 0 && result.final.readyState >= 2;
     // Neither an unmuted flag nor an established peer proves audible output.
     const outcome = !receivedAudio || !decodedVideo ? 'inconclusive'
       : result.final.paused ? 'paused' : result.final.muted ? 'playing-muted' : 'playing-unmuted';
     console.log(JSON.stringify({browser:name, transport, outcome, ...result}));
   } finally {clearTimeout(deadline);}
   await context.close();
  }} finally {await browser.close();}
 }
} finally {await senderBrowser.close();server.close();}
