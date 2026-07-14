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

## ADR-012: Pantalla de Prospectos con dos pestañas (Verificados / No verificados)

**Estado:** Activo  
**Fecha:** 2026-06-09

**Contexto:** Los "clientes por recuperar" estaban en una pantalla separada (`/user/chat`), lo que fragmentaba el flujo de trabajo del vendor. La pantalla de Prospectos tenía una fila de estadísticas (hoy/semana) que ocupaba espacio sin aportar mucho.

**Decisión:**
- `leads/page.tsx` tiene dos pestañas principales: `verificados` y `no_verificados`
- "Verificados" = prospectos asignados con Maps link (flujo de siempre)
- "No verificados" = clientes por recuperar (de campaña o por indicativos), acción renombrada a "Pasar a Verificados"
- La fila de stats se reemplazó por un contador semanal simple `X/total sem.`
- `/user/chat` queda solo para clientes `not_suitable` ("No Aptos")
- El nav label `/user/chat` cambió de "Recup." a "No Aptos"

**Consecuencias:**
- `subscribeIncompleteClients` se llama desde `leads/page.tsx` con `campaignIds` (no desde `chat/page.tsx`)
- `subscribeNotSuitableClients` se llama desde `chat/page.tsx` con `campaignIds`
- El componente `RecoveryCard` vive en `leads/page.tsx`

---

## ADR-013: Clientes de campaña tratados como ya asignados en No verificados

**Estado:** Activo
**Fecha:** 2026-06-09

**Contexto:** Los clientes en "No verificados" de campaña (`leadAcquisitionCampaignId` en las campañas activas del vendor) son exclusivamente visibles para ese vendor — nadie más los puede ver. Sin embargo, se mostraban con el mismo flujo "Tomar" de los clientes por DDD (compartidos), añadiendo fricción innecesaria.

**Decisión:**
- Si `lead.leadAcquisitionCampaignId ∈ campaignIds` del vendor → `CampaignLeadCard`: mismas acciones que Verificados, sin botón "Tomar"
- Las acciones "Gestionar" y "WhatsApp" auto-asignan el cliente (`takeIncompleteClient`) silenciosamente antes de ejecutar
- Si el cliente no tiene `leadAcquisitionCampaignId` en las campañas activas → `RecoveryCard` con "Tomar" explícito (puede haber competencia entre vendors del mismo indicativo)

**Consecuencias:**
- `isCampaignClient(lead, campaignIds)` es la función de discriminación en `leads/page.tsx`
- `openCampaignManage` y `openCampaignWhatsApp` realizan el auto-take antes de la acción
- Error `"client_already_taken"` puede ocurrir si la campaña tiene múltiples vendors asignados (edge case)
- `CampaignLeadCard` es un componente separado de `LeadCard` para evitar prop-drilling excesivo

---

## ADR-014: Auto-asignación de clientes de campaña en el bot

**Estado:** Superseded by ADR-015
**Fecha:** 2026-06-09

**Contexto:** Los clientes que llegan con `leadAcquisitionCampaignId` son exclusivos de un vendor (via `subscriptionCities.ownerUserId`). Sin embargo, `autoAssignLead` los procesaba con el matcher geográfico junto al resto, pudiendo asignárselos a cualquier vendor con cobertura en la zona.

**Decisión:**
- En `autoAssignLead.js`, antes del matcher geográfico, verificar si `lead.leadAcquisitionCampaignId` tiene valor
- Si tiene valor, buscar en `subscriptionCities` donde `activeCampaignId == valor` y `status == "occupied"` (fallback a campo `campaignId`)
- Si hay match, asignar al `ownerUserId` directamente con `assignmentMode: "campaign_auto"` y `autoAssignMatchType: "campaign"`
- Si no hay match en campaña, continuar con el matcher geográfico normal

