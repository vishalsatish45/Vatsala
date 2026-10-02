import * as SecureStore from 'expo-secure-store';

/**
 * Encrypted key–value storage for anything sensitive kept on the phone: the auth session
 * and the outbox of unsent writes. Backed by the OS keystore via expo-secure-store. SecureStore values are kept
 * small, so a value is split into chunks: `<key>.n` holds the count, `<key>.0…` the parts.
 */
const CHUNK = 1800;

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const n = Number(await SecureStore.getItemAsync(`${key}.n`));
    if (!n) return null;
    const parts = await Promise.all(Array.from({ length: n }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`)));
    return parts.some((p) => p === null) ? null : parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    await secureStorage.removeItem(key);
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${key}.n`, String(n));
  },
  async removeItem(key: string): Promise<void> {
    const n = Number(await SecureStore.getItemAsync(`${key}.n`));
    await SecureStore.deleteItemAsync(`${key}.n`);
    for (let i = 0; i < (n || 0); i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
  },
};
