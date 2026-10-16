/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import { describe, it, expect } from 'vitest';
import { getCurrentUser, requireAuth } from './session';
import { UnauthorizedError } from './errors';

function fakeClient(opts: { user?: any; profile?: any; token?: string | null }) {
  return {
    auth: {
      getUser: async () => ({ data: { user: opts.user ?? null }, error: opts.user ? null : { message: 'no user' } }),
      getSession: async () => ({ data: { session: opts.token ? { access_token: opts.token } : null } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.profile ?? null, error: null }) }) }) }),
  } as any;
}
const u = { id: 'u1', email: 'a@b.c' };

describe('getCurrentUser', () => {
  it('returns null with no session', async () => {
    expect(await getCurrentUser(fakeClient({}))).toBeNull();
  });
  it('returns instructor user', async () => {
    const c = fakeClient({ user: u, token: 't', profile: { id: 'u1', full_name: 'A', role: 'instructor' } });
    expect(await getCurrentUser(c)).toEqual({ id: 'u1', email: 'a@b.c', fullName: 'A', role: 'instructor', accessToken: 't' });
  });
  it('returns admin user', async () => {
    const c = fakeClient({ user: u, token: 't', profile: { id: 'u1', full_name: null, role: 'admin' } });
    expect((await getCurrentUser(c))?.role).toBe('admin');
  });
  it('returns null when profile is missing', async () => {
    expect(await getCurrentUser(fakeClient({ user: u, token: 't' }))).toBeNull();
  });
  it('returns null for invalid role', async () => {
    const c = fakeClient({ user: u, token: 't', profile: { id: 'u1', role: 'superuser' } });
    expect(await getCurrentUser(c)).toBeNull();
  });
  it('returns null when token is missing', async () => {
    const c = fakeClient({ user: u, token: null, profile: { id: 'u1', role: 'admin' } });
    expect(await getCurrentUser(c)).toBeNull();
  });
});

describe('requireAuth', () => {
  it('throws UnauthorizedError when unauthenticated', async () => {
    await expect(requireAuth(fakeClient({}))).rejects.toBeInstanceOf(UnauthorizedError);
  });
  it('returns user when authenticated', async () => {
    const c = fakeClient({ user: u, token: 't', profile: { id: 'u1', full_name: 'A', role: 'admin' } });
    expect((await requireAuth(c)).id).toBe('u1');
  });
});
