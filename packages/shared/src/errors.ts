export class ToriiError extends Error {
  public readonly status: number;
  public readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ToriiError';
    this.status = status;
    this.code = code;
  }
}

export class UnauthorizedError extends ToriiError {
  constructor(message = 'Unauthorized') {
    super(401, 'unauthorized', message);
  }
}

export class ForbiddenError extends ToriiError {
  constructor(message = 'Forbidden') {
    super(403, 'forbidden', message);
  }
}

export class NotFoundError extends ToriiError {
  constructor(message = 'Not found') {
    super(404, 'not_found', message);
  }
}

export class ConflictError extends ToriiError {
  constructor(message: string) {
    super(409, 'conflict', message);
  }
}

export class ValidationError extends ToriiError {
  public readonly details: unknown;
  constructor(message: string, details?: unknown) {
    super(400, 'validation_error', message);
    this.details = details;
  }
}