**Consecuencias:**
- Los clientes de campaña siempre van al vendor dueño de esa campaña cuando tienen `parseStatus: "ready"` y `verificationStatus: "pending_review"/"verified"`
- Los clientes aún `incomplete` (bot en progreso) permanecen sin asignar en "No verificados" hasta completar el flujo
- `autoAssignEnabled` no es requerido para recibir clientes de campaña propia
- `LeadAutoAssignMatchType` extendido con `"campaign"`; labels y tones actualizados en admin

---

*Ver [[06_Changelog]] para cuándo se tomaron estas decisiones.*

---

## ADR-016: Creación manual de campañas Meta Ads vía Graph API

**Status:** Active
**Date:** 2026-07-14

**Context:** El flujo de suscripción existente activa campañas preexistentes en Meta (configuradas manualmente antes). Para ciudades nuevas como Resistencia (Argentina), no había campaña en Meta ni flujo automatizado para crearla desde cero.

**Decision:** Las campañas nuevas para ciudades nuevas se crean manualmente vía Graph API v19.0 siguiendo el patrón documentado en [[08_Workflows#Flujo de creación manual de campaña Meta Ads]]. La estructura es siempre: 1 campaña → 1 adset → N creativos → N anuncios. Todo se crea en estado PAUSED; el operador activa cuando esté listo.

**Consequences:**
- La creación se hace con el token `META_ACCESS_TOKEN` del system user "TrackGo" — el system user debe tener rol Anunciante en cada página nueva.
- El WABA de cada país debe estar asignado a su página correspondiente en Business Suite antes de poder crear adsets con `destination_type: WHATSAPP`.
- Los creativos se crean con image_hash placeholder; el operador reemplaza las imágenes reales vía Ads Manager antes de activar.
- Formato de número WhatsApp en API: sin `+`, con código de país (AR=54, BR=55, PA=507).
- Usar Python con `json.dumps()` para construir requests con JSON anidado — curl falla con encoding en este caso.

---

## ADR-017: Granularidad de cobertura por país — Argentina usa código de país, no DDD

**Estado:** Activo
**Fecha:** 2026-07-14

**Contexto:** Brasil se cubre con DDDs de 2 dígitos (ej. "11" = São Paulo, "81" = Recife). Al expandir a Argentina surgió la pregunta de qué indicativo asignar a los usuarios — si el código de país "54" o algún código de área regional (ej. "379" para Resistencia).

**Decisión:** Argentina usa el código de país `"54"` como única unidad de cobertura. Un usuario con indicativo `"54"` ve todos los prospectos argentinos sin distinción de ciudad. No existe granularidad por DDD argentino en el sistema actual.

**Consecuencias:**
- Asignar `54` como indicativo a cualquier usuario que opere en Argentina.
- Un solo usuario con `54` recibirá prospectos de todo el país (Buenos Aires, Córdoba, Resistencia, etc.).
- Si en el futuro se requiere segmentar por ciudad argentina, habrá que extender `BRAZIL_DDDS` con un mapa equivalente para Argentina y ajustar `extractDDD`. Ver [[05_Ideas#IDEA-T006]].

---

## ADR-015: Auto-asignacion prioriza geoCoverage sobre campana

**Status:** Active
**Date:** 2026-06-11

**Context:** Meta referrals and campaign IDs can be wrong or stale. A prospect from one real city can arrive with campaign metadata mapped to another vendor, causing assignments outside the vendor coverage.

**Decision:** `autoAssignLead` no longer assigns directly by `leadAcquisitionCampaignId`. All ready prospects, including campaign-attributed prospects, must pass through `selectAutoAssignUser` and `geoCoverage` matching.

**Consequences:**
- Campaign metadata remains useful for attribution, labels, and audits, but not as the owner source for automatic assignment.
- Automatic assignments use `assignmentMode: "coverage_auto"` and geographic match types (`city`, `hub_city`, `state`, `country`).
- Vendors must have active `autoAssignEnabled` and matching `geoCoverage` to receive ready prospects automatically.
- Historical logs with `autoAssignMatchType: "campaign"` can still exist from before this decision.
