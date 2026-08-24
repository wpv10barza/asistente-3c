import type { Express } from "express";
import type { DeviceCommandStore } from "./deviceCommands.js";
import { normalizeDeviceCommand, verifyDeviceToken } from "./deviceCommands.js";

export const DEVICE_API_PATHS = {
  health: "/api/device/v1/health",
  commands: "/api/device/v1/commands",
  pending: "/api/device/v1/commands/pending",
  result: "/api/device/v1/commands/:id/result",
} as const;

type DeviceApiEnvironment = {
  ESP32_API_TOKEN?: string;
  ALLOW_INSECURE_DEVICE_API?: string;
};

export function registerDeviceApi(
  app: Express,
  deviceCommands: DeviceCommandStore,
  environment: DeviceApiEnvironment = process.env,
) {
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "asistente-3c",
      device_api_configured: Boolean(environment.ESP32_API_TOKEN),
    });
  });

  app.get(DEVICE_API_PATHS.health, (_req, res) => {
    res.json({
      ok: true,
      service: "asistente-3c-device-api",
      accepts_commands:
        Boolean(environment.ESP32_API_TOKEN) ||
        environment.ALLOW_INSECURE_DEVICE_API === "true",
      requires_human_confirmation: true,
      protocol_version: "1.0",
    });
  });

  app.post(DEVICE_API_PATHS.commands, (req, res) => {
    try {
      const configuredToken = environment.ESP32_API_TOKEN;
      const allowInsecure = environment.ALLOW_INSECURE_DEVICE_API === "true";
      const bearer = req.get("authorization")?.replace(/^Bearer\s+/i, "");
      const candidateToken = req.get("x-3c-device-token") || bearer;

      if (!configuredToken && !allowInsecure) {
        return res
          .status(503)
          .json({ error: "ESP32_API_TOKEN no esta configurado en el servidor." });
      }
      if (configuredToken && !verifyDeviceToken(configuredToken, candidateToken)) {
        return res.status(401).json({ error: "Token del dispositivo invalido." });
      }

      const input = normalizeDeviceCommand(req.body);
      const queued = deviceCommands.enqueue(input);
      return res.status(queued.duplicate ? 200 : 202).json({
        command_id: queued.command.id,
        request_id: queued.command.request_id,
        status: queued.command.status,
        duplicate: queued.duplicate,
        requires_human_confirmation: true,
        message:
          "Comando recibido. Abra el Asistente 3C para revisar y confirmar los cambios.",
      });
    } catch (error: any) {
      return res
        .status(400)
        .json({ error: error.message || "Comando del dispositivo invalido." });
    }
  });

  app.get(DEVICE_API_PATHS.pending, (req, res) => {
    const afterId = String(req.query.after || "").trim() || undefined;
    const command = deviceCommands.latestPending(afterId);
    res.json({ command });
  });

  app.post(DEVICE_API_PATHS.result, (req, res) => {
    const status = req.body?.status;
    if (status !== "applied" && status !== "rejected") {
      return res.status(400).json({ error: "status debe ser applied o rejected." });
    }
    const command = deviceCommands.update(
      req.params.id,
      status,
      req.body?.result,
    );
    if (!command) {
      return res.status(404).json({ error: "Comando no encontrado o vencido." });
    }
    return res.json({ command });
  });
}

