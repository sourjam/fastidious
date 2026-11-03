export type RepositoryErrorCode =
  | "unauthorized"
  | "revoked"
  | "expired"
  | "not_found"
  | "generation_mismatch"
  | "validation_failure"
  | "overlap"
  | "active_fast_conflict"
  | "transient_database_failure";

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, message: string) {
    super(message);
    this.name = "RepositoryError";
    this.code = code;
  }
}

export function databaseFailure(cause: unknown): RepositoryError {
  if (cause instanceof RepositoryError) return cause;
  return new RepositoryError("transient_database_failure", "The database operation could not be completed.");
}
