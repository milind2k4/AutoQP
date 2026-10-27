import type { SupabaseClient } from '@supabase/supabase-js';
import { UnauthorizedError, ValidationError } from './errors';

export interface LoginInput { email: string; password: string }

export function parseLoginInput(body: unknown): LoginInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('A valid email is required');
  if (password.length < 1) throw new ValidationError('Password is required');
  return { email, password };
}

export async function login(supabase: SupabaseClient, input: LoginInput): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword(input); // sets session cookies via server client
  if (error) throw new UnauthorizedError('Invalid email or password');
}

export async function logout(supabase: SupabaseClient): Promise<void> {
  await supabase.auth.signOut();
}
