# 06 — Changelog

> [[00_Index]] | [[03_Decisions]] | [[04_Errors]]

Historial de cambios significativos del proyecto. Organizado por fecha descendente.

---

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
