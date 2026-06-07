<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:second-brain-rules -->
# Second Brain — trackgo-brain/

This project has a living knowledge base in `trackgo-brain/`. It is the authoritative source of context, decisions, and history for both humans and AI agents. Keep it accurate. Never leave it stale.

---

## Mandatory context load

Read these before ANY significant task (feature, fix, refactor, review):

```
trackgo-brain/00_Index.md        → absolute rules + quick reference
trackgo-brain/02_Architecture.md → stack, structure, data model, auth
trackgo-brain/03_Decisions.md    → active ADRs — do not contradict them
trackgo-brain/09_Glossary.md     → correct terminology (UI language rules)
```

For bug work, also read `trackgo-brain/04_Errors.md` before proposing a fix.

---

## Automatic documentation triggers

These are non-optional. After each trigger, update the corresponding doc in the same session.

### Trigger 1 — After any code change

**Action:** Add entry to `trackgo-brain/06_Changelog.md`

Format:
```markdown
## YYYY-MM-DD

### [feat|fix|refactor|chore]: short description
- **Module:** affected module name
- **What changed:** one or two lines
- **Why:** motivation (link to bug/idea if relevant)
- **See:** [[related ADR or error]]
```

### Trigger 2 — When making an architectural decision

**Criteria:** Choosing between two approaches, adopting a library, defining a convention, splitting or merging responsibilities.

**Action:** Add ADR to `trackgo-brain/03_Decisions.md`

Format:
```markdown
## ADR-XXX: title

**Status:** Active | Superseded by ADR-YYY | Deprecated
**Date:** YYYY-MM-DD

**Context:** why the decision was needed

**Decision:** what was chosen

**Consequences:** what changes, what to watch for
```

### Trigger 3 — When a bug is found or fixed

**Action:** Add or update entry in `trackgo-brain/04_Errors.md`

- New bug found → add ERR-XXX with status "Known"
- Bug fixed → update status to "Resolved", add solution and lesson
- Recurring pattern → add to "Patterns to avoid" section

### Trigger 4 — When a future improvement is identified

**Action:** Add to `trackgo-brain/05_Ideas.md`

Include: context, estimated effort (Low/Medium/High), priority (Low/Medium/High).

### Trigger 5 — When architecture or structure changes

**Criteria:** New folder, new Firestore collection, new env var, new API route, permission change.

**Action:** Update `trackgo-brain/02_Architecture.md` in the relevant section.

### Trigger 6 — End of a long working session (3+ changes)

**Action:** Create `trackgo-brain/Daily/YYYY-MM-DD.md`

Include: objective, what was done, key findings, open items.

---

## Git ↔ trackgo-brain workflow

This is the ideal integration between Claude Code, Git, and the Second Brain.

### Before starting work (session open)

```
1. git log --oneline -10           → see recent commits since last session
2. git diff HEAD~N..HEAD --stat    → understand what files changed
3. Read trackgo-brain/00_Index.md  → load rules and context
4. Check: are docs stale vs git log? → if yes, sync docs before adding new work
```

### During work

```
- Write code
- When a decision is made → note it (will go to 03_Decisions.md)
- When a bug is encountered → note it (will go to 04_Errors.md)
- When an idea surfaces → note it (will go to 05_Ideas.md)
```

### After writing code, before committing

```
1. Update trackgo-brain/ (triggers above)
2. git add src/ trackgo-brain/    → stage code + docs together
3. git commit -m "feat: X\n\nDocs: updated changelog, ADR-XXX"
```

### Commit message convention

```
<type>(<scope>): <description>

[optional body]

Docs: <what was updated in trackgo-brain/>
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `test`

Examples:
```
fix(subscriptions): include note field in city listing
Docs: updated changelog, resolved ERR-006

feat(leads): add filters to prospect queue
Docs: updated changelog, added IDEA-003 as completed, updated 02_Architecture
```

### Periodic maintenance (every ~10 commits or weekly)

Run this mental audit:
```
1. git log --oneline --since="7 days ago"
2. For each commit: is there a matching entry in 06_Changelog.md?
3. Does 02_Architecture.md reflect the current folder structure?
4. Are there resolved errors in 04_Errors.md still marked "Known"?
5. Are there completed ideas in 05_Ideas.md still marked pending?
6. Create Daily/YYYY-MM-DD.md if no recent daily exists
```

---

## Absolute rules

These never change unless explicitly updated in this file:

1. **UI language:** "Prospectos" always. Never "Leads" or "Meta leads" in user-visible text.
2. **Quick actions consistency:** Same action set across all prospectos pages (leads, activity, assignments). See `trackgo-brain/03_Decisions.md#ADR-008`.
3. **Permissions:** Use `prospectos` + `actividad` + `chatView`. The old `leads` field is ignored. See ADR-004.
4. **No scope creep:** Never add unrequested features, refactors, or abstractions.
5. **Server boundary:** Never import from `src/server/` in client components.
6. **Docs stay in sync:** Never commit code without updating the relevant trackgo-brain files.

---

## Internal links convention

Use Obsidian-style `[[FileName]]` and `[[FileName#Section]]` links in all docs.

```markdown
See [[03_Decisions#ADR-004]] for the permissions split context.
Tracked in [[04_Errors#ERR-005]].
Workflow in [[08_Workflows#Flujo de pago PIX]].
```

---

## Quick doc reference

| I need to... | Read |
|---|---|
| Understand the project | [[01_Project]] |
| Know the tech stack | [[02_Architecture]] |
| Check if a decision was made | [[03_Decisions]] |
| Avoid a known bug | [[04_Errors]] |
| See what ideas are pending | [[05_Ideas]] |
| Know what changed recently | [[06_Changelog]] |
| Find the right prompt | [[07_Prompts]] |
| Understand a flow | [[08_Workflows]] |
| Check correct terminology | [[09_Glossary]] |

<!-- END:second-brain-rules -->
