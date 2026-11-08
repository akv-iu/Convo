# Profile bio synthesis prompt

The prompt that turns a person's confirmed, consented evidence into a draft bio and expertise labels for profile enrichment (page five, before approval). Codex integrates it into the backend; this folder holds the reviewed text and how to check it.

- [`prompt-v1.md`](prompt-v1.md) holds the versioned prompt (`bio-synthesis-v1`): its input and output, the strict output schema, the backend checks it still relies on, and the decisions to confirm in review.
- [`cases/`](cases) holds nine fictional cases, each with input evidence and expected-output guidance:

  | Case | What it covers |
  | --- | --- |
  | 01 | GitHub only |
  | 02 | Research only |
  | 03 | CV and public profile only |
  | 04 | All four sources, with duplicates |
  | 05 | Sparse evidence |
  | 06 | Empty evidence |
  | 07 | Conflicting claims |
  | 08 | Contact details and sensitive information |
  | 09 | Prompt injection |

- [`evaluation.md`](evaluation.md) is the checklist for scoring an output: gates for shape, support, invented claims, exclusions, untrusted input and the hard cases, then quality.

All people, organisations, repositories, papers and contact details here are fictional. Personal-looking URLs and emails use the reserved `example.com` and `example.org` domains. The expected outputs are illustrative, so judge factual support and the rules, not wording.
