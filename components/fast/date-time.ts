function partsAt(epoch: number, timezone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(epoch);
  return Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]),
  );
}

export function formatDateTimeInput(epoch: number, timezone: string): string {
  const parts = partsAt(epoch, timezone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month!)}-${pad(parts.day!)}T${pad(parts.hour!)}:${pad(parts.minute!)}`;
}

export function parseDateTimeInput(value: string, timezone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const desired = match.slice(1).map(Number);
  const wallTime = Date.UTC(desired[0]!, desired[1]! - 1, desired[2]!, desired[3]!, desired[4]!);
  let candidate = wallTime;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shown = partsAt(candidate, timezone);
    const shownWallTime = Date.UTC(shown.year!, shown.month! - 1, shown.day!, shown.hour!, shown.minute!);
    candidate += wallTime - shownWallTime;
  }
  return formatDateTimeInput(candidate, timezone) === value ? candidate : null;
}
