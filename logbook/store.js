/* 이 기기 저장소 (IndexedDB). 인터넷이 없어도 모든 기록이 여기에 저장됩니다.
 * entries: 로그북 기록 / kv: 설정·동기화 정보 / photos: 스캔 사진 (이 기기에만, 구글 드라이브로는 안 올림)
 */
(function () {
  'use strict';
  const DB_NAME = 'pilot-logbook', VERSION = 1;
  let dbp = null;

  function open() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error || new Error('저장소를 열 수 없습니다.'));
        req.onblocked = () => rej(new Error('다른 탭에서 로그북이 열려 있어 저장소를 열 수 없습니다.'));
      });
    }
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('저장 실패'));
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const store = {
    allEntries: () => tx('entries', 'readonly', s => req(s.getAll())),
    putEntry: e => tx('entries', 'readwrite', s => { s.put(e); }),
    putEntries: list => tx('entries', 'readwrite', s => { list.forEach(e => s.put(e)); }),
    get: key => tx('kv', 'readonly', s => req(s.get(key))),
    set: (key, val) => tx('kv', 'readwrite', s => { s.put(val, key); }),
    getPhoto: id => tx('photos', 'readonly', s => req(s.get(id))),
    putPhoto: (id, blob) => tx('photos', 'readwrite', s => { s.put(blob, id); }),
    deletePhoto: id => tx('photos', 'readwrite', s => { s.delete(id); }),
    photoKeys: () => tx('photos', 'readonly', s => req(s.getAllKeys())),

    /** 브라우저가 공간이 부족할 때 지우지 않도록 요청 (홈 화면 앱이면 대개 허용) */
    async persist() {
      try {
        if (navigator.storage && navigator.storage.persist) {
          if (await navigator.storage.persisted()) return true;
          return await navigator.storage.persist();
        }
      } catch (e) { /* 지원 안 함 */ }
      return false;
    }
  };

  window.LOGBOOK_STORE = store;
})();
