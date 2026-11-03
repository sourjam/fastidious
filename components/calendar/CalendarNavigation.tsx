export function CalendarNavigation({ title, subtitle, onPrevious, onNext }: {
  title: string;
  subtitle: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="calendar-navigation">
      <button type="button" aria-label={`Previous ${title}`} onClick={onPrevious}>‹</button>
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <button type="button" aria-label={`Next ${title}`} onClick={onNext}>›</button>
    </div>
  );
}
