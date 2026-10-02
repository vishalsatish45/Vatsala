import * as SecureStore from 'expo-secure-store';

/**
 * Encrypted key–value storage for anything sensitive kept on the phone: the auth session
 * and the outbox of unsent writes. Backed by the OS keystore via expo-secure-store. SecureStore values are kept
 * small, so a value is split into chunks.
 *
 * Writes are crash-safe: a new value goes into chunks of a fresh generation (`<key>.<gen>.0…`), then the pointer
 * `<key>.n` ("<gen>:<count>") is switched to it in one write, and only then are the old generation's chunks deleted.
 * A kill at any point leaves either the old value or the new one readable — never neither. (The first format,
 * `<key>.n` = "<count>" with chunks `<key>.0…`, is still read, and replaced on the next write.)
 */
const CHUNK = 1800;

type Pointer = { gen?: string; n: number };

function parsePointer(raw: string | null): Pointer | undefined {
  if (!raw) return undefined;
  const m = /^(?:([A-Za-z0-9]+):)?(\d+)$/.exec(raw);
  const n = m ? Number(m[2]) : 0;
  return m && n > 0 ? { gen: m[1], n } : undefined;
}

const chunkKey = (key: string, p: Pointer, i: number) => (p.gen ? `${key}.${p.gen}.${i}` : `${key}.${i}`);

async function deleteChunks(key: string, p: Pointer | undefined) {
  if (!p) return;
  for (let i = 0; i < p.n; i++) await SecureStore.deleteItemAsync(chunkKey(key, p, i));
}

/** Per key, one write at a time: two overlapping writes could otherwise each delete the other's chunks. */
const locks = new Map<string, Promise<unknown>>();
function serial<T>(key: string, job: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(job);
  locks.set(key, run);
  void run.finally(() => {
    if (locks.get(key) === run) locks.delete(key);
  }).catch(() => undefined);
  return run;
}

let counter = 0;
const newGen = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`;

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const p = parsePointer(await SecureStore.getItemAsync(`${key}.n`));
    if (!p) return null;
    const parts = await Promise.all(Array.from({ length: p.n }, (_, i) => SecureStore.getItemAsync(chunkKey(key, p, i))));
    return parts.some((x) => x === null) ? null : parts.join('');
  },
  setItem(key: string, value: string): Promise<void> {
    return serial(key, async () => {
      const old = parsePointer(await SecureStore.getItemAsync(`${key}.n`));
      const p: Pointer = { gen: newGen(), n: Math.ceil(value.length / CHUNK) };
      if (!p.n) {
        // An empty value reads back as none (as before).
        await SecureStore.deleteItemAsync(`${key}.n`);
        return deleteChunks(key, old);
      }
      for (let i = 0; i < p.n; i++) await SecureStore.setItemAsync(chunkKey(key, p, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
      await SecureStore.setItemAsync(`${key}.n`, `${p.gen}:${p.n}`); // the switch
      await deleteChunks(key, old);
    });
  },
  removeItem(key: string): Promise<void> {
    return serial(key, async () => {
      const old = parsePointer(await SecureStore.getItemAsync(`${key}.n`));
      await SecureStore.deleteItemAsync(`${key}.n`);
      await deleteChunks(key, old);
    });
  },
};
