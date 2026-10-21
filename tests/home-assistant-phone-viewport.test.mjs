import { test } from "node:test";
import assert from "node:assert/strict";
import { HomeAssistantPhoneViewport } from "../src/integrations/home-assistant/phone-viewport.js";

const safari = "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const environment = (options, run) => {
  const names = ["window", "document", "navigator", "getComputedStyle"];
  const originals = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const viewport = { height: 600, scale: 1 };
  const values = {
    window: { visualViewport: viewport, innerHeight: 900, scrollY: 0,
      matchMedia: () => ({ matches: options.standalone === true }) },
    navigator: { userAgent: options.ua || safari },
    document: { scrollingElement: null, body: null, documentElement: null },
    getComputedStyle: (node) => ({ marginBottom: "0px", paddingBottom: "0px", borderBottomWidth: "0px", ...node.css }),
  };
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: values[name] });
  try { run(values); } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
};

test("phone Safari uses visible space and unscrolled geometry, not HA's height hint", () => {
  environment({}, ({ window }) => {
    const geometry = { top: 56 };
    const parent = { scrollTop: 0, css: { paddingBottom: "10px" } };
    const host = { parentElement: parent, getBoundingClientRect: () => ({ top: geometry.top }) };
    const owner = new HomeAssistantPhoneViewport(host);
    assert.equal(owner.resolveHeight(true), 534);
    geometry.top = 16;
    window.scrollY = 40;
    assert.equal(owner.resolveHeight(true), 534);
    geometry.top = -4;
    parent.scrollTop = 20;
    assert.equal(owner.resolveHeight(true), 534);
    window.visualViewport.height = 680;
    assert.equal(owner.resolveHeight(true), 614);
    window.visualViewport.scale = 2;
    assert.equal(owner.resolveHeight(true), null);
  });
});

test("Companion, standalone, desktop and other browser paths remain untouched", () => {
  for (const options of [
    { ua: `${safari} Home Assistant/2026.10` },
    { ua: `${safari} mobile/homeassistant` },
    { ua: "Mozilla/5.0 (Macintosh) Version/18 Safari/604.1" },
    { ua: `${safari} CriOS/140.0` },
    { ua: `${safari} FxiOS/140.0` },
    { standalone: true },
  ]) {
    environment(options, () => {
      const owner = new HomeAssistantPhoneViewport({
        getBoundingClientRect: () => { throw new Error("must not measure excluded clients"); },
      });
      assert.equal(owner.resolveHeight(true), null);
    });
  }
});

test("inactive layouts do not enter phone viewport sizing", () => {
  environment({}, () => {
    const owner = new HomeAssistantPhoneViewport({});
    assert.equal(owner.resolveHeight(false), null);
  });
});
