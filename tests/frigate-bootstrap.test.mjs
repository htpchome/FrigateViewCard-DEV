import { test } from "node:test";
import assert from "node:assert/strict";

import { signHomeAssistantPath } from "../src/integrations/frigate/bootstrap.js";

test("signHomeAssistantPath requests an HA auth signature", async () => {
  const calls = [];
  const hass = {
    callWS: async (msg) => {
      calls.push(msg);
      return { path: `${msg.path}&authSig=abc` };
    },
  };

  const signed = await signHomeAssistantPath({
    hass,
    path: "/api/frigate/x?src=front",
  });

  assert.equal(signed, "/api/frigate/x?src=front&authSig=abc");
  assert.deepEqual(calls, [
    {
      type: "auth/sign_path",
      path: "/api/frigate/x?src=front",
      expires: 3600,
    },
  ]);
});
