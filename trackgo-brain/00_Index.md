# TrackGo Web — Second Brain

> Base de conocimiento viva del proyecto. Optimizada para Obsidian y Claude Code.
> Última actualización: 2026-06-07

---

## Navegación principal

| Documento | Descripción |
|-----------|-------------|
| [[01_Project]] | Visión general, objetivo de negocio, módulos principales |
| [[02_Architecture]] | Stack técnico, estructura de carpetas, flujo de datos |
| [[03_Decisions]] | Decisiones técnicas y de diseño tomadas (ADRs) |
| [[04_Errors]] | Errores conocidos, bugs resueltos, patrones problemáticos |
| [[05_Ideas]] | Ideas pendientes, mejoras futuras, backlog informal |
| [[06_Changelog]] | Historial de cambios por fecha |
| [[07_Prompts]] | Prompts efectivos para Claude Code en este proyecto |
| [[08_Workflows]] | Flujos de trabajo: auth, leads, pagos, contabilidad |
| [[09_Glossary]] | Glosario de términos del dominio (español/técnico) |

---

## Quick Reference

### Roles de usuario
- **admin** → Panel de operaciones con 26+ permisos granulares
- **user** (vendor) → Panel móvil de atención a prospectos

### Colecciones Firestore clave
```
/users           /clients          /leadChats
/dailyEvents     /autoAssignLogs   /subscriptionCities
/subscriptionCheckouts             /accountingInvestments
```

### Variables de entorno críticas
```
NEXT_PUBLIC_FIREBASE_*   → Firebase cliente
MERCADOPAGO_*            → Pagos PIX
META_ACCESS_TOKEN        → Meta Ads
CRON_SECRET              → Jobs programados
```

### Comandos de desarrollo
```bash
npm run dev    # Puerto 3000
npm run build  # Build producción
npm run lint   # ESLint
```

---

## Contexto para IA (Claude Code)

Este proyecto usa **Next.js 16.2.4 con App Router** — hay cambios breaking respecto a versiones anteriores.  
Leer `node_modules/next/dist/docs/` antes de tocar routing o layouts.

**Reglas absolutas:**
1. Texto de UI en español. "Prospectos" NO "Leads" ni "Meta leads".
2. Quick actions modales deben tener el mismo conjunto de acciones en todas las páginas de prospectos.
3. Permisos: `prospectos` + `actividad` + `chatView` (el viejo `leads` fue dividido).
4. No agregar código no solicitado. No refactorizar por cuenta propia.
5. Actualizar [[06_Changelog]] y [[03_Decisions]] después de cambios significativos.

---

## Notas de sesión activa

_Registrar aquí notas temporales de la sesión actual antes de distribuirlas a los docs definitivos._

---

*Este índice es el punto de entrada. Navegar desde aquí usando los enlaces [[nombre]].*
