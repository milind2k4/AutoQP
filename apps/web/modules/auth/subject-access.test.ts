/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import { describe, it, expect } from 'vitest';
import { getAuthorizedSubjects, assertSubjectAccess } from './subject-access';
import { ForbiddenError, ValidationError } from './errors';

type Row = { instructor_id: string; subject_id: string; subjects: { id: string; code: string; name: string } };
const CS101 = { id: 's101', code: 'CS101', name: 'Intro' };
const CS301 = { id: 's301', code: 'CS301', name: 'DB' };
const rows: Row[] = [
  { instructor_id: 'A', subject_id: 's101', subjects: CS101 },
  { instructor_id: 'B', subject_id: 's301', subjects: CS301 },
];

function fakeClient(data: Row[], failWith?: string) {
  return {
    from: () => {
      const f: Record<string, string> = {};
      const run = () => data.filter((r) => Object.entries(f).every(([k, v]) => (r as any)[k] === v));
      const q: any = {
        select: () => q,
        eq: (c: string, v: string) => { f[c] = v; return q; },
        maybeSingle: async () => (failWith ? { data: null, error: { message: failWith } } : { data: run()[0] ?? null, error: null }),
        then: (res: any) => res(failWith ? { data: null, error: { message: failWith } } : { data: run(), error: null }),
      };
      return q;
    },
  } as any;
}

describe('getAuthorizedSubjects', () => {
  it('returns only the user’s subjects', async () => {
    expect(await getAuthorizedSubjects('A', fakeClient(rows))).toEqual([CS101]);
  });
  it('returns [] when no assignments', async () => {
    expect(await getAuthorizedSubjects('Z', fakeClient(rows))).toEqual([]);
  });
  it('rejects empty userId', async () => {
    await expect(getAuthorizedSubjects('', fakeClient(rows))).rejects.toBeInstanceOf(ValidationError);
  });
  it('throws on db error', async () => {
    await expect(getAuthorizedSubjects('A', fakeClient(rows, 'boom'))).rejects.toThrow();
  });
});

describe('assertSubjectAccess', () => {
  it('allows assigned subject', async () => {
    expect(await assertSubjectAccess('A', 's101', fakeClient(rows))).toBe(true);
  });
  it('denies unassigned subject', async () => {
    await expect(assertSubjectAccess('A', 's301', fakeClient(rows))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('denies other instructor’s subject', async () => {
    await expect(assertSubjectAccess('B', 's101', fakeClient(rows))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('rejects invalid ids', async () => {
    await expect(assertSubjectAccess('A', '', fakeClient(rows))).rejects.toBeInstanceOf(ValidationError);
    await expect(assertSubjectAccess('', 's101', fakeClient(rows))).rejects.toBeInstanceOf(ValidationError);
  });
  it('denies (fails closed) on db error', async () => {
    await expect(assertSubjectAccess('A', 's101', fakeClient(rows, 'boom'))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
