import assert from "node:assert/strict";
import test from "node:test";
import { DeviceCommandStore, normalizeDeviceCommand, verifyDeviceToken } from "../server/deviceCommands.ts";

test("normaliza el contrato enviado por el ESP32", () => {
  const command = normalizeDeviceCommand({
    device_id: "esp-hi-3c-01",
    command: "  Cambia\nla tarea J10 a mensual  ",
    request_id: "req-1",
  });
  assert.deepEqual(command, {
    deviceId: "esp-hi-3c-01",
    text: "Cambia la tarea J10 a mensual",
    requestId: "req-1",
  });
});

test("rechaza comandos incompletos", () => {
  assert.throws(() => normalizeDeviceCommand({ device_id: "esp-hi-01" }), /text es obligatorio/);
  assert.throws(() => normalizeDeviceCommand({ text: "hola" }), /device_id es obligatorio/);
});

test("compara el token sin aceptar variantes", () => {
  assert.equal(verifyDeviceToken("secreto-123", "secreto-123"), true);
  assert.equal(verifyDeviceToken("secreto-123", "secreto-124"), false);
  assert.equal(verifyDeviceToken(undefined, "secreto-123"), false);
});

test("mantiene idempotencia y requiere confirmacion", () => {
  let now = Date.parse("2026-08-23T20:00:00.000Z");
  const store = new DeviceCommandStore(60_000, 10, () => now);
  const first = store.enqueue({ deviceId: "esp-hi-01", text: "Tarea J10 mensual", requestId: "abc" });
  const repeated = store.enqueue({ deviceId: "esp-hi-01", text: "Tarea J10 mensual", requestId: "abc" });
  assert.equal(first.duplicate, false);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.command.id, first.command.id);
  assert.equal(store.latestPending()?.status, "pending_confirmation");
  assert.equal(store.get(first.command.id)?.id, first.command.id);

  const applied = store.update(first.command.id, "applied", "Fila 10 actualizada");
  assert.equal(applied?.status, "applied");
  assert.equal(store.latestPending(), null);

  now += 61_000;
  assert.equal(store.get(first.command.id), null);
  assert.equal(store.update(first.command.id, "rejected"), null);
});
