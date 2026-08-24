import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { DeviceCommandStore } from "../server/deviceCommands.ts";
import { registerDeviceApi } from "../server/deviceApi.ts";

async function withDeviceServer(
  environment: { ESP32_API_TOKEN?: string; ALLOW_INSECURE_DEVICE_API?: string },
  callback: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  registerDeviceApi(app, new DeviceCommandStore(), environment);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("expone health y mantiene confirmacion humana", async () => {
  await withDeviceServer({ ESP32_API_TOKEN: "token-ci" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/device/v1/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.accepts_commands, true);
    assert.equal(body.requires_human_confirmation, true);
    assert.equal(body.protocol_version, "1.0");
  });
});

test("rechaza token incorrecto y acepta reintento idempotente", async () => {
  await withDeviceServer({ ESP32_API_TOKEN: "token-ci" }, async (baseUrl) => {
    const command = {
      device_id: "esp-hi-3c-A1B2C3",
      request_id: "esp-hi-3c-A1B2C3-0001",
      text: "Cambiar la tarea T-030 a cada 30 días",
    };
    const unauthorized = await fetch(`${baseUrl}/api/device/v1/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-3c-device-token": "incorrecto" },
      body: JSON.stringify(command),
    });
    assert.equal(unauthorized.status, 401);

    const send = () =>
      fetch(`${baseUrl}/api/device/v1/commands`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-3c-device-token": "token-ci" },
        body: JSON.stringify(command),
      });
    const accepted = await send();
    assert.equal(accepted.status, 202);
    const acceptedBody = await accepted.json();
    assert.equal(acceptedBody.status, "pending_confirmation");
    assert.equal(acceptedBody.requires_human_confirmation, true);

    const duplicate = await send();
    assert.equal(duplicate.status, 200);
    const duplicateBody = await duplicate.json();
    assert.equal(duplicateBody.duplicate, true);
    assert.equal(duplicateBody.command_id, acceptedBody.command_id);

    const pending = await fetch(`${baseUrl}/api/device/v1/commands/pending`);
    const pendingBody = await pending.json();
    assert.equal(pendingBody.command.id, acceptedBody.command_id);
    assert.equal(pendingBody.command.text, command.text);

    const applied = await fetch(
      `${baseUrl}/api/device/v1/commands/${acceptedBody.command_id}/result`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "applied", result: "Vista previa confirmada" }),
      },
    );
    assert.equal(applied.status, 200);
    assert.equal((await applied.json()).command.status, "applied");
  });
});

