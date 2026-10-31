# Wordwell correction model benchmark

Date: 2026-10-31

## Method

- Wordwell 0.5.6 packaged browser engine (`wllama 3.8.1`, WebGPU)
- NVIDIA Lovelace adapter, headless Chromium 156
- Context: 1,024 tokens
- Temperature: 0; seed: 42; top-k: 1; top-p: 1
- Wordwell's default correction prompt
- 16 English cases: 14 erroneous sentences and 2 already-correct controls
- One model load and one pass per model; median and p90 cover the 16 measured corrections after one warm-up
- "Accepted corrections" was reviewed manually because semantically equivalent corrections do not always match the single reference string

## Results

| Model | File size | Load | Median | p90 | Exact reference | Accepted erroneous corrections | Correct controls unchanged |
|---|---:|---:|---:|---:|---:|---:|---:|
| Qwen3.5 0.8B UD-Q6_K_XL | 771 MB | 6.77 s | 0.607 s | 0.714 s | 10/16 | 10/14 | 2/2 |
| Qwen3.5 0.8B UD-Q5_K_XL | 607 MB | 2.78 s | 0.331 s | 0.393 s | 10/16 | 10/14 | 2/2 |
| Qwen3.5 0.8B UD-Q4_K_XL | 559 MB | 2.84 s | 0.326 s | 0.404 s | 12/16 | 12/14 | 2/2 |
| Qwen3.5 0.8B Q4_K_M | 533 MB | 2.84 s | 0.341 s | 0.424 s | 10/16 | 9/14 | 2/2 |
| Qwen3.5 0.8B Q4_K_S | 508 MB | 2.82 s | 0.337 s | 0.417 s | 10/16 | 9/14 | 2/2 |
| Qwen3.5 0.8B IQ4_XS | 493 MB | 2.72 s | 0.338 s | 0.397 s | 9/16 | 7/14 | 2/2 |
| Qwen3.5 0.8B UD-Q3_K_XL | 492 MB | 2.98 s | 0.333 s | 0.396 s | 9/16 | 7/14 | 2/2 |
| Qwen3.5 0.8B UD-Q2_K_XL | 418 MB | 3.43 s | 0.335 s | 0.423 s | 8/16 | 7/14 | 2/2 |
| Qwen3.5 0.8B UD-IQ3_XXS | 398 MB | 3.28 s | 0.348 s | 0.492 s | 9/16 | 7/14 | 2/2 |
| Qwen3.5 0.8B UD-IQ2_M | 372 MB | 3.25 s | 0.385 s | 0.636 s | 8/16 | 7/14 | 2/2 |
| Qwen3.5 0.8B UD-IQ2_XXS | 338 MB | 3.31 s | 2.628 s | 2.666 s | 0/16 | 0/14 | 0/2 |
| Qwen3.5 2B UD-Q2_K_XL | 967 MB | 4.94 s | 0.420 s | 0.529 s | 9/16 | 9/14 | 2/2 |
| Gemma 3 1B IT UD-Q5_K_XL | 874 MB | 5.11 s | 0.668 s | 0.786 s | 9/16 | 13/14 | 1/2 |
| Gemma 3 1B IT UD-Q4_K_XL | 807 MB | 2.87 s | 0.358 s | 0.421 s | 8/16 | 12/14 | 1/2 |
| Gemma 3 1B IT UD-Q3_K_XL | 727 MB | 2.89 s | 0.390 s | 0.448 s | 9/16 | 12/14 | 1/2 |
| Gemma 3 1B IT IQ4_NL | 722 MB | 2.74 s | 0.377 s | 0.438 s | 8/16 | 10/14 | 1/2 |
| Gemma 3 1B IT IQ4_XS | 714 MB | 2.68 s | 0.387 s | 0.458 s | 9/16 | 11/14 | 1/2 |
| Gemma 3 1B IT UD-Q2_K_XL | 694 MB | 3.04 s | 0.385 s | 0.456 s | 8/16 | 10/14 | 1/2 |
| Gemma 3 1B IT UD-IQ3_XXS | 592 MB | 3.06 s | 0.390 s | 0.455 s | 9/16 | 9/14 | 2/2 |
| Gemma 3 1B IT UD-IQ2_M | 578 MB | 3.33 s | 0.415 s | 0.516 s | 9/16 | 9/14 | 2/2 |
| Gemma 3 1B IT UD-IQ1_M | 560 MB | 3.67 s | 0.451 s | 1.167 s | 9/16 | 8/14 | 2/2 |
| Gemma 3 270M IT UD-IQ2_XXS | 180 MB | 2.61 s | 0.190 s | 0.571 s | 0/16 | 0/14 | 0/2 |
| Gemma 3 270M IT UD-IQ3_XXS | 185 MB | 2.00 s | 0.296 s | 0.481 s | 6/16 | 4/14 | 2/2 |
| Gemma 3 270M IT UD-Q3_K_XL | 243 MB | 2.03 s | 0.287 s | 0.317 s | 10/16 | 10/14 | 2/2 |
| Gemma 3 270M IT UD-Q4_K_XL | 254 MB | 2.04 s | 0.258 s | 0.298 s | 10/16 | 9/14 | 2/2 |
| Gemma 3 270M IT UD-Q5_K_XL | 260 MB | 2.06 s | 0.262 s | 0.360 s | 6/16 | 5/14 | 2/2 |
| Gemma 3 270M IT UD-Q6_K_XL | 286 MB | 2.03 s | 0.274 s | 0.305 s | 8/16 | 7/14 | 2/2 |
| Gemma 3 270M IT UD-Q8_K_XL | 471 MB | 2.37 s | 0.291 s | 0.317 s | 8/16 | 7/14 | 2/2 |
| Gemma 3 270M IT QAT UD-Q4_K_XL | 254 MB | 2.06 s | 0.309 s | 0.386 s | 7/16 | 6/14 | 2/2 |
| Gemma 3 270M IT F16 | 543 MB | 2.34 s | 0.273 s | 0.300 s | 8/16 | 7/14 | 2/2 |
| Gemma 3 270M IT QAT F16 | 543 MB | 2.33 s | 0.274 s | 0.377 s | 8/16 | 7/14 | 2/2 |
| LFM2.5 1.2B Instruct UD-Q6_K_XL | 995 MB | 3.28 s | 0.436 s | 0.562 s | 8/16 | 7/14 | 1/2 |
| Falcon-H1 0.5B Instruct UD-Q8_K_XL | 656 MB | 3.36 s | 0.825 s | 1.022 s | 4/16 | 5/14 | 1/2 |
| Granite 4.0 1B Q4_K_S | 981 MB | 4.97 s | 5.384 s | 5.429 s | 0/16 | 0/14 | 0/2 |

