import { GoogleGenAI, Type } from "@google/genai";

const MAX_CAPTURE_BYTES = 1_500_000;
const CAPTURE_TTL_MS = 60_000;
const MAX_CAPTURES = 12;

export type VisionCapture = {
  id: string;
  mimeType: string;
  bytes: Buffer;
  localOcrText: string;
  createdAt: number;
};

type VisionReadResult = {
  status: "READ" | "NOT_LEGIBLE" | "CONFLICT";
  number: string;
  raw_text: string;
  reason: string;
};

const captures = new Map<string, VisionCapture>();

function pruneCaptures() {
  const now = Date.now();
  for (const [id, capture] of captures) {
    if (now - capture.createdAt > CAPTURE_TTL_MS) captures.delete(id);
  }
  while (captures.size > MAX_CAPTURES) {
    const oldest = captures.keys().next().value;
    if (oldest) captures.delete(oldest);
  }
}

export function registerVisionCapture(input: {
  base64: string;
  mimeType?: string;
  localOcrText?: string;
}) {
  pruneCaptures();

  const normalized = String(input.base64 || "")
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\\s+/g, "");

  if (!normalized) throw new Error("No se recibió imagen para visión.");
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw new Error("La captura no está codificada en Base64 válido.");
  }

  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length === 0) throw new Error("La captura de visión está vacía.");
  if (bytes.length > MAX_CAPTURE_BYTES) {
    throw new Error(`La captura supera el límite de ${MAX_CAPTURE_BYTES} bytes.`);
  }

  const id = `vision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  captures.set(id, {
    id,
    mimeType: String(input.mimeType || "image/jpeg"),
    bytes,
    localOcrText: String(input.localOcrText || "").slice(0, 500),
    createdAt: Date.now(),
  });

  return { capture_id: id, expires_in_ms: CAPTURE_TTL_MS };
}

function getCapture(id: string) {
  pruneCaptures();
  const capture = captures.get(id);
  if (!capture) throw new Error("La captura de visión no existe o ya expiró.");
  return capture;
}

const NUMBER_PATTERN = /^-?(?:\\d+)(?:\\.\\d+)?$/;

function normalizeNumber(value: unknown) {
  const text = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!NUMBER_PATTERN.test(text)) return "";
  return text;
}

export const VISION_READ_NUMBER_DECLARATION = {
  name: "vision_read_number",
  description:
    "Lee un único valor numérico visible en una captura de cámara. Debe llamarse solamente cuando la tarea requiere leer un número de una pantalla, indicador o instrumento. Nunca estima, redondea, calcula ni completa dígitos que no sean visibles.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      capture_id: {
        type: Type.STRING,
        description: "Identificador de una captura previamente registrada por ScaleVision.",
      },
      instruction: {
        type: Type.STRING,
        description:
          "Contexto opcional del valor solicitado, por ejemplo 'lectura de peso del indicador central'.",
      },
    },
    required: ["capture_id"],
  },
};

const VISION_READER_PROMPT = `
Eres el lector numérico visual de ScaleVision.

OBJETIVO:
Leer únicamente el número que está VISUALMENTE PRESENTE en la pantalla o indicador principal de la imagen.

REGLAS INMUTABLES:
- No inventes, completes, redondees, corrijas ni calcules dígitos.
- Si un solo dígito, signo o separador decimal no es claramente legible, devuelve NOT_LEGIBLE.
- Si hay más de una lectura plausible, devuelve NOT_LEGIBLE.
- Ignora unidades, etiquetas, NET/TARE/ZERO/HOLD/STABLE y cualquier número auxiliar que no sea la lectura principal.
- No uses el contexto de la conversación para adivinar el número.
- Devuelve el separador decimal como punto.
- Conserva los ceros visibles.
- Si la imagen no permite una lectura segura, number debe ser una cadena vacía.
`;

export async function executeVisionReadNumber(
  ai: GoogleGenAI,
  model: string,
  args: Record<string, unknown>,
) {
  const captureId = String(args.capture_id || "").trim();
  if (!captureId) throw new Error("vision_read_number requiere capture_id.");

  const capture = getCapture(captureId);
  const instruction = String(args.instruction || "").trim();
  const localOcr = capture.localOcrText
    ? `OCR auxiliar del dispositivo (NO es una fuente autoritativa): ${JSON.stringify(capture.localOcrText)}`
    : "No hay OCR auxiliar disponible.";

  const response = await ai.models.generateContent({
    model,
    contents: [{
      role: "user",
      parts: [
        { text: `${VISION_READER_PROMPT}
