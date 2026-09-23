import { Type } from "@google/genai";
import {
  readNumberFromFrame,
  type VisionFrame,
  type VisionReadResult,
} from "./visionReadNumber.js";

const FRAMES = new Map<string, VisionFrame>();
const FRAME_TTL_MS = 60_000;

export const VISION_READ_NUMBER_FUNCTION = {
  name: "vision_read_number",
  description:
    "Lee el número visible en la captura actual de ScaleVision. Úsala únicamente cuando se necesite una lectura numérica. Si la imagen no es inequívocamente legible, devuelve not_readable. Nunca infiere ni completa dígitos.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      vision_session_id: {
        type: Type.STRING,
        description:
          "Identificador de la captura temporal más reciente de ScaleVision.",
      },
    },
    required: ["vision_session_id"],
  },
};

function cleanup() {
  const now = Date.now();
  for (const [id, frame] of FRAMES) {
    if (frame.expiresAt <= now) {
      FRAMES.delete(id);
    }
  }
}

export function saveVisionFrame(args: {
  imageBase64: string;
  mimeType?: string;
  unit?: string;
}) {
  cleanup();

  const id = `vision-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  FRAMES.set(id, {
    imageBase64: args.imageBase64,
    mimeType: args.mimeType || "image/jpeg",
    unit: args.unit || "",
    expiresAt: Date.now() + FRAME_TTL_MS,
  });

  return id;
}

export async function executeVisionReadNumber(
  visionSessionId: string
): Promise<VisionReadResult> {
  const frame = FRAMES.get(visionSessionId);

  if (!frame || frame.expiresAt <= Date.now()) {
    FRAMES.delete(visionSessionId);

    return {
      status: "not_readable",
      number_text: "",
      value: null,
      reason: "La captura visual ya no está disponible.",
      vision_session_id: visionSessionId,
    };
  }

  return readNumberFromFrame(frame, visionSessionId);
}
