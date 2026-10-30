# Publishing Wordwell

Prepare the GitHub release and Chrome Web Store submission from the same tested ZIP. Wordwell's original code is licensed under Apache-2.0. Include the root LICENSE and NOTICE in the extension package and retain the existing Harper, wllama, and llama.cpp licenses and notices. Model weights are downloaded separately under their own licenses.

## Build and validate

1. Run `npm ci` and `npx playwright install chromium`.
2. Set `MODEL_FILE_PATH` if the verified GGUF is not in `models/`.
3. Run `npm run test:budget`, `npm run test:diff`, `npm run test:package`, and `npm run test:release`.
4. Confirm `dist/wordwell-VERSION.validation.json` passed and its `releaseSha256` matches `dist/wordwell-VERSION.zip.sha256`.
5. Use the exact `dist/wordwell-VERSION.zip` that passed, together with its checksum. Model weights are downloaded separately and must not be added to this ZIP.
6. Review `artifacts/store/` for three actual UI screenshots at 1280×800 and a 440×280 promotional image. The screenshots use a first-party writing demo and real local-model output. Check their wording and quality before upload.

Version comes from `package.json` and must match `extension/manifest.json`. Increment both before a later store update. Commit/tag the tested source, then attach the ZIP and `.sha256` to a GitHub release. Use a tag matching the actual version, for example `v0.5.6`. The validation report includes local test paths/hardware details and is for your review, not a required public asset.

## Public privacy/support URLs

The static website is ready in `docs/`. After the repository is public, enable GitHub Pages from branch `main`, folder `/docs`, then verify these URLs in a signed-out browser:

- Homepage: `https://fortedexe.github.io/Wordwell/`
- Privacy: `https://fortedexe.github.io/Wordwell/privacy.html`
- Support/source: `https://github.com/ForteDexe/Wordwell/issues`

These are intended URLs, not evidence that hosting is already enabled. Do not submit a private or missing policy URL. The same policy is bundled at `privacy.html` inside the extension so users can read it offline. If you choose another hostname, update the publishing URLs. GitHub visibility, Pages deployment, release publication, and Web Store upload are separate publishing actions.

## Suggested listing

Name: **Wordwell**

Short description: **Write clearly. Translate locally. Grammar correction and translation with a model running on your computer.**

Single purpose: Help users improve and translate writing using a local model, with reviewable grammar suggestions and explicit selection translation.

Explain that a separate compatible model download is required. The verified Qwen3.5-0.8B UD-Q6_K_XL GGUF is about 771 MB, and Wordwell caches a copy for autoload. Users keep the workspace open to reuse the engine. Quality and speed depend on the model/hardware. Avoid guarantees of perfect grammar or universal editor/model compatibility.

Declare data handling consistently with `docs/privacy.html`: selected/edited website content is processed locally; settings and one model copy persist locally; requested diagnostic reports use session storage. No telemetry, advertisements, cloud inference, or automatic diagnostic uploads. External model/support links are user-initiated. Local-only processing still needs disclosure; do not equate it with not handling user data. Complete the dashboard's current questions according to their definitions.

Permission explanations:

- HTTP/HTTPS content scripts: correction/translation UI in supported website editors and selections, including frames.
- `contextMenus`: explicit selection checks and requested editor diagnostics.
- `storage`: preferences and temporary session state.
- `unlimitedStorage`: the large selected model copy for local autoload.
- `clipboardWrite`: explicit Copy actions.

All executable JS, workers, and WASM are included in the package. The external download is a GGUF model file, not extension code. Model weights are not redistributed in the ZIP.

## Reviewer test instructions

1. Use desktop Chrome 137+ and pin Wordwell. No account, API key, local server, Python, Node, or command-line launcher is needed for the installed extension.
2. Open Wordwell. Follow the model download link in Tips, select the downloaded GGUF, and click Load model. Allow disk/memory for the roughly 771 MB model and its saved copy. Wait for Ready. Read the linked privacy policy.
3. In Original, enter `Yesterday I go to the shop and buy some milk.` Use Check text and review the correction; the source remains editable. Output can vary by model.
4. On a normal HTTP/HTTPS website, type the same sentence in a supported text box. Pause, click an underline, use Replace, then Ctrl+Z. Chrome internal and other restricted pages are not supported.
5. In Settings, enable Text box translation, uncheck Instant translation, choose Spanish, and select `Hello.` in a text box. Click the translation icon, review and Replace. Enable Instant translation and repeat to test direct replacement and Undo.
6. Enable Page selection translation and choose a target language. Select ordinary webpage text; the icon appears after mouse release. Translate and Copy. The page text stays unchanged.
7. Close and restart Chrome. The cached model should autoload in one background workspace. Keep that workspace open while writing.
8. Use Forget model to delete the saved copy, then Unload to release the current engine. It should not autoload on the next restart.

If automatic checking is unwanted, turn it off in Settings; manual checks remain available. The optional Windows GPU tip changes a browser-wide setting and is not required for correctness or installation.

## Final manual review

- Verify privacy/support URLs are public and developer contact details are correct.
- Inspect store screenshots and the padded 128px icon on light/dark backgrounds.
- Try the package on normal Chrome and real Reddit/YouTube editors; automated fixtures complement live-site testing.
- Check that no model, personal report, browser profile, `.conda`, or source archive is included in the extension upload.

References: [Chrome Web Store publishing](https://developer.chrome.com/docs/webstore/publish), [privacy disclosures](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), [image requirements](https://developer.chrome.com/docs/webstore/images).
