const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-5.6-luna";

export type VisionFrame = {
  imageBase64: string;
  mimeType: string;
  unit: string;
  expiresAt: number;
};

export type VisionReadResult = {
  status: "ok" | "not_readable";
  number_text: string;
  value: number | null;
  reason: string;
  vision_session_id?: string;
};

type ModelPayload = {
  status: "ok" | "not_readable";
  number_text: string;
  reason: string;
};

const NUMBER_PATTERN = /^[-+]?\d+(?:[.,]\d+)?$/;

function normalizeNumberText(raw: string) {
  return raw.trim().replace(/\s+/g, "").replace(/,/g, ".");
}

function sanitizeModelResult(
  model: ModelPayload,
  visionSessionId?: string
): VisionReadResult {
  if (model.status !== "ok") {
    return {
      status: "not_readable",
      number_text: "",
      value: null,
      reason: model.reason || "La lectura no es legible.",
      vision_session_id: visionSessionId,
    };
  }

  const numberText = normalizeNumberText(model.number_text);

  if (!NUMBER_PATTERN.test(numberText)) {
    return {
      status: "not_readable",
      number_text: "",
      value: null,
      reason: "La salida visual no contiene un número inequívoco.",
      vision_session_id: visionSessionId,
    };
  }

  const value = Number(numberText);

  if (!Number.isFinite(value)) {
    return {
      status: "not_readable",
      number_text: "",
      value: null,
      reason: "El valor detectado no es numéricamente válido.",
      vision_session_id: visionSessionId,
    };
  }

  return {
    status: "ok",
    number_text: numberText,
    value,
    reason: "",
    vision_session_id: visionSessionId,
  };
}

export async function readNumberFromFrame(
  frame: VisionFrame,
  visionSessionId?: string
): Promise<VisionReadResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY no esta configurada.");
  }

  const prompt = [
    "Lee únicamente el valor numérico visible de la pantalla o indicador en la imagen.",
    "No infieras, no calcules, no completes dígitos faltantes y no uses valores anteriores.",
    "Si un dígito, signo o separador decimal es ambiguo, responde status=not_readable.",
    "No leas etiquetas, unidades, botones ni texto auxiliar como parte del número.",
    "number_text debe copiar literalmente los dígitos visibles, con un único separador decimal si existe.",
    `Unidad contextual opcional: ${frame.unit || "sin especificar"}.`,
    "",
    "La lectura solo es válida cuando el número está inequívocamente legible.",
  ].join("\n");

  const body = {
    model: DEFAULT_MODEL,
    store: false,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt,
          },
          {
            type: "input_image",
            image_url: `data:${frame.mimeType};base64,${frame.imageBase64}`,
            detail: "high",
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "vision_read_number",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: {
              type: "string",
              enum: ["ok", "not_readable"],
            },
            number_text: {
              type: "string",
            },
            reason: {
              type: "string",
            },
          },
          required: ["status", "number_text", "reason"],
        },
      },
    },
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `OpenAI vision HTTP ${response.status}: ${responseText}`
    );
  }

  const responseJson = JSON.parse(responseText);
  const outputText = String(responseJson.output_text || "").trim();

  if (!outputText) {
    return {
      status: "not_readable",
      number_text: "",
      value: null,
      reason: "El modelo no devolvió una lectura estructurada.",
      vision_session_id: visionSessionId,
    };
  }

  let modelResult: ModelPayload;

  try {
    modelResult = JSON.parse(outputText) as ModelPayload;
  } catch {
    return {
      status: "not_readable",
      number_text: "",
      value: null,
      reason: "La salida estructurada no pudo validarse.",
      vision_session_id: visionSessionId,
    };
  }

  return sanitizeModelResult(modelResult, visionSessionId);
}
