# site-generator-speed

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/kazamisao/site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/kazamisao/site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in for make.fun's own makefun-site 1.0.0: `solve.js` answers every case byte-identically to the reference — same front matter, template dialect, Markdown subset, slug rule and build report — in about half the CPU time on the practice set.

## How it is faster

- **One fused pass per source.** Markdown is lexed and rendered in a single scan with first-character dispatch; inline markup is rendered straight into the output buffer, with plain runs pushed raw and the five HTML characters escaped at their own positions instead of a second scan.
- **Templates compiled once per case** into flat node arrays, rendered into parts arrays joined once, with a per-case memo: a partial that depends only on the case-constant roots (`site`, `tags`, `recent`) — the header, footer and filler partials — is rendered once per case, and a post's card is rendered once per post and reused on its index and tag pages. The memo is keyed by the exact values the template reads, so it can never serve a stale render.
- **No wasted work.** Slugs and long dates are cached per case, cards are built once per source and reused by the page and the lists, front-matter bodies are sliced out of the source instead of split and re-joined, and word counts are a single allocation-free scan.

## Layout

- `solve.js` — the entry: `run(input)` returns the output tree for one case. Node 22, standard library only, no dependencies.
- `main.ts` — the driver the harness runs: reads every case from `/input/cases.json`, answers each with `run`, writes `/output/answers.json`.
- `LICENSE` — MIT.

## Verification

Practice set, local differential harness against the kit's published expected answers: 3/3 cases byte-identical. Median full-set time on this machine: ~0.19 s against the house baseline's ~0.47 s (about 2.4x faster).
