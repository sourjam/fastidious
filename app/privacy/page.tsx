import type { Metadata } from "next";

import { InformationPage } from "@/components/information/InformationPage";

export const metadata: Metadata = { title: "Privacy — Fastidious" };

export default function PrivacyPage() {
  return (
    <InformationPage title="Privacy">
      <section>
        <h2>What is stored</h2>
        <p>Fastidious stores your fasting records, weights, and preferences in Cloudflare D1. This data is readable by the server; it is not end-to-end encrypted.</p>
      </section>
      <section>
        <h2>Your access link</h2>
        <p>Your secret link grants full access to view and change the log. Treat it like a password. There is no conventional account, password reset, or recovery service.</p>
      </section>
      <section>
        <h2>Retention and operations</h2>
        <p>A log expires after 12 months without a successful authenticated visit or sync. Operational logs exclude secret links, fasting and weight values, and request payloads.</p>
        <p>Fastidious has no advertising, product analytics, session replay, or external error tracker.</p>
      </section>
      <section>
        <h2>Your controls</h2>
        <p>Use the You screen to export a JSON copy, clear fasting and weight data, rotate the access link, or remove the log from this device.</p>
      </section>
    </InformationPage>
  );
}
