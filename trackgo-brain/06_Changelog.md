# 06 — Changelog

> [[00_Index]] | [[03_Decisions]] | [[04_Errors]]

Historial de cambios significativos del proyecto. Organizado por fecha descendente.

---

## 2026-06-23 (2)

### feat(subscriptions): impuesto configurable sobre inversión en Reglas comerciales
- **Module:** `src/server/subscriptions/subscriptionService.ts`, `src/app/api/subscriptions/settings/route.ts`, `src/app/admin/settings/subscriptions/page.tsx`
- **What changed:** Nuevo campo `taxRate` en `subscriptionSettings/global` (Firestore). Se configura vía slider en "Reglas comerciales" (0–50%). El `adsBudgetNet = adsBudget × (1 - taxRate)` es lo que recibe Meta Ads; `adsBudget` (bruto) sigue guardado en Firestore como referencia para el vendor. El `dailyBudget` enviado a Meta y almacenado en la suscripción ya refleja el neto. El modal de activación manual muestra "Cobro / Inversión / Neto Meta" en el preview.
- **Why:** El impuesto del 13% sobre inversión Meta (IOF) debe descontarse del presupuesto efectivo sin afectar lo que se le cobra al vendor.
- **See:** —

---

## 2026-06-23

### feat(subscriptions): eliminar plan 300 R$ y actualizar plan Impulso a 350 R$
- **Module:** `src/lib/subscriptionPlans.ts`, `src/app/api/subscriptions/create-pix/route.ts`, `src/app/api/subscriptions/manual-activate/route.ts`, `src/app/admin/settings/subscriptions/page.tsx`
- **What changed:** Eliminado plan `base` (300 R$). Plan `crecimiento` ("Impulso") pasa de 400 R$ a 350 R$. Se quita `"base"` del set `validPlans` en ambas rutas API. El formulario de activación manual ahora defaultea a 350 R$.
- **Why:** Restructuración comercial: inversión 200 R$ + ganancia TrackGo 150 R$ = 350 R$ total. El plan de 300 ya no existe. Requiere actualizar "Reglas comerciales" en Firestore a 57% operativo (200/350).
- **See:** —

---

## 2026-06-22

### feat(admin): copiar datos de prospectos en panel admin
- **Module:** `src/app/admin/leads/page.tsx`, `src/app/admin/activity/page.tsx`, `src/app/admin/leads/assignments/page.tsx`
- **What changed:** Añadido botón "Copiar datos" en todos los modales de acciones rápidas del admin (desktop y mobile). Copia al portapapeles: Nombre, Teléfono, Negocio, Dirección y Maps. En actividad y asignaciones los campos disponibles dependen de lo que tenga guardado el documento. El botón cambia a verde con icono ✓ durante 1.2s tras copiar.
- **Why:** El admin no tenía esta funcionalidad disponible para usuarios normales (vendors). Solicitado por el usuario.
- **See:** —

---

## 2026-06-11

