import type { Focus } from '@/domain/focus'

/**
 * Caches imported focuses in the browser (IndexedDB) so the game folder only has to be
 * chosen once. All failures (private mode, blocked storage) degrade to "no cache".
 */
const DB_NAME = 'hoi4-companion'
const STORE = 'focuses'
/** Bump when the shape of Focus changes; older cached data is then ignored (re-import needed). */
const CACHE_VERSION = 11

interface CachedFocuses {
  version: number
  focuses: Focus[]
}

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

export const loadCachedFocuses = async (tag: string): Promise<Focus[] | null> => {
  try {
    const db = await open()
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(tag)
      req.onsuccess = () => {
        const cached = req.result as CachedFocuses | undefined
        resolve(cached?.version === CACHE_VERSION ? cached.focuses : null)
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export const saveCachedFocuses = async (tag: string, focuses: Focus[]): Promise<void> => {
  try {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ version: CACHE_VERSION, focuses } satisfies CachedFocuses, tag)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // Caching is best-effort.
  }
}
