import { languageTools } from './languages.js';

export function createBenchmark({ model, canStart, onRunningChange }) {
  const $ = id => document.getElementById(id);
  let cases = null, running = false, stopping = false, report = null;
  const text = (tag, value, className) => {
    const node = document.createElement(tag); node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length ? (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : null;
  };
  function summarize() {
    const results = report.results, generated = results.filter(row => !row.error);
    const controls = generated.filter(row => row.category === 'correct control');
    report.summary = {
      completed: results.length, total: cases.length, errors: results.length - generated.length,
      exampleMatches: generated.filter(row => row.matchesExample).length,
      unchangedIncorrect: generated.filter(row => row.category !== 'correct control' && row.unchanged).length,
      controlsPreserved: controls.filter(row => row.unchanged).length,
      controlsCompleted: controls.length, medianSeconds: median(generated.map(row => row.seconds)),
    };
    const summary = report.summary;
    $('benchmark-summary').textContent = `${summary.exampleMatches} exact example matches · ${summary.unchangedIncorrect} incorrect inputs unchanged · ${summary.controlsPreserved}/${summary.controlsCompleted} correct controls preserved${summary.medianSeconds === null ? '' : ` · median ${summary.medianSeconds.toFixed(2)} s`}${summary.errors ? ` · ${summary.errors} error${summary.errors === 1 ? '' : 's'}` : ''}`;
  }
  function append(row) {
    const tr = document.createElement('tr');
    tr.append(text('th', `${row.index}. ${row.category}`)); tr.firstChild.scope = 'row';
    tr.append(text('td', row.input));
    const output = text('td', row.error || row.output);
    const label = row.error ? 'Generation error' : row.matchesExample ? 'Matches example'
      : row.unchanged ? 'Unchanged — review' : 'Different wording — review';
    output.append(text('span', label, `benchmark-label${row.error ? ' benchmark-error' : ''}`));
    tr.append(output, text('td', row.reference), text('td', row.error ? '—' : `${row.seconds.toFixed(2)} s`));
    $('benchmark-results').append(tr);
  }
  function refresh() {
    $('benchmark-run').disabled = running || !cases || !canStart();
    $('benchmark-stop').hidden = !running;
    $('benchmark-stop').disabled = stopping;
    $('benchmark-stop').textContent = stopping ? 'Stopping…' : 'Stop';
    $('benchmark-download').disabled = running || !report?.results.length;
    if (!running && !report && cases) $('benchmark-status').textContent = model.ready ? 'Ready to run 16 English cases.' : 'Load a model to run the benchmark.';
  }
  async function run() {
    if (running || !cases || !canStart()) return;
    running = true; stopping = false;
    report = { suite: 'Wordwell English grammar smoke test', startedAt: new Date().toISOString(), completed: false, stopped: false,
      model: structuredClone(model.info), language: 'en', prompt: languageTools.instruction('en'),
      sampling: { temperature: 0, seed: 42 }, results: [],
      note: 'References are examples. Exact matches are not an accuracy score; different wording can be correct. Review outputs manually.' };
    $('benchmark-results').replaceChildren(); $('benchmark-table').hidden = false; $('benchmark-summary').hidden = false;
    $('benchmark-meta').hidden = false;
    $('benchmark-meta').textContent = `${report.model.file} · ${report.model.backend} · ${report.model.context.toLocaleString()} context tokens · default English prompt`;
    summarize(); onRunningChange(); refresh();
    try {
      for (const [index, test] of cases.entries()) {
        if (stopping || !model.ready) break;
        $('benchmark-status').textContent = `Running ${index + 1}/${cases.length}: ${test.category}…`;
        let row;
        try {
          const result = await model.process(test.input, { operation: 'correct', language: 'en', customPrompt: '' });
          row = { ...test, index: index + 1, output: result.corrected, seconds: result.seconds,
            matchesExample: result.corrected.trim() === test.reference.trim(), unchanged: result.corrected.trim() === test.input.trim(),
            usage: result.usage, budget: result.budget };
        } catch (error) { row = { ...test, index: index + 1, error: error.message }; }
        report.results.push(row); append(row); summarize();
      }
      report.completed = report.results.length === cases.length;
      report.stopped = !report.completed;
      $('benchmark-status').textContent = `${report.completed ? 'Completed' : 'Stopped after'} ${report.results.length}/${cases.length} cases. Review the outputs below.`;
    } finally {
      report.finishedAt = new Date().toISOString(); running = false;
      onRunningChange(); refresh();
    }
  }
  $('benchmark-run').addEventListener('click', () => run().catch(error => {
    $('benchmark-status').textContent = `Benchmark could not finish: ${error.message}`;
  }));
  $('benchmark-stop').addEventListener('click', () => {
    stopping = true; $('benchmark-status').textContent = 'Stopping after the current sentence…'; refresh();
  });
  $('benchmark-download').addEventListener('click', () => {
    if (!report || running) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `wordwell-benchmark-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  fetch(chrome.runtime.getURL('benchmark-cases.json')).then(async response => {
    if (!response.ok) throw new Error('Benchmark cases could not be loaded.');
    const loaded = await response.json();
    if (!Array.isArray(loaded) || loaded.length !== 16 || loaded.some(item => typeof item.input !== 'string' || typeof item.reference !== 'string' || typeof item.category !== 'string')) throw new Error('Invalid benchmark cases.');
    cases = loaded; refresh();
  }).catch(error => { $('benchmark-status').textContent = error.message; });
  return { get running() { return running; }, refresh, snapshot: () => ({ running, stopping, report: report ? structuredClone(report) : null }) };
}
