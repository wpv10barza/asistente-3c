# Asistente de tareas 3C

Aplicación React + Express que interpreta comandos de voz o texto y actualiza Google Sheets respetando la estructura real de la estrategia 3C.

## Funciones incluidas

- Auditoría previa de encabezados A:AF y bloqueo si E/F no corresponden a `TareaId`/`Nombre`.
- Búsqueda única por `Nombre` (F) o `TareaId` (E), con rechazo de coincidencias ambiguas.
- Múltiples cambios en un solo comando.
- Frecuencia (L) y unidad de tiempo (M): mensual, anual, cada N meses/años, semanas, días u horas.
- Límites aceptables (I), comentarios condicionales (J), especialidad (N), Labour1-4, cantidades y horas.
- Marcado de eliminación mediante `X` en AF; nunca elimina físicamente una fila.
- Bloqueo de columnas A:E y AA:AE.
- Validación de números, unidades, nombre máximo 100 caracteres y texto descriptivo sin omisiones.
- Configuración de spreadsheet, hoja y fila de encabezados mediante variables de entorno.

## Variables de entorno

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
SPREADSHEET_ID=
SHEET_NAME=Data
HEADER_ROW=4
PORT=3000
```

## Comandos de ejemplo

- `La tarea Inspección de panel 5110-DP-201 es mensual.`
- `Cambia Inspección de panel 5110-DP-201 a cada 3 meses.`
- `Para la tarea 103316 coloca 2 personas y 4 horas en Labour1.`
- `Actualiza el límite aceptable de la tarea J10 a: temperatura menor de 60 °C.`
- `Marca para eliminar la tarea Inspección visual J10.`

## Ejecución

```bash
npm install
npm run lint
npm run dev
```
