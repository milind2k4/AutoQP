# AutoQP

Centralized, AI-assisted exam question bank and LaTeX compilation platform.
Replaces manual, word-processor-based exam typesetting with a shared,
subject-scoped question bank, a human-reviewed AI intake pipeline, an
automated blueprint-based paper assembler, and a LaTeX/Tectonic compilation
engine that outputs publication-quality PDFs plus raw `.tex` source.

Full requirements: `docs/SRS_AutoQP.tex`. Technical contract for any coding
agent working on this repo: `docs/AGENTS.md`. Database schema:
`db/schema.sql`. This document is the practical "how do I start writing
code" companion to those three.

**Current milestone scope:** Must-Have requirements only (REQ-1 through
REQ-7), per the project's Time Feasibility finding. See `docs/AGENTS.md`
"Current phase" before building anything else.

## Team ownership

Four tracks, matching the pipeline a question actually flows through:

| Track | Covers | Owns |
|---|---|---|
| 1. Foundation | Auth, subjects, RLS (REQ-1.x) | `modules/auth/` |
| 2. Intake | AI generation, extraction, staging (REQ-2–4.x) | `modules/intake/` |
| 3. Bank & Assembly | Repository, blueprint generator (REQ-5–6.x) | `modules/bank/` |
| 4. Compilation | LaTeX pipeline (REQ-7.x) | `modules/compile/`, `compile-worker/` |

## Folder structure

```
AutoQP/
├── apps/
│   ├── web/                          # Next.js app (UI + API)
│   │   ├── app/                      # Routes ONLY: pages, layouts, thin handlers
│   │   │   ├── (auth)/login/
│   │   │   │   └── page.tsx
│   │   │   ├── (dashboard)/
│   │   │   │   ├── staging/
│   │   │   │   ├── bank/
│   │   │   │   └── papers/[paperId]/
│   │   │   ├── api/
│   │   │   │   ├── auth/route.ts
│   │   │   │   ├── staging/route.ts
│   │   │   │   ├── questions/route.ts
│   │   │   │   ├── papers/route.ts
│   │   │   │   └── compile/route.ts
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   ├── modules/                  # Business logic & domain-specific UI
│   │   │   ├── auth/
│   │   │   │   ├── session.ts
│   │   │   │   └── subject-access.ts
│   │   │   ├── intake/
│   │   │   │   ├── generate-questions.ts
│   │   │   │   ├── extract-from-input.ts
│   │   │   │   └── staging-review.ts
│   │   │   ├── bank/
│   │   │   │   ├── search-questions.ts
│   │   │   │   ├── blueprint-generator.ts
│   │   │   │   ├── assemble-paper.ts
│   │   │   │   └── components/       # Domain UI: QuestionCard.tsx
│   │   │   └── compile/
│   │   │       ├── compile-paper.ts
│   │   │       └── components/       # Domain UI: PaperPreview.tsx
│   │   ├── components/               # Generic design system components
│   │   │   └── ui/                   # Button, Modal, Input, Spinner
│   │   ├── lib/                      # SDK clients & server setup
│   │   │   └── supabase/
│   │   │       ├── client.ts         # Browser client
│   │   │       └── server.ts         # Server/Route handler client (cookies)
│   │   └── package.json
│   │
│   └── compile-worker/               # Isolated Tectonic PDF process
│       ├── src/
│       │   └── compile.ts
│       ├── templates/
│       │   └── standard.tex.hbs
│       ├── Dockerfile
│       └── package.json
│
├── packages/                         # Shared modules across apps
│   └── schema/                       # Shared Zod contracts & TS types
│       ├── src/
│       │   └── question.schema.ts
│       └── package.json
│
├── db/                               # Versioned migrations
│   ├── migrations/
│   └── seed.sql
├── docs/
│   ├── AGENTS.md
│   ├── SRS_AutoQP.tex
│   └── diagrams/
├── .github/
│   ├── CODEOWNERS
│   └── workflows/ci.yml
├── docker-compose.yml                # Local setup (web + compile-worker + DB)
├── pnpm-workspace.yaml               # Monorepo workspaces
├── package.json
└── README.md
```

**Why `modules/` has exactly four folders, not more:** each one maps 1:1 to
a team track and nothing else. Nobody has to guess where a piece of logic
belongs or whose review to request — the folder tree *is* the ownership
map. This is the same reasoning as the `modules/` vs `app/` split below,
just applied at a coarser grain.

**Why `app/` stays thin and `modules/` holds the real logic:** a route
handler's only job is to parse a request, call one function in `modules/`,
and format the response. That split means `modules/bank/blueprint-generator.ts`
can be unit-tested directly — called with plain arguments, asserted against
a plain return value — without spinning up a Next.js server or mocking an
HTTP request to test an algorithm that has nothing to do with HTTP.

