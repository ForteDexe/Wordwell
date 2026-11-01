// Loaded lazily only when the edit engine is selected.
export class EditModel {
  constructor() {
    this.worker = new Worker(new URL('./edit-model-worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map(); this.sequence = 0;
    this.worker.onmessage = ({ data }) => {
      const job = this.pending.get(data.id); if (!job) return;
      clearTimeout(job.timer); this.pending.delete(data.id);
      if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
    };
    this.worker.onerror = event => { this.abort(new Error(event.message || 'The edit worker stopped.')); };
  }
  abort(error) {
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
    this.pending.clear(); this.worker?.terminate(); this.worker = null;
  }
  request(type, value) {
    if (!this.worker) return Promise.reject(new Error('The edit model is no longer loaded. Reload it or switch engines.'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.abort(new Error('The edit engine did not respond. Reload it or switch engines.')); }, 120000);
      this.pending.set(id, { resolve, reject, timer }); this.worker.postMessage({ id, type, value });
    });
  }
  load(file) { return this.request('load', file); }
  count(text) { return this.request('count', text); }
  correct(text) { return this.request('correct', text); }
  async exit() {
    try { if (this.worker) await this.request('dispose'); }
    finally { this.abort(new Error('Edit model unloaded.')); }
  }
}
