import type { EpochMs, LogId, LogPreferences, MutationId } from "../../domain/types";
import { validateLogPreferences } from "../../validation/domain";
import { commitRevisionChange } from "../db.server";
import { RepositoryError } from "../errors.server";
import { LogRepository } from "./logs.server";

export class PreferencesRepository {
  constructor(private readonly db: D1Database) {}

  async update(
    logId: LogId,
    patch: Partial<LogPreferences>,
    now: EpochMs,
    mutationId: MutationId,
    additionalStatements: D1PreparedStatement[] = [],
  ): Promise<LogPreferences> {
    const existing = await new LogRepository(this.db).get(logId);
    if (!existing) throw new RepositoryError("not_found", "Log was not found.");
    const next = { ...existing.preferences, ...patch };
    const validated = validateLogPreferences(next);
    if (!validated.ok) throw new RepositoryError("validation_failure", validated.message);
    const preferences = validated.value;
    const statement = this.db
      .prepare(
        `UPDATE logs SET timezone = ?, theme = ?, weight_unit = ?, default_goal_hours = ?
         WHERE id = ?`,
      )
      .bind(
        preferences.timezone,
        preferences.theme,
        preferences.weightUnit,
        preferences.defaultGoalHours,
        logId,
      );
    await commitRevisionChange(this.db, logId, statement, {
      entityType: "preferences",
      entityId: "active",
      operation: "upsert",
      payload: preferences,
      createdAt: now,
      mutationId,
    }, additionalStatements);
    return preferences;
  }
}
