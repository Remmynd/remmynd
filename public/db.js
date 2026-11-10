/* remmynd on-device storage, shared by the page and the service worker (importScripts).
 * IndexedDB "remmynd", version 2. Everything here stays on this device; nothing is sent anywhere.
 *   alerts     key id, index rkey   phone alerts waiting to be shown (push.js, sw.js)
 *   reminders  key rkey             reminders held on this device
 *   links      key share            links made on this device
 * Open the database only through this file. */
(function (g) {
  "use strict";
  const NAME = "remmynd", VERSION = 2;
  let opening = null;

  function upgrade(db, tx, oldVersion) {
    const has = n => db.objectStoreNames.contains(n);
    if (!has("alerts")) db.createObjectStore("alerts", { keyPath: "id" }).createIndex("rkey", "rkey");
    if (!has("links")) db.createObjectStore("links", { keyPath: "share" });
    if (!has("reminders")) {
      const reminders = db.createObjectStore("reminders", { keyPath: "rkey" });
      // From version 1: one reminder per group of alerts that share an rkey.
      if (oldVersion >= 1) {
        tx.objectStore("alerts").getAll().onsuccess = e => {
          const seen = new Set();
          for (const a of e.target.result || []) {
            if (!a || !a.rkey || seen.has(a.rkey)) continue;
            seen.add(a.rkey);
            reminders.put({ rkey: a.rkey, title: a.title || "", start: a.start, dur: 60, place: a.place || "", host: "", z: "",
              share: a.share || "", state: "held", nudge: false, heldAt: a.start, doneAt: null, replanAt: null });
          }
        };
      }
    }
  }

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const q = indexedDB.open(NAME, VERSION);
      q.onupgradeneeded = e => upgrade(q.result, q.transaction, e.oldVersion || 0);
      q.onsuccess = () => {
        const db = q.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      q.onerror = () => { opening = null; reject(q.error); };
    });
    return opening;
  }

  // Run fn on one store in one transaction; resolves with fn's request result once it completes.
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r && "result" in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  g.remmyndDB = {
    open,
    getAll: store => tx(store, "readonly", s => s.getAll()),
    put: (store, value) => tx(store, "readwrite", s => s.put(value)),
    putMany: (store, list) => tx(store, "readwrite", s => { list.forEach(v => s.put(v)); }),
    del: (store, key) => tx(store, "readwrite", s => s.delete(key)),
    delMany: (store, keys) => tx(store, "readwrite", s => { keys.forEach(k => s.delete(k)); })
  };
})(self);
