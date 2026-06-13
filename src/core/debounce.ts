export interface Debounced {
  (): void;
  cancel(): void;
}

/** Trailing-edge debounce. */
export function debounce(fn: () => void, ms: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (() => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  }) as Debounced;
  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return debounced;
}
