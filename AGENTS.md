# AGENTS.md — AutoQP

Context file for AI coding agents (Google Antigravity, Claude Code, Cursor, Copilot, etc.)
working on this repository. Read this in full before making changes. If a change would
conflict with anything below, stop and ask rather than guessing.

---

## What this project is

A centralized web platform for instructors to build exam papers without manual
word-processor typesetting. Instructors generate or extract questions (AI generation,
screenshot OCR, manual entry, `.docx` import), review them in a staging sandbox, store
them in a subject-scoped shared question bank, assemble papers from that bank, and
compile a publication-quality PDF via LaTeX.

## Current phase — READ THIS FIRST

**Scope for this milestone is Must-Have features only.** A feasibility review found the
full feature list too large for the available timeline. Do not implement Should-Have,
Could-Have, or Wish-List features unless explicitly asked, even if they seem like a
natural extension of something you're building.

Must-Have scope:
1. Role & subject scoping (instructors see only their assigned subjects)
2. AI question generation (topic, difficulty, marks, count → formatted questions)
3. Multimodal extraction (pasted text or screenshot → parsed text/math, OR a diagram
   kept as an image asset — see "Images and diagrams" below)
4. Staging sandbox (human review before anything enters the bank)
5. Subject question repository (search/filter by subject, topic, difficulty, marks)
6. Pattern-based blueprint generator (auto-select non-repeating questions by mark pattern)
7. Automated document compilation (PDF + raw `.tex` source, downloadable)

Out of scope for now: the two-panel drag-and-drop assembler, live PDF preview, in-browser
markup editor, concurrency auditing, layout presets, question forking, marking guides,
and everything on the Wish List (chatbot, moderation chains, semantic dedup, student
portal). Ask before touching any of these.

## Tech stack

- **Frontend + backend:** Next.js (App Router), TypeScript. One codebase — UI and API
  routes/server actions together, not a separate backend service.
- **Styling:** [not finalized — confirm with the team before assuming Tailwind or
  Bootstrap; do not mix both in new components]
- **Database / auth / storage:** Supabase (Postgres + Auth + Row Level Security + Storage)
- **AI:** Claude API — one integration handles both question generation and
  screenshot/diagram extraction (vision + structured/tool-based output)
- **PDF compilation:** Tectonic (self-contained LaTeX engine) + the `exam` document class,
  run as a separate service/subprocess, not inside a client-facing request handler
- **Deployment:** Next.js app → Vercel; DB/auth/storage → Supabase; compile step →
  Railway/Render (or a local subprocess call during early development — see below)

## Architecture — how a request actually flows

Three programs that only ever talk over HTTP, never by calling each other's functions
directly. The browser never talks to the database or to Tectonic — only the Next.js
server does:

```
Browser → Next.js (API routes/server actions) → Supabase (data)
                                               → Claude API (AI gen/OCR)
                                               → Compile step (LaTeX → PDF)
```

Compile flow specifically, since it's the most novel piece: Next.js reads a paper's
question snapshots from Supabase → fills a `.tex` template → downloads any referenced
images from Supabase Storage into the compile working directory *before* invoking
Tectonic → runs Tectonic fully offline (no network during the actual compile) → uploads
the resulting PDF back to Storage → records its path on the `papers` row.

## Database

Full schema lives in `db/schema.sql` — treat it as the single source of truth for table
structure. Do not modify table structure ad hoc in application code; change
`db/schema.sql` first, then write the migration.

Tables: `profiles`, `subjects`, `instructor_subjects` (join), `topics`, `questions`
(committed bank), `staging_questions` (temporary review buffer — never queried by
anything except the staging UI), `papers`, `paper_sections`, `paper_questions` (stores a
**frozen snapshot** of each question, never a live reference — this is what preserves
Saved Papers History even after a bank question is later edited).

Access control is enforced primarily through Postgres **Row Level Security**, not
application-layer checks alone — an instructor's visible subjects come from
`instructor_subjects`. Do not add a query path that bypasses RLS (e.g. using the
Supabase service-role key in client-reachable code) without flagging it explicitly.

## The Question "shape" — the most important contract in this codebase

Every producer (AI generation, OCR extraction, manual entry, `.docx` import) and every
consumer (staging sandbox, blueprint generator, LaTeX templates) must agree on this
exact shape. If you write code that produces or consumes a question, match this
precisely — do not invent alternate field names.

```typescript
type BaseQuestion = {
  id: string;
  subjectId: string;
  topicId: string | null;
  difficulty: "easy" | "medium" | "hard";
  marks: number;
  text: string;            // math written inline, e.g. "...using $O(V^2)$..."
  imageRefs: string[];     // Supabase Storage paths; [] if none
};

type MCQData = { options: { id: string; text: string }[]; correctOptionId: string };
type NumericalData = { expectedValue: number; tolerance?: number };
type LongAnswerData = { solution: string };

type MCQQuestion = BaseQuestion & { type: "mcq"; typeData: MCQData };
type NumericalQuestion = BaseQuestion & { type: "numerical"; typeData: NumericalData };
type LongAnswerQuestion = BaseQuestion & { type: "long_answer"; typeData: LongAnswerData };

// `type` is a plain string, not a closed union, in the database — the union
// below is what the app currently knows how to render. Adding a new question
// type means adding a branch here and in the compile templates, not a migration.
type Question = MCQQuestion | NumericalQuestion | LongAnswerQuestion;
```

