# 02 — Arquitectura

> [[00_Index]] | [[01_Project]] | [[03_Decisions]]

---

## Stack tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Framework | Next.js (App Router) | 16.2.4 |
| UI | React | 19.2.4 |
| Lenguaje | TypeScript | 5.x |
| Estilos | Tailwind CSS | 4.x |
| Base de datos | Cloud Firestore | — |
| Auth | Firebase Auth | 12.12.1 |
| Admin SDK | Firebase Admin | 13.8.0 |
| Mapas | @vis.gl/react-google-maps | 1.8.3 |
| Mapas alt. | MapLibre GL + Maptiler | 5.24.0 |
| Pagos | MercadoPago (PIX) | — |
| Anuncios | Meta Ads API | — |
| Push | Firebase Cloud Messaging | — |
| Deploy | Vercel | — |

---

## Estructura de carpetas

```
src/
├── app/                    # Next.js App Router (páginas + API routes)
│   ├── admin/              # Dashboard admin
│   ├── user/               # Panel vendor (mobile-first)
│   ├── api/                # Backend API routes
│   │   ├── subscriptions/  # CRUD suscripciones + PIX
│   │   ├── webhook/        # MercadoPago webhook
│   │   └── cron/           # Jobs programados
│   └── login/
│
├── components/             # Componentes reutilizables
│   ├── ui/                 # Kit de UI (Button, Card, Badge, Modal, etc.)
│   ├── auth/               # Guards (RequireAdmin)
│   ├── mobile/             # PullToRefresh, PWA
│   └── brand/              # Logo TrackGo
│
├── features/               # Lógica de dominio por feature
│   ├── auth/               # AuthProvider, usePermissions
│   ├── leads/              # Hooks, modales, coverageMatching
│   ├── accounting/         # Cálculos contables
│   └── subscriptions/      # Verificación de estado
│
├── data/                   # Capa de acceso a datos (repos Firestore)
│   ├── leadsRepo.ts
│   ├── userLeadsRepo.ts
│   ├── accountingRepo.ts
│   ├── clientsRepo.ts
│   ├── leadChatRepo.ts
│   └── ... (14 repos total)
│
├── server/                 # Código solo servidor
│   ├── auth.ts             # Token verification, requireServerUser()
│   ├── firebaseAdmin.ts    # Firebase Admin SDK init
│   ├── push.ts             # Push notifications
│   └── subscriptions/      # MercadoPago, Meta Ads, plans
│
├── lib/                    # Utilidades
│   ├── firebase.ts         # Firebase cliente init
│   ├── whatsapp.ts         # Normalización teléfonos LATAM
│   ├── phoneCoverage.ts    # Validación DDD brasileños
│   ├── subscriptionPlans.ts
│   └── date.ts
│
├── hooks/                  # Custom React hooks
│   ├── useWhatsAppDailyLimit.ts
│   └── useBackButtonDismiss.ts
│
└── types/                  # Modelos de dominio TypeScript
    ├── users.ts            # UserRole, AdminPermissions, UserDoc
    ├── leads.ts            # MetaLeadDoc, LeadAutoAssignMatchType
    ├── subscriptions.ts    # SubscriptionCity, SubscriptionCheckout
    ├── accounting.ts       # DailyEventDoc, WeeklyInvestmentDoc
    ├── activity.ts
    └── dashboard.ts
```

---

## Modelo de datos (Firestore)

### Colecciones principales

```
/users/{uid}
  role, name, email, active
  permissions (AdminPermissions)     // solo admins
  userPermissions (UserPermissions)  // solo vendors
  geoCoverage[], phoneCodes[]        // cobertura geográfica
  billingMode, ratePerVisit          // modelo de facturación
  autoAssignEnabled, autoAssignDailyLimit
  sharedAdmins[]                     // beneficiarios de ganancias

/clients/{id}                        // = prospectos
  name, phone, waId, business
  status: pending | visited | rejected
  verificationStatus: pending_review | incomplete | not_suitable | verified
  parseStatus: empty | partial | ready
  assignedTo, assignedAt, assignedDayKey
  autoAssignedAt, autoAssignMatchType
  location { city, state, lat, lng, address }
  lastInboundMessageAt, userUnreadMessageCount

/leadChats/{clientId}/messages/{msgId}
  text, direction, senderType, createdAt

/dailyEvents/{id}                    // eventos diarios de visita
  type: visited | rejected | pending
  userId, clientId, dayKey
  amount, ratePerVisitSnapshot

/autoAssignLogs/{id}
  leadId, assignedToUserId, matchType
  timestamp, city, state

/subscriptionCities/{cityId}
  name, state, country
  status: available | reserved | occupied
  ownerUserId, activeSubscriptionIds[]
  campaignId, activeCampaignId
  sharedPoolDailyBudget

/subscriptionCheckouts/{checkoutId}
  userId, cityId, plan, amount, adsBudget
  paymentId, status, activationStatus
  createdAt, expiresAt

/accountingInvestments/{weekKey}
  amount, allocations{}, groups{}
  status: draft | review | closed
  finalSummary (snapshot al cerrar)

/gastosExpenses/{id}
  name, amount, allocations[]

/webPushTokens/{uid}/tokens/{tokenId}
```

---

## Autenticación y permisos

```
Firebase Auth → onAuthStateChanged → cargar UserDoc desde Firestore
                                   → cachear en localStorage (trackgo_profile_cache_${uid})

API Routes: Bearer token → requireServerUser() → verificar + cargar perfil

isSuperAdmin=true   → ALL permissions bypassed
role="admin"        → AdminPermissions (26 flags)
role="user"         → UserPermissions (6 flags)
active=false        → 403 Forbidden
```

### Permisos admin (26 flags)
`prospectos, leadsEdit, leadsDelete, accountingView, accountingEdit, subscriptionsEdit, usersCreate, usersEdit, chatView, activityView, gastosView, gastosEdit, debtsView, commercialDirectory, notifications, ...`

### Permisos vendor (6 flags)
`canSeeMap, canSeeHistory, canSeeChat, canChatWithProspects, canSeeSubscriptions, canSeeCommercialDirectory`

---

## Auto-asignación de prospectos

```
Jerarquía de matching (coverageMatching.ts):
  1. city    → ciudad exacta
  2. hub_city → ciudad proxy/hub predefinida
  3. state   → estado completo
  4. country → país (fallback final)

Restricciones:
  - user.autoAssignEnabled = true
  - asignaciones del día < user.autoAssignDailyLimit
  - lead.location debe estar en user.geoCoverage
```

---

## PWA y Mobile

- `manifest.json` + service worker en `/public`
- `firebase-messaging-sw.js` para push notifications
- Pantalla de splash: SVG animado + `window.__tgSplashDone()` / `window.__tgSplashText()`
- Timeout de seguridad: 10 segundos si auth no resuelve

---

## Variables de entorno

```bash
# Firebase cliente
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID

# Mapas
NEXT_PUBLIC_GOOGLE_MAPS_KEY
NEXT_PUBLIC_MAPTILER_KEY

# Pagos
MERCADOPAGO_ACCESS_TOKEN
MERCADOPAGO_WEBHOOK_SECRET

# Meta Ads
META_ACCESS_TOKEN
META_AD_ACCOUNT_ID

# Firebase Admin (server-only)
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY

# Infraestructura
CRON_SECRET
NEXT_PUBLIC_APP_URL
```

---

*Ver [[03_Decisions]] para razonamiento detrás de elecciones de arquitectura.*
