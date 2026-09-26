import assert from "node:assert/strict";
import test from "node:test";
import {
  backendDiscoveryDescriptor,
  backendDiscoveryOptions,
  BACKEND_DISCOVERY_DEFAULTS,
} from "../server/backendDiscovery.ts";

test("construye el anuncio mDNS canonico del backend 3C", () => {
  const options = backendDiscoveryOptions(3000, {});
  assert.equal(options.type, BACKEND_DISCOVERY_DEFAULTS.service);
  assert.equal(options.protocol, "tcp");
  assert.equal(options.hostname, "3c-backend.local");
  assert.equal(options.port, 3000);
  assert.equal(options.name, "3C Backend");
  assert.deepEqual(options.txt, {
    protocol: "1.0",
    health: "/api/device/v1/health",
  });
});

test("permite cambiar identidad y puerto por entorno sin hardcodear IP", () => {
  const options = backendDiscoveryOptions(4311, {
    MDNS_SERVICE: "3c",
    MDNS_HOST: "3c-backend.local",
    MDNS_NAME: "3C Backend Principal",
  });
  assert.equal(options.port, 4311);
  assert.equal(options.hostname, "3c-backend.local");
  assert.equal(options.name, "3C Backend Principal");
});

test("expone descriptor identico al contrato que consume el ESP32", () => {
  assert.deepEqual(backendDiscoveryDescriptor(3000, {}), {
    service: "_3c._tcp",
    logical_host: "3c-backend.local",
    port: 3000,
    instance_name: "3C Backend",
  });
});

test("puede desactivarse mDNS de forma explicita", async () => {
  const { startBackendDiscovery } = await import("../server/backendDiscovery.ts");
  assert.equal(startBackendDiscovery(3000, { MDNS_ENABLED: "false" }), null);
});