**Naming boundary:** fields above are camelCase (application-layer convention).
The database stores the same data as snake_case columns (`subject_id`, `topic_id`,
`image_refs`, `type_data`, `correct_option_id`, ...). Conversion happens exactly
once, at the Supabase data-access boundary in `shared/supabase/` — nowhere else
in the codebase should convert between the two by hand. The canonical, enforced
version of this shape lives in `shared/schema/question.schema.ts` (Zod); this
block is documentation of it, not a second source of truth — if the two ever
disagree, the Zod schema wins and this block is stale.

Notes:
- `type_data`'s internal shape depends on `type` and is **not** validated by Postgres —
  a JSONB column has no schema of its own. Validate it in application code (e.g. a
  Zod schema keyed by `type`) before writing or trusting it.
- `math_segments` is **not** a persisted field. It's computed on the fly for live KaTeX
  preview in the staging UI from whatever is currently in `text`. Never add it as a
  stored column or API field.
- Diagrams/graphs are not parsed into text. They stay as image files referenced in
  `image_refs` and get embedded into the compiled PDF via `\includegraphics`, never
  OCR'd into a description.
- A `staging_questions` draft may have `type`, `type_data`, and most other fields as
  `null`/`{}` — it's allowed to be incomplete mid-review. A committed `questions` row
  may not.

## Conventions & constraints

- Papers store frozen question snapshots (JSONB), never a live foreign-key-only
  reference to `questions` — old papers must not change if a bank question is edited later.
- `correct_option_id` and any field pointing inside a JSON array cannot be a real
  foreign key — validate it in application code, and don't assume the database enforces it.
- Optimistic locking on `questions` uses a `version` integer column — updates must be
  `WHERE id = ? AND version = ?`, and a zero-row result means a conflicting edit occurred.
- No shell-escape and no raw SVG in LaTeX templates — raster images (PNG/JPG) via
  `graphicx` only.
- Image fetches for compilation happen in a network-enabled step *before* Tectonic runs;
  the actual Tectonic invocation should not require network access.
- Don't build the two-panel drag-and-drop assembler, live preview, or any
  Should/Could/Wish feature without being asked — see "Current phase" above.
- Refreshing a paper's question to the bank's latest version is an explicit,
  instructor-initiated action (a button, with a diff shown first), never an
  automatic background sync. It works by re-copying the current `questions`
  row into `question_snapshot` via `source_question_id`, then updating
  `source_version` and `snapshot_captured_at` to match. If `source_question_id`
  is `NULL` (the original bank question was deleted), there is nothing to
  refresh from — the paper permanently keeps its last snapshot.

## Commands

[fill in once the repo is scaffolded — e.g. `npm run dev`, `npm run build`,
`npm run lint`, `npx prisma migrate dev`]

## Team ownership — AutoQP, 4 members

The Must-Have scope splits along the same pipeline a question actually flows
through: **auth → intake → assembly → compilation**. This isn't an arbitrary
division — it follows the natural seams in the data model, so each person's
work reads from and writes to a distinct set of tables, minimizing the
chance that two people's changes collide.

1. **Foundation — Auth, Subjects & Access Control** (REQ-1.x)
   Tables owned: `profiles`, `subjects`, `instructor_subjects`, `topics`.
   Supabase Auth wiring, Row Level Security policies, subject assignment
   UI/admin flow. Seeds `subjects`/`topics` with real data early so the
   other three tracks aren't blocked waiting on it.

2. **Intake — AI Generation, Extraction & Staging** (REQ-2.x, REQ-3.x, REQ-4.x)
   Tables owned: `staging_questions`; writes into `questions` on promote.
   Claude API integration (generation + vision/OCR), the staging review UI,
   the promote/discard flow, image-vs-text branching for screenshots.

3. **Bank & Assembly — Repository & Blueprint Generator** (REQ-5.x, REQ-6.x)
   Tables owned: reads `questions`; writes `papers`, `paper_sections`,
   `paper_questions` (including capturing `question_snapshot`,
   `source_version` at assembly time). Search/filter UI, the non-repeating
   selection algorithm against a mark pattern.

4. **Compilation — LaTeX Pipeline** (REQ-7.x) — the crux
   Reads `paper_questions.question_snapshot` and paper metadata; writes
   `compiled_pdf_ref`/`compiled_source_ref` back to `papers`. Tectonic
   integration, the `exam`-class template, image embedding via
   `\includegraphics`, the fetch-before-compile step for Storage-hosted
   images (see "Images and diagrams" above).

### Why this order, and how to avoid blocking on each other

Tracks 2, 3, and 4 can start in parallel from day one, *not* sequentially,
because the contract each one produces for the next is already fully
specified in this file and in `schema.sql` — nobody needs to wait for
someone else's actual implementation, only for the shape.

Concretely: whoever owns Compilation should not wait for the Bank &
Assembly track to be finished. Write 2-3 hand-crafted `paper_questions`
rows (one MCQ, one numerical, one long-answer with an `image_refs` entry)
matching the schema exactly, and build the entire compile pipeline against
that fixture data. Swap in real data from Track 3 later — nothing about the
compile service's logic should need to change when you do, if both sides
actually matched the contract.

## Open decisions — do not assume, confirm with the team first

- Tailwind vs Bootstrap for styling
- Exact `.tex` template layout for the `standard` preset
- Whether the compile step runs as a Next.js API route directly or a separate hosted
  service (start with the simpler in-process route; split out only if you hit a timeout
  or a real security concern)
