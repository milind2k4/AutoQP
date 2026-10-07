-- ============================================================
-- EXAM PLATFORM — DATABASE SCHEMA
-- Postgres / Supabase
-- ============================================================

-- ============================================================
-- ENUM TYPES
-- Fixed, small sets of valid values are self-documenting as
-- enums. Trade-off: adding a new value later needs a migration
-- (ALTER TYPE ... ADD VALUE), which is an acceptable cost for
-- categories this stable.
-- ============================================================

create type user_role as enum ('instructor', 'admin');

create type difficulty_level as enum ('easy', 'medium', 'hard');

create type staging_source as enum ('ai_generated', 'ocr_extracted', 'manual');

create type paper_status as enum ('draft', 'compiled', 'archived');


-- ============================================================
-- 1. PROFILES
-- Supabase Auth already manages auth.users (email, password
-- hash, sessions). This table extends it with app-specific
-- fields via a 1:1 relationship on the same id.
-- ============================================================
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        user_role not null default 'instructor',
  created_at  timestamptz not null default now()
);


-- ============================================================
-- 2. SUBJECTS
-- The top-level scoping unit everything else hangs off.
-- ============================================================
create table subjects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  code        text,                 -- e.g. "CS301", used in exam headers
  created_at  timestamptz not null default now()
);


-- ============================================================
-- 3. INSTRUCTOR_SUBJECTS (join table)
-- Many-to-many: an instructor can teach several subjects, and
-- a subject's bank can be shared by several instructors.
-- This is the table your Row Level Security policies read from.
-- ============================================================
create table instructor_subjects (
  instructor_id  uuid not null references profiles(id) on delete cascade,
  subject_id     uuid not null references subjects(id) on delete cascade,
  primary key (instructor_id, subject_id)
);


-- ============================================================
-- 4. TOPICS
-- Normalized (not free text on questions) so filtering and
-- tagging stay consistent instead of drifting into
-- "Graphs" vs "graph theory" vs "Graph Theory".
-- ============================================================
create table topics (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references subjects(id) on delete cascade,
  name        text not null,
  unique (subject_id, name)   -- same topic name allowed in different subjects
);


-- ============================================================
-- 5. QUESTIONS — the committed master bank
-- Only holds questions that have passed staging review.
-- Constraints here are strict on purpose.
-- ============================================================
create table questions (
  id                  uuid primary key default gen_random_uuid(),
  subject_id          uuid not null references subjects(id) on delete restrict,
  topic_id            uuid references topics(id) on delete set null,
  type                text not null,            -- 'mcq' | 'numerical' | 'long_answer' | future types — no migration needed to add one
  difficulty          difficulty_level not null,
  marks               integer not null check (marks > 0),
  text                text not null,            -- math written inline, e.g. "$O(V^2)$"
  image_refs          jsonb not null default '[]',  -- array of Supabase Storage paths

  -- Everything specific to `type` lives here instead of separate nullable
  -- columns per type. mcq: { options: [{id,text}], correctOptionId }.
  -- numerical: { expectedValue, tolerance? }. long_answer: { solution }.
  -- Keys INSIDE jsonb payloads are camelCase, exactly as packages/schema
  -- defines them. Only top-level column names are snake_case; jsonb
  -- contents are never key-converted.
  -- Shape is enforced in application code, not the database — same
  -- limitation as any JSONB field: Postgres won't validate its internals.
  type_data           jsonb not null,

  forked_from         uuid references questions(id) on delete set null,

  created_by          uuid not null references profiles(id),
  last_edited_by      uuid references profiles(id),
  version             integer not null default 1,   -- optimistic locking counter
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Supports the "basic search and filter" must-have.
create index idx_questions_filter on questions (subject_id, topic_id, difficulty);
create index idx_questions_text_search on questions using gin (to_tsvector('english', text));


-- ============================================================
-- 6. STAGING_QUESTIONS — temporary human-in-the-loop buffer
-- Deliberately looser constraints than `questions`: a draft can
-- be incomplete while an instructor is still reviewing it.
-- Rows are deleted on [Discard] or once accepted into the bank —
-- this table should never accumulate long-term data.
-- ============================================================
create table staging_questions (
  id                  uuid primary key default gen_random_uuid(),
  subject_id          uuid not null references subjects(id) on delete cascade,
  topic_id            uuid references topics(id) on delete set null,
  type                text,                       -- nullable: may be undetermined mid-review
  difficulty          difficulty_level,
  marks               integer check (marks > 0),
  text                text,
  image_refs          jsonb default '[]',
  type_data           jsonb default '{}',         -- same shape as questions.type_data once `type` is set; permissive while still a draft

  source              staging_source not null,   -- how this draft was produced
  confidence_score    numeric,                    -- from OCR/AI, if available
  raw_ai_output       jsonb,                       -- original model response, for debugging

  created_by          uuid not null references profiles(id),
  created_at          timestamptz not null default now()
);

create index idx_staging_subject on staging_questions (subject_id);


-- ============================================================
-- 7. PAPERS — an assembled exam paper
-- ============================================================
create table papers (
  id                     uuid primary key default gen_random_uuid(),
  subject_id             uuid not null references subjects(id) on delete restrict,
  title                  text not null,
  created_by             uuid not null references profiles(id),
  total_marks            integer,
  time_limit_minutes     integer,
  instructions           text,
  layout_preset          text not null default 'standard',   -- could-have: multiple templates
  status                 paper_status not null default 'draft',
  compiled_pdf_ref       text,     -- Storage path, set once compiled
  compiled_source_ref    text,     -- Storage path to raw .tex source
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);


-- ============================================================
-- 8. PAPER_SECTIONS
-- Section name, order, and instructions are properties of the
-- section itself — kept separate so they aren't duplicated
-- across every question row in that section.
-- ============================================================
create table paper_sections (
  id            uuid primary key default gen_random_uuid(),
  paper_id      uuid not null references papers(id) on delete cascade,
  name          text not null,           -- e.g. "Section A"
  order_index   integer not null,
  instructions  text,
  unique (paper_id, order_index)
);


-- ============================================================
-- 9. PAPER_QUESTIONS — the snapshot join table
-- Stores a FROZEN COPY of the question, not a live reference.
-- This is what guarantees Saved Papers History stays accurate
-- even after the bank question is later edited or deleted.
-- ============================================================
create table paper_questions (
  id                    uuid primary key default gen_random_uuid(),
  paper_id              uuid not null references papers(id) on delete cascade,     -- denormalized for query convenience
  section_id            uuid not null references paper_sections(id) on delete cascade,
  order_index           integer not null,
  marks_used            integer not null check (marks_used > 0),   -- may differ from questions.marks
  source_question_id    uuid references questions(id) on delete set null,          -- soft traceability link only
  question_snapshot     jsonb not null,    -- full frozen Question object at assembly time (camelCase keys, same shape as packages/schema `Question`)
  source_version        integer,           -- questions.version at the time this snapshot was taken
  snapshot_captured_at  timestamptz not null default now(),
  unique (section_id, order_index)
);

create index idx_paper_questions_paper on paper_questions (paper_id);

-- "Which questions in this paper have a newer version in the bank?"
-- Powers a per-paper "N questions have updates available" indicator.
-- select pq.id
-- from paper_questions pq
-- join questions q on q.id = pq.source_question_id
-- where pq.paper_id = :paper_id and pq.source_version < q.version;
