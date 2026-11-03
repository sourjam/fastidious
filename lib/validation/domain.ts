import { findOverlappingFast, validateGoalHours } from "../domain/fasts";
import { isValidTimezone } from "../domain/locale";
import { poundsToKilograms } from "../domain/weight";
import type {
  EpochMs,
  FastId,
  FastRecord,
  IanaTimezone,
  LogId,
  LogPreferences,
  ValidationResult,
  WeightId,
  WeightRecord,
  WeightUnit,
} from "../domain/types";

export const MAX_WEIGHT_KG = 1_000;

function error(code: string, message: string, field?: string): ValidationResult<never> {
  return field === undefined ? { ok: false, code, message } : { ok: false, code, message, field };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function optionalEpoch(value: unknown): value is number | null {
  return value === null || isEpoch(value);
}

export interface FastInput {
  id: FastId;
  logId: LogId;
  startAt: EpochMs;
  endAt: EpochMs | null;
  goalHours: number;
  revision?: number;
  updatedAt?: EpochMs;
  deletedAt?: EpochMs | null;
}

export function createFastRecord(
  input: FastInput,
  now: number,
  existing: readonly FastRecord[] = [],
): ValidationResult<FastRecord> {
  if (!Number.isFinite(input.startAt)) return error("start_not_finite", "Start time must be finite.", "startAt");
  if (input.startAt > now) return error("start_in_future", "Start time cannot be in the future.", "startAt");
  if (input.endAt !== null) {
    if (!Number.isFinite(input.endAt)) return error("end_not_finite", "End time must be finite.", "endAt");
    if (input.endAt <= input.startAt) return error("end_not_after_start", "End time must be after start time.", "endAt");
    if (input.endAt > now) return error("end_in_future", "End time cannot be in the future.", "endAt");
  }
  const goal = validateGoalHours(input.goalHours);
  if (!goal.ok) return goal;

  const record: FastRecord = {
    id: input.id,
    logId: input.logId,
    startAt: input.startAt,
    endAt: input.endAt,
    goalHours: goal.value,
    revision: input.revision ?? 0,
    updatedAt: input.updatedAt ?? (now as EpochMs),
    deletedAt: input.deletedAt ?? null,
  };
  if (
    record.deletedAt === null &&
    record.endAt === null &&
    existing.some((fast) => fast.deletedAt === null && fast.endAt === null && fast.id !== record.id)
  ) {
    return error("active_fast_exists", "Only one active fast is allowed.");
  }
  if (record.deletedAt === null && findOverlappingFast(record, existing)) {
    return error("fast_overlap", "Fast overlaps an existing fast.");
  }
  return { ok: true, value: record };
}

export function validateFastRecord(value: unknown, now: number): ValidationResult<FastRecord> {
  if (!isObject(value)) return error("fast_not_object", "Fast must be an object.");
  if (!isUuid(value.id)) return error("invalid_fast_id", "Fast id must be a UUID.", "id");
  if (!isUuid(value.logId)) return error("invalid_log_id", "Log id must be a UUID.", "logId");
  if (!isEpoch(value.startAt)) return error("invalid_start", "Start time must be UTC epoch milliseconds.", "startAt");
  if (!optionalEpoch(value.endAt)) return error("invalid_end", "End time must be UTC epoch milliseconds or null.", "endAt");
  if (typeof value.goalHours !== "number") return error("invalid_goal", "Goal must be a number.", "goalHours");
  if (typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 0) {
    return error("invalid_revision", "Revision must be a non-negative integer.", "revision");
  }
  if (!isEpoch(value.updatedAt)) return error("invalid_updated_at", "Updated time must be UTC epoch milliseconds.", "updatedAt");
  if (!optionalEpoch(value.deletedAt)) return error("invalid_deleted_at", "Deleted time must be UTC epoch milliseconds or null.", "deletedAt");
  return createFastRecord(
    {
      id: value.id as FastId,
      logId: value.logId as LogId,
      startAt: value.startAt as EpochMs,
      endAt: value.endAt as EpochMs | null,
      goalHours: value.goalHours,
      revision: value.revision,
      updatedAt: value.updatedAt as EpochMs,
      deletedAt: value.deletedAt as EpochMs | null,
    },
    now,
  );
}

export function validateFastCollection(fasts: readonly FastRecord[]): ValidationResult<readonly FastRecord[]> {
  const live = fasts.filter((fast) => fast.deletedAt === null);
  if (live.filter((fast) => fast.endAt === null).length > 1) {
    return error("multiple_active_fasts", "Only one active fast is allowed.");
  }
  for (let index = 0; index < live.length; index += 1) {
    const fast = live[index]!;
    if (findOverlappingFast(fast, live.slice(index + 1), null)) {
      return error("fast_overlap", "Fasts cannot overlap.");
    }
  }
  return { ok: true, value: fasts };
}

export function parseWeightInput(raw: string, unit: WeightUnit): ValidationResult<number> {
  const trimmed = raw.trim();
  if (trimmed === "") return error("weight_empty", "Enter a weight.", "weight");
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    return error("weight_malformed", "Weight must be a number.", "weight");
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return error("weight_not_finite", "Weight must be finite.", "weight");
  const kilograms = unit === "kg" ? value : poundsToKilograms(value);
  if (kilograms <= 0) return error("weight_not_positive", "Weight must be greater than zero.", "weight");
  if (kilograms > MAX_WEIGHT_KG) {
    return error("weight_too_large", `Weight cannot exceed ${MAX_WEIGHT_KG} kg.`, "weight");
  }
  return { ok: true, value: kilograms };
}

export interface WeightInput {
  id: WeightId;
  logId: LogId;
  measuredAt: EpochMs;
  kilograms: number;
  revision?: number;
  updatedAt?: EpochMs;
  deletedAt?: EpochMs | null;
}

export function createWeightRecord(input: WeightInput, now: number): ValidationResult<WeightRecord> {
  if (!Number.isFinite(input.measuredAt)) return error("weight_time_not_finite", "Weight time must be finite.", "measuredAt");
  if (input.measuredAt > now) return error("weight_time_in_future", "Weight time cannot be in the future.", "measuredAt");
  if (!Number.isFinite(input.kilograms)) return error("weight_not_finite", "Weight must be finite.", "kilograms");
  if (input.kilograms <= 0) return error("weight_not_positive", "Weight must be greater than zero.", "kilograms");
  if (input.kilograms > MAX_WEIGHT_KG) return error("weight_too_large", `Weight cannot exceed ${MAX_WEIGHT_KG} kg.`, "kilograms");
  return {
    ok: true,
    value: {
      id: input.id,
      logId: input.logId,
      measuredAt: input.measuredAt,
      kilograms: input.kilograms,
      revision: input.revision ?? 0,
      updatedAt: input.updatedAt ?? (now as EpochMs),
      deletedAt: input.deletedAt ?? null,
    },
  };
}

export function validateWeightRecord(value: unknown, now: number): ValidationResult<WeightRecord> {
  if (!isObject(value)) return error("weight_not_object", "Weight must be an object.");
  if (!isUuid(value.id)) return error("invalid_weight_id", "Weight id must be a UUID.", "id");
  if (!isUuid(value.logId)) return error("invalid_log_id", "Log id must be a UUID.", "logId");
  if (!isEpoch(value.measuredAt)) return error("invalid_measured_at", "Weight time must be UTC epoch milliseconds.", "measuredAt");
  if (typeof value.kilograms !== "number") return error("invalid_kilograms", "Weight must be a number.", "kilograms");
  if (typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 0) {
    return error("invalid_revision", "Revision must be a non-negative integer.", "revision");
  }
  if (!isEpoch(value.updatedAt)) return error("invalid_updated_at", "Updated time must be UTC epoch milliseconds.", "updatedAt");
  if (!optionalEpoch(value.deletedAt)) return error("invalid_deleted_at", "Deleted time must be UTC epoch milliseconds or null.", "deletedAt");
  return createWeightRecord(
    {
      id: value.id as WeightId,
      logId: value.logId as LogId,
      measuredAt: value.measuredAt as EpochMs,
      kilograms: value.kilograms,
      revision: value.revision,
      updatedAt: value.updatedAt as EpochMs,
      deletedAt: value.deletedAt as EpochMs | null,
    },
    now,
  );
}

export function validateLogPreferences(value: unknown): ValidationResult<LogPreferences> {
  if (!isObject(value)) return error("preferences_not_object", "Preferences must be an object.");
  if (typeof value.timezone !== "string" || !isValidTimezone(value.timezone)) {
    return error("invalid_timezone", "Timezone must be a valid IANA timezone.", "timezone");
  }
  if (value.theme !== "system" && value.theme !== "light" && value.theme !== "dark") {
    return error("invalid_theme", "Theme must be system, light, or dark.", "theme");
  }
  if (value.weightUnit !== "kg" && value.weightUnit !== "lb") {
    return error("invalid_weight_unit", "Weight unit must be kg or lb.", "weightUnit");
  }
  if (typeof value.defaultGoalHours !== "number") {
    return error("invalid_goal", "Default goal must be a number.", "defaultGoalHours");
  }
  const goal = validateGoalHours(value.defaultGoalHours);
  if (!goal.ok) return { ...goal, field: "defaultGoalHours" };
  return {
    ok: true,
    value: {
      timezone: value.timezone as IanaTimezone,
      theme: value.theme,
      weightUnit: value.weightUnit,
      defaultGoalHours: goal.value,
    },
  };
}
