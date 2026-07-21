# 05 — Ideas y Mejoras Futuras

> [[00_Index]] | [[01_Project]] | [[03_Decisions]]

Backlog informal de ideas, mejoras técnicas y features potenciales. No comprometidas, solo registradas.

---

## Ideas de producto

### IDEA-001: Dashboard de vendor con métricas personales
**Contexto:** Los vendors actualmente no tienen visibilidad de sus propias métricas (visitas, ingresos generados, prospectos pendientes).  
**Propuesta:** Agregar un mini-dashboard en `/user` con KPIs personales del vendor.  
**Esfuerzo estimado:** Medio (nuevo repo query + UI)  
**Prioridad:** Media

---

### IDEA-002: Notificaciones in-app (bell icon)
**Contexto:** Las notificaciones son actualmente solo push (Firebase Cloud Messaging). Si el usuario está en la app no ve una alerta visible.  
**Propuesta:** Centro de notificaciones in-app con badge counter y lista de eventos recientes.  
**Esfuerzo estimado:** Alto  
**Prioridad:** Baja

---

### IDEA-003: Filtros avanzados en cola de prospectos
**Contexto:** La cola de prospectos del admin es una lista paginada simple. Con volumen alto es difícil encontrar prospectos específicos.  
**Propuesta:** Filtros por ciudad, estado, vendor asignado, fecha, calidad.  
**Esfuerzo estimado:** Medio  
**Prioridad:** Media

---

### IDEA-004: Exportación de contabilidad a Excel
**Contexto:** Ya existe la dependencia `xlsx`. Los admins necesitan reportes para contadores externos.  
**Propuesta:** Botón de exportar en `/admin/accounting` que genere Excel con el resumen semanal.  
**Esfuerzo estimado:** Bajo (xlsx ya instalado)  
**Prioridad:** Alta

---

### IDEA-005: Multi-ciudad por vendor
**Contexto:** Actualmente un vendor puede cubrir múltiples ciudades vía `geoCoverage[]`, pero el panel mobile no muestra qué ciudad está atendiendo cada visita.  
**Propuesta:** Mostrar indicador de ciudad en cada prospecto del panel vendor.  
**Esfuerzo estimado:** Bajo  
**Prioridad:** Media

---

### IDEA-006: Comentarios/notas por prospecto
**Contexto:** Los admins no pueden dejar notas internas en un prospecto (solo el chat).  
**Propuesta:** Campo de notas internas (invisible para vendor) en el detalle del prospecto.  
**Esfuerzo estimado:** Bajo  
**Prioridad:** Alta

---

### IDEA-007: Webhooks de Meta Ads automáticos
**Contexto:** La activación de campaña es manual (admin hace clic). Si un pago PIX se confirma de madrugada, la campaña no arranca hasta que un admin entre.  
**Propuesta:** Activar campaña automáticamente al confirmarse el pago en el webhook de MercadoPago.  
**Esfuerzo estimado:** Medio (ya existe `server/subscriptions/metaAds.ts`)  
**Prioridad:** Alta

---

### IDEA-008: Contacto directo del vendedor tras verificar un prospecto
**Contexto:** Cuando la IA o el bot termina de verificar un prospecto, TrackGo puede informar que su caso ya está listo, pero no ofrece una vía personal y clara para comunicarse con el vendedor responsable.
**Propuesta:** Permitir que cada vendedor registre y edite desde su perfil un `nombre para WhatsApp` y un `número de WhatsApp de contacto`, con un interruptor de activación. Al verificar un prospecto, el mensaje automatizado podrá presentar al responsable (por ejemplo, "Carlos, tu cobrador encargado") e incluir un botón para abrir una conversación directa por WhatsApp. El administrador debe poder revisar qué vendedores tienen este contacto configurado y habilitado.
**Decisión de UX pendiente:** Ofrecer dos modos: `canal centralizado`, donde la conversación sigue en el WhatsApp conectado a TrackGo y queda registrada; y `contacto directo`, donde el botón abre el WhatsApp del vendedor. El segundo modo mejora la cercanía, pero los mensajes posteriores no se registrarán automáticamente en TrackGo.
**Consideraciones:** Validar el número en formato internacional, no exponerlo si el vendedor no lo habilita y revisar que el mensaje/CTA sea compatible con la plantilla de WhatsApp usada para iniciar conversaciones.
**Esfuerzo estimado:** Medio (campos en `/users`, perfil de vendedor, administración, plantilla y enlace de WhatsApp)
**Prioridad:** Media
**Estado:** Pendiente de definición y aprobación de producto

---

## Ideas técnicas

### IDEA-T001: Migración automática de permisos legacy
**Contexto:** Sub-admins con permiso `leads` viejo no migrado. Ver [[04_Errors#ERR-005]].  
**Propuesta:** Script de migración one-time en Firestore o endpoint de admin para migrar masivamente.  
**Esfuerzo estimado:** Bajo  
**Prioridad:** Alta (bug activo)

---

### IDEA-T002: Transacciones atómicas para auto-asignación
**Contexto:** Race condition potencial en límite diario de asignaciones. Ver [[04_Errors#ERR-009]].  
**Propuesta:** Usar Firestore transactions en `coverageMatching.ts` para garantizar atomicidad.  
**Esfuerzo estimado:** Medio  
**Prioridad:** Media (solo impacta bajo alta concurrencia)

---

### IDEA-T003: Storybook para kit UI
**Contexto:** El kit en `components/ui/` crece sin documentación visual.  
**Propuesta:** Agregar Storybook para documentar y testear componentes UI aislados.  
**Esfuerzo estimado:** Alto (setup inicial)  
**Prioridad:** Baja

---

### IDEA-T004: Tests E2E para flujo de pago
**Contexto:** El flujo PIX → webhook → activación es crítico pero sin tests automatizados.  
**Propuesta:** Tests de integración usando Firebase Emulator Suite.  
**Esfuerzo estimado:** Alto  
**Prioridad:** Media

---

### IDEA-T006: Granularidad por DDD para Argentina
**Contexto:** Hoy Argentina usa código de país `"54"` para toda la cobertura (ver [[03_Decisions#ADR-017]]). Un usuario con `"54"` ve prospectos de todo el país.  
**Propuesta:** Extender `incompleteClientsRepo.ts` con un mapa `ARGENTINA_DDDS` equivalente al `BRAZIL_DDDS` existente, usando los códigos de área argentinos (ej. `"379"` → Resistencia, `"11"` → Buenos Aires). Ajustar `extractDDD` para que, si el número empieza con `"54"`, extraiga el DDD regional en lugar de devolver siempre `"54"`.  
**Esfuerzo estimado:** Medio  
**Prioridad:** Baja (solo necesario si hay múltiples vendors en Argentina en distintas ciudades)

---

### IDEA-T005: Invalidar caché de perfil activamente
**Contexto:** Cambios de permisos no se reflejan sin cerrar sesión. Ver [[04_Errors#ERR-008]].  
**Propuesta:** Usar Firestore `onSnapshot` en el documento del usuario para invalidar caché en tiempo real.  
**Esfuerzo estimado:** Bajo  
**Prioridad:** Media

---

## Ideas descartadas

_(Mover aquí ideas que se evaluaron y decidieron no implementar, con razón)_

---

*Actualizar prioridades cuando el equipo planifique sprints.*
