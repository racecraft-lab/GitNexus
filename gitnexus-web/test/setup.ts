import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  };
}

const testStorage: Record<'localStorage' | 'sessionStorage', Storage> = {
  localStorage: createMemoryStorage(),
  sessionStorage: createMemoryStorage(),
};

function installJsdomStorageGlobal(name: 'localStorage' | 'sessionStorage'): void {
  const storage = testStorage[name];
  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  });
  if (globalThis.window !== undefined) {
    Object.defineProperty(globalThis.window, name, {
      value: storage,
      configurable: true,
    });
  }
}

// Reset storage between tests
beforeEach(() => {
  installJsdomStorageGlobal('sessionStorage');
  installJsdomStorageGlobal('localStorage');
  globalThis.sessionStorage.clear();
  globalThis.localStorage.clear();
});
