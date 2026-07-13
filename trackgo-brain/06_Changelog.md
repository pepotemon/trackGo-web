# 06 — Changelog

> [[00_Index]] | [[03_Decisions]] | [[04_Errors]]

Historial de cambios significativos del proyecto. Organizado por fecha descendente.

---

## 2026-07-13 (10)

### fix(resolver): ciudad "Natal" incorrecta en leads de Argentina y otros
- **Module:** `functions/src/utils/googleMapsResolver.js`, `functions/src/utils/trackgoGeo.js`, `functions/src/whatsapp/upsertLead.js`
- **What changed:**
  1. Eliminado el paso `fromHtml = extractCoordsFromAnyText(fetched.html)` de `resolveCoordsFromGoogleMapsUrl` — ese paso corría patrones de coordenadas sobre el HTML crudo completo, pudiendo matchear coords de Natal (u otra ciudad) embebidas en scripts/links de la página.
  2. `extractConsentContinueUrl` ya no escanea todas las URLs del HTML de consent.google.com como fallback. Ahora solo busca en parámetros URL (`continue`, `redirect`, `destination`, `next`, `return`) e inputs hidden de formulario — evita capturar una URL de Maps equivocada que referencie otra ciudad.
  3. `geocodeTextInBrazil` reemplazada por `geocodeTextForMarket(query, marketCountry)` con configuración por país: usa `countrycodes=ar` + `accept-language=es-AR` + bounding box de Argentina para leads AR, y equivalentes para PA/BR.
  4. `buildGeocodeQueries` recibe `marketCountry` y agrega el sufijo correcto al query (`, Argentina` en vez de `, Brasil`).
  5. `looksSpecificEnoughForBrazilGeocode` reemplazada por `looksSpecificEnoughForGeocode(query, marketCountry)` con placeHints por país.
  6. `resolveCoordsFromGoogleMapsUrl` y `resolveEffectiveCoords` reciben `marketCountry` y lo propagan.
  7. `trackgoGeo.js`: agregada `TRACKGO_ARGENTINA_CITY_HUBS` (Resistencia, Corrientes, Formosa, Posadas, Buenos Aires, Córdoba, Rosario, Tucumán, Salta, Mendoza). `getHubsForMarket("AR")` ahora devuelve estos hubs en vez de caer a los hubs de Brasil.
