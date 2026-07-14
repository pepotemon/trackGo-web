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

## Flujo de creación manual de campaña Meta Ads

Usar cuando hay que crear una campaña para una ciudad nueva desde cero (sin pasar por el flujo de suscripción).

### Prerequisitos (verificar antes de empezar)

| Item | Dónde verificar |
|---|---|
| Página de FB existe en el negocio TrackGo | `GET /906164879256382/owned_pages` |
| WABA existe y número verificado | `GET /906164879256382/owned_whatsapp_business_accounts` |
| WABA asignada a la página | Business Suite → Configuración → WhatsApp → Páginas asignadas |
| System user "TrackGo" tiene rol en la página | Business Suite → Configuración → Páginas → Personas |
| Audiencia guardada existe en la cuenta | `GET /act_1677554803260265/saved_audiences` |

### IDs fijos

```
Business ID:    906164879256382
Ad Account:     act_1677554803260265
System user:    TrackGo (agregar como Anunciante en cada página nueva)
Graph API:      v19.0
```

### IDs por país/página

| País | Página | Page ID | WABA ID | WhatsApp |
|---|---|---|---|---|
| Argentina | Credito Comercial - Argentina | `1277602658762993` | `1558135945992315` | `5493625192845` |
| Brasil | Crédito Comercial - Brasil | `906157149257155` | `1647410183361267` | `559180468472` |
| Panamá | Credito Comercial Panamá | `1159295907257113` | `2398466063967406` | `50767518087` |

### Paso 1 — Crear campaña

```bash
POST /act_1677554803260265/campaigns
{
  "name": "{Ciudad} | WhatsApp | Microcrédito | Comerciantes",
  "objective": "OUTCOME_ENGAGEMENT",
  "status": "PAUSED",
  "special_ad_categories": [],
  "is_adset_budget_sharing_enabled": false
}
```

### Paso 2 — Crear adset

```bash
POST /act_1677554803260265/adsets
{
  "name": "TrackGo - {Ciudad} - {PAIS}",
  "campaign_id": "{campaign_id}",
  "daily_budget": 3400,          # en centavos de USD → $34
  "billing_event": "IMPRESSIONS",
  "optimization_goal": "CONVERSATIONS",
  "destination_type": "WHATSAPP",
  "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
  "promoted_object": {
    "page_id": "{page_id}",
    "whatsapp_phone_number": "{numero_sin_+}"
  },
  "targeting": { ...spec de audiencia guardada... },
  "status": "PAUSED"
}
```

Obtener el targeting de la audiencia guardada:
```
GET /act_1677554803260265/saved_audiences?fields=id,name,targeting
→ copiar el objeto "targeting" de la audiencia deseada
```

### Paso 3 — Crear creativos (Python recomendado para evitar problemas de encoding)

```python
import urllib.request, urllib.parse, json

story_spec = {
    "page_id": PAGE_ID,
    "link_data": {
        "link": "https://api.whatsapp.com/send",
        "message": "TEXTO_DEL_ANUNCIO",
        "name": "TÍTULO_DEL_ANUNCIO",
        "image_hash": "HASH_IMAGEN_PLACEHOLDER",  # reemplazar en Ads Manager
        "call_to_action": {
            "type": "WHATSAPP_MESSAGE",
            "value": {"app_destination": "WHATSAPP"}
        },
        "page_welcome_message": json.dumps({
            "type": "VISUAL_EDITOR", "version": 2,
            "landing_screen_type": "welcome_message",
            "media_type": "text",
            "text_format": {
                "customer_action_type": "autofill_message",
                "message": {
                    "autofill_message": {"content": "¡Hola! Quiero más información."},
                    "text": "¡Hola! ¿En qué podemos ayudarte?"
                }
            },
            "user_edit": False, "surface": "visual_editor_new"
        }),
        "use_flexible_image_aspect_ratio": True
    }
}
payload = urllib.parse.urlencode({
    "name": "Nombre del creativo",
    "object_story_spec": json.dumps(story_spec),
    "access_token": TOKEN,
}).encode()
```

### Paso 4 — Crear anuncios

```python
payload = urllib.parse.urlencode({
    "name": "Nombre del anuncio",
    "adset_id": ADSET_ID,
    "creative": json.dumps({"creative_id": CREATIVE_ID}),
    "status": "PAUSED",
    "access_token": TOKEN,
}).encode()
# POST a /act_1677554803260265/ads
```

### Paso 5 — Reemplazar imágenes (manual, Ads Manager)

- Entrar a Ads Manager → abrir cada anuncio → editar creativo → subir imagen real
- Los image_hash son reutilizables si ya están subidos en la misma cuenta

### Errores comunes

| Error | Causa | Solución |
|---|---|---|
| `is_adset_budget_sharing_enabled` requerido | Cambio reciente en API | Agregar `"is_adset_budget_sharing_enabled": false` |
| `This WhatsApp phone number is not linked` | Número con código de país incorrecto | Verificar: AR=54, BR=55, PA=507, sin el `+` |
| `Permisos de página insuficientes` | System user no está en la página | Business Suite → Página → Personas → agregar TrackGo como Anunciante |
| `Página no vinculada a WhatsApp` | WABA no asignada a la página | Business Suite → WhatsApp → Páginas asignadas → agregar página |
| `object_story_spec inválido` | Encoding roto con curl para JSON anidado | Usar Python con `json.dumps()` en vez de curl |

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
