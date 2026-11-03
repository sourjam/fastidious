# Local database lifecycle

`FastidiousDatabase` is the single browser-local working store. Opening it creates one device ID if none exists and resets interrupted `sending` mutations to `pending`. Installing a different log with `replaceActiveLog` preserves that device ID while replacing all log, sync, and backup rows.

Before deleting the database, `revokeAndErase` and `removeFromDevice` broadcast the string `close-for-reset` on the `fastidious-database-control` `BroadcastChannel`. Every open `FastidiousDatabase` instance listens for that message and closes its IndexedDB connection so another tab cannot block deletion. `removeFromDevice` attempts push unsubscription first, but local erasure still runs if that best-effort step fails.

Credentials are intentionally outside these domain and mutation tables. The identity bootstrap keeps the active secret in one dedicated local-storage entry and clears it alongside database erasure. Exports can therefore enumerate Dexie's domain tables without ever reading or serializing the credential.
