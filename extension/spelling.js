// Dictionary parsing and candidate generation run off the page's main thread.
export class SpellingService {
  constructor() { this.worker = null; this.pending = new Map(); this.sequence = 0; }
  correct(text) {
    if (!this.worker) {
      this.worker = new Worker(new URL('./spelling-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        const job = this.pending.get(data.id); if (!job) return;
        clearTimeout(job.timer); this.pending.delete(data.id);
        if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
      };
      this.worker.onerror = e => this.reset(new Error(e.message || 'The spelling checker stopped. Reload Wordwell or disable Spelling suggestions.'));
    }
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.reset(new Error('The spelling checker did not respond. Reload Wordwell or disable Spelling suggestions.')), 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, text });
    });
  }
  reset(error = new Error('Spelling settings changed. Please try again.')) {
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
    this.pending.clear(); this.worker?.terminate(); this.worker = null;
  }
}
