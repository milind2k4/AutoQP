import { parseQuestion } from "@autoqp/schema";
import { createClient } from "../../lib/supabase/server";
import { toCamelCase, toCamelCaseRows, toSnakeCase } from "../../lib/supabase/transform";
import { StagingDraft } from "./generate-questions";

export interface SupabaseQueryBuilder {
  select: (...args: unknown[]) => SupabaseQueryBuilder & PromiseLike<{ data: unknown; error: { message: string } | null }>;
  insert: (...args: unknown[]) => SupabaseQueryBuilder & PromiseLike<{ data: unknown; error: { message: string } | null }>;
  update: (...args: unknown[]) => SupabaseQueryBuilder & PromiseLike<{ error: { message: string } | null }>;
  delete: (...args: unknown[]) => SupabaseQueryBuilder & PromiseLike<{ error: { message: string } | null }>;
  eq: (...args: unknown[]) => SupabaseQueryBuilder & PromiseLike<{ data: unknown; error: { message: string } | null }>;
  order: (...args: unknown[]) => Promise<{ data: unknown; error: { message: string } | null }>;
  single: () => Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface SupabaseLike {
  from: (table: string) => SupabaseQueryBuilder;
  storage?: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: unknown,
        opts?: Record<string, unknown>
      ) => Promise<{ data: { path?: string } | null; error: { message: string } | null }>;
    };
  };
}

export interface ReviewOptions {
  supabase?: SupabaseLike;
}

async function resolveSupabase(options?: ReviewOptions | SupabaseLike): Promise<SupabaseLike> {
  if (options && "from" in options && typeof options.from === "function") {
    return options as SupabaseLike;
  }
  if (options && "supabase" in options && options.supabase) {
    return options.supabase;
  }
  return (await createClient()) as unknown as SupabaseLike;
}

/**
 * Lists all questions currently awaiting human review in the staging sandbox for a given subject.
 */
export async function listStagingQuestions(
  subjectId: string,
  options?: ReviewOptions | SupabaseLike
): Promise<StagingDraft[]> {
  const supabase = await resolveSupabase(options);

  const { data, error } = await supabase
    .from("staging_questions")
    .select("*")
    .eq("subject_id", subjectId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list staging questions: ${error.message || JSON.stringify(error)}`);
  }

  return toCamelCaseRows<StagingDraft>(data as Record<string, unknown>[]);
}

/**
 * Updates an incomplete or edited question draft in `staging_questions`.
 */
export async function updateStagingQuestion(
  id: string,
  patch: Partial<StagingDraft>,
  options?: ReviewOptions | SupabaseLike
): Promise<void> {
  const supabase = await resolveSupabase(options);

  // Exclude immutable database-managed columns from update payload
  const allowedFields: Partial<StagingDraft> = { ...patch };
  delete allowedFields.id;
  delete allowedFields.createdAt;
  delete allowedFields.createdBy;
  const updatePayload = toSnakeCase(allowedFields as Record<string, unknown>);

  const { error } = await supabase
    .from("staging_questions")
    .update(updatePayload)
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to update staging question: ${error.message || JSON.stringify(error)}`);
  }
}

/**
 * Discards a staging question draft from the review queue.
 */
export async function discardStagingQuestion(
  id: string,
  options?: ReviewOptions | SupabaseLike
): Promise<void> {
  const supabase = await resolveSupabase(options);

  const { error } = await supabase
    .from("staging_questions")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to delete staging question: ${error.message || JSON.stringify(error)}`);
  }
}

/**
 * The ONLY bridge from the staging buffer to the committed question bank.
 * Validates the draft against `questionSchema` (via `parseQuestion`), inserts it into
 * `questions`, and removes it from `staging_questions`.
 */
export async function promoteToBank(
  id: string,
  userId: string,
  options?: ReviewOptions | SupabaseLike
): Promise<string> {
  const supabase = await resolveSupabase(options);

  // 1. Fetch draft from staging_questions
  const { data: rawDraft, error: fetchError } = await supabase
    .from("staging_questions")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !rawDraft) {
    throw new Error(
      `Staging question with id ${id} not found: ${fetchError?.message || "No row returned"}`
    );
  }

  const draft = toCamelCase<StagingDraft>(rawDraft as Record<string, unknown>);
  if (!draft) {
    throw new Error(`Failed to transform staging draft with id ${id}`);
  }

  // 2. Prepare candidate question object
  const candidate = {
    id: draft.id || crypto.randomUUID(),
    subjectId: draft.subjectId,
    topicId: draft.topicId ?? null,
    type: draft.type,
    difficulty: draft.difficulty,
    marks: draft.marks,
    text: draft.text,
    imageRefs: draft.imageRefs ?? [],
    typeData: draft.typeData,
    createdBy: userId,
    version: 1,
  };

  // 3. Strict schema validation guard (Throws ZodError if invalid)
  const validatedQuestion = parseQuestion(candidate);

  // 4. Insert into the committed questions bank
  const dbRow = toSnakeCase(validatedQuestion as unknown as Record<string, unknown>);
  const { error: insertError } = await supabase
    .from("questions")
    .insert([dbRow])
    .select();

  if (insertError) {
    throw new Error(
      `Failed to insert promoted question into bank: ${insertError.message || JSON.stringify(insertError)}`
    );
  }

  // 5. Delete from staging_questions
  const { error: deleteError } = await supabase
    .from("staging_questions")
    .delete()
    .eq("id", id);

  if (deleteError) {
    throw new Error(
      `Failed to remove question from staging after promotion: ${deleteError.message || JSON.stringify(deleteError)}`
    );
  }

  return validatedQuestion.id;
}
