import { databaseFailure, RepositoryError } from "./errors.server";

export interface ChangeInput {
  entityType:
    | "fast"
    | "weight"
    | "preferences"
    | "nutritionTargets"
    | "category"
    | "food"
    | "meal"
    | "activity"
    | "exercise"
    | "checklistItem"
    | "checklistCompletion"
    | "groceryItem"
    | "generation";
  entityId: string;
  operation: "upsert" | "delete" | "reset";
  payload: unknown;
  createdAt: number;
  mutationId?: string;
}

export function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

export function asNullableNumber(value: unknown): number | null {
  return value === null ? null : asNumber(value);
}

export function changedRows(result: D1Result): number {
  return Number(result.meta.changes ?? 0);
}

export async function requireLog(db: D1Database, logId: string): Promise<void> {
  try {
    const row = await db.prepare("SELECT 1 AS present FROM logs WHERE id = ?").bind(logId).first<{ present: number }>();
    if (!row) throw new RepositoryError("not_found", "Log was not found.");
  } catch (cause) {
    throw databaseFailure(cause);
  }
}

/**
 * D1 executes every statement passed to batch() sequentially in one transaction and
 * rolls the whole batch back when a statement fails. Entity writes use the revision
 * selected from logs inside SQL, so no revision value is allocated in application code.
 */
export async function commitRevisionChange(
  db: D1Database,
  logId: string,
  entityStatement: D1PreparedStatement,
  change: ChangeInput,
  additionalStatements: D1PreparedStatement[] = [],
): Promise<number> {
  let payload: string | undefined;
  try {
    payload = JSON.stringify(change.payload);
  } catch {
    throw new RepositoryError("validation_failure", "Change payload must be valid JSON.");
  }
  if (payload === undefined || !Number.isInteger(change.createdAt) || change.createdAt < 0) {
    throw new RepositoryError("validation_failure", "Change payload or timestamp is invalid.");
  }
  const statements = [
    db
      .prepare("UPDATE logs SET revision = revision + 1, updated_at = ? WHERE id = ?")
      .bind(change.createdAt, logId),
    entityStatement,
    ...additionalStatements,
    db
      .prepare(
        `INSERT INTO changes (log_id, revision, entity_type, entity_id, operation, payload, created_at)
         SELECT id, revision, ?, ?, ?, ?, ? FROM logs WHERE id = ?`,
      )
      .bind(
        change.entityType,
        change.entityId,
        change.operation,
        payload,
        change.createdAt,
        logId,
      ),
  ];
  if (change.mutationId) {
    statements.push(
      db
        .prepare(
          `INSERT INTO mutation_receipts (log_id, mutation_id, applied_revision, created_at)
           SELECT id, ?, revision, ? FROM logs WHERE id = ?`,
        )
        .bind(change.mutationId, change.createdAt, logId),
    );
  }
  statements.push(db.prepare("SELECT revision FROM logs WHERE id = ?").bind(logId));

  try {
    const results = await db.batch<{ revision?: number }>(statements);
    const revision = results.at(-1)?.results[0]?.revision;
    if (revision === undefined) throw new RepositoryError("not_found", "Log was not found.");
    return asNumber(revision);
  } catch (cause) {
    if (cause instanceof RepositoryError) throw cause;
    const message = cause instanceof Error ? cause.message : "";
    if (message.includes("fast_overlap")) {
      throw new RepositoryError("overlap", "Fast overlaps an existing fast.");
    }
    if (message.includes("fasts_one_active_per_log_idx")) {
      throw new RepositoryError("active_fast_conflict", "Only one active fast is allowed.");
    }
    if (message.includes("mutation_receipts")) {
      throw new RepositoryError("validation_failure", "Mutation has already been applied.");
    }
    throw databaseFailure(cause);
  }
}
