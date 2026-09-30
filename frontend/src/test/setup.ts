import '@testing-library/jest-dom';

// Radix Select reads `hasPointerCapture` off its trigger while opening the
// listbox. jsdom does not implement the pointer-capture API, so a test that
// tried to open a dropdown found zero options and reported nothing - which is
// how the decline-reason picker shipped with no test ever exercising it.
// The stubs below satisfy the guard. Note that a bare `pointerdown` still
// leaves the listbox shut in jsdom; open a Select under test with
// `fireEvent.keyDown(trigger, { key: 'ArrowDown' })`, which is the same path a
// keyboard user takes and is fully supported.
if (typeof Element !== 'undefined' && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => true;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}
