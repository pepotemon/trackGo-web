# 08 — Workflows y Flujos de Trabajo

> [[00_Index]] | [[02_Architecture]] | [[01_Project]]

Diagramas y descripciones de los flujos principales del sistema.

---

## Flujo de autenticación

```
Usuario abre app
  │
  ▼
Splash screen (SVG animado)
  │
  ▼
Firebase Auth → onAuthStateChanged
  │
  ├─ No autenticado → /login
  │
  └─ Autenticado → cargar UserDoc de Firestore
                    │
                    ├─ Cachear en localStorage (trackgo_profile_cache_${uid})
                    │
                    ├─ role="admin" → /admin (dashboard)
                    │
                    └─ role="user" → /user (leads del vendor)

API Routes:
  Request con Bearer token
    │
    ▼
  requireServerUser() → verificar token → cargar perfil
    │
    ├─ active=false → 403
    ├─ isSuperAdmin=true → all permissions
    ├─ role="admin" → check AdminPermissions
    └─ role="user" → check UserPermissions
```

---

## Ciclo de vida de un prospecto

```
Meta Lead Ads webhook
  │
  ▼
/api/webhook/meta (POST)
  │
  ▼
Crear MetaLeadDoc en /clients
  parseStatus: "empty" | "partial" | "ready"
  verificationStatus: "pending_review"
  status: "pending"
  │
  ▼
Auto-asignación (coverageMatching.ts)
  │
  ├─ Buscar vendor con cobertura: city → hub_city → state → country
  ├─ Verificar autoAssignEnabled + dailyLimit
  └─ assignedTo = userId, autoAssignMatchType = tipo
      │
      ▼
    Log en /autoAssignLogs
      │
      ▼
    Admin revisa prospecto
      │
      ├─ verificationStatus = "verified" → Vendor visita
      │     │
      │     ▼
      │   status = "visited" → DailyEventDoc (type: visited, amount calculado)
      │
      ├─ verificationStatus = "not_suitable" → Archivado
      │
      └─ verificationStatus = "incomplete" → Archivado tras 30 días
```

---

## Flujo de pago PIX y suscripción

```
Vendor selecciona ciudad + plan
  │
  ▼
POST /api/subscriptions/create-pix
  │
  ├─ Crear SubscriptionCheckout (status: pending, expiresAt: +timeout)
  ├─ Reservar ciudad: status → "reserved"
  └─ Crear pago PIX en MercadoPago
      paymentId, qrCode, expirationDate
      │
      ▼
Vendor escanea QR con app bancaria → paga PIX
  │
  ▼
MercadoPago → POST /api/webhook/mercadopago
  │
  ├─ Verificar firma webhook
  ├─ Buscar checkout por paymentId/checkoutId
  └─ status: "approved"
      │
      ▼
    activationStatus: "processing"
      │
      ▼
    ¿Ciudad ya ocupada?
      ├─ Sí → activationStatus: "city_occupied", reembolso manual
      └─ No → Activar cuenta Meta Ads
                │
                ├─ Éxito → ciudad status: "occupied", ownerUserId = userId
                │           activationStatus: "active"
                └─ Fallo → activationStatus: "meta_failed", alerta admin

Cron: /api/cron/subscriptions/expire
  → Buscar checkouts expirados → status: "expired" → ciudad: "available"
```

---

## Ciclo contable semanal

```
Lunes: Nuevo período
  │
  ▼
Admin crea WeeklyInvestmentDoc (status: draft)
  │
  ├─ Asignar budget a usuarios (allocations{userId: amount})
  └─ Opcionalmente: grupos de inversión (groups{})
      │
      ▼
Durante la semana:
  Vendor visita prospecto
    │
    ▼
  status prospecto → "visited"
    │
    ▼
  DailyEventDoc creado:
    type: "visited"
    amount: ratePerVisitSnapshot × 1
    dayKey: "YYYY-MM-DD"
    userId, clientId
      │
      ▼
  AccountingRepo acumula:
    gross = suma de amounts (ingresos)
    investment = WeeklyInvestmentDoc.allocations[userId]
    real = gross - investment
    roi = (real / investment) × 100

Fin de semana: Admin cierra período
  │
  ▼
status: "review" → admin revisa
  │
  ▼
status: "closed" → finalSummary persistido (inmutable)
  snapshot: { visited, rejected, gross, investment, real, roi, rows[] }
```

---

## Flujo de auto-asignación geográfica

```
Nuevo prospecto ingresa con location { city, state, country }
  │
  ▼
coverageMatching.ts busca vendors activos con autoAssignEnabled=true
  │
  ▼
Para cada vendor ordenado por prioridad:
  │
  ├─ Verificar dailyAssignments < autoAssignDailyLimit
  │
  └─ Verificar cobertura (geoCoverage[]):
      │
      ├─ MATCH city exacta
      │   → assignedTo = vendorId
      │   → autoAssignMatchType = "city"
      │
      ├─ MATCH hub_city (proxy predefinido)
      │   → autoAssignMatchType = "hub_city"
      │
      ├─ MATCH state completo
      │   → autoAssignMatchType = "state"
      │
      └─ MATCH country (fallback)
          → autoAssignMatchType = "country"

Log en /autoAssignLogs:
  leadId, assignedToUserId, matchType, timestamp, city, state
```

---

## Flujo de notificaciones push

```
Evento en sistema (nuevo prospecto asignado, etc.)
  │
  ▼
server/push.ts → buildNotificationPayload()
  │
  ▼
Leer /webPushTokens/{uid}/tokens/
  │
  ▼
Por cada token:
  FCM.send(token, payload)
    │
    ├─ Éxito → continuar
    └─ Token inválido → eliminar de Firestore
```

---

## Flujo de WhatsApp con límite diario

```
Vendor presiona "WhatsApp" en prospecto
  │
  ▼
useWhatsAppDailyLimit.ts verifica:
  Leer contador del día (localStorage + Firestore)
    │
    ├─ Límite no alcanzado → abrir wa.me link + incrementar contador
    └─ Límite alcanzado → mostrar modal de bloqueo
        "Límite diario de WhatsApp alcanzado"
```

---

## Workflow de desarrollo con Second Brain

```
Inicio de sesión
  │
  ▼
Leer trackgo-brain/00_Index.md (contexto)
  │
  ▼
Realizar cambios en código
  │
  ▼
Después de cambios significativos:
  ├─ Actualizar trackgo-brain/06_Changelog.md
  ├─ Si nueva decisión → trackgo-brain/03_Decisions.md
  ├─ Si error resuelto → trackgo-brain/04_Errors.md
  ├─ Si nueva idea → trackgo-brain/05_Ideas.md
  └─ Si cambió arquitectura → trackgo-brain/02_Architecture.md
      │
      ▼
    git commit con mensaje descriptivo
      │
      ▼
    Entrada en Daily/YYYY-MM-DD.md (si la sesión fue larga)
```

---

*Ver [[07_Prompts]] para prompts listos para usar con Claude Code en estos flujos.*
