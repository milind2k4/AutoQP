import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server';
import { login, logout, parseLoginInput } from '../../../modules/auth/login';
import { UnauthorizedError, ValidationError } from '../../../modules/auth/errors';

// Thin controller: parse -> call module -> respond.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const supabase = await createClient();

    if (body?.action === 'logout') {
      await logout(supabase);
      return NextResponse.json({ ok: true });
    }
    await login(supabase, parseLoginInput(body));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: e.message }, { status: 401 });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
