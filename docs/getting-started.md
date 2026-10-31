# Getting started with Wordwell

**Write clearly. Translate locally.**

Wordwell is a Chrome extension for grammar correction and translation with a GGUF model running on your device. It underlines suggested edits after a typing pause, refines selected writing, and translates selections in text boxes or ordinary webpage text. Your writing is not sent to an inference service.

## Get started

Requirements: desktop Chrome 137 or newer, a compatible GGUF model, and enough memory and disk space for that model. A GPU can improve speed; performance and language quality depend on your hardware and model. The recommended model below is about 559 MB. Wordwell saves an additional local copy for autoload.

1. Install the published Chrome Web Store version when available, or download and unzip a [GitHub release](https://github.com/ForteDexe/Wordwell/releases). For an unpacked install, open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select the extracted folder containing `manifest.json`. Developers can [build locally](development.md) and load `dist/extension` instead.
2. The workspace opens automatically on first install so you can load a model and review Settings. Pin Wordwell and use its toolbar icon to reopen the workspace later.
3. [Download Qwen3.5-0.8B UD-Q4_K_XL GGUF](https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-UD-Q4_K_XL.gguf). It is the recommended default for its size, speed, conservative corrections, and Simplified Chinese translation. [Gemma 3 1B UD-Q3_K_XL](https://huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-UD-Q3_K_XL.gguf) is a larger alternative that performed better for Vietnamese translation but rephrased correct text more readily. Select one downloaded file in Wordwell and click Load model. Other models need separate compatibility and quality checks; a GGUF extension alone does not guarantee support. This version accepts one file under 2 GiB.
4. Keep the workspace tab open while writing. A saved model autoloads on later Chrome starts; the engine is reused for each check.
5. Type in a supported webpage text box and pause for 1.2 seconds. Click an underline to review a suggestion, then Replace or Ignore. Ctrl+Z undoes a replacement.

## Correction and translation

- **Correction:** automatic checks are on by default. Settings lets you choose a correction language, turn automatic checks off, adjust the 512–8,192-token context (1,024 by default), or customize the correction prompt. Select text and click the bulb for a manual refinement.
- **Text box translation:** enable it and select a target language in Settings. Select writing and click its bottom-right translation icon. Instant translation is checked by default and applies the translation directly after the icon click. Uncheck it to preview the translation and choose Replace instead. Undo remains available.
- **Page selection translation:** enable its separate setting and language. Select article or posted comment text, release the mouse, and click the nearby translation icon. The card offers Copy and leaves the page text unchanged.

Supported surfaces include ordinary textareas, common single-line text inputs, and basic contenteditable editors, including open and closed shadow roots. Password and disabled fields are excluded. Read-only selections support page translation. Specialized editors, including Google Docs, may require additional integration. The extension cannot run on Chrome's internal pages or every restricted browser page.

Long passages are budgeted with the model's tokenizer and split by newlines, periods, then commas as needed. Pieces that cannot fit are rejected instead of silently truncated. A small local model can miss errors or make unwanted edits; review the output. See [detailed usage and limitations](usage.md).

## Privacy and storage

Text processing stays on your device. Settings and one unchanged model copy are saved locally. No account, analytics, telemetry, or cloud inference is used. The optional model download and support links open third-party websites only when clicked.

Unload releases the active engine. Forget model deletes the saved copy and disables autoload; an already-running engine stays available until unloaded or closed. Uninstalling removes extension storage and leaves your original downloaded GGUF alone.

Read the [privacy policy](privacy.html), also available offline from the workspace. For problems with a site, use Wordwell's context-menu editor diagnostics; reports stay local until you choose to share them. Support: [GitHub issues](https://github.com/ForteDexe/Wordwell/issues).

## Development and release

- [Development, verification, and architecture](development.md)
- [Publishing checklist and reviewer instructions](publishing.md)
- [Standalone engine benchmark](engine-benchmark.md)
- [Performance experiments](performance.md)

The card styling adapts Harper's Apache-2.0 suggestion UI. Wordwell uses its local model for corrections, rather than Harper's rule engine. Harper, wllama, and llama.cpp notices and licenses are included in the extension. See [third-party notices](../extension/THIRD_PARTY_NOTICES.txt).
