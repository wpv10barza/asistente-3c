import { randomUUID, timingSafeEqual } from "node:crypto";

export const DEVICE_COMMAND_TTL_MS = 15 * 60 * 1000;
export const DEVICE_COMMAND_LIMIT = 50;

export type DeviceCommandStatus = "pending_confirmation" | "applied" | "rejected";

export type DeviceCommand = {
  id: string;
  request_id: string;
  device_id: string;
  text: string;
  status: DeviceCommandStatus;
  created_at: string;
  updated_at: string;
  result?: string;
};

function cleanSingleLine(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizeDeviceCommand(body: unknown) {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const deviceId = cleanSingleLine(value.device_id ?? value.deviceId, 64);
  const text = cleanSingleLine(value.text ?? value.command, 1000);
  const requestId = cleanSingleLine(value.request_id ?? value.requestId, 96) || randomUUID();

  if (!deviceId) throw new Error("device_id es obligatorio.");
  if (!/^[A-Za-z0-9._:-]+$/.test(deviceId)) {
    throw new Error("device_id contiene caracteres no permitidos.");
  }
  if (!text) throw new Error("text es obligatorio.");

  return { deviceId, text, requestId };
}

export function verifyDeviceToken(configuredToken: string | undefined, candidateToken: string | undefined) {
  if (!configuredToken) return false;
  if (!candidateToken) return false;
  const configured = Buffer.from(configuredToken);
  const candidate = Buffer.from(candidateToken);
  return configured.length === candidate.length && timingSafeEqual(configured, candidate);
}

export class DeviceCommandStore {
  private commands: DeviceCommand[] = [];

  constructor(
    private readonly ttlMs = DEVICE_COMMAND_TTL_MS,
    private readonly limit = DEVICE_COMMAND_LIMIT,
    private readonly now = () => Date.now(),
  ) {}

  enqueue(input: { deviceId: string; text: string; requestId: string }) {
    this.prune();
    const duplicate = this.commands.find(command =>
      command.device_id === input.deviceId && command.request_id === input.requestId
    );
    if (duplicate) return { command: duplicate, duplicate: true };

    const timestamp = new Date(this.now()).toISOString();
    const command: DeviceCommand = {
      id: randomUUID(),
      request_id: input.requestId,
      device_id: input.deviceId,
      text: input.text,
      status: "pending_confirmation",
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.commands.push(command);
    if (this.commands.length > this.limit) this.commands.splice(0, this.commands.length - this.limit);
    return { command, duplicate: false };
  }

  latestPending(afterId?: string) {
    this.prune();
    const pending = this.commands.filter(command => command.status === "pending_confirmation");
    if (!pending.length) return null;
    if (!afterId) return pending[pending.length - 1];
    const afterIndex = pending.findIndex(command => command.id === afterId);
    return afterIndex >= 0 ? pending[afterIndex + 1] ?? null : pending[pending.length - 1];
  }

  get(id: string) {
    this.prune();
    return this.commands.find(command => command.id === id) ?? null;
  }

  update(id: string, status: Exclude<DeviceCommandStatus, "pending_confirmation">, result?: string) {
    this.prune();
    const command = this.commands.find(item => item.id === id);
    if (!command) return null;
    if (command.status !== "pending_confirmation") return command;
    command.status = status;
    command.result = cleanSingleLine(result, 300) || undefined;
    command.updated_at = new Date(this.now()).toISOString();
    return command;
  }

  private prune() {
    const cutoff = this.now() - this.ttlMs;
    this.commands = this.commands.filter(command => Date.parse(command.created_at) >= cutoff);
  }
}
