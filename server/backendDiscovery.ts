import { advertise } from "dnssd-advertise";

export const BACKEND_DISCOVERY_DEFAULTS = {
  service: "3c",
  protocol: "tcp" as const,
  hostname: "3c-backend.local",
  name: "3C Backend",
} as const;

export function backendDiscoveryOptions(
  port: number,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const service = String(
    environment.MDNS_SERVICE || BACKEND_DISCOVERY_DEFAULTS.service,
  ).trim();
  const hostname = String(
    environment.MDNS_HOST || BACKEND_DISCOVERY_DEFAULTS.hostname,
  ).trim();
  const name = String(
    environment.MDNS_NAME || BACKEND_DISCOVERY_DEFAULTS.name,
  ).trim();

  if (!service) throw new Error("MDNS_SERVICE no puede estar vacio.");
  if (!hostname) throw new Error("MDNS_HOST no puede estar vacio.");
  if (!name) throw new Error("MDNS_NAME no puede estar vacio.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Puerto mDNS invalido: ${port}`);
  }

  return {
    name,
    type: service,
    protocol: "tcp" as const,
    port,
    hostname,
    txt: {
      protocol: "1.0",
      health: "/api/device/v1/health",
    },
  };
}

export function backendDiscoveryDescriptor(
  port: number,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const options = backendDiscoveryOptions(port, environment);
  return {
    service: `_${options.type}._${options.protocol}`,
    logical_host: options.hostname,
    port: options.port,
    instance_name: options.name,
  };
}

export function startBackendDiscovery(
  port: number,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (String(environment.MDNS_ENABLED || "true").toLowerCase() === "false") {
    return null;
  }

  return advertise(backendDiscoveryOptions(port, environment));
}
