import { describe, expect, it, vi } from "vitest";

import { ServiceWorkerUpdateCoordinator, type ServiceWorkerContainerLike, type ServiceWorkerRegistrationLike } from "./update";

class FakeEventTarget {
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

function setup() {
  const waiting = { postMessage: vi.fn<(message: { type: "SKIP_WAITING" }) => void>() };
  const registrationEvents = new FakeEventTarget();
  const containerEvents = new FakeEventTarget();
  const registration: ServiceWorkerRegistrationLike = {
    waiting,
    installing: null,
    addEventListener: registrationEvents.addEventListener.bind(registrationEvents),
    removeEventListener: registrationEvents.removeEventListener.bind(registrationEvents),
  };
  const container: ServiceWorkerContainerLike = {
    controller: {},
    addEventListener: containerEvents.addEventListener.bind(containerEvents),
    removeEventListener: containerEvents.removeEventListener.bind(containerEvents),
  };
  return { waiting, registration, container, containerEvents };
}

describe("ServiceWorkerUpdateCoordinator", () => {
  it("activates the first installed worker without showing an update prompt", () => {
    const fixture = setup();
    fixture.container.controller = undefined;
    const onState = vi.fn();
    const coordinator = new ServiceWorkerUpdateCoordinator({
      registration: fixture.registration,
      container: fixture.container,
      onState,
      reload: vi.fn(),
      isEditing: () => false,
    });

    coordinator.start();

    expect(fixture.waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(onState).toHaveBeenLastCalledWith({ updateAvailable: false });
  });

  it("reports a waiting worker and updates only after user action", () => {
    const fixture = setup();
    const onState = vi.fn();
    const coordinator = new ServiceWorkerUpdateCoordinator({
      registration: fixture.registration,
      container: fixture.container,
      onState,
      reload: vi.fn(),
      isEditing: () => false,
    });

    coordinator.start();
    expect(onState).toHaveBeenLastCalledWith({ updateAvailable: true });
    expect(fixture.waiting.postMessage).not.toHaveBeenCalled();

    coordinator.applyUpdate();
    expect(fixture.waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("reloads once after controller change and waits for an open editor to close", () => {
    const fixture = setup();
    fixture.registration.waiting = null;
    const reload = vi.fn();
    let editing = true;
    const coordinator = new ServiceWorkerUpdateCoordinator({
      registration: fixture.registration,
      container: fixture.container,
      onState: vi.fn(),
      reload,
      isEditing: () => editing,
    });
    coordinator.start();

    fixture.containerEvents.dispatch("controllerchange");
    fixture.containerEvents.dispatch("controllerchange");
    expect(reload).not.toHaveBeenCalled();

    editing = false;
    coordinator.resumeReloadIfReady();
    coordinator.resumeReloadIfReady();
    expect(reload).toHaveBeenCalledOnce();
  });
});
