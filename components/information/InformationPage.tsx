import type { ReactNode } from "react";

export function InformationPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="information-page">
      <a className="information-back" href="/">← Fastidious</a>
      <span className="panel-kicker">Fastidious</span>
      <h1>{title}</h1>
      {children}
    </main>
  );
}
