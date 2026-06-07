# 07 — Prompts para Claude Code

> [[00_Index]] | [[08_Workflows]] | [[09_Glossary]]

Prompts efectivos y plantillas para trabajar con Claude Code en este proyecto.

---

## Prompts de contexto inicial

### Cargar contexto completo del proyecto
```
Lee trackgo-brain/00_Index.md, 01_Project.md, y 02_Architecture.md.
Luego responde: ¿qué hace TrackGo y cómo está organizado el código?
```

### Cargar contexto antes de una tarea
```
Antes de empezar, lee:
- trackgo-brain/02_Architecture.md (estructura del proyecto)
- trackgo-brain/03_Decisions.md (decisiones técnicas vigentes)
- trackgo-brain/09_Glossary.md (terminología correcta)

Tarea: [describir tarea aquí]
```

---

## Prompts de desarrollo

### Agregar nueva feature
```
Contexto del proyecto en trackgo-brain/. 
Quiero agregar [nombre de feature].
El módulo afectado es [módulo].
Sigue los patrones existentes en [archivo de referencia].
No modifiques código fuera del alcance de esta tarea.
```

### Corregir un bug
```
Bug: [descripción del bug]
Archivo(s) afectado(s): [ruta]
Comportamiento actual: [qué pasa]
Comportamiento esperado: [qué debería pasar]

Antes de proponer solución, lee trackgo-brain/04_Errors.md para ver si este
patrón ya fue encontrado antes.
```

### Revisar permisos
```
Necesito verificar que el permiso [nombre_permiso] está correctamente
aplicado en [página/componente].

Contexto de permisos en trackgo-brain/02_Architecture.md#Autenticación-y-permisos
y src/types/users.ts.
```

### Agregar acción a quick actions
```
Quiero agregar la acción [nombre] a los quick actions modales.
Según trackgo-brain/03_Decisions.md#ADR-008, esta acción debe ser evaluada
para todas las páginas de prospectos (leads, actividad, assignments).

Páginas afectadas:
- src/app/admin/leads/page.tsx
- src/app/admin/activity/page.tsx
- src/app/admin/leads/assignments/page.tsx
```

---

## Prompts de mantenimiento de documentación

### Actualizar changelog después de cambios
```
Se acaban de realizar los siguientes cambios al proyecto:
[descripción de cambios]

1. Actualiza trackgo-brain/06_Changelog.md con una entrada para hoy (YYYY-MM-DD).
2. Si hay nueva decisión técnica, agrégala a trackgo-brain/03_Decisions.md.
3. Si se resolvió un bug conocido, actualiza el estado en trackgo-brain/04_Errors.md.
4. Si surgió una nueva idea o mejora, agrégala a trackgo-brain/05_Ideas.md.
```

### Registrar nuevo error
```
Se encontró el siguiente error:
[descripción del error]
Archivo(s): [ruta]
Commit: [hash si aplica]

Agrégalo a trackgo-brain/04_Errors.md con:
- ERR-XXX (siguiente número disponible)
- Estado
- Problema
- Solución (si ya se resolvió)
- Lección aprendida
```

### Revisar arquitectura tras refactor
```
Se refactorizó [módulo/área].
Lee el código actual en [ruta] y actualiza trackgo-brain/02_Architecture.md
para reflejar los cambios. No cambies código, solo documentación.
```

### Actualizar Second Brain completo
```
Analiza los últimos commits con `git log --oneline -20`.
Para cada cambio significativo:
1. Agrega entrada a trackgo-brain/06_Changelog.md
2. Identifica si hay nuevas decisiones técnicas → trackgo-brain/03_Decisions.md
3. Identifica errores resueltos → actualiza trackgo-brain/04_Errors.md
4. Identifica mejoras futuras mencionadas → trackgo-brain/05_Ideas.md
5. Actualiza trackgo-brain/02_Architecture.md si cambió estructura
```

---

## Prompts de revisión de código

### Code review antes de commit
```
Revisa el código que acabo de escribir en [archivo].
Verifica:
1. La terminología en UI usa "Prospectos" (no "Leads")
2. Los permisos se verifican correctamente
3. No se importa código de src/server/ desde componentes cliente
4. Los quick actions modales son consistentes (ver ADR-008)
5. No hay lógica nueva sin documentar en decisiones
```

### Verificar consistencia con patrones existentes
```
Revisa [nuevo archivo/función] y compáralo con [archivo de referencia].
¿Sigue los mismos patrones de:
- Estructura de componente
- Manejo de errores
- Tipos TypeScript
- Queries a Firestore
?
```

---

## Prompts de análisis

### Entender un módulo
```
Explica cómo funciona el módulo de [nombre] en TrackGo.
Lee los archivos relevantes en src/ y resume:
1. Qué hace
2. Cómo está estructurado
3. Qué datos maneja
4. Con qué otros módulos interactúa
```

### Análisis de impacto
```
Si modifico [función/tipo/archivo], ¿qué otros archivos pueden verse afectados?
Busca todas las importaciones y usos en el codebase.
```

---

## Prompts especiales para Second Brain

### Sesión de actualización semanal
```
Haz una revisión semanal del Second Brain de TrackGo:
1. git log --oneline --since="7 days ago" para ver cambios recientes
2. Actualiza trackgo-brain/06_Changelog.md
3. Verifica si trackgo-brain/02_Architecture.md sigue siendo preciso
4. Mueve ideas completadas de 05_Ideas.md a 06_Changelog.md
5. Agrega una entrada en trackgo-brain/Daily/ con la fecha de hoy
```

### Iniciar nueva sesión de trabajo
```
Estoy empezando a trabajar en TrackGo.
Lee trackgo-brain/00_Index.md y dame un resumen de:
1. Estado actual del proyecto
2. Últimas decisiones técnicas relevantes
3. Errores conocidos que podría encontrar
4. Ideas en progreso
```

---

*Agregar nuevos prompts que se descubran como útiles durante el desarrollo.*
