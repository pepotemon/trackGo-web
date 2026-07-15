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

## ERR-011: Liberar ciudad con dos usuarios falla (read-after-write en transacción Firestore)

**Estado:** Resuelto  
**Fecha:** 2026-06-08

**Problema:** Al intentar liberar una ciudad con `activeParticipantsCount > 1` (shared pool), la operación fallaba con un error de Firestore. La transacción en `releaseSubscriptionCity` iteraba sobre `subscriptionIdsToRelease` haciendo `tx.get(subRef)` seguido de `tx.set(subRef, ...)` en la misma iteración. En la segunda iteración, el `tx.get(subRef2)` ocurría después de los `tx.set()` de la primera — violando la regla del Admin SDK de "todas las lecturas antes de todas las escrituras" en una transacción.

**Solución:** Separar lecturas de escrituras: primero `Promise.all(subscriptionRefs.map(ref => tx.get(ref)))` para leer todos los docs, luego el loop de escrituras.

**Archivos afectados:** `src/server/subscriptions/subscriptionService.ts` → función `releaseSubscriptionCity`

**Lección:** En transacciones de Firestore Admin SDK, nunca interleaves `tx.get()` y `tx.set()` dentro de un loop. Separar siempre: batch de lecturas → batch de escrituras.

---

## ERR-013: Auto-asignación por campaña nunca funcionó — colección inexistente

**Estado:** Resuelto  
**Fecha:** 2026-06-09

**Problema:** `autoAssignLead` y `useUserCampaignIds` consultaban la colección `subscriptionCities`, que no existe en Firestore. Ningún servidor escribía en ella. El servidor escribe en `cities` (con `ownerUserId`, `activeCampaignId`, `status: "occupied"`). Resultado: `campaignIds` siempre vacío en el cliente, `autoAssignLead` nunca encontraba owner por campaña y caía al matcher geográfico.

**Solución:**
- `autoAssignLead.js`: `subscriptionCities` → `cities`
- `useUserCampaignIds.ts`: `subscriptionCities` → `subscriptions` (accesible por cliente, tiene regla `userId == auth.uid`). Campo usado: `campaignId` + `city`.
- `firestore.indexes.json`: índice compuesto `(userId ASC, status ASC)` en `subscriptions`.

**Lección:** Al escribir código que lee de Firestore, verificar siempre que la colección referenciada sea la misma que el servidor escribe. Nunca asumir que una colección existe sin buscar `collection("nombre")` en el codebase.

---

## ERR-012: Leads de campaña auto-asignados desaparecen de "No verificados"

**Estado:** Resuelto  
**Fecha:** 2026-06-09

**Problema:** `autoAssignLead` seteaba `assignedTo = vendorId` en los leads de campaña antes de que el vendor los viera. `isRecoverableIncompleteLead` tenía `if (lead.assignedTo) return false` → los filtraba de "No verificados". Los leads terminaban visibles en "Verificados" (vía `subscribeUserLeads`) pero sin que el vendor los esperara ahí. Adicionalmente, `useUserCampaignIds` no tenía estado `loading`, causando una race condition donde se mostraban clientes DDD no-campaña mientras se cargaban los campaignIds.

**Solución:**
- `subscribeIncompleteClients` con `campaignIds`: filtro cambiado a `!takenFromIncompleteAt && status !== "visited/rejected"`. `takenFromIncompleteAt` lo setea solo `takeIncompleteClient` (acción explícita del vendor), no `autoAssignLead`.
- `useUserCampaignIds`: expone `loading: boolean`, inicialmente `true`.
- La suscripción de "No verificados" espera a que `campaignIdsLoading === false` antes de activarse.
- `visibleLeads` y `counts` en `page.tsx` excluyen leads de campaña con `takenFromIncompleteAt == null` para evitar duplicarlos en "Verificados".

**Lección:** `autoAssignLead` asigna sin que el vendor sepa. Nunca usar `assignedTo` como señal de "el vendor ya actuó" en el contexto de campaña. Usar `takenFromIncompleteAt` como discriminador.