- **Why:** Links `maps.app.goo.gl?g_st=iw` (iOS WhatsApp) y otros shortlinks siempre resolvían "Natal" como ciudad. El HTML de la página de consent o del redirect intermedio contenía coordenadas de Natal en algún script/link, y `extractCoordsFromAnyText` sobre HTML crudo las capturaba antes de que se pudiera encontrar la URL correcta. Además, los leads de Argentina no tenían hubs propios — `getHubsForMarket("AR")` devolvía hubs de Brasil.
- **See:** [[04_Errors#ERR-016]]

## 2026-07-13 (9)

### fix(bot): catch-all estricto para tipos de negocio no reconocidos
- **Module:** `functions/src/bot/business.js`
- **What changed:** `isPossibleBusinessFallbackText` ahora termina con un catch-all: si el texto tiene ≥4 chars, al menos 2 letras consecutivas, y NO es una palabra de la lista de rechazo (afirmaciones, saludos, despedidas, agradecimientos, rellenos, frases de intención), se acepta como negocio. Lista de ~60 tokens/frases no-negocio en español y portugués.
- **Why:** La lista hardcodeada de negocios nunca puede ser completa. "peluquería", "acopio", "vivero", etc. no estaban y el bot pedía el tipo en loop. Ahora acepta cualquier tipo de negocio nuevo sin requerir modificar el código.
- **See:** entrada (8) de hoy

## 2026-07-13 (8)

### fix(bot): parser no reconocía términos de negocio en español/Argentina
- **Module:** `functions/src/bot/business.js`
- **What changed:** Agregados ~30 términos de negocio en español argentino a `isLikelyBusinessLine` (peluquería, taller, ferretería, verdulería, carnicería, panadería, almacén, supermercado, heladería, etc.). Agregadas normalizaciones en `normalizeBusinessLabel` para cada uno. Los términos existentes solo tenían equivalentes en portugués (salão, barbearia, padaria) sin sus contrapartes en español.
- **Why:** El parser devolvía `parsedBusiness = ""` para respuestas comunes en Argentina como "peluquería", "taller", etc. El bot quedaba en loop preguntando el tipo de negocio incluso luego de que el usuario ya lo había respondido.
- **See:** —

## 2026-07-13 (7)

### fix(bot): respuesta inicial en portugués para número Argentina
- **Module:** `functions/index.js`, `functions/src/whatsapp/upsertLead.js`, `functions/src/cron/reminderMissingInfo.js`
- **What changed:** 4 puntos donde el idioma del canal solo chequeaba `=== "es-PA"` y dejaba `es-AR` caer al builder pt-BR. Cambiados todos a `.startsWith("es")`. Fallback de `marketCountryNormalized/Label` en `buildMarketFields` ahora incluye `"AR"` → `"argentina"/"Argentina"`. `acceptLanguage` para reverse geo pasa el idioma real (`es-AR`) en lugar de hardcodear solo `es-PA`.
- **Why:** El número de Argentina tiene `language: "es-AR"` pero el selector de reply builder solo conocía `"es-PA"` — todos los leads de AR recibían el primer mensaje en portugués.
- **See:** —

## 2026-07-13 (6)

### fix(resolver): implementar bypass consent.google.com y resolver URLs anidadas
- **Module:** `functions/src/utils/googleMapsResolver.js`
- **What changed:** Agregada `extractConsentContinueUrl(finalUrl, html)` que extrae la URL real de Maps desde el parámetro `continue` de consent.google.com o escaneando el HTML como fallback. `fetchUrlFollowingRedirects` ahora acepta `depth` (max 2) y si aterriza en consent.google.com hace un segundo fetch a la URL real. En el loop de URLs anidadas del HTML, si la URL no tiene coords directas se sigue con `fetchUrlFollowingRedirects` (2 sources nuevas: `maps_nested_redirect`, `maps_nested_html`).
- **Why:** ERR-016 marcado como resuelto pero el código nunca fue implementado. Links `share.google/` y `maps.app.goo.gl` con `?g_st=aw` fallaban porque redirect server-side va a consent.google.com, que no es URL de Maps. Links `share.google/` además pueden embeder la URL real en el HTML de la página, no en el redirect directo.
- **See:** [[04_Errors#ERR-016]]

## 2026-07-13 (5)

### feat(bot): implementar canal WhatsApp Argentina en functions
- **Module:** `functions/src/config/params.js`, `functions/src/whatsapp/channels.js`
- **What changed:** `WHATSAPP_PHONE_NUMBER_ID_AR` registrado como `defineString` en params. `getArgentinaPhoneNumberId()` y `getArgentinaWhatsappChannel()` agregados en channels. `getWhatsappChannelByPhoneNumberId()` reconoce el ID de AR. `getWhatsappChannelFromClient()` devuelve canal AR cuando `marketCountry === "AR"`. Fallback hardcodeado `1217681158095488` por si el param no está disponible en frío.
- **Why:** El número AR estaba registrado en Meta Cloud API pero el código de functions nunca lo leía ni lo usaba — los mensajes salientes de AR habrían usado el canal de Brasil por defecto.
- **See:** entrada (4) — registro WABA y PIN

## 2026-07-13 (4)

### chore(meta): configurar WABA Argentina y registrar número WhatsApp
- **Module:** `functions/.env.trackgo-f2461`, Meta Business Manager (manual)
- **What changed:** WABA Argentina (`1558135945992315`) suscrita al webhook de TrackGo (`POST /subscribed_apps → {success:true}`). Número `+54 9 362 519-2845` (Phone Number ID `1217681158095488`) registrado en Cloud API con PIN `171866` (`POST /register → {success:true}`). Ambos valores guardados en `.env.trackgo-f2461` (`WHATSAPP_PHONE_NUMBER_ID_AR`, `WHATSAPP_PIN_AR`).
- **Why:** El número de Argentina estaba en estado "no registrado" en Meta — sin registro Cloud API el bot no puede enviar mensajes. La WABA tampoco estaba suscrita al webhook de la app TrackGo.
- **See:** —

## 2026-07-13 (3)

### fix(resolver): bypassear consent.google.com al resolver links maps.app.goo.gl
- **Module:** `functions/src/utils/googleMapsResolver.js`
- **What changed:** `fetchUrlFollowingRedirects` detecta si el redirect aterrizó en `consent.google.com` y extrae la URL real de Maps desde el parámetro `continue` de la URL o del HTML de la página de consent. Luego hace un segundo fetch a esa URL para continuar la cadena normal de resolución de coordenadas.
- **Why:** Links compartidos desde WhatsApp Android (`?g_st=aw`) redirigían server-side a consent.google.com, bloqueando la resolución de coordenadas y dejando leads sin ciudad asignada.
- **See:** [[04_Errors#ERR-016]]

## 2026-07-13 (2)

### feat(bot): soporte de canal WhatsApp Argentina (número dedicado)
- **Module:** `functions/src/config/params.js`, `functions/src/whatsapp/channels.js`, `functions/index.js`
- **What changed:** Agregado canal Argentina al bot de Firebase Functions. `WHATSAPP_PHONE_NUMBER_ID_AR` como nuevo param. `getArgentinaWhatsappChannel()` con `marketCountry: "AR"`, `language: "es-AR"`, `countryNormalized: "argentina"`. El router de respuestas del bot trata `es-AR` igual que `es-PA` (mismo builder en español). Mensajes pre-cargados de WhatsApp en el mapa del vendor cambiados de portugués a español.
- **Why:** Expansión de operaciones a Argentina con número de WhatsApp dedicado.
- **See:** [[04_Errors#ERR-015]]

## 2026-07-13

### fix(coverage): soporte de Argentina en matching de cobertura y prefijos de teléfono
- **Module:** `features/leads/coverageMatching.ts`, `lib/phoneCoverage.ts`, `lib/phonePrefixes.ts`
- **What changed:** Tres fixes para que Argentina funcione como país de campaña: (1) `leadCountry()` ahora usa un mapa `MARKET_COUNTRY_CODE` que incluye `AR → argentina`; (2) `extractPhoneCoverageCode` reconoce el prefijo `54` via `LATAM_2_DIGIT_COUNTRY_CODES`; (3) `LATAM_COUNTRIES` incluye `54 → Argentina` para filtros del admin.
- **Why:** Expansión de operaciones a Argentina. Antes, leads argentinos sin `geoAdminCountryNormalized` caían al fallback "brasil" y no matcheaban ninguna cobertura.
- **See:** [[04_Errors#ERR-015]]

---

## 2026-06-29

### fix(bot): evitar race condition que borraba currentLeadMapsConfirmedAt
- **Module:** `functions/src/whatsapp/upsertLead.js`
- **What changed:** En el update de lead existente, cuando `hasMapsInThisMessage = false`, el campo `currentLeadMapsConfirmedAt` ya no se incluye en el payload (antes se escribía `0`). Con `merge: true`, Firestore preserva el valor positivo ya guardado.
- **Why:** Si dos mensajes llegaban con ~50ms de diferencia (URL de Maps + dirección de texto), el segundo upsert leía `prev.currentLeadMapsConfirmedAt = 0` (antes de que el primero commitara) y lo pisaba, haciendo que el bot pidiera Maps de nuevo aunque ya había sido enviado.
- **See:** [[04_Errors]]

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
