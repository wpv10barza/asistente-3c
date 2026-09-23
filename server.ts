import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { DeviceCommandStore } from "./server/deviceCommands.js";
import { registerDeviceApi } from "./server/deviceApi.js";
import { AnalyticalReviewStore } from "./server/reviewControl.js";
import { registerVisionCapture, runVisionReadNumberAgent } from "./server/visionReadNumber.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) console.warn("GEMINI_API_KEY no esta configurada.");
const ai = new GoogleGenAI({ apiKey: apiKey || "" });
const deviceCommands = new DeviceCommandStore();
const reviewStore = new AnalyticalReviewStore();

const FIELD_RULES = {
  item_mantenible: { column: "B", header: "ItemMantenible", type: "catalog" },
  modo_falla: { column: "C", header: "ModoDeFalla", type: "catalog" },
  restriccion: { column: "H", header: "Restriccion", type: "text" },
  limites_aceptables: { column: "I", header: "LimitesAceptables", type: "long_text" },
  comentarios_condicionales: { column: "J", header: "ComentariosCondicionales", type: "long_text" },
  origen: { column: "K", header: "Origen", type: "text" },
  frecuencia: { column: "L", header: "Frecuencia", type: "positive_integer" },
  unidad_tiempo: { column: "M", header: "UnidadTiempo", type: "time_unit" },
  especialidad: { column: "N", header: "Especialidad", type: "catalog" },
  labour1: { column: "O", header: "Labour1", type: "catalog" }
} as const;

type FieldKey = keyof typeof FIELD_RULES;

