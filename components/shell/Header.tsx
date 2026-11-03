import { Tag } from "../ui/Tag";

interface HeaderProps {
  date: string;
  offline?: boolean;
  error?: string;
}

export function Header({ date, offline = false, error }: HeaderProps) {
  return (
    <header className="app-header">
      <span className="wordmark">Fastidious</span>
      {offline ? <Tag>Offline</Tag> : null}
      {error ? <Tag variant="status">Error</Tag> : null}
      <span className="header-date" suppressHydrationWarning>{date}</span>
    </header>
  );
}
