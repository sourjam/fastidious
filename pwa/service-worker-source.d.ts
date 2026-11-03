export type CachePolicy = "network-only" | "network-first" | "cache-first" | "stale-while-revalidate";

export function classifyRequest(url: string, origin: string, isNavigation: boolean): CachePolicy;
export function showPushNotification(registration: ServiceWorkerRegistration, data: PushMessageData | null): Promise<void>;
export function focusOrOpenApp(clientsApi: Clients): Promise<WindowClient | null>;
