import type { Express } from "express";
import type { DeviceCommandStore } from "./deviceCommands.js";
import { normalizeDeviceCommand, verifyDeviceToken } from "./deviceCommands.js";

export const DEVICE_API_PATHS = {
  health: "/api/device/v1/health",
  commands: "/api/device/v1/commands",
  pending: "/api/device/v1/commands/pending",
  status: "/api/device/v1/commands/:id",
  result: "/api/device/v1/commands/:id/result",
} as const;

type DeviceApiEnvironment = {
  ESP32_API_TOKEN?: string;
  ALLOW_INSECURE_DEVICE_API?: string;
  PORT?: string;
  MDNS_SERVICE?: string;
  MDNS_HOST?: string;
};

function authorizeDeviceRequest(
  request: { get(name: string): string | undefined },
  environment: DeviceApiEnvironment,
) {
  const configuredToken = environment.ESP32_API_TOKEN;
  const allowInsecure = environment.ALLOW_INSECURE_DEVICE_API === "true";
  const bearer = request.get("authorization")?.replace(/^Bearer\s+/i, "");
  const candidateToken = request.get("x-3c-device-token") || bearer;
  if (!configuredToken && !allowInsecure) {
    return { ok: false as const, status: 503, error: "ESP32_API_TOKEN no esta configurado en el servidor." };
  }
  if (configuredToken && !verifyDeviceToken(configuredToken, candidateToken)) {
    return { ok: false as const, status: 401, error: "Token del dispositivo invalido." };
  }
  return { ok: true as const };
}

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
      supports_status_polling: true,
      discovery: {
        service: `_${environment.MDNS_SERVICE || "3c"}._tcp`,
        logical_host: environment.MDNS_HOST || "3c-backend.local",
        port: Number(environment.PORT || 3000),
      },
    });
  });

  app.post(DEVICE_API_PATHS.commands, (req, res) => {
    try {
      const authorization = authorizeDeviceRequest(req, environment);
      if (!authorization.ok) {
        return res.status(authorization.status).json({ error: authorization.error });
      }

      const input = normalizeDeviceCommand(req.body);
      const queued = deviceCommands.enqueue(input);
      return res.status(queued.duplicate ? 200 : 202).json({
        command_id: queued.command.id,
        request_id: queued.command.request_id,
        status: queued.command.status,
        duplicate: queued.duplicate,
        requires_human_confirmation: true,
        status_path: `/api/device/v1/commands/${queued.command.id}`,
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

  app.get(DEVICE_API_PATHS.status, (req, res) => {
    const authorization = authorizeDeviceRequest(req, environment);
    if (!authorization.ok) {
      return res.status(authorization.status).json({ error: authorization.error });
    }
    const command = deviceCommands.get(req.params.id);
    if (!command) return res.status(404).json({ error: "Comando no encontrado o vencido." });
    return res.json({
      command: {
        id: command.id,
        request_id: command.request_id,
        device_id: command.device_id,
        status: command.status,
        updated_at: command.updated_at,
        result: command.result,
      },
    });
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
