import type { Metadata } from "next";

import { InformationPage } from "@/components/information/InformationPage";

export const metadata: Metadata = { title: "Help and about — Fastidious" };

export default function HelpPage() {
  return (
    <InformationPage title="Help & about">
      <section>
        <h2>Install</h2>
        <p>On a supported browser, open You and choose Install. On iPhone or iPad, use Safari’s Share menu and choose Add to Home Screen.</p>
      </section>
      <section>
        <h2>Reminders</h2>
        <p>On iOS, Web Push works only after the app is added to the Home Screen. Enable reminders from the installed app and allow notifications when asked.</p>
      </section>
      <section>
        <h2>Offline use</h2>
        <p>You can record changes offline and Fastidious syncs them after reconnection. A fast started offline cannot schedule reliable closed-app reminders until its start reaches the server.</p>
      </section>
      <section>
        <h2>Access and devices</h2>
        <p>Rotate your link if it may have been shared; old links stop working. Remove from this device erases only this device and does not delete the server log.</p>
      </section>
      <section>
        <h2>Health information</h2>
        <p>Fastidious provides general information, not medical advice. Fasting may not be appropriate for everyone. The displayed fasting stages are rough estimates and vary by person.</p>
      </section>
    </InformationPage>
  );
}
