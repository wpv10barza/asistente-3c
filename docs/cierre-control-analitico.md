# Cierre — Paso 1: Control Analítico

## Alcance

Repositorio: `wpv10barza/asistente-3c`

Componente: revisión de celdas, lista blanca de columnas y control de propuestas antes de escribir en Google Sheets.

## Checklist de cierre

| Etapa | Repositorio | Componente | Acción de cierre | Estado |
|---|---|---|---|---|
| Paso 1: Control Analítico | `asistente-3c` | Revisión de celdas y lista blanca | Verificar bloqueo de filas y almacenamiento en estado `proposed`; rechazar columnas fuera de B, C, H, I, J, K, L, M, N y O; liberar la fila al aprobar, rechazar o expirar la propuesta. | ✅ Validado técnicamente |

## Evidencia técnica

- `server.ts` instancia `AnalyticalReviewStore` y expone la API de propuestas.
- `server/reviewControl.ts` centraliza la lista blanca, el bloqueo por fila, el TTL de 5 minutos y las transiciones `proposed → approved/rejected`.
- Una segunda propuesta sobre una fila ya bloqueada es rechazada.
- Una operación sobre una columna fuera de la lista blanca es rechazada.
- La expiración de una propuesta libera automáticamente la fila.
- `test/reviewControl.test.ts` cubre estado inicial, bloqueo, lista blanca, liberación y expiración.

## Validación CI

La rama de cierre `feat/cierre-control-analitico` fue validada por GitHub Actions mediante **CI Run #5**, asociado al commit `9fa651bad8918f9db75a1de363b09e316201727a`.

Resultado observado:

- `test-and-build`: ✅ `success`.
- `npm ci`: ✅ `success`.
- Validación JSON del contrato `contract/device-command-v1.json`: ✅ `success`.
- `npm run lint`: ✅ `success`.
- `npm test`: ✅ `success`.
- `npm run build`: ✅ `success`.

La PR **#2** permanece abierta y mergeable; no se registran comentarios de revisión. Por tanto, el estado de cierre de este paso es **validado técnicamente, pendiente de aprobación/merge de la PR**.

## Criterio de cierre

El control analítico se considera técnicamente cerrado cuando una operación válida no puede pasar directamente a escritura: primero debe existir una propuesta en estado `proposed`, con la fila bloqueada y con todas sus columnas validadas contra la lista blanca. La aprobación libera el bloqueo y permite continuar con la operación de escritura del flujo de aplicación; el rechazo o vencimiento descarta la propuesta y desbloquea la fila.

## Autenticación y persistencia

Este control se ejecuta dentro del backend de la aplicación y no almacena credenciales en el repositorio. El almacenamiento implementado en esta etapa es en memoria del proceso del backend. Un reinicio del proceso elimina las propuestas y bloqueos activos; esto evita presentar este control como persistencia transaccional permanente.

## Estado transaccional de cierre

**Estado:** 🟡 `Validated / Pending Merge`

**Condición restante:** aprobación humana/final y posterior merge de la PR #2 en `main`.
