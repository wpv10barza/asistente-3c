import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKEND_MDNS_CONFIG,
  startBackendMdnsAdvertisement,
} from "../server/mdns.ts";

test("publica el servicio estable _3c._tcp del backend", async () => {
  let captured: Record<string, unknown> | undefined;
  let stopped = false;

  const stop = startBackendMdnsAdvertisement(3000, (options) => {
    captured = options;
    return async () => {
      stopped = true;
    };
  });

  assert.deepEqual(captured, {
    ...BACKEND_MDNS_CONFIG,
    port: 3000,
    txt: {
      service: "asistente-3c",
      protocol: "1.0",
    },
  });

  await stop();
  assert.equal(stopped, true);
});

test("rechaza un puerto mDNS invalido", () => {
  assert.throws(
    () =>
      startBackendMdnsAdvertisement(0, () => async () => undefined),
    /Puerto mDNS invalido/,
  );
});