---

## ERR-014: Auto-asignacion por campana puede mandar prospectos fuera de cobertura

**Estado:** Resuelto
**Fecha:** 2026-06-11

**Problema:** `autoAssignLead` daba prioridad a `leadAcquisitionCampaignId` y asignaba al `ownerUserId` de `cities` sin validar `geoCoverage`. Si Meta enviaba una campana equivocada o stale, un vendor podia recibir prospectos de otra ciudad.

**Solucion:** Eliminado el atajo de asignacion por campana en `functions/src/assignments/autoAssignLead.js`. Todos los prospectos listos pasan por `selectAutoAssignUser`, que usa `geoCoverage`, estado de entrega de suscripcion y limites diarios.

**Leccion:** La metadata de campana sirve para atribucion y auditoria, pero no debe ser la fuente de verdad para decidir cobertura operativa. Ver [[03_Decisions#ADR-015]].

---

## ERR-015: País Argentina no reconocido en matching de cobertura y prefijos de teléfono

**Estado:** Resuelto
**Fecha:** 2026-07-13

**Problema:** Cuatro gaps al expandir operaciones a Argentina:
1. `coverageMatching.ts` — `leadCountry()` tenía hardcodeado solo `"PA"` → `"panama"`. Leads de Argentina sin `adminCountryNormalized` caían al fallback `"brasil"` y no matcheaban cobertura Argentina.
2. `phoneCoverage.ts` — `INTL_COUNTRY_CODES` solo tiene códigos de 3 dígitos. El `"54"` de Argentina (2 dígitos) devolvía `null` en `extractPhoneCoverageCode`, rompiendo filtros por prefijo.
3. `phonePrefixes.ts` — `LATAM_COUNTRIES` no tenía `"54": "Argentina"`, así que no aparecía como opción de filtro en el admin.
4. `incompleteClientsRepo.ts` *(detectado 2026-07-14)* — `extractDDD` y `phonePrefixesForCode` no conocían Argentina: `extractDDD` devolvía `null` para números como `5493794119260` (13 dígitos con prefijo "54"), y `phonePrefixesForCode("54")` generaba `["54","5554","+5554"]` en lugar de `["54","+54"]`. Resultado: la tab "No verificados" aparecía vacía para usuarios de Argentina.

**Solución:**
- `coverageMatching.ts`: reemplazado el ternario hardcodeado por `MARKET_COUNTRY_CODE: Record<string, string>` con `BR`, `PA`, `AR`.
- `phoneCoverage.ts`: agregado `LATAM_2_DIGIT_COUNTRY_CODES = ["54"]` con su propio loop después del de 3 dígitos.
- `phonePrefixes.ts`: agregado `"54": "Argentina"` a `LATAM_COUNTRIES`.
- `incompleteClientsRepo.ts`: agregado `LATAM_2DIGIT_CC = ["54"]` + loop en `extractDDD` + rama en `phonePrefixesForCode` para generar prefijos correctos. Agregado `"54": "Argentina"` a `COUNTRY_NAMES`.

**Lección:** Al agregar un país nuevo, revisar CUATRO archivos: `coverageMatching.ts`, `phoneCoverage.ts`, `phonePrefixes.ts`, `incompleteClientsRepo.ts`. El patrón de `LATAM_2_DIGIT_COUNTRY_CODES` está disponible para futuros países con código de 2 dígitos (MX=52, CL=56, CO=57, VE=58).

---

## ERR-016: Links maps.app.goo.gl compartidos desde WhatsApp Android no resuelven coordenadas

**Estado:** Resuelto (fix iterativo — 3 capas)
**Fecha:** 2026-07-13 → 2026-07-14

**Problema:** Links con parámetro `?g_st=aw` (Android WhatsApp) o `?g_st=iw` (iOS WhatsApp) causaban que el lead quedara con ciudad = "Natal" aunque el negocio estuviera en otra ciudad.

**Causa raíz (capa 1 — fix 9aa9a94):** `extractCoordsFromAnyText` corría sobre el HTML crudo completo — capturaba coords de Natal embebidas en scripts/links de la página de consent.

**Causa raíz (capa 2 — fix 2026-07-14):** `extractCoordsFromHtmlMeta` tenía patrones demasiado genéricos:
- `"center":{"lat":X,"lng":Y}` — este es el VIEWPORT del mapa de Google JS. Google Maps servido server-side (sin user-location) centra el mapa en la región NE de Brasil, que resulta estar cerca de Natal.
- `"lat":X..."lng":Y` — genérico, matcheaba cualquier var JS con esas keys.
Ambos capturaban las coords del viewport (Natal) en vez de las del negocio.

**Causa raíz (capa 3 — fix 2026-07-14):** `extractCoordsFromAnyText(nestedFetched.html)` en el loop de URLs anidadas violaba la misma lección que el fix anterior había aplicado solo al HTML principal.

**Solución (2026-07-14):**
- `extractCoordsFromHtmlMeta` reescrita: solo busca en bloques `<script type="application/ld+json">` usando `"latitude"/"longitude"` (schema.org). Elimina viewport/JS patterns.
- Loop nested: `extractCoordsFromAnyText(nestedFetched.html)` → `extractCoordsFromHtmlMeta(nestedFetched.html)`.
- `geoDisplayLabel` en `leadsRepo.ts`: eliminado `geoNearestHubLabel` del fallback — mostraba ciudad del hub más cercano aunque el lead estuviera fuera de cobertura o tuviera coords incorrectas.

**Lección actualizada:**
- `maps.app.goo.gl` con `g_st` redirige a consent.google.com server-side. El fix de consent ya está en su lugar.
- **Nunca** correr `extractCoordsFromAnyText` sobre HTML crudo (ni principal ni nested).
- `extractCoordsFromHtmlMeta` debe buscar SOLO en JSON-LD estructurado, SOLO con `"latitude"/"longitude"` — no `"lat"/"lng"` ni `"center"`.
- El patrón `"center":{"lat":X,"lng":Y}` es el viewport de Google Maps JS, no la ubicación del negocio.
- `geoNearestHubLabel` es el hub más cercano sin importar distancia — nunca usarlo como display de ciudad.

---

## ERR-017: Bot repite preguntas ignorando respuestas previas y no maneja objeciones

**Estado:** Resuelto
**Fecha:** 2026-07-15

**Problema:** El bot en español (y portugués) preguntaba tipo de negocio o ubicación Maps repetidamente aunque el usuario ya los hubiera respondido. No manejaba frases como "¿para qué necesitás mi ubicación?", "no entiendo lo que decís", "mañana lo hago" — simplemente repetía la misma solicitud.

**Causa raíz:** `analyzeLeadReplyWithAi` solo recibía `lastInboundText` (el último mensaje del usuario) sin historial de conversación. El AI no podía saber qué se había preguntado antes ni qué el usuario ya había respondido.

**Solución (2026-07-15):**
1. `functions/index.js`: antes de llamar al AI, se cargan los últimos 8 mensajes de `clients/{clientId}/messages` (ordenados por `createdAt`) y se pasan como `recentMessages`.
2. `functions/src/bot/aiLeadAssistant.js`: `buildPrompt` incluye el historial en el prompt como "Conversation history (oldest first)". Se agregaron reglas explícitas para: no repetir preguntas ya respondidas, explicar por qué se pide la ubicación, ofrecer alternativas cuando el usuario no puede compartir Maps, manejar "lo hago después", dejar de insistir tras 2 rechazos de Maps.
3. `functions/src/bot/repliesEsPa.js` y `replies.js`: el mensaje de intro ahora dice "soy un asistente automático de TrackGo" (antes no se identificaba).

**Lección:** El AI en modo conversacional SIEMPRE necesita historial de mensajes. Pasar solo el último mensaje es insuficiente y causa comportamiento repetitivo y descontextualizado.

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
