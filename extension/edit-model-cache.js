// An independent database: selecting/forgetting GGUF never removes the edit bundle, or vice versa.
async function store(mode, callback) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('wordwell-edit-models', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('model');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('model', mode); let result;
      const request = callback(transaction.objectStore('model'));
      if (request) request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Edit-model cache operation failed.'));
    });
  } finally { db.close(); }
}
export const savedEditInfo = () => store('readonly', s => s.get('info'));
export const savedEditFile = () => store('readonly', s => s.get('file'));
export const rememberEditModel = file => store('readwrite', s => {
  s.clear(); s.put(file, 'file'); s.put({ name: file.name, bytes: file.size, savedAt: Date.now() }, 'info');
});
export const forgetEditModel = () => store('readwrite', s => s.clear());
