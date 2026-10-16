import type { SupabaseClient } from "@supabase/supabase-js";
import { toCamelCase } from "../../lib/supabase/transform";
import { UnauthorizedError } from "./errors";
import type { AuthUser, Role } from "./types";

const ROLES: Role[] = ["instructor", "admin"];

async function resolveClient(client?: SupabaseClient): Promise<SupabaseClient> {
  if (client) return client;
  // Lazy import keeps unit tests free of next/headers.
  const { createClient } = await import("../../lib/supabase/server");
  return createClient();
}

/** Returns the verified current user (profile + role + token) or null. */
export async function getCurrentUser(client?: SupabaseClient): Promise<AuthUser | null> {
  const supabase = await resolveClient(client);

  // getUser() re-validates the JWT with Supabase Auth (getSession alone is not trustworthy).
  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData?.user) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return null;

  const { data: row, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError || !row) return null;

  const profile = toCamelCase<{ id: string; fullName?: string | null; role: string }>(row);
  if (!profile || !ROLES.includes(profile.role as Role)) return null;

  return {
    id: profile.id,
    email: userData.user.email ?? "",
    fullName: profile.fullName ?? null,
    role: profile.role as Role,
    accessToken,
  };
}

/** Returns the authenticated user or throws UnauthorizedError. */
export async function requireAuth(client?: SupabaseClient): Promise<AuthUser> {
  const user = await getCurrentUser(client);
  if (!user) throw new UnauthorizedError();
  return user;
}
