# 01 — Proyecto TrackGo

> [[00_Index]] | [[02_Architecture]] | [[08_Workflows]]

---

## Descripción

**TrackGo** es una plataforma SaaS B2B de gestión de prospectos y operaciones de ventas en campo, orientada al mercado latinoamericano. Conecta administradores que gestionan campañas de Meta Ads con vendedores (vendors) que visitan a los prospectos en terreno.

---

## Objetivos de negocio

1. **Capturar prospectos** desde Meta Lead Ads via webhook
2. **Asignar prospectos** automáticamente a vendedores según cobertura geográfica
3. **Rastrear visitas** y generar contabilidad semanal de ingresos/inversión/ROI
4. **Gestionar suscripciones** de ciudades exclusivas con pagos PIX (MercadoPago)
5. **Comunicar** a admins y vendors sobre prospectos en tiempo real (WhatsApp + push)

---

## Usuarios del sistema

### Admin
- Gestiona el panel de operaciones completo
- 26 permisos granulares configurables (no todos los admins tienen todo)
- Puede ser **isSuperAdmin** (bypassa todos los checks de permisos)
- Ve contabilidad, prospectos, actividad, configuración

### Vendor (role: "user")
- Panel móvil-first con PWA
- Atiende prospectos asignados
- Puede tener cobertura geográfica (DDD / ciudades / estados)
- 6 permisos configurables (canSeeMap, canSeeChat, etc.)

---

## Módulos principales

| Módulo | Ruta | Descripción |
|--------|------|-------------|
| Dashboard admin | `/admin` | KPIs, actividad reciente, métricas |
| Prospectos | `/admin/leads` | Cola de prospectos, asignación |
| Detalle prospecto | `/admin/leads/[id]` | Chat, historial, edición |
| Asignaciones | `/admin/leads/assignments` | Log de auto-asignaciones |
| Actividad | `/admin/activity` | Audit trail de eventos |
| Contabilidad | `/admin/accounting` | Inversión semanal, ingresos, ROI |
| Gastos | `/admin/gastos` | Registro de gastos operativos |
| Configuración | `/admin/settings/*` | Usuarios, suscripciones, notificaciones |
| Panel vendor | `/user/leads` | Prospectos asignados al vendor |
| Mapa vendor | `/user/map` | Vista geográfica de prospectos |
| Chat vendor | `/user/chat` | Conversación con prospectos |
| Historial vendor | `/user/history` | Contactos pasados |

---

## Flujos clave

Ver [[08_Workflows]] para diagramas detallados de:
- Flujo de autenticación
- Ciclo de vida de un prospecto
- Sistema de pagos y suscripciones
- Ciclo contable semanal

---

## Regiones objetivo

- **Brasil** (foco principal): PIX, DDDs brasileños
- México, Colombia, Argentina, Chile, Perú (soporte multi-país)
- Idioma UI: **español** (incluso para Brasil — UI en español)

---

## Estado del proyecto (2026-06-07)

- Producción activa en Vercel
- Sistema de suscripciones funcional con MercadoPago PIX
- Meta Ads integrado para campañas automáticas
- Permiso `leads` dividido en `prospectos` + `actividad` + `chatView`
- Sub-admins existentes requieren actualización manual en Firestore

---

*Ver [[02_Architecture]] para detalles técnicos del stack.*
