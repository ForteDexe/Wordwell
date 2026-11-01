import nspell from './vendor/spelling/nspell.mjs';
import { createSpellingChecker } from './spelling-core.js';

let loading;
function load() {
  return loading ||= (async () => {
    const values = await Promise.all(['en.aff', 'en.dic'].map(async name => {
      const response = await fetch(new URL(`./vendor/spelling/${name}`, import.meta.url));
      if (!response.ok) throw new Error('The local spelling dictionary could not be loaded. Reload Wordwell or disable Spelling suggestions.');
      return response.text();
    }));
    return createSpellingChecker(nspell(values[0], values[1]));
  })();
}
self.onmessage = async ({ data: { id, text } }) => {
  try { self.postMessage({ id, result: (await load()).correct(text) }); }
  catch (error) { self.postMessage({ id, error: error.message || String(error) }); }
};
