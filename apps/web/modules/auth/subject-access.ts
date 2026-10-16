import type { SupabaseClient } from "@supabase/supabase-js";
import { toCamelCaseRows } from "../../lib/supabase/transform";
import { ForbiddenError, ValidationError } from "./errors";
import type { Subject } from "./types";

async function resolveClient(client?: SupabaseClient): Promise<SupabaseClient> {
  if (client) return client;
  const { createClient } = await import("../../lib/supabase/server");
  return createClient();
}

const isValidId = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Subjects linked to the user via instructor_subjects (RLS also restricts the rows). */
export async function getAuthorizedSubjects(userId: string, client?: SupabaseClient): Promise<Subject[]> {
  if (!isValidId(userId)) throw new ValidationError("userId is required");
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("instructor_subjects")
    .select("subject_id, subjects(id, code, name)")
    .eq("instructor_id", userId);
  if (error) throw new Error(`Failed to load subjects: ${error.message}`);

  const subjects = (data ?? [])
    .map((r: { subjects?: unknown }) => r.subjects)
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object");
  return toCamelCaseRows<Subject>(subjects);
}

/** Verifies explicit assignment. Returns true or throws ForbiddenError. Fails closed. */
export async function assertSubjectAccess(userId: string, subjectId: string, client?: SupabaseClient): Promise<boolean> {
  if (!isValidId(userId)) throw new ValidationError("userId is required");
  if (!isValidId(subjectId)) throw new ValidationError("subjectId is required");
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("instructor_subjects")
    .select("subject_id")
    .eq("instructor_id", userId)
    .eq("subject_id", subjectId)
    .maybeSingle();

  if (error || !data) throw new ForbiddenError();
  return true;
}
