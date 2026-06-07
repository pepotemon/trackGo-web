# 09 — Glosario

> [[00_Index]] | [[01_Project]] | [[03_Decisions]]

Terminología del dominio, convenciones de código y conceptos clave del proyecto.

---

## Terminología UI (reglas de escritura)

| Correcto ✅ | Incorrecto ❌ | Notas |
|------------|--------------|-------|
| Prospecto | Lead | En toda UI visible |
| Prospectos | Leads / Meta leads | Plural y títulos |
| Cola de prospectos | Lead queue | Nombre del módulo |
| Asignación | Assignment | Opcional, ambos usados |
| Visita | Visit | En contabilidad |
| Rechazado/a | Rejected | En contabilidad y UI |
| Vendor / Vendedor | User / Seller | Rol de usuario |
| Admin | Admin | OK en ambos idiomas |

**Nota:** Esta regla aplica SOLO a textos visibles en UI. Los nombres de variables, funciones, tipos TypeScript y archivos mantienen `lead/leads` por compatibilidad con el código existente.

---

## Roles de usuario

| Término | Descripción |
|---------|-------------|
| **Admin** | Usuario con `role="admin"`. Accede al panel de operaciones (`/admin/*`). Puede tener permisos granulares específicos. |
| **Super Admin** | Admin con `isSuperAdmin=true`. Bypasea todos los checks de permisos. Acceso total. |
| **Vendor** | Usuario con `role="user"`. Usa panel mobile (`/user/*`). Atiende prospectos asignados. También llamado "vendedor". |
| **Sub-admin** | Admin sin `isSuperAdmin`. Tiene solo los permisos que se le asignaron explícitamente. |

---

## Estados de un prospecto (MetaLeadDoc)

| Campo | Valores | Descripción |
|-------|---------|-------------|
| `status` | `pending` | Prospecto sin contacto final |
| | `visited` | Vendor visitó al prospecto |
| | `rejected` | Prospecto rechazado/descartado |
| `verificationStatus` | `pending_review` | Recién ingresado, sin revisar |
| | `incomplete` | Datos insuficientes para asignar |
| | `not_suitable` | No es cliente potencial |
| | `verified` | Verificado, listo para asignar |
| `parseStatus` | `empty` | Sin datos de ubicación |
| | `partial` | Datos de ubicación incompletos |
| | `ready` | Datos completos, listo para asignar |
| `leadQuality` | `unknown` \| `valid` \| `review` \| `not_suitable` | Calidad del prospecto |

---

## Estados de suscripción

| Término | Descripción |
|---------|-------------|
| `SubscriptionCity.status` | Estado de la ciudad |
| `available` | Ciudad libre, disponible para comprar |
| `reserved` | Ciudad en proceso de compra (checkout activo) |
| `occupied` | Ciudad con suscripción activa, tiene dueño |
| `SubscriptionCheckout.status` | Estado del pago |
| `pending` | Pago PIX generado, esperando confirmación |
| `approved` | Pago confirmado por MercadoPago |
| `failed` | Pago fallido |
| `expired` | Checkout vencido sin pago |
| `cancelled` | Cancelado manualmente |
| `SubscriptionCheckout.activationStatus` | Estado de activación |
| `waiting_payment` | Esperando pago |
| `processing` | Pago aprobado, activando Meta Ads |
| `active` | Campaña activa, suscripción operativa |
| `meta_failed` | Fallo al activar en Meta Ads |
| `city_occupied` | Ciudad ocupada por otro al procesar |

---

## Planes de suscripción

| Plan | Descripción |
|------|-------------|
| `base` | Plan base de entrada |
| `crecimiento` | Plan de crecimiento (mid-tier) |
| `dominio` | Plan premium (máximo presupuesto) |
| `custom` | Plan personalizado |

---

## Términos contables

| Término | Descripción |
|---------|-------------|
| **Inversión** | Presupuesto asignado a un vendor para la semana (`WeeklyInvestmentDoc`) |
| **Bruto / Gross** | Ingresos generados por visitas (visitas × tasa por visita) |
| **Real** | Resultado neto = Bruto - Inversión |
| **ROI** | Return on Investment = (Real / Inversión) × 100 |
| **DailyEvent** | Registro de una visita o rechazo individual en un día |
| **dayKey** | Clave de fecha en formato `YYYY-MM-DD` |
| **weekKey** | Clave de semana contable (`YYYY-MM-DD` del lunes) |
| **Shared admin** | Admin beneficiario de un porcentaje de las ganancias de un vendor |

---

## Auto-asignación

| Término | Descripción |
|---------|-------------|
| `autoAssignMatchType` | Tipo de match geográfico usado al asignar |
| `city` | Coincidencia exacta de ciudad |
| `hub_city` | Ciudad proxy/hub predefinida |
| `state` | Estado completo (fallback) |
| `country` | País (fallback final) |
| `geoCoverage` | Array de zonas geográficas cubiertas por un vendor |
| `phoneCodes` | Array de DDDs (códigos de área) del vendor |
| `autoAssignDailyLimit` | Máximo de asignaciones automáticas por día para un vendor |

---

## Permisos

### Admin permissions (AdminPermissions)
| Flag | Acceso que otorga |
|------|------------------|
| `prospectos` | Lista y cola de prospectos |
| `leadsEdit` | Editar prospectos |
| `leadsDelete` | Eliminar prospectos |
| `actividad` | Log de actividad |
| `chatView` | Ver chats de prospectos |
| `accountingView` | Ver contabilidad |
| `accountingEdit` | Editar contabilidad |
| `subscriptionsEdit` | Gestionar suscripciones |
| `usersCreate` | Crear usuarios |
| `usersEdit` | Editar usuarios |
| `gastosView` | Ver gastos |
| `gastosEdit` | Editar gastos |
| `debtsView` | Ver deudas |
| `commercialDirectory` | Directorio comercial |
| `notifications` | Configurar notificaciones |

### User permissions (UserPermissions)
| Flag | Descripción |
|------|-------------|
| `canSeeMap` | Acceso al mapa geográfico |
| `canSeeHistory` | Ver historial de contactos |
| `canSeeChat` | Ver chat (solo lectura) |
| `canChatWithProspects` | Enviar mensajes en chat |
| `canSeeSubscriptions` | Ver panel de suscripciones |
| `canSeeCommercialDirectory` | Acceder al directorio comercial |

---

## Términos técnicos del proyecto

| Término | Descripción |
|---------|-------------|
| **App Router** | Sistema de rutas de Next.js 16 basado en carpetas `app/` |
| **Server Component** | Componente React que corre solo en servidor (default en App Router) |
| **Route Handler** | API route en App Router (`route.ts`) |
| **Firestore Rule** | Regla de seguridad en `firestore.rules` (cliente) |
| **requireServerUser()** | Función en `server/auth.ts` que valida Bearer token en API routes |
| **MetaLeadDoc** | Documento de prospecto en Firestore (colección `/clients`) |
| **DailyEventDoc** | Registro de evento diario (visita/rechazo) |
| **coverageMatching** | Algoritmo de matching geográfico en `features/leads/coverageMatching.ts` |
| **PIX** | Método de pago instantáneo de Brasil (vía MercadoPago) |
| **FCM** | Firebase Cloud Messaging (push notifications) |
| **DDD** | Código de discado directo a distancia (código de área brasileño) |
| **PWA** | Progressive Web App (manifest + service worker) |
| **splash** | Pantalla de carga inicial antes del auth check |

---

*Actualizar al introducir nueva terminología en el proyecto.*
