# vision_read_number

## Propósito

`vision_read_number` es una función callable para que Gemini solicite una lectura numérica de una captura de ScaleVision cuando la tarea realmente necesita conocer ese número.

La documentación no habilita la función por sí sola. En esta implementación existen tanto la declaración para Gemini como el ejecutor backend.

## Componentes

- Declaración de función: `server/visionTools.ts`
- Ejecutor: `executeVisionReadNumber()` en `server/visionTools.ts`
- Motor visual: `server/visionReadNumber.ts`
- Puente Gemini: `server.ts`
- Capturas temporales: memoria del backend, TTL 60 segundos

## Entrada

```json
{
  "vision_session_id": "vision-..."
}
```

## Salida válida

```json
{
  "status": "ok",
  "number_text": "12.30",
  "value": 12.3,
  "reason": "",
  "vision_session_id": "vision-..."
}
```

## Salida cuando no es legible

```json
{
  "status": "not_readable",
  "number_text": "",
  "value": null,
  "reason": "La lectura no es legible.",
  "vision_session_id": "vision-..."
}
```

## Reglas invariantes

1. Gemini debe usar la herramienta únicamente cuando necesita una lectura numérica visual.
2. No se completan dígitos faltantes.
3. No se calcula ni se estima un valor.
4. No se reutiliza el valor anterior del dispositivo como sustituto.
5. Un dígito, signo o separador decimal ambiguo produce `not_readable`.
6. El backend valida `number_text` antes de convertirlo a `value`.
7. La API key del proveedor visual solo existe en backend.
8. La captura temporal caduca después de 60 segundos.

## Modelo visual

El modelo por defecto queda en `OPENAI_VISION_MODEL=gpt-5.6-luna` y puede cambiarse por variable de entorno sin modificar Android.

## Flujo callable

```
ScaleVision
   |
   | captura actual
   v
POST /api/vision/read-number
   |
   v
session temporal
   |
   v
Gemini -> vision_read_number
   |
   v
executeVisionReadNumber()
   |
   v
modelo visual
   |
   +--> ok + número
   |
   +--> not_readable
   |
   v
FunctionResponse -> Gemini
```

La API de Gemini requiere una declaración de función para que el modelo pueda solicitarla y el cliente debe ejecutar la llamada y devolver un `FunctionResponse` al modelo; ese es el patrón aplicado aquí. 
