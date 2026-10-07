import { z } from "zod";

// =====================================================================
// AutoQP — the Question contract (enforced, not just documented)
//
// This file is the single source of truth for the Question shape at the
// application layer. AGENTS.md's TypeScript block documents this same
// shape for humans reading quickly, but if the two ever disagree, THIS
// file wins — it's the one that actually runs.
//
// Field names are camelCase. The database stores the same data as
// snake_case columns (schema.sql). Conversion happens once, at the
// Supabase data-access boundary in shared/supabase/ — never here, and
// never anywhere else.
//
// Every producer (AI generation, OCR extraction, manual entry, .docx
// import) must parse its output through `questionSchema` before it is
// trusted. Every consumer (blueprint generator, LaTeX templates) may
// assume anything typed `Question` has already passed this schema.
// =====================================================================

const baseQuestionSchema = z.object({
  id: z.string().uuid(),
  subjectId: z.string().uuid(),
  topicId: z.string().uuid().nullable(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  marks: z.number().int().positive(),
  text: z.string().min(1, "Question text cannot be empty"),
  imageRefs: z.array(z.string()),
});

// --- Per-type data -----------------------------------------------------
// Each of these is deliberately its own schema, not inlined, so the
// three question types in questionSchema below read as three clearly
// named branches rather than one large object with optional fields.

const optionSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
});

const mcqDataSchema = z
  .object({
    options: z.array(optionSchema).min(2, "MCQ needs at least two options"),
    correctOptionId: z.string(),
  })
  // schema.sql cannot enforce this as a real foreign key — correctOptionId
  // points at an element inside a JSON array, not a database row. This is
  // the application-layer substitute AGENTS.md calls for explicitly.
  .refine((data) => data.options.some((opt) => opt.id === data.correctOptionId), {
    message: "correctOptionId must match the id of one of the provided options",
    path: ["correctOptionId"],
  });

const numericalDataSchema = z.object({
  expectedValue: z.number(),
  tolerance: z.number().nonnegative().optional(),
});

const longAnswerDataSchema = z.object({
  solution: z.string().min(1),
});

// --- The discriminated union -------------------------------------------
// This is the runtime twin of AGENTS.md's `type Question = MCQQuestion |
// NumericalQuestion | LongAnswerQuestion`. Adding a new question type
// later means adding one more branch here (and to the compile templates)
// — not a schema.sql migration, per REQ-5.4.

export const mcqQuestionSchema = baseQuestionSchema.extend({
  type: z.literal("mcq"),
  typeData: mcqDataSchema,
});

export const numericalQuestionSchema = baseQuestionSchema.extend({
  type: z.literal("numerical"),
  typeData: numericalDataSchema,
});

export const longAnswerQuestionSchema = baseQuestionSchema.extend({
  type: z.literal("long_answer"),
  typeData: longAnswerDataSchema,
});

export const questionSchema = z.discriminatedUnion("type", [
  mcqQuestionSchema,
  numericalQuestionSchema,
  longAnswerQuestionSchema,
]);

// --- Inferred types ------------------------------------------------------
// Import these, don't hand-write a parallel `interface Question`
// somewhere else — that second copy is exactly how a contract drifts.

export type Question = z.infer<typeof questionSchema>;
export type MCQQuestion = z.infer<typeof mcqQuestionSchema>;
export type NumericalQuestion = z.infer<typeof numericalQuestionSchema>;
export type LongAnswerQuestion = z.infer<typeof longAnswerQuestionSchema>;

// --- Convenience parse helper --------------------------------------------
// Throws a ZodError with a precise field-level message on invalid input.
// Prefer this at every boundary (API route body, AI provider response,
// Supabase row after snake_case→camelCase conversion) rather than an
// `as Question` cast, which checks nothing at runtime.

export function parseQuestion(data: unknown): Question {
  return questionSchema.parse(data);
}
