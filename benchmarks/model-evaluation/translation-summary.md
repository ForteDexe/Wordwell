# Wordwell translation model benchmark

Date: 2026-10-31

## Method

- Wordwell 0.5.6 packaged browser engine (`wllama 3.8.1`, WebGPU)
- Wordwell's production translation instruction
- Context: 1,024 tokens; temperature: 0; seed: 42; top-k: 1; top-p: 1
- Ten English source sentences translated to Vietnamese and Simplified Chinese
- One already-target-language control per language
- Cases cover details, negation, contrast, counterfactual meaning, privacy wording, ambiguity, dialogue, nuance, and technical language
- A translation passes manual review when its core meaning, polarity, named details, constraints, action, and tone are preserved. Minor awkwardness is allowed. Unrelated/meta output is a failure.

This is a small directional benchmark, not a professional human evaluation. Translation has many valid outputs, so exact-reference matching is not used as the quality score.

## Results

| Model | Vietnamese acceptable | Chinese acceptable | Combined | Controls unchanged | Median | p90 |
|---|---:|---:|---:|---:|---:|---:|
| Qwen3.5 0.8B UD-Q4_K_XL | 6/10 | **9/10** | **15/20** | 1/2 | 0.431 s | 0.561 s |
| Gemma 3 1B UD-Q3_K_XL | **8/10** | 7/10 | **15/20** | **2/2** | 0.456 s | 0.588 s |
| Gemma 3 1B UD-Q4_K_XL | 7/10 | 4/10 | 11/20 | **2/2** | 0.452 s | 0.594 s |
| Gemma 3 1B UD-Q5_K_XL | 7/10 | 6/10 | 13/20 | **2/2** | 0.428 s | 0.554 s |

## Important failures

- Qwen translated Friday as Sunday in Vietnamese and answered `How are you?` instead of translating the question. Its Chinese translations were generally strongest, although the already-Chinese control was unnecessarily rewritten.
- Gemma Q3 was strongest in Vietnamese, but returned a request for input instead of translating the negation case in both languages. It also translated `offline` as `online` in Chinese.
- Gemma Q4 changed `shaking her head` to bowing or shrugging, translated `offline` as `online`, lost the left-side direction in the bank case, and produced a weak technical translation in Chinese.
- Gemma Q5 handled Chinese negation correctly, but translated `offline` as `online`, lost directional information, and omitted the configuration constraint from the technical question.

## Preliminary conclusion

Qwen Q4 and Gemma Q3 tie on combined acceptable translations but specialize differently: Qwen is stronger for Simplified Chinese, while Gemma Q3 is stronger for Vietnamese and better at leaving target-language text unchanged. Neither is reliable enough to treat translation as automatic or authoritative. Wordwell should continue showing translations as optional previews, and instant replacement should remain opt-in.

The reports under `reports/translation/` contain every source, reference, raw model output, finish reason, timing, and token count.
