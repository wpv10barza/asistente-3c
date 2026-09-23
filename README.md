# Asistente de tareas 3C

Aplicación React + Express que interpreta comandos de voz o texto y actualiza Google Sheets respetando la estructura real de la estrategia 3C.

## Funciones incluidas

- Auditoría previa de encabezados A:AF y bloqueo si E/F no corresponden a `TareaId`/`Nombre`.
- Búsqueda única por `Nombre` (F) o `TareaId` (E), con rechazo de coincidencias ambiguas.
- Múltiples cambios en un solo comando.
- Frecuencia (L) y unidad de tiempo (M): mensual, anual, cada N meses/años, semanas, días u horas.
- Lista blanca estricta: B, C, H, I, J, K, L, M, N y O.
- Bloqueo de columnas de identidad/búsqueda A, D, E y F y de cualquier columna fuera de la lista blanca.
- Catálogos preexistentes para ItemMantenible, ModoDeFalla, Especialidad y Labour1.
- Frecuencia entera mayor o igual a uno, unidades canónicas y texto descriptivo completo sin `...`, `…` ni `etc.`.
- Configuración de spreadsheet, hoja y fila de encabezados mediante variables de entorno.
- API local para ESP-Hi C3 y panel ESP32-4848S040 con autenticación,
  idempotencia, cola de comandos y consulta del resultado.
- Vista previa obligatoria y confirmación humana antes de escribir en Google Sheets.

## Variables de entorno

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
SPREADSHEET_ID=
SHEET_NAME=Data
HEADER_ROW=4
PORT=3000
ESP32_API_TOKEN=cambie-este-token-en-wsl-y-en-el-esp32
# Solo para pruebas locales aisladas; no usar en la red normal:
ALLOW_INSECURE_DEVICE_API=false
```

## Endpoint para ESP32 en WSL

El firmware consulta `GET /api/device/v1/health` y envía órdenes a
`POST /api/device/v1/commands`. El cuerpo es:

```json
{
  "device_id": "esp-hi-3c-01",
  "request_id": "esp-hi-3c-01-12345",
  "text": "Cambia la tarea J10 a mensual"
}
```

Incluya el token en `X-3C-Device-Token`. La respuesta `202` solo indica que la
orden quedó pendiente: la persona debe abrir la interfaz, revisar la vista
previa y confirmar. El ESP32 nunca escribe directamente en Google Sheets.

La respuesta incluye `status_path`. El panel táctil consulta esa ruta con el
mismo token hasta recibir `pending_confirmation`, `applied` o `rejected`, de
modo que la pantalla refleja la decisión tomada en WSL.

Para acceder desde la red local, el servidor ya escucha en `0.0.0.0`. Configure
en el firmware la IPv4 LAN de Windows, por ejemplo
`http://192.168.1.50:3000`; no use `127.0.0.1`. En WSL2 use red reflejada o un
reenvío de puerto de Windows y permita TCP/3000 en el firewall de la red privada.

## Comandos de ejemplo

- `La tarea Inspección de panel 5110-DP-201 es mensual.`
- `Cambia Inspección de panel 5110-DP-201 a cada 3 meses.`
- `Para la tarea 103316 cambia Labour1 a MECÁNICO.`
- `Actualiza el límite aceptable de la tarea J10 a: temperatura menor de 60 °C.`

## Ejecución

```bash
cd ~/projects/asistente-3c
npm ci
cp -n .env.example .env
nano .env
npm run lint
npm test
npm run dev
```

También puede usar el iniciador validado para WSL:

```bash
chmod +x scripts/run-wsl.sh
./scripts/run-wsl.sh
```

El servidor carga `.env` mediante `dotenv/config` y escucha en `0.0.0.0:3000`.
Desde el ESP‑Hi use la IP LAN del equipo, mientras que las pruebas ejecutadas
dentro de WSL pueden utilizar `http://127.0.0.1:3000`.

## Lectura numérica visual bajo demanda

ScaleVision puede registrar una captura puntual y solicitar una lectura numérica mediante la herramienta callable `vision_read_number`. Esta ruta está separada del parser `/api/extract`: no ejecuta visión por cada fotograma.

Flujo:

1. ScaleVision captura una imagen solo cuando se solicita una lectura numérica.
2. `POST /api/vision/captures` registra temporalmente la captura.
3. `POST /api/vision/agent` inicia Gemini con la declaración callable `vision_read_number`.
4. El ejecutor `server/visionReadNumber.ts` vuelve a procesar la imagen con el mismo `GEMINI_MODEL`, con salida estructurada.
5. Solo `status=READ` con un número sintácticamente válido se considera lectura autoritativa. `NOT_LEGIBLE` y `CONFLICT` no producen un valor inferido.

Contrato: `contract/vision-read-number-v1.json`.

En desarrollo, ScaleVision puede apuntar a `http://10.0.2.2:3000` desde un emulador Android. Para un dispositivo físico, configure `-PvisionBackendUrl=http://IP_LAN_DEL_PC:3000`. Producción debe usar HTTPS.