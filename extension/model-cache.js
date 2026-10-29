export const CACHE_DB_NAME = 'local-english-models';
export const CACHE_STORE = 'selected-model';

async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(CACHE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function read(key) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE, 'readonly');
      const request = transaction.objectStore(CACHE_STORE).get(key);
      let value;
      request.onsuccess = () => { value = request.result; };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Model cache read was interrupted.'));
    });
  } finally { db.close(); }
}

export const savedModelInfo = () => read('info');
export const savedModelFile = () => read('file');

export async function rememberModel(file) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE, 'readwrite');
      const store = transaction.objectStore(CACHE_STORE);
      // One key is replaced atomically, so changing models retains one copy.
      store.put(file, 'file');
      store.put({ name: file.name, bytes: file.size, savedAt: Date.now() }, 'info');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Saving the model was interrupted.'));
    });
  } finally { db.close(); }
}

export async function forgetModel() {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE, 'readwrite');
      transaction.objectStore(CACHE_STORE).clear();
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Removing the saved model was interrupted.'));
    });
  } finally { db.close(); }
}
