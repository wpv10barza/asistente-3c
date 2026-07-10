import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) console.warn("GEMINI_API_KEY no esta configurada.");
const ai = new GoogleGenAI({ apiKey: apiKey || "" });

const FIELD_RULES = {
  nombre: { column: "F", header: "Nombre", type: "text", maxLength: 100 },
  tipo_tarea: { column: "G", header: "TipoTarea", type: "text" },
  restriccion: { column: "H", header: "Restriccion", type: "text" },
  limites_aceptables: { column: "I", header: "LimitesAceptables", type: "long_text" },
  comentarios_condicionales: { column: "J", header: "ComentariosCondicionales", type: "long_text" },
  origen: { column: "K", header: "Origen", type: "text" },
  frecuencia: { column: "L", header: "Frecuencia", type: "positive_number" },
  unidad_tiempo: { column: "M", header: "UnidadTiempo", type: "time_unit" },
  especialidad: { column: "N", header: "Especialidad", type: "text" },
  labour1: { column: "O", header: "Labour1", type: "text" },
  labour1_cantidad: { column: "P", header: "Labour1Cantidad", type: "positive_number" },
  labour1_horas: { column: "Q", header: "Labour1Horas", type: "positive_number" },
  labour2: { column: "R", header: "Labour2", type: "text" },
  labour2_cantidad: { column: "S", header: "Labour2Cantidad", type: "positive_number" },
  labour2_horas: { column: "T", header: "Labour2Horas", type: "positive_number" },
  labour3: { column: "U", header: "Labour3", type: "text" },
  labour3_cantidad: { column: "V", header: "Labour3Cantidad", type: "positive_number" },
  labour3_horas: { column: "W", header: "Labour3Horas", type: "positive_number" },
  labour4: { column: "X", header: "Labour4", type: "text" },
  labour4_cantidad: { column: "Y", header: "Labour4Cantidad", type: "positive_number" },
  labour4_horas: { column: "Z", header: "Labour4Horas", type: "positive_number" },
  eliminar: { column: "AF", header: "Eliminar", type: "delete_mark" }
} as const;

type FieldKey = keyof typeof FIELD_RULES;

function normalizeOperationValue(field: FieldKey, rawValue: unknown): string | number {
  const rule = FIELD_RULES[field];
  const text = String(rawValue ?? "").trim();

  if (rule.type === "positive_number") {
    const normalized = text.replace(",", ".");
    const value = Number(normalized);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${rule.header} debe ser un numero mayor o igual a cero.`);
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

  if (rule.type === "delete_mark") {
    return /^(x|eliminar|borrar|si|sí)$/i.test(text) ? "X" : "";
  }

  if (field === "nombre" && text.length > 100) {
    throw new Error("Nombre supera 100 caracteres. Debe resumirse tecnicamente sin truncar ni eliminar codigos.");
  }

  if (!text) throw new Error(`${rule.header} no puede quedar vacio.`);
  return text;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/config", (_req, res) => {
    try {
      const configPath = path.join(process.cwd(), "firebase-applet-config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      res.json({
        clientId: config.oAuthClientId,
        spreadsheetId: process.env.SPREADSHEET_ID || config.spreadsheetId || "1tLNo0_xjtmWKM9Y7PcChFut8S0w0kMKeAvFi9zg52gA",
        sheetName: process.env.SHEET_NAME || "Data",
        headerRow: Number(process.env.HEADER_ROW || 4),
        searchColumn: "F"
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "No se pudo cargar la configuracion." });
    }
  });

  app.post("/api/extract", async (req, res) => {
    try {
      const text = String(req.body?.text || "").trim();
      const detectedHeaders = req.body?.detectedHeaders || {};
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
- Columnas A:E, AA:AE estan bloqueadas y nunca se modifican.
- "mensual" significa frecuencia=1 y unidad_tiempo="Mes", salvo que el usuario indique otro numero.
- "anual" significa frecuencia=1 y unidad_tiempo="año", salvo que el usuario indique otro numero.
- "cada N meses" significa frecuencia=N y unidad_tiempo="Mes".
- "cada N años" significa frecuencia=N y unidad_tiempo="año".
- Si pide cambiar limite, por que/porque, criterio aceptable o aceptacion, usa limites_aceptables (I).
- Si pide comentario, instruccion, procedimiento u observacion condicional, usa comentarios_condicionales (J).
- Si pide horas de la tarea o HH base del Labour1, usa labour1_horas (Q). No calcules HH si faltan cantidad y HH total.
- Si pide cantidad de personas del Labour1, usa labour1_cantidad (P).
- Para borrar una estrategia, no borres la fila: marca eliminar (AF) con X.
- Conserva completo el texto descriptivo. No uses "...", "…" ni "etc.".
- Si el nombre nuevo excede 100 caracteres, marca requiere_revision=true; no lo trunques.
- Si falta tarea o valor, devuelve requiere_revision=true y explica el motivo.
- Puedes devolver varias operaciones para una misma tarea.

ENCABEZADOS DETECTADOS EN LA HOJA:
${JSON.stringify(detectedHeaders)}

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
          valor_actualizar: normalizeOperationValue(op.campo, op.valor),
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