## Review notes

- Qwen 0.8B missed four errors and left both correct controls unchanged.
- Qwen 0.8B dynamic Q4 XL was the quantization sweet spot: it corrected 12/14 acceptably, preserved both controls, used 559 MB, and had a 0.326-second median. Its two misses were conservative unchanged errors rather than destructive replacements.
- Q5 matched Q6's 10/14 at a smaller footprint. Q3, Q2, and IQ3 fell to 7/14. IQ2-M produced a hallucinated, incomplete response, while IQ2-XXS failed all 16 generations and was much slower because every response hit the output limit.
- Smaller non-dynamic Q4 variants did not retain Q4 XL quality: Q4-K-S and Q4-K-M reached 9/14, and IQ4-XS reached 7/14. The extra selectively higher-precision tensors in dynamic Q4 XL were worthwhile for this workload.
- Qwen 2B at Q2 was about 31% faster than Qwen 0.8B at Q6 and also preserved both controls, but corrected one fewer erroneous sentence. It missed common tense and word-order errors and once inserted Markdown formatting into an unchanged error.
- Gemma corrected three more erroneous sentences than Qwen. Its non-reference corrections were valid rephrasings, but it unnecessarily changed `I don't know what I should do.` to `I don't know what to do.` in the control case.
- Gemma 3 1B dynamic Q3 XL was its quantization sweet spot: 727 MB, a 0.390-second median, and 12/14 accepted corrections. Dynamic Q4 also reached 12/14 but cost 80 MB more; Q5 reached 13/14 but cost another 147 MB and retained the same unnecessary control rewrite.
- Gemma 1B Q2 and the compact IQ4 variants lost correction recall for modest size savings. IQ3 and IQ2 preserved both controls but dropped to 9/14. IQ1 produced explanatory text and one incomplete hallucinated response, marking the reliability floor.
- Gemma 3 270M standard Q4 was about 57% faster than Qwen and roughly one-third its file size. It corrected 9/14 acceptably and preserved both controls, but one response was a refusal and two responses removed meaning. Those failure modes make it less safe than its score suggests.
- Gemma 3 270M standard Q3 was the quantization sweet spot in this test: 243 MB, a 0.287-second median, 10/14 accepted corrections, and both controls preserved. It still produced one refusal and incorrectly claimed the longest erroneous example was already correct, so its equal accepted count does not make it as safe as Qwen.
- IQ2 was unusable, usually producing empty or unrelated output. IQ3 was unstable, while Q5, Q6, Q8, and F16 did not recover Q3/Q4 quality. The non-monotonic results show that this tiny model is highly quant-sensitive under deterministic decoding.
- Gemma 3 270M QAT did not improve this workload. QAT Q4 frequently added response labels or failed to make the correction, while both F16 checkpoints corrected only 7/14. The standard Q4 result beating F16 is likely decoding sensitivity on this small sample, not evidence that Q4 is generally more capable.
- LFM2.5 was about 28% faster than Qwen by median latency, but it missed several common constructions and sometimes changed meaning or returned commentary instead of corrected text.
- Falcon missed most of the errors and was slower than Qwen despite its smaller file.
- Granite's Q4_K_S quant loaded, but every generation produced 128 exclamation marks and stopped at the token limit. This is consistent with the upstream warning about reduced-precision numerical failures. It is not usable in Wordwell at this quant.

## Preliminary conclusion

Qwen3.5 0.8B dynamic Q4 XL is the strongest current default candidate: it reaches 12/14, preserves both controls, and uses 559 MB. Gemma 3 1B dynamic Q3 XL is its family's best tradeoff at the same 12/14, but it uses 727 MB, runs slightly slower, and unnecessarily rewrites one control. Gemma Q5 remains the recall leader at 13/14 but is 874 MB and has the same rewrite tendency. A larger safety benchmark should confirm Qwen Q4 XL before Wordwell changes its recommended download.

Raw files under `reports/correction/` contain every input, output, timing, token count, runtime option, and adapter detail.
