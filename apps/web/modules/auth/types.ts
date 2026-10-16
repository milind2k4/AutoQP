export type Role = 'instructor' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  accessToken: string;
}

export interface Subject {
  id: string;
  code: string | null;
  name: string;
}
