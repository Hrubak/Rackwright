// Desktop branding assets: one IndexedDB database `rackwright`, store `assets`, key = asset name, value = Blob.
const DB = "rackwright";
const STORE = "assets";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") { rej(new Error("Storage is not available.")); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(new Error("Could not open storage."));
  });
}

async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((res, rej) => {
      const tx = db.transaction(STORE, mode);
      const req = f(tx.objectStore(STORE));
      tx.oncomplete = () => res(req.result);
      tx.onerror = tx.onabort = () => rej(new Error("Could not save the file."));
    });
  } finally { db.close(); }
}

export async function idbGet(name: string): Promise<Blob | null> {
  const b = await run<unknown>("readonly", (s) => s.get(name));
  return b instanceof Blob ? b : null;
}
export async function idbPut(name: string, blob: Blob): Promise<void> { await run("readwrite", (s) => s.put(blob, name)); }
export async function idbDelete(name: string): Promise<void> { await run("readwrite", (s) => s.delete(name)); }
