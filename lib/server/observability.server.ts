const ALLOWED_FIELDS = new Set([
  "requestId",
  "route",
  "status",
  "durationMs",
  "d1DurationMs",
  "syncMutations",
  "syncChanges",
  "claimed",
  "sent",
  "permanentFailures",
  "transientFailures",
  "expired",
  "markersPurged",
  "version",
  "success",
]);

export function redactOperationalFields(fields: Record<string, unknown>): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (typeof value === "string") safe[key] = value.slice(0, 100);
    else if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === "boolean") safe[key] = value;
  }
  return safe;
}

export function logOperationalEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ event: event.slice(0, 60), ...redactOperationalFields(fields) }));
}
