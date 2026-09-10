# Cierre — Paso 1: Control Analítico

## Alcance

Repositorio: `wpv10barza/asistente-3c`

Componente: revisión de celdas, lista blanca de columnas y control de propuestas antes de escribir en Google Sheets.

## Checklist de cierre

| Etapa | Repositorio | Componente | Acción de cierre | Estado |
|---|---|---|---|---|
| Paso 1: Control Analítico | `asistente-3c` | Revisión de celdas y lista blanca | Verificar bloqueo de filas y almacenamiento en estado `proposed`; rechazar columnas fuera de B, C, H, I, J, K, L, M, N y O; liberar la fila al aprobar, rechazar o expirar la propuesta. | ✅ Implementado |

## Evidencia técnica

- `server.ts` instancia `AnalyticalReviewStore` y expone la API de propuestas.
- `server/reviewControl.ts` centraliza la lista blanca, el bloqueo por fila, el TTL de 5 minutos y las transiciones `proposed → approved/rejected`.
- Una segunda propuesta sobre una fila ya bloqueada es rechazada.
- Una operación sobre una columna fuera de la lista blanca es rechazada.
- La expiración de una propuesta libera automáticamente la fila.
- `test/reviewControl.test.ts` cubre estado inicial, bloqueo, lista blanca, liberación y expiración.

## Criterio de cierre

El control analítico se considera cerrado cuando una operación válida no puede pasar directamente a escritura: primero debe existir una propuesta en estado `proposed`, con la fila bloqueada y con todas sus columnas validadas contra la lista blanca. La aprobación libera el bloqueo y permite continuar con la operación de escritura del flujo de aplicación; el rechazo o vencimiento descarta la propuesta y desbloquea la fila.

> Nota: el almacenamiento implementado en esta etapa es en memoria del proceso del backend. Un reinicio del proceso elimina las propuestas y bloqueos activos; esto evita presentar este control como persistencia transaccional permanente.
