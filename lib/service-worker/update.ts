export interface ServiceWorkerLike {
  state?: string;
  postMessage(message: { type: "SKIP_WAITING" }): void;
  addEventListener?(type: "statechange", listener: () => void): void;
  removeEventListener?(type: "statechange", listener: () => void): void;
}

export interface ServiceWorkerRegistrationLike {
  waiting: ServiceWorkerLike | null;
  installing: ServiceWorkerLike | null;
  addEventListener(type: "updatefound", listener: () => void): void;
  removeEventListener(type: "updatefound", listener: () => void): void;
}

export interface ServiceWorkerContainerLike {
  controller?: unknown;
  addEventListener(type: "controllerchange", listener: () => void): void;
  removeEventListener(type: "controllerchange", listener: () => void): void;
}

export interface ServiceWorkerUpdateState {
  updateAvailable: boolean;
}

interface CoordinatorOptions {
  registration: ServiceWorkerRegistrationLike;
  container: ServiceWorkerContainerLike;
  onState: (state: ServiceWorkerUpdateState) => void;
  reload: () => void;
  isEditing: () => boolean;
}

export class ServiceWorkerUpdateCoordinator {
  private readonly options: CoordinatorOptions;
  private installing: ServiceWorkerLike | null = null;
  private pendingReload = false;
  private reloaded = false;
  private reloadForControllerChange: boolean;

  constructor(options: CoordinatorOptions) {
    this.options = options;
    this.reloadForControllerChange = Boolean(options.container.controller);
  }

  start() {
    this.options.registration.addEventListener("updatefound", this.handleUpdateFound);
    this.options.container.addEventListener("controllerchange", this.handleControllerChange);
    this.reportWaitingWorker();
  }

  stop() {
    this.options.registration.removeEventListener("updatefound", this.handleUpdateFound);
    this.options.container.removeEventListener("controllerchange", this.handleControllerChange);
    this.installing?.removeEventListener?.("statechange", this.handleInstallingState);
  }

  applyUpdate() {
    const waiting = this.options.registration.waiting;
    if (!waiting) return;
    this.reloadForControllerChange = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  }

  resumeReloadIfReady() {
    if (this.pendingReload && !this.options.isEditing()) this.reloadOnce();
  }

  private readonly handleUpdateFound = () => {
    this.installing?.removeEventListener?.("statechange", this.handleInstallingState);
    this.installing = this.options.registration.installing;
    this.installing?.addEventListener?.("statechange", this.handleInstallingState);
  };

  private readonly handleInstallingState = () => {
    if (this.installing?.state === "installed") this.reportWaitingWorker();
  };

  private readonly handleControllerChange = () => {
    if (!this.reloadForControllerChange || this.reloaded) return;
    if (this.options.isEditing()) {
      this.pendingReload = true;
      return;
    }
    this.reloadOnce();
  };

  private reportWaitingWorker() {
    const waiting = this.options.registration.waiting;
    if (waiting && !this.options.container.controller) {
      waiting.postMessage({ type: "SKIP_WAITING" });
      this.options.onState({ updateAvailable: false });
      return;
    }
    this.options.onState({ updateAvailable: Boolean(waiting) });
  }

  private reloadOnce() {
    if (this.reloaded) return;
    this.reloaded = true;
    this.pendingReload = false;
    this.options.reload();
  }
}