### fix(assignments): auto-asignacion usa geoCoverage aunque exista campana
- **Module:** `functions/src/assignments/autoAssignLead.js`
- **What changed:** Eliminado el atajo que asignaba directamente por `leadAcquisitionCampaignId` al `ownerUserId` de `cities`. Todos los prospectos listos pasan por `selectAutoAssignUser` y el matcher de `geoCoverage`.
- **Why:** La metadata de campana puede venir equivocada o stale, causando asignaciones fuera de cobertura real (ej. vendedor de Maceio recibiendo prospectos de Fortaleza).
- **See:** [[03_Decisions#ADR-015]], [[04_Errors#ERR-014]]

### refactor(leads): No verificados filtrado solo por indicativo (DDD/cobertura)
- **Módulo:** `src/data/incompleteClientsRepo.ts`, `src/app/user/leads/page.tsx`
- **What changed:** Eliminada toda la lógica de campaña de "No verificados". `subscribeIncompleteClients` ya no acepta `campaignIds` — lista únicamente clientes cuyos teléfonos coinciden con los indicativos configurados en la cobertura del vendor. Removidos: `CampaignLeadCard`, `useUserCampaignIds`, `isCampaignClient`, `openCampaign*`, states `campaignManaging`/`incWaSent`/`actionFromNoVerificados`. `confirmVisit`/`confirmReject` simplificados (sin `takeIncompleteClient` previo).
- **Why:** Simplificación solicitada — "No verificados" debe mostrar simplemente todos los clientes incompletos del indicativo del vendor, sin lógica especial de campaña.

### feat(leads): Chat por ciudad muestra todos los prospectos, no solo la cola sin asignar
- **Módulo:** `src/app/admin/leads/city-chat/page.tsx`, `src/data/leadsRepo.ts`
- **What changed:** `getLeadQueuePage` acepta `includeAssigned` e `includeStale` (ambos `false` por defecto para no romper otros callers). La pantalla Chat por ciudad ahora los activa por defecto (muestra todos), con dos checkboxes para restringir: "Solo sin asignar" y "Solo activos (últimos 30 días)". Se agregó contador de asignados en stats, badge de vendor en tarjetas, pill verde "Asig. N" en grupos, y cuarto stat card "Asignados".
- **Why:** El filtro `assignedTo == ""` y la regla de 30 días dejaban leads invisibles. La pantalla ahora funciona como base de datos por indicativo/ciudad, no solo como cola de revisión.

## 2026-06-09

### fix(push): notificación "nuevo cliente" falsa al rechazar/visitar desde No verificados
- **Módulo:** `functions/index.js` → `onClientReassigned`
- **What changed:** Añadida guarda: si `takenFromIncompleteAt` pasa de null → valor en el mismo write que cambia `assignedTo`, es una auto-asignación del vendor → no se envía notificación.
- **Why:** `confirmVisit`/`confirmReject` llaman `takeIncompleteClient` para leads `incomplete` sin asignar. Eso cambia `assignedTo` null→userId, disparando `onClientReassigned` → notificación falsa de "nuevo cliente" al mismo vendor que acaba de rechazar/visitar el lead.

### fix(leads): rechazar/visitar desde Gestionar falla para leads incompletos no asignados
- **Módulo:** `src/app/user/leads/page.tsx`
- **What changed:** `confirmVisit`/`confirmReject` ahora detectan si el lead de campaña no tiene `assignedTo = userId` (caso `verificationStatus = "incomplete"` donde `autoAssignLead` no corre). En ese caso, llaman `takeIncompleteClient` primero (asigna y sella `takenFromIncompleteAt`), luego `markLeadVisited`/`markLeadRejected` sin stamp extra. Para leads ya asignados (`autoAssignLead` corrió, `pending_review`), siguen usando el stamp en un solo write.
- **Why:** `autoAssignLead` omite leads con `verificationStatus = "incomplete"` (líneas 45-53). Esos leads llegaban a "No verificados" con `assignedTo = null`. La regla Firestore de visited/rejected exige `assignedTo == auth.uid` → write fallaba silenciosamente y "no hacía nada."
- **See:** [[04_Errors#ERR-012]]

### fix(leads): "Gestionar" ya no mueve leads a Verificados hasta que el vendor actúa
- **Módulo:** `src/app/user/leads/page.tsx`, `src/data/userLeadsRepo.ts`, `firestore.rules`
- **What changed:** `openCampaignManage` ya no llama `takeIncompleteClient` (que seteaba `takenFromIncompleteAt` prematuramente). Ahora sólo abre el modal. `takenFromIncompleteAt` se sella sólo cuando el vendor confirma Visitado o Rechazado (`confirmVisit`/`confirmReject` con flag `actionFromNoVerificados`). Regla Firestore actualizada: `takenFromIncompleteAt` ahora es campo permitido en el `allow update` de visited/rejected (validando que sea int y que el valor anterior fuera null).
- **Why:** Presionar "Gestionar" movía el lead a "Verificados" sin que el vendor hubiera hecho nada. "Verificados" debe contener sólo leads con al menos ubicación/maps — la acción real (visita o rechazo) es la que cambia el estado.
- **See:** [[04_Errors#ERR-012]]

### fix(leads): permitir Gestionar en leads de campaña pre-asignados por autoAssignLead
- **Módulo:** `src/data/incompleteClientsRepo.ts`, `firestore.rules`
- **What changed:** `takeIncompleteClient` ya no lanza `client_already_taken` si `assignedTo === userId` (el mismo vendor). Se agrega regla Firestore para permitir al vendor confirmar un lead que `autoAssignLead` pre-asignó (condición: `assignedTo == auth.uid && takenFromIncompleteAt == null`).
- **Why:** `autoAssignLead` deja `assignedTo = vendorId` antes de que el vendor actúe. Al presionar "Gestionar", `takeIncompleteClient` fallaba con `client_already_taken` bloqueando el flujo.

### feat(leads): simplificar UX de "No verificados" — Gestionar modal + Revisar fusionado
- **Módulo:** `src/app/user/leads/page.tsx`
- **What changed:** `CampaignLeadCard`: botones Visitar/Rechazar reemplazados por un único botón "Gestionar" que abre el modal con opciones Visitado/Rechazado. `RecoveryCard`: eliminados botones WA standalone y Verificar standalone; el botón principal pasa a ser "Revisar" (full-width, abre el chat) con ícono de chat. Dentro del modal de review, el botón "Tomar" renombrado a "Verificar" y oculto para leads de campaña (estos usan el flujo Gestionar).
- **Why:** Reducir botones visibles en la tarjeta, obligar al vendor a leer el chat antes de verificar un lead DDD, y unificar el flujo de campaña bajo un solo punto de entrada (Gestionar).

### fix(assignments): corregir colección incorrecta en auto-asignación y campaignIds
- **Módulo:** `functions/src/assignments/autoAssignLead.js`, `src/features/subscriptions/useUserCampaignIds.ts`, `firestore.indexes.json`
- **What changed:** `autoAssignLead` cambiado de `subscriptionCities` a `cities` (colección correcta donde el servidor escribe `ownerUserId`, `activeCampaignId`, `status`). `useUserCampaignIds` cambiado de `subscriptionCities` a `subscriptions` (colección accesible por el cliente con regla Firestore `userId == auth.uid`). Índice compuesto `(userId, status)` agregado en `subscriptions`. Ahora `cityNames` usa el campo `city` del doc de suscripción.
- **Why:** `subscriptionCities` no existe como colección — nunca fue escrita. Todo el flujo de asignación por campaña nunca funcionó porque ambas queries siempre devolvían vacío.
- **See:** [[04_Errors#ERR-013]]

### feat(leads): fusionar campañas + DDD en "No verificados" cuando ambos están activos
- **Módulo:** `src/data/incompleteClientsRepo.ts`
- **What changed:** `subscribeIncompleteClients` ahora corre ambas subscriptions (campaña + DDD) en paralelo cuando el vendor tiene `campaignIds` Y `phoneCodes`. Mergea resultados deduplicando por ID (leads de campaña tienen prioridad). Leads de campaña → `CampaignLeadCard`. Leads DDD → `RecoveryCard`.
- **Why:** Un vendor puede tener campañas activas y también tener clientes por DDD en su área. Antes el modo campaña excluía completamente los leads DDD.

### fix(leads): leads de campaña auto-asignados visibles en "No verificados"
- **Módulo:** `src/data/incompleteClientsRepo.ts`, `src/features/subscriptions/useUserCampaignIds.ts`, `src/app/user/leads/page.tsx`
- **What changed:** `subscribeIncompleteClients` con `campaignIds` ahora usa `!takenFromIncompleteAt && status !== "visited/rejected"` como filtro en lugar de `isRecoverableIncompleteLead`. `useUserCampaignIds` expone `loading: boolean` para evitar race condition. La suscripción de "No verificados" espera a que `campaignIdsLoading` sea false antes de activarse. `visibleLeads` y `counts` en `page.tsx` excluyen leads de campaña sin `takenFromIncompleteAt` para que no aparezcan duplicados en "Verificados".
- **Why:** `autoAssignLead` setea `assignedTo` antes de que el vendor vea el lead, por lo que `isRecoverableIncompleteLead` los filtraba y desaparecían. `takenFromIncompleteAt` (solo seteado por `takeIncompleteClient`) es el discriminador correcto del estado "vendor ya actuó".
- **See:** [[04_Errors#ERR-012]]

### feat(assignments): auto-asignación por campaña en autoAssignLead
- **Módulo:** `functions/src/assignments/autoAssignLead.js`, `src/types/leads.ts`, `src/app/admin/leads/assignments/page.tsx`, `src/app/admin/page.tsx`
- **What changed:** Antes del matcher geográfico, `autoAssignLead` ahora comprueba si el lead tiene `leadAcquisitionCampaignId`. Si existe, busca en `subscriptionCities` el doc con `activeCampaignId == valor` (fallback a `campaignId`) y `status == "occupied"`, y asigna directamente al `ownerUserId`. Se registra con `autoAssignMatchType: "campaign"` y `assignmentMode: "campaign_auto"`. Si no hay match en campaña, cae al matcher geográfico normal. Se agregó `"campaign"` a `LeadAutoAssignMatchType` y a los labels/tones del admin.
- **Why:** Los clientes de campaña son exclusivos de un vendor — no tiene sentido que compitan con otros vendors en el pool geográfico.
- **See:** [[03_Decisions#ADR-014]]

### feat(leads): botones Visitar y Rechazar en CampaignLeadCard
- **Módulo:** `src/app/user/leads/page.tsx`
- **What changed:** `CampaignLeadCard` reemplaza el botón "Gestionar" por dos botones directos: "Visitar" (verde) y "Rechazar" (rojo). Ambos auto-asignan al vendor (`takeIncompleteClient`) en silencio antes de abrir el modal correspondiente (`actionType = "visit"` / `"reject"`). Se añadió tono `"red"` a `ActionBtn`. Se crearon `openCampaignVisit` y `openCampaignReject` siguiendo el mismo patrón que `openCampaignManage`.
- **Why:** Los clientes de campaña son exclusivos del vendor — no tiene sentido pasar por un modal intermedio de "Gestionar" cuando se puede ir directo a la acción.

### feat(leads): clientes de campaña como ya asignados en No verificados
- **Módulo:** `src/app/user/leads/page.tsx`
- **What changed:** Clientes con `leadAcquisitionCampaignId` que pertenece a una campaña activa del vendor se muestran con `CampaignLeadCard` (badge "Sin verificar", acciones iguales a Verificados: chat, WA, maps, copiar, nota, gestionar, No Apto). Las acciones "Gestionar" y "WhatsApp" auto-asignan el cliente al vendor (`takeIncompleteClient`) en silencio antes de ejecutar la acción — sin modal de confirmación de "Tomar". Los clientes filtrados por DDD (sin campaña) siguen usando `RecoveryCard` con flujo de "Tomar" explícito.
- **Why:** Los clientes de campaña son exclusivos de un vendor (nadie más los ve), por lo que el "Tomar" era fricción innecesaria. Los DDD clients sí son compartidos y mantienen el anti-colisión.
- **See:** [[03_Decisions#ADR-013]]

### feat(leads): botón No Apto en RecoveryCard + Verificados más pequeño
- **Módulo:** `src/app/user/leads/page.tsx`
- **What changed:** Botón de "Pasar a Verificados" reducido en tamaño. Se añadió botón "No Apto" (BanIcon, naranja) en RecoveryCard que abre modal de confirmación y llama `markClientNotSuitable`, moviendo el cliente a No Aptos.
- **Why:** Permitir limpiar los No verificados de clientes no aptos sin tenerlos que tomar primero.

### feat(prospectos): UI redesign — tabs Verificados / No verificados + pantalla No Aptos
- **Módulo:** `src/app/user/leads/page.tsx`, `src/app/user/chat/page.tsx`, `src/app/user/layout.tsx`
- **What changed:** La pantalla de Prospectos ahora tiene dos pestañas principales: "Verificados" (los prospectos asignados de siempre) y "No verificados" (clientes por recuperar de campañas/indicativos, con acción "Pasar a Verificados"). Se eliminó la fila de stats (visitado hoy/semana, rechazado), reemplazada por un contador semanal simple `X/total sem.`. La pantalla `/user/chat` queda exclusivamente para clientes "No Aptos" y el nav label cambió de "Recup." a "No Aptos".
- **Why:** Unificar la experiencia de gestión de prospectos en una sola pantalla. Los clientes por recuperar (no verificados) son parte del flujo de trabajo, no una pantalla separada.
- **See:** [[03_Decisions#ADR-012]]

### feat(recovery): filtrar clientes por recuperar según campaña activa del usuario
- **Módulo:** `src/data/incompleteClientsRepo.ts`, `src/features/subscriptions/useUserCampaignIds.ts`, `src/app/user/chat/page.tsx`, `src/app/user/leads/page.tsx`
- **What changed:** Los "clientes por recuperar" ahora se filtran por las campañas activas del usuario (ciudades de `subscriptionCities` donde `ownerUserId == uid` y `status == "occupied"`). Si el usuario tiene campañas activas, la query usa `leadAcquisitionCampaignId IN [campaignIds]` en Firestore. Si no tiene campañas, hace fallback al sistema anterior de indicativos (DDDs). El subtitle de la pantalla muestra los nombres de ciudad en lugar de los DDDs cuando hay campañas. Se añadió índice compuesto en `firestore.indexes.json` para `(verificationStatus, leadAcquisitionCampaignId)`.
- **Why:** Evitar que los vendors vean clientes de campañas de otros usuarios. Antes el filtro por DDD era demasiado amplio y mezclaba clientes de distintas campañas.
- **See:** [[03_Decisions#ADR — recuperar por campaña]]

## 2026-06-08

### fix(subscriptions): liberar ciudad con dos usuarios (ERR-011)
- **Módulo:** `src/server/subscriptions/subscriptionService.ts`
- **What changed:** En `releaseSubscriptionCity`, la transacción Firestore ahora lee todos los documentos de suscripción en paralelo (`Promise.all`) antes de escribir, evitando el error "read after write" del Admin SDK que bloqueaba ciudades con `activeParticipantsCount > 1`.
- **Why:** Firestore Admin SDK requiere que todas las lecturas ocurran antes de cualquier escritura en la misma transacción. Con un solo usuario (1 iteración) no había problema; con dos usuarios la segunda lectura ocurría después de las escrituras de la primera iteración.
- **See:** [[04_Errors#ERR-011]]

### feat(bot): IA activa desde el primer reply post-intro
- **Módulo:** `functions/src/bot/aiLeadAssistant.js`
- **What changed:** `shouldTryAiLeadAssistant` simplificado — la IA se activa en todos los mensajes después del intro mientras falten datos (hasBusiness || hasMaps). Antes solo se activaba como rescate. Prompt mejorado: instrucción de preguntar una sola cosa por mensaje, flujo paso a paso (negocio primero, luego Maps), tono más natural, reglas de calificación más explícitas, hasBusiness/hasMaps añadidos al estado del lead. Bug fix: textos PT-BR en buildAutomationLimitReply tenían encoding corrupto (Mojibake).
- **Why:** Mejorar la experiencia conversacional. La IA maneja mejor descripciones informales, detecta perfiles no aptos más temprano y responde preguntas sin caer en fallback.

### feat(bot): flujo de recolección paso a paso en intro (ES-PA y PT-BR)
- **Módulo:** `functions/src/bot/replies.js`, `functions/src/bot/repliesEsPa.js`
- **What changed:** Mensaje de intro simplificado a una sola pregunta ("¿Cuentas con un negocio propio activo?"). Flujo de recolección cambiado de pedir tipo+maps en un solo mensaje a pedir primero tipo de negocio, y solo después de recibirlo pedir la ubicación en Google Maps. Se mejoró el mensaje de Maps con instrucciones de cómo compartir el enlace.
- **Why:** Reducir fricción en el primer contacto. Lista de exclusiones y múltiples campos de golpe generaban abandono.

### feat(users): píldora "Suscripción" en verde si la campaña está activa en Firestore
- **Módulo:** `src/app/admin/settings/users/page.tsx`, `src/server/subscriptions/subscriptionService.ts`, `src/app/api/subscriptions/active-user-ids/route.ts`
- **What changed:** La badge de billing en la tabla de usuarios (desktop y mobile) muestra `tone="green"` cuando el usuario tiene una suscripción con `status === "active"` en la colección `subscriptions` de Firestore. Se añadió `getActiveSubscriptionUserIds` en el service (con scoping por admin/superadmin) y un nuevo endpoint `GET /api/subscriptions/active-user-ids`. La pantalla de usuarios carga los IDs activos en paralelo al cargar los usuarios.
- **Why:** El flag `weeklySubscriptionActive` es manual; el usuario quería reflejar el estado real de la campaña (colección `subscriptions`).

---

## 2026-06-07

### feat(accounting): mostrar gastos sociedad | mi parte en imagen y Excel
- **Módulo:** `src/app/admin/accounting/page.tsx`
- **Cambios:**
  - `downloadReceiptAsImage`: nuevo parámetro `societyExpensesTotal`. Si difiere de `expensesTotal` (mi parte), agrega una línea extra bajo "Total gastos" con `sociedad | mi parte` y los dos valores
  - `exportAccountingSheet`: nuevo parámetro `allExpenses`. Si difiere de `expenses` (portioned), agrega columnas "Sociedad | Mi parte" con ambos totales en la fila de gastos del Excel
  - Todos los call sites actualizados (desktop + mobile, 6 imagen + 3 Excel)
  - La línea solo aparece cuando los valores difieren (evita mostrar duplicado cuando el admin tiene 100% de gastos)

### fix(accounting): corregir ganancia bruta/real ajena en descargas de contabilidad
- **Módulo:** `src/app/admin/accounting/page.tsx`
- **Problema:** Admins regulares veían gross/real del total global en descargas; recibos por-admin del superadmin también mostraban totales globales
- **Cambios:**
  - `exportSummary`: usa `finalSummary` solo cuando `isClosed && isSuperAdmin`
  - `miGananciaPerAdmin` y `closeMiGananciaPerAdmin`: incluyen `gross`, `subscriptionInvestment` y `real` escopados por admin
  - 3 call sites de `downloadReceiptAsImage` actualizados con valores por-admin
- **Ver:** [[04_Errors#ERR-010]]

### Sistema Second Brain (trackgo-brain/)
- Creada estructura completa de documentación en `trackgo-brain/`
- Incluye: índice, proyecto, arquitectura, decisiones, errores, ideas, prompts, workflows, glosario
- Actualizado `AGENTS.md` con instrucciones de mantenimiento de memoria
- Todos los documentos generados desde análisis real del codebase

---

## 2026 (commits recientes)

### `1cd213a` — Fix: incluir campo `note` al listar ciudades de suscripción
- **Módulo:** Suscripciones admin
- **Problema:** El campo `note` de ciudades no aparecía en el panel admin
- **Fix:** Incluido `note` al serializar `SubscriptionCity` en el listado
- **Ver:** [[04_Errors#ERR-006]]

### `5374270` — Feature: partial spend refresh, city mini-notes en admin de suscripciones
- **Módulo:** Suscripciones admin
- **Cambios:**
  - Refresh parcial de spend (sin recargar toda la página)
  - Mini-notas de ciudad en el panel de administración de suscripciones
- **Decisión relacionada:** [[03_Decisions#ADR-006]]

### `f6abb47` — Fix: retry en rate limits de Meta, mostrar estado pausa de campaña, bloquear zoom desktop
- **Módulo:** Meta Ads, Layout
- **Cambios:**
  - Retry con backoff para errores 429 de Meta Ads API
  - Indicador visual de estado de pausa de campaña
  - Bloqueado zoom en desktop
- **Ver:** [[04_Errors#ERR-001]], [[04_Errors#ERR-002]]

### `2d17c72` — Recuperar: botón maps, requerir take-before-wa, modal de awareness
- **Módulo:** Quick actions, Flujo de visita
- **Cambios:**
  - Restaurado botón Maps en quick actions (condicional)
  - Bloqueado WhatsApp hasta completar foto "take-before"
  - Nuevo modal de awareness para contexto
- **Ver:** [[04_Errors#ERR-003]], [[04_Errors#ERR-004]], [[03_Decisions#ADR-008]]

### `6c54367` — ok
- Commit de ajustes menores (sin descripción específica)

---

## Cambios de arquitectura mayor (histórico)

### Split de permisos `leads` → `prospectos + actividad + chatView`
- **Fecha estimada:** 2026-Q1
- **Motivación:** Permiso `leads` era demasiado amplio
- **Impacto:** Sub-admins existentes requieren migración manual
- **Ver:** [[03_Decisions#ADR-004]], [[04_Errors#ERR-005]]

### Terminología: "Prospectos" reemplaza "Leads" en UI
- **Fecha estimada:** 2026
- **Motivación:** Mejor alineación con vocabulario del cliente en español
- **Ver:** [[03_Decisions#ADR-005]], [[09_Glossary]]

### Integración PIX (MercadoPago)
- **Fecha estimada:** 2025
- **Módulo:** `server/subscriptions/mercadoPago.ts`, `/api/webhook/mercadopago`
- **Ver:** [[03_Decisions#ADR-006]], [[08_Workflows#Flujo de pago PIX]]

### Integración Meta Ads para campañas automáticas
- **Fecha estimada:** 2025
- **Módulo:** `server/subscriptions/metaAds.ts`
- **Ver:** [[08_Workflows#Flujo de suscripción y campaña]]

---

## Plantilla para nuevas entradas

```markdown
## YYYY-MM-DD

### [tipo]: descripción breve
- **Módulo:** nombre del módulo afectado
- **Problema/Motivación:** por qué se hizo
- **Cambios:** qué se modificó exactamente
- **Ver:** [[enlace a decisión o error relacionado]]
```

---

*Actualizar este archivo después de cada commit significativo o sesión de trabajo.*
