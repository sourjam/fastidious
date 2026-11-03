import type { LogId, MutationId } from "../../domain/types";
import { asNumber } from "../db.server";
import { databaseFailure, RepositoryError } from "../errors.server";

interface ReceiptRow {
  applied_revision: number;
  created_at: number;
}

export interface MutationReceipt {
  logId: LogId;
  mutationId: MutationId;
  appliedRevision: number;
  createdAt: number;
}

export interface OrderedMutation {
  mutationId: MutationId;
}

export interface AppliedMutation {
  mutationId: MutationId;
  appliedRevision: number;
  duplicate: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MutationRepository {
  constructor(private readonly db: D1Database) {}

  async find(logId: LogId, mutationId: MutationId): Promise<MutationReceipt | null> {
    try {
      const row = await this.db
        .prepare(
          "SELECT applied_revision, created_at FROM mutation_receipts WHERE log_id = ? AND mutation_id = ?",
        )
        .bind(logId, mutationId)
        .first<ReceiptRow>();
      return row
        ? {
            logId,
            mutationId,
            appliedRevision: asNumber(row.applied_revision),
            createdAt: asNumber(row.created_at),
          }
        : null;
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async record(logId: LogId, mutationId: MutationId, appliedRevision: number, createdAt: number): Promise<MutationReceipt> {
    if (
      !UUID_PATTERN.test(logId) ||
      !UUID_PATTERN.test(mutationId) ||
      !Number.isInteger(appliedRevision) ||
      appliedRevision < 0 ||
      !Number.isInteger(createdAt) ||
      createdAt < 0
    ) {
      throw new RepositoryError("validation_failure", "Mutation receipt is invalid.");
    }
    try {
      await this.db
        .prepare(
          `INSERT OR IGNORE INTO mutation_receipts (log_id, mutation_id, applied_revision, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(logId, mutationId, appliedRevision, createdAt)
        .run();
      const receipt = await this.find(logId, mutationId);
      if (!receipt) throw new RepositoryError("transient_database_failure", "Mutation receipt was not stored.");
      return receipt;
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  /**
   * The mutation handler must pass mutationId into the entity repository. That entity
   * repository stores its write, change, revision, and receipt in one D1 batch.
   */
  async applyBatch<T extends OrderedMutation>(
    logId: LogId,
    mutations: readonly T[],
    apply: (mutation: T) => Promise<number>,
  ): Promise<AppliedMutation[]> {
    const applied: AppliedMutation[] = [];
    for (const mutation of mutations) {
      const existing = await this.find(logId, mutation.mutationId);
      if (existing) {
        applied.push({
          mutationId: mutation.mutationId,
          appliedRevision: existing.appliedRevision,
          duplicate: true,
        });
        continue;
      }
      const revision = await apply(mutation);
      const receipt = await this.find(logId, mutation.mutationId);
      if (!receipt || receipt.appliedRevision !== revision) {
        throw new RepositoryError(
          "transient_database_failure",
          "Mutation handler did not atomically store its receipt.",
        );
      }
      applied.push({ mutationId: mutation.mutationId, appliedRevision: revision, duplicate: false });
    }
    return applied;
  }
}
