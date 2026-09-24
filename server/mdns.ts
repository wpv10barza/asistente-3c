import { advertise } from "dnssd-advertise";

export const BACKEND_MDNS_CONFIG = {
  name: "3C Backend",
  type: "3c",
  protocol: "tcp",
  hostname: "3c-backend",
  txt: {
    service: "asistente-3c",
    protocol: "1.0",
  },
} as const;

type AdvertisementStop = () => Promise<void>;
type AdvertisementOptions = {
  name: string;
  type: string;
  protocol: "tcp" | "udp";
  port: number;
  hostname: string;
  txt?: Record<string, string>;
};

type AdvertiseFunction = (
  options: AdvertisementOptions,
) => AdvertisementStop;

export function startBackendMdnsAdvertisement(
  port: number,
  advertiseFn: AdvertiseFunction = advertise as AdvertiseFunction,
): AdvertisementStop {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Puerto mDNS invalido: ${port}`);
  }

  return advertiseFn({
    ...BACKEND_MDNS_CONFIG,
    port,
    txt: { ...BACKEND_MDNS_CONFIG.txt },
  });
}