${instruction ? `CONTEXTO: ${instruction}\n` : ""}
${localOcr}

Responde solo con el esquema estructurado solicitado.` },
        {
          inlineData: {
            mimeType: capture.mimeType,
            data: capture.bytes.toString("base64"),
          },
        },
      ],
    }],
    config: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          status: {
            type: Type.STRING,
            enum: ["READ", "NOT_LEGIBLE", "CONFLICT"],
          },
          number: { type: Type.STRING },
          raw_text: { type: Type.STRING },
          reason: { type: Type.STRING },
        },
        required: ["status", "number", "raw_text", "reason"],
      },
    },
  });

  let parsed: VisionReadResult;
  try {
    parsed = JSON.parse(response.text || "{}");
  } catch {
    parsed = {
      status: "NOT_LEGIBLE",
      number: "",
      raw_text: "",
      reason: "El lector visual no devolvió JSON válido.",
    };
  }

  const normalizedNumber = normalizeNumber(parsed.number);
  const status = parsed.status === "READ" && normalizedNumber
    ? "READ"
    : parsed.status === "CONFLICT"
      ? "CONFLICT"
      : "NOT_LEGIBLE";

  return {
    tool: "vision_read_number",
    capture_id: captureId,
    status,
    number: status === "READ" ? normalizedNumber : null,
    raw_text: String(parsed.raw_text || "").slice(0, 200),
    reason: String(parsed.reason || "").slice(0, 500),
  };
}

export async function runVisionReadNumberAgent(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
  captureId: string,
) {
  const userPrompt = `
La solicitud actual requiere una lectura numérica visual SOLO si realmente corresponde:
${prompt}

CAPTURE_ID DISPONIBLE: ${captureId}

Debes usar vision_read_number para obtener la lectura. No generes un número por tu cuenta. Si la herramienta devuelve NOT_LEGIBLE o CONFLICT, informa que no se puede determinar la lectura con seguridad.
`;

  const response = await ai.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      tools: [{
        functionDeclarations: [VISION_READ_NUMBER_DECLARATION],
      }],
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: ["vision_read_number"],
        },
      },
      systemInstruction:
        "El resultado de vision_read_number es la única fuente autorizada para el valor numérico. Nunca sustituyas un valor faltante por una estimación.",
    },
  });

  const functionCall = response.functionCalls?.find(
    call => call.name === "vision_read_number",
  );

  if (!functionCall) {
    return {
      answer: "No se ejecutó la lectura numérica.",
      tool_result: null,
    };
  }

  const toolResult = await executeVisionReadNumber(
    ai,
    model,
    functionCall.args || {},
  );

  const history = [
    ...(response.candidates?.[0]?.content
      ? [
          { role: "user" as const, parts: [{ text: userPrompt }] },
          response.candidates[0].content,
        ]
      : [{ role: "user" as const, parts: [{ text: userPrompt }] }]),
    {
      role: "user" as const,
      parts: [{
        functionResponse: {
          name: "vision_read_number",
          response: toolResult,
        },
      }],
    },
  ];

  const finalResponse = await ai.models.generateContent({
    model,
    contents: history,
    config: {
      temperature: 0,
      systemInstruction:
        "Resume el resultado de la herramienta. Nunca introduzcas ni transformes un número que no esté en tool_result.number. Si tool_result.status no es READ, declara que la lectura no es segura.",
    },
  });

  return {
    answer: finalResponse.text || "",
    tool_result: toolResult,
  };
}
