import { afterEach, expect, it, vi } from "vitest";
import { store } from "./store";

afterEach(() => { store.reset(); vi.resetModules(); });
it("shares fake state across separately loaded route modules, including a shared reset", async () => {
  store.reset();
  const first = store.get();
  const id = store.nextId("route");
  vi.resetModules();
  const second = (await import("./store")).store;
  expect(second.get()).toBe(first);
  expect(second.nextId("route")).not.toBe(id);
  second.reset();
  expect(store.get()).toBe(second.get());
  expect(store.get()).not.toBe(first);
});
