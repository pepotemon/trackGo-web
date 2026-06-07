# 04 — Errores y Problemas Conocidos

> [[00_Index]] | [[03_Decisions]] | [[06_Changelog]]

Registro de bugs, errores resueltos, y patrones problemáticos. Sirve para no repetir los mismos errores.

---

## ERR-001: Rate limiting de Meta Ads API

**Estado:** Resuelto  
**Fecha:** ~2026-Q1  
**Commit:** `f6abb47`

**Problema:** Las llamadas a Meta Ads API devolvían errores de rate limit (429) sin reintentos, causando fallos silenciosos en la activación de campañas.

**Solución:** Implementado sistema de retry con backoff exponencial en `server/subscriptions/metaAds.ts`.

**Lección:** Siempre manejar 429 con retry + backoff en integraciones con Meta Ads.

---

## ERR-002: Zoom no deseado en desktop

**Estado:** Resuelto  
**Fecha:** ~2026-Q1  
**Commit:** `f6abb47`

**Problema:** El viewport meta permitía zoom en desktop, causando problemas de layout.

**Solución:** Bloqueo de zoom en desktop manteniendo zoom accesible en mobile.

**Lección:** Revisar viewport meta al trabajar en componentes de layout.

---

## ERR-003: Botón de Maps desaparecido

**Estado:** Resuelto  
**Fecha:** ~2026-Q1  
**Commit:** `2d17c72`

**Problema:** El botón de Maps fue eliminado accidentalmente de los quick actions.

**Solución:** Restaurado con lógica condicional (solo aparece si el prospecto tiene coordenadas).

**Lección:** Maps debe ser condicional en quick actions. Ver [[03_Decisions#ADR-008]].

---

## ERR-004: WhatsApp sin validar "take-before"

**Estado:** Resuelto  
**Fecha:** ~2026-Q1  
**Commit:** `2d17c72`

**Problema:** Era posible abrir WhatsApp sin haber tomado la foto de antes de la visita, perdiendo el flujo correcto.

**Solución:** Requerido paso de "take-before" antes de habilitar WhatsApp.

**Lección:** El flujo correcto es: tomar foto ANTES → WhatsApp. Mantener esta validación.

---

## ERR-005: Permisos sub-admins rotos tras split de `leads`

**Estado:** Conocido — requiere acción manual  
**Fecha:** 2026  
**Decisión relacionada:** [[03_Decisions#ADR-004]]

**Problema:** Al dividir el permiso `leads` en `prospectos + actividad + chatView`, los sub-admins existentes tienen el campo `leads` en Firestore pero ya no se lee. Perdieron acceso.

**Solución:** Actualización manual en Firestore: agregar los tres nuevos campos de permisos a cada sub-admin afectado.

**Estado de acción:** Pendiente migración de datos.

---

## ERR-006: Campo `note` faltante en ciudades de suscripción

**Estado:** Resuelto  
**Fecha:** 2026  
**Commit:** `1cd213a`

**Problema:** Al listar ciudades de suscripción en admin, el campo `note` no se incluía en la respuesta, causando que las notas de admin no aparecieran.

**Solución:** Incluido campo `note` al mapear ciudades de suscripción en el listado.

**Lección:** Al agregar campos nuevos a documentos Firestore, revisar todos los lugares donde ese documento se serializa/devuelve.

---

## ERR-007: Pagos PIX duplicados

**Estado:** Mitigado  
**Fecha:** Proyecto original

**Problema:** Reintentos del webhook de MercadoPago podían crear múltiples activaciones de suscripción.

**Solución:** Idempotency key = checkoutId en la creación de pagos. El webhook verifica estado antes de procesar.

**Lección:** Siempre usar idempotency keys en webhooks de pago. Ver [[03_Decisions#ADR-006]].

---

## ERR-008: Caché de perfil stale en localStorage

**Estado:** Conocido — bajo riesgo  
**Fecha:** Identificado durante revisión

**Problema:** El caché de perfil `trackgo_profile_cache_${uid}` puede quedar stale si los permisos del usuario cambian en Firestore sin que la sesión expire.

**Impacto:** Vendor o admin puede seguir viendo contenido basado en permisos viejos hasta que recargue.

**Mitigación actual:** El caché se invalida al hacer logout. Para cambios de permisos críticos, pedir al usuario que cierre sesión.

---

## ERR-009: Auto-asignación ignorando límite diario bajo carga

**Estado:** Investigar  
**Fecha:** 2026

**Problema:** Bajo alta carga (muchos prospectos entrando simultáneamente), la verificación del límite diario puede tener race conditions en Firestore.

**Contexto:** `autoAssignDailyLimit` se verifica leyendo `autoAssignLogs` del día. Sin transacción, dos asignaciones concurrentes pueden pasar el límite.

**Acción sugerida:** Implementar counter atómico con Firestore transactions o batch writes.

---

## ERR-010: Ganancia bruta/real ajena aparece en descargas de contabilidad

**Estado:** Resuelto  
**Fecha:** 2026-06-07

**Problema (parte 1 — admin regular):** Al descargar imagen o Excel de contabilidad, un admin regular veía `gross` y `real` del superadmin completo. La pantalla era correcta pero la descarga usaba `exportSummary`, que para semanas cerradas sobreescribía los valores con `investment.finalSummary` — snapshot global guardado por el superadmin al cerrar la semana.

**Solución parte 1:** En `exportSummary` (useMemo), cambiar `isClosed` por `isClosed && isSuperAdmin`. El `finalSummary` solo es válido para el superadmin; los admins regulares siempre usan el `summary` filtrado en vivo.

**Problema (parte 2 — superadmin descargando para otro admin):** Al generar el recibo de imagen para un admin específico desde la vista del superadmin, `gross`, `subscriptionInvestment` y `real` mostraban los totales globales. Solo `miGanancia` era correcto.

**Solución parte 2:** `miGananciaPerAdmin` y `closeMiGananciaPerAdmin` ahora calculan `gross`, `subscriptionInvestment` y `real` escopados por admin (suma de `row.gross`, `row.cost`, `row.real` para los vendors de ese admin únicamente). Todos los call sites de `downloadReceiptAsImage` para recibos por-admin usan estos valores.

**Archivos afectados:** `src/app/admin/accounting/page.tsx`

**Lección:** Al agregar campos a memos de "por admin", calcular también los aggregates (gross/real), no solo el gain porcentual. El `finalSummary` es un snapshot del superadmin y nunca debe usarse directamente para sub-admins.

---

## Patrones problemáticos a evitar

### No usar `leads` en UI
Usar siempre "Prospectos". Ver [[09_Glossary]].

### No agregar lógica a `server/` que pueda ir en `lib/`
El código en `server/` no puede ser importado por client components.

### No crear checkouts sin expiración
Los checkouts PIX deben tener `expiresAt` para que el cron los limpie.

### No modificar `finalSummary` de semanas cerradas
Las semanas `closed` son inmutables. Usar reopen si hay corrección.

---

*Agregar nuevos errores aquí con fecha, commit y lección aprendida.*
