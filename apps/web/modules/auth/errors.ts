// If the repo already has shared error classes, delete this file and import those instead.
export class UnauthorizedError extends Error {
  constructor(message = 'Authentication required') { super(message); this.name = 'UnauthorizedError'; }
}
export class ForbiddenError extends Error {
  constructor(message = 'Access to this subject is forbidden') { super(message); this.name = 'ForbiddenError'; }
}
export class ValidationError extends Error {
  constructor(message = 'Invalid input') { super(message); this.name = 'ValidationError'; }
}
