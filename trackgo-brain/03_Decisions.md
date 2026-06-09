# 03 — Decisiones Técnicas (ADRs)

> [[00_Index]] | [[02_Architecture]] | [[04_Errors]]

Registro de decisiones de arquitectura y diseño. Cada ADR explica el contexto, la decisión tomada y las consecuencias.

---

## ADR-001: Next.js App Router (no Pages Router)

**Estado:** Activo  
**Fecha:** Proyecto original

**Contexto:** Necesidad de layout compartido entre rutas, server components para reducir JS en cliente, y route handlers para API.

**Decisión:** Usar App Router de Next.js 16 con layout hierarchy.

**Consecuencias:**
- `src/app/admin/layout.tsx` y `src/app/user/layout.tsx` son los layouts de rol
- API routes van en `src/app/api/` como `route.ts`
- IMPORTANTE: Next.js 16 tiene breaking changes — siempre leer `node_modules/next/dist/docs/`

---

## ADR-002: Firebase como backend principal

**Estado:** Activo  
**Fecha:** Proyecto original

**Contexto:** Necesidad de auth, base de datos y real-time con mínima infraestructura propia.

**Decisión:** Firebase Auth + Cloud Firestore + Firebase Admin SDK.

**Consecuencias:**
- Seguridad duplicada: `firestore.rules` (client) + `server/auth.ts` (server)
- Caché de perfil en localStorage para reducir lecturas a Firestore
- Composite indexes en `firestore.indexes.json` para queries complejas

---

## ADR-003: Separación client/server en /lib vs /server

**Estado:** Activo  
**Fecha:** Proyecto original

**Contexto:** Next.js necesita separación clara de código que solo corre en servidor para no exponer secrets.

**Decisión:**
- `src/lib/` → utilitaries que pueden correr en cliente o servidor
- `src/server/` → código estrictamente servidor (Firebase Admin, secrets)
- `src/data/` → repos que usan Firebase cliente (pueden correr en ambos)

**Consecuencias:** No importar nada de `src/server/` desde componentes cliente.

---

## ADR-004: Modelo de permisos granulares

**Estado:** Activo (migración en progreso)  
**Fecha:** 2025 (actualizado ~2026-Q1)

**Contexto:** El permiso `leads` era demasiado amplio y necesitaba ser dividido.

**Decisión:** Dividir `leads` en tres permisos separados:
- `prospectos` → acceso a la lista y cola de prospectos
- `actividad` → acceso al log de actividad
- `chatView` → acceso al chat de prospectos

**Consecuencias:**
- Sub-admins existentes en Firestore tienen el campo `leads` viejo, que ya NO se lee
- Necesitan actualización manual en Firestore para recuperar acceso
- [[04_Errors#ERR-005]] documenta el impacto

---

## ADR-005: Terminología "Prospectos" en lugar de "Leads"

**Estado:** Activo  
**Fecha:** 2026

**Contexto:** El equipo decidió que "Prospectos" es más correcto en español y se alinea mejor con el lenguaje del cliente.

**Decisión:** Toda la UI usa "Prospectos" / "prospecto". "Leads" y "Meta leads" quedan prohibidos en textos visibles.

**Consecuencias:**
- Aplica a: nav labels, títulos de página, captions de KPI, mensajes de estado vacío, labels de acción
- NO aplica a: nombres de variables, funciones, archivos, tipos TypeScript (backward compat)
- Ver [[09_Glossary]] para lista completa

---

## ADR-006: PIX como único método de pago

**Estado:** Activo  
**Fecha:** 2025

**Contexto:** Mercado principal es Brasil donde PIX es el estándar de pagos instantáneos.

**Decisión:** Integrar MercadoPago PIX para suscripciones de ciudades.

**Consecuencias:**
- Idempotency key = checkoutId (evita cobros duplicados)
- Webhook en `/api/webhook/mercadopago` procesa confirmaciones
- Reserva de ciudad expira si pago no se confirma en timeout
- Ver [[08_Workflows#Flujo de pago PIX]] para secuencia completa

---

## ADR-007: Auto-asignación por jerarquía geográfica

**Estado:** Activo  
**Fecha:** 2025

**Contexto:** Los vendors tienen coberturas geográficas distintas. Los prospectos deben ir al vendor más específico disponible.

**Decisión:** Match en cascada: ciudad exacta → hub_city → estado → país.

**Consecuencias:**
- `features/leads/coverageMatching.ts` implementa la lógica
- `autoAssignMatchType` se guarda en el prospecto para auditoría
- `autoAssignLogs` colección registra cada asignación
- Limites diarios por vendor para evitar overflow

---

## ADR-008: Quick actions consistentes entre páginas

**Estado:** Activo  
**Fecha:** 2026

**Contexto:** Las acciones disponibles en los modales de acción rápida eran inconsistentes entre páginas.

**Decisión:** Estandarizar el set de acciones para todas las páginas de prospectos:
- Ver cliente (siempre)
- Chat/Editar (siempre)
- Reasignar (solo en página de actividad)
- Maps (condicional: si tiene coordenadas)
- WhatsApp (condicional: si tiene teléfono)
- Eliminar prospecto (solo en actividad)
- Assignments usa `AutoAssignLogDoc` con `leadId`

**Consecuencias:** Al agregar nueva acción, debe ser evaluada para todas las páginas.

---

## ADR-009: Ciclo contable semanal con cierre manual

**Estado:** Activo  
**Fecha:** Proyecto original

**Contexto:** El equipo necesita periodos contables claros con snapshot final.

**Decisión:** Semanas contables con estados `draft → review → closed`. Al cerrar se persiste `finalSummary`.

**Consecuencias:**
- Semanas cerradas son inmutables (snapshot)
- Pueden re-abrirse si hay error
- `accountingInvestments/{weekKey}` indexado por fechas

---

## ADR-010: Pantalla de splash con control JS

**Estado:** Activo  
**Fecha:** 2025

**Contexto:** Firebase Auth tiene latencia de inicialización. Sin splash, hay CLS y flashes de contenido no autenticado.

**Decisión:** Splash en HTML puro con control via `window.__tgSplashDone()` y `window.__tgSplashText()`.

**Consecuencias:**
- React controla el ciclo de vida del splash
- Timeout de seguridad a los 10 segundos
- Animación SVG + gradiente cargada antes de React

---

## ADR-011: Clientes por recuperar filtrados por campaña activa

**Estado:** Activo  
**Fecha:** 2026-06-09

**Contexto:** La pantalla "clientes por recuperar" listaba todos los clientes sin dueño en el área de indicativos del vendor (DDDs). Esto mezclaba clientes de campañas de distintos usuarios cuando varios vendors cubrían la misma región.

**Decisión:** Cuando el vendor tiene ciudades activas en `subscriptionCities` (`ownerUserId == uid`, `status == "occupied"`), la query usa `leadAcquisitionCampaignId IN [campaignIds]`. Si no hay campañas activas, hace fallback a la query por indicativos (comportamiento anterior).

**Consecuencias:**
- Un vendor solo ve clientes de sus propias campañas en la pantalla de recuperación
- Se añadió el hook `useUserCampaignIds` en `src/features/subscriptions/`
- Se añadió función `subscribeCoverageByCampaignIds` en `incompleteClientsRepo.ts`
- Requiere índice compuesto en Firestore: `(verificationStatus ASC, leadAcquisitionCampaignId ASC)`
- Clientes sin `leadAcquisitionCampaignId` (manuales o históricos) no aparecen en la vista de campaña

---

*Ver [[06_Changelog]] para cuándo se tomaron estas decisiones.*
