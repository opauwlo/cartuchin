/* ---------------- local storage (IndexedDB) ---------------- */
const idb = (() => {
  let p = null;
  function open() {
    if (!p) p = new Promise((res, rej) => {
      let r; try { r = indexedDB.open("cartucho", 2); } catch (e) { rej(e); return; }
      r.onupgradeneeded = () => { const d = r.result; for (const s of ["roms", "pend", "sync", "covers"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return p;
  }
  async function run(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req ? req.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  return {
    get: (s, k) => run(s, "readonly", (st) => st.get(k)).catch(() => undefined),
    put: (s, k, v) => run(s, "readwrite", (st) => st.put(v, k)),
    del: (s, k) => run(s, "readwrite", (st) => st.delete(k)).catch(() => {}),
    all: (s) => run(s, "readonly", (st) => st.getAll()).catch(() => []),
  };
})();

export { idb };