**Why one `compile-worker/` folder instead of a `services/` directory of
microservices:** per the architecture discussion, this is a modular
monolith with exactly one isolated process — the one piece (Tectonic
compiling AI-influenced content) that genuinely needs its own sandbox and
resource limits. Everything else stays in one deployable app on purpose.

**Why no Python anywhere, including `compile-worker/`:** Tectonic is a CLI
binary; Node can invoke it directly via `child_process`. Keeping the whole
system in one language removes the exact failure mode from the
two-person-project story — two independent type systems that both have to
be hand-kept in sync, with nothing mechanical checking they still agree.

## File naming convention

| Kind | Convention | Example | Why |
|---|---|---|---|
| React component | PascalCase, matches export | `QuestionCard.tsx` | File name mirrors the imported symbol exactly -- zero mental translation when scanning imports |
| Module / logic file | kebab-case | `blueprint-generator.ts` | Filesystem-safe on both case-sensitive (Linux, CI) and case-insensitive (Mac, Windows) systems -- avoids a real class of bug where two "different" filenames collide on one OS and not another |
| Type-only file | kebab-case + `.types.ts` | `question.types.ts` | Instantly distinguishes "pure type definitions" from "logic that runs" |
| Next.js special files | dictated by the framework | `page.tsx`, `route.ts`, `layout.tsx` | Not a free choice -- follow Next.js's own convention |
| Test file | co-located, same name + `.test.ts` | `blueprint-generator.test.ts` | Test sits next to the code it tests; moving one without the other is a visible mistake, not a silent one |

## Variable naming convention

- **camelCase** for variables, function names, object properties -- standard
  TS/JS convention.
- **PascalCase** for types, interfaces, and React components.
- **UPPER_SNAKE_CASE** only for true module-level constants, e.g.
  `MAX_QUESTIONS_PER_PAPER`.
- **Booleans prefixed** `is` / `has` / `should` -- `isOutdated`,
  `hasImageRefs` -- so a call site reads as a sentence.
- **Enforce with tooling, not a style doc.** ESLint + Prettier, run in CI,
  not a paragraph someone has to remember to re-read. This is the same
  lesson as `CONTRACTS.md`: a convention that only lives in prose will
  drift the moment four people are coding under deadline pressure.

### The one real naming seam: database vs. application code

`schema.sql` uses `snake_case` (`subject_id`, `created_at`) -- standard
Postgres convention. Application code uses `camelCase` (`subjectId`,
`createdAt`) -- standard TS convention, and already how the `Question`
type is written in `AGENTS.md`. **Don't let every call site do this
conversion by hand.** Convert once, at the data-access boundary inside
`shared/supabase/`, so the rest of the codebase only ever sees camelCase
and never has to think about which layer it's touching.

## OOP, or not?

**Default to plain functions and data, not classes.** This needs unpacking
because it looks like it contradicts the class diagram, and it doesn't.

The class diagram's `Question <|-- MCQQuestion` inheritance is a correct
*design*-level statement: these three question types share a base shape
and each adds its own behavior. But TypeScript's most idiomatic way to
express exactly that polymorphism isn't `class MCQQuestion extends
Question` -- it's the discriminated union already defined in `AGENTS.md`:

```typescript
type Question = MCQQuestion | NumericalQuestion | LongAnswerQuestion;
```

A `switch` on `question.type` gets the same polymorphism, with the
compiler forcing every branch to be handled (exhaustiveness checking) --
the same guarantee a class hierarchy gives you, with less ceremony and no
`extends`/`super()` footguns.

The same logic applies to `BlueprintGenerator` and `CompilationService` on
the class diagram: they're stateless transformations (data in, data out),
not objects with internal state to encapsulate across calls. A plain
exported function --

```typescript
export function generateBlueprint(subject: Subject, pattern: MarkPattern[]): Paper
```

-- is simpler to call, simpler to unit-test (no instantiation step), and
more idiomatic in a React/Next.js codebase, where the ecosystem itself
moved away from classes years ago (class components to function
components being the clearest example).

**Where real classes still earn their place:** custom error types.
`class CompilationError extends Error` is the standard, idiomatic pattern
for distinguishing error kinds in a `catch` block, and there's no
functional alternative that's actually simpler. Use classes there; don't
reach for them elsewhere by default.

**For a team split across four skill levels, this also lowers risk.**
Plain functions and plain data are generally easier for AI-assisted
("vibe") coding to generate correctly, and easier for a less experienced
teammate to reason about, than a class hierarchy where subtle bugs hide in
constructor logic, `this` binding, or shared mutable state -- exactly the
kind of accidental complexity that turned a 2-skilled-person project
messy.

## Next concrete step

The `shared/schema/question.schema.ts` Zod file -- the thing that makes
the `Question` contract enforced rather than just documented -- hasn't
been built yet. That, plus `.github/CODEOWNERS`, are the two highest-value
next things to add before four people start writing code in parallel.
