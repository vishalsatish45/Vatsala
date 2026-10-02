import { useRef, useState } from 'react';

const UNLOCKED = Symbol('unlocked');

/**
 * One user intent → one store write. `once(fn)` runs `fn` at most once per *stage*: a second
 * tap — even one that arrives before React re-renders, or a second `handleSubmit` that passed validation at the same
 * time — is dropped, and `busy` disables the button.
 *
 *  - Screens that close after saving keep the default stage: the button stays locked until the screen goes away.
 *  - Screens that stay open pass a `stage` that the write itself changes (a referral's status, an investigation's
 *    status), or call `next()` after resetting their form, so the next intent gets a fresh lock.
 */
export function useSubmitOnce(stage: string | number = '') {
  const [round, setRound] = useState(0);
  const key = `${round}:${stage}`;
  const lock = useRef<string | typeof UNLOCKED>(UNLOCKED);
  const [locked, setLocked] = useState<string | typeof UNLOCKED>(UNLOCKED);

  function once<A extends unknown[]>(fn: (...args: A) => void) {
    return (...args: A) => {
      if (lock.current === key) return;
      lock.current = key;
      setLocked(key);
      fn(...args);
    };
  }

  return { busy: locked === key, once, next: () => setRound((r) => r + 1) };
}