function normalizeComparable(value: unknown) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeOperationValue(field: FieldKey, rawValue: unknown, detectedCatalogs: Partial<Record<FieldKey, string[]>>): string | number {
  const rule = FIELD_RULES[field];
  const text = String(rawValue ?? "").trim();

  if (rule.type === "positive_integer") {
    const value = Number(text);
    if (!Number.isInteger(value) || value < 1) throw new Error(`${rule.header} debe ser un entero mayor o igual a uno.`);
    return value;
  }

  if (rule.type === "time_unit") {
    const value = text.toLowerCase();
    const aliases: Record<string, string> = {
      mensual: "Mes", mes: "Mes", meses: "Mes",
      anual: "año", ano: "año", año: "año", anos: "año", años: "año",
      semanal: "Semana", semana: "Semana", semanas: "Semana",
      diario: "Dia", diaria: "Dia", dia: "Dia", dias: "Dia",
      hora: "Hora", horas: "Hora"
    };
    const mapped = aliases[value];
    if (!mapped) throw new Error(`Unidad de tiempo no valida: ${text}.`);
    return mapped;
  }

  if (!text) throw new Error(`${rule.header} no puede quedar vacio.`);
  if (rule.type === "long_text" && /(\.\.\.|…|\betc\.?\b)/i.test(text)) {
    throw new Error(`${rule.header} debe contener el texto completo, sin puntos suspensivos ni etcetera.`);
  }
  if (rule.type === "catalog") {
    const catalog = detectedCatalogs[field] || [];
    const match = catalog.find(value => normalizeComparable(value) === normalizeComparable(text));
    if (!match) throw new Error(`${rule.header} debe coincidir con un valor ya existente en la hoja.`);
    return match;
  }
  return text;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  app.use(express.json({ limit: "6mb" }));

  // Numeric vision is intentionally isolated from the normal command parser.
  // ScaleVision registers one still image only when a numeric read is requested;
  // Gemini can then call vision_read_number against that short-lived capture.

  registerDeviceApi(app, deviceCommands);

  app.get("/api/config", (_req, res) => {
    try {
      const configPath = path.join(process.cwd(), "firebase-applet-config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      res.json({
        clientId: config.oAuthClientId,
        spreadsheetId: process.env.SPREADSHEET_ID || config.spreadsheetId || "",
        sheetName: process.env.SHEET_NAME || "Data",
        headerRow: Number(process.env.HEADER_ROW || 4),
        searchColumn: "F"
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "No se pudo cargar la configuracion." });
    }
  });

  app.post("/api/review/proposals", (req, res) => {
    try {
      const proposal = reviewStore.propose({
        row: Number(req.body?.row),
        matched: String(req.body?.matched || "").trim(),
        operations: req.body?.operations || [],
        externalCommandId: req.body?.externalCommandId ? String(req.body.externalCommandId) : undefined,
      });
      res.status(201).json(proposal);
    } catch (error: any) {
      res.status(409).json({ error: error.message || "No se pudo guardar la propuesta." });
    }
  });

  app.get("/api/review/proposals/:id", (req, res) => {
    try {
      res.json(reviewStore.get(req.params.id));
    } catch (error: any) {
      res.status(404).json({ error: error.message || "Propuesta no encontrada." });
    }
  });

  app.post("/api/review/proposals/:id/approve", (req, res) => {
    try {
      res.json(reviewStore.approve(req.params.id));
    } catch (error: any) {
      res.status(409).json({ error: error.message || "La propuesta no puede aprobarse." });
    }
  });

  app.post("/api/review/proposals/:id/reject", (req, res) => {
    try {
      res.json(reviewStore.reject(req.params.id));
    } catch (error: any) {
      res.status(404).json({ error: error.message || "Propuesta no encontrada." });
    }
  });

  app.post("/api/vision/captures", (req, res) => {
    try {
      const capture = registerVisionCapture({
        base64: String(req.body?.image_base64 || ""),
        mimeType: req.body?.mime_type ? String(req.body.mime_type) : undefined,
        localOcrText: req.body?.local_ocr_text ? String(req.body.local_ocr_text) : undefined,
      });
      res.status(201).json(capture);
    } catch (error: any) {
      console.error("Vision capture error:", error);
      res.status(400).json({ error: error.message || "No se pudo registrar la captura de visión." });
    }
  });

  app.post("/api/vision/agent", async (req, res) => {
    try {
      if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no esta configurada." });

      const prompt = String(req.body?.prompt || "").trim();
      const captureId = String(req.body?.capture_id || "").trim();
      if (!prompt) return res.status(400).json({ error: "prompt es obligatorio." });
      if (!captureId) return res.status(400).json({ error: "capture_id es obligatorio." });

      const result = await runVisionReadNumberAgent(
        ai,
        process.env.GEMINI_MODEL || "gemini-2.5-flash",
        prompt,
        captureId,
      );

      res.json(result);
    } catch (error: any) {
      console.error("Vision agent error:", error);
      res.status(400).json({ error: error.message || "No se pudo ejecutar la lectura visual." });
    }
  });

  app.post("/api/extract", async (req, res) => {
    try {
      const text = String(req.body?.text || "").trim();
      const detectedHeaders = req.body?.detectedHeaders || {};
      const detectedCatalogs = req.body?.detectedCatalogs || {};
      if (!text) return res.status(400).json({ error: "Text is required" });
      if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no esta configurada." });

      const allowedFields = Object.entries(FIELD_RULES)
        .map(([key, rule]) => `${key}=${rule.column}:${rule.header}`)
        .join(", ");

      const prompt = `Eres un parser determinista de comandos de voz para una estrategia Excel 3C.
No ejecutas cambios; solo produces operaciones JSON que luego seran validadas por el backend.

REGLAS INMUTABLES:
- La tarea se localiza por Nombre en columna F, o por TareaId si el usuario lo dice explicitamente.
- No inventes columnas, encabezados, IDs ni valores.
- Solo puedes modificar los campos permitidos: ${allowedFields}.
- Solo se modifican B, C, H, I, J, K, L, M, N y O. Todas las demas columnas estan bloqueadas.
- "mensual" significa frecuencia=1 y unidad_tiempo="Mes", salvo que el usuario indique otro numero.
- "anual" significa frecuencia=1 y unidad_tiempo="año", salvo que el usuario indique otro numero.
- "cada N meses" significa frecuencia=N y unidad_tiempo="Mes".
- "cada N años" significa frecuencia=N y unidad_tiempo="año".
- Si pide cambiar limite, por que/porque, criterio aceptable o aceptacion, usa limites_aceptables (I).
- Si pide comentario, instruccion, procedimiento u observacion condicional, usa comentarios_condicionales (J).
- Conserva completo el texto descriptivo. No uses "...", "…" ni "etc.".
- ItemMantenible, ModoDeFalla, Especialidad y Labour1 deben usar exactamente un valor existente en sus catalogos.
- Frecuencia debe ser un numero entero mayor o igual a 1.
- Si falta tarea o valor, devuelve requiere_revision=true y explica el motivo.
- Puedes devolver varias operaciones para una misma tarea.

ENCABEZADOS DETECTADOS EN LA HOJA:
${JSON.stringify(detectedHeaders)}

CATALOGOS EXISTENTES PERMITIDOS:
${JSON.stringify(detectedCatalogs)}

COMANDO:
${JSON.stringify(text)}`;

      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tarea_buscada: { type: Type.STRING },
              tarea_id: { type: Type.STRING },
              operaciones: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    campo: { type: Type.STRING, enum: Object.keys(FIELD_RULES) },
                    valor: { type: Type.STRING },
                    razon: { type: Type.STRING }
                  },
                  required: ["campo", "valor"]
                }
              },
              requiere_revision: { type: Type.BOOLEAN },
              motivo_revision: { type: Type.STRING }
            },
            required: ["tarea_buscada", "operaciones", "requiere_revision"]
          }
        }
      });

      const parsed = JSON.parse(response.text || "{}");
      const validated = (parsed.operaciones || []).map((op: { campo: FieldKey; valor: unknown; razon?: string }) => {
        if (!(op.campo in FIELD_RULES)) throw new Error(`Campo no permitido: ${op.campo}`);
        const rule = FIELD_RULES[op.campo];
        if (detectedHeaders[rule.column] && detectedHeaders[rule.column] !== rule.header) {
          throw new Error(`La columna ${rule.column} no coincide con ${rule.header}. Auditoria detenida.`);
        }
        return {
          campo: op.campo,
          columna_actualizar: rule.column,
          encabezado: rule.header,
          valor_actualizar: normalizeOperationValue(op.campo, op.valor, detectedCatalogs),
          razon: op.razon || ""
        };
      });

      res.json({
        tarea_buscada: String(parsed.tarea_buscada || "").trim(),
        tarea_id: String(parsed.tarea_id || "").trim(),
        columna_busqueda: parsed.tarea_id ? "E" : "F",
        operaciones: validated,
        requiere_revision: Boolean(parsed.requiere_revision) || validated.length === 0,
        motivo_revision: parsed.motivo_revision || (validated.length ? "" : "No se detectaron cambios validos.")
      });
    } catch (error: any) {
      console.error("Error extracting command:", error);
      res.status(400).json({ error: error.message || "No se pudo interpretar el comando." });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://0.0.0.0:${PORT}`));
}

startServer();
