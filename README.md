# ASO local-model ladder

The code behind [the local-model experiment](https://github.com/Sys64k/ai-swarm-orchestrator/blob/main/docs/local-model-experiment.md):
what free models running on one GPU managed to build, and how they failed, when
[ASO](https://github.com/Sys64k/ai-swarm-orchestrator) gave them real tasks on a small Next.js reader app.

**This is experiment data, not a product.** Most of the code was written by AI agents, some by small
local models, and much of it failed. Nobody has reviewed it for production, so don't deploy it.

## What's here

| Where | What it is |
|---|---|
| `main` | The starting code (tag `base`, commit `9cac1e3`), plus this README and the licence |
| `run/glm-4-7-flash` | `glm-4.7-flash`: passed 3 of 5 levels |
| `run/glm-4-7-flash-tests-first` | `glm-4.7-flash` with Opus writing the tests first: passed 5 of 5 |
| `run/qwen3-coder-tests-first` | `qwen3-coder:30b` with Opus writing the tests first: passed 4 of 5 |
| `run/first-runs` | The merged work from the first runs of `qwen3-coder` and `gpt-oss`, on one shared history and mostly different tasks, so compare these only roughly |
| `attempt/*` | Failed attempts that left code, named after their tasks (`-tf`: tests first) |

Some results have no `run/` branch. `devstral:24b` finished nothing in either run, and
`qwen2.5-coder:14b` made no tool calls, so it left no code. The experiment page has every result
and what each failure looked like.

The agent transcripts and the Hub's task records aren't included. The commit history shows what
each model wrote, but not why it stopped.

## See what a model did

```bash
git clone https://github.com/Sys64k/aso-local-model-ladder.git && cd aso-local-model-ladder
git diff --stat base origin/run/glm-4-7-flash-tests-first
git log --oneline base..origin/run/glm-4-7-flash-tests-first
```

Commit authors such as `ASO frontend agent (avalon-81328450)` name the agent's role and worker
machine. The Hub made the merge commits.

## Run the ladder yourself

You need a running ASO Hub, a worker, and a model the Hub can reach. The ladder script looks for
this repository in the Hub's projects folder, as `aso-test`. So on the Hub's machine, with the
default folder:

```bash
git clone https://github.com/Sys64k/aso-local-model-ladder.git ~/aso-projects/aso-test
```

Then, from the ASO repository after `npm run build`:

```bash
node scripts/local-model-ladder.mjs local/<model>                 # as it is
node scripts/local-model-ladder.mjs local/<model> --tests-first   # a stronger model writes the tests first
```

Each run gets a new project seeded from `base`, so every model does the same five tasks from the
same code. The task descriptions are in that script. We used Opus for the tests. The Hub will also
list `aso-test` as a project after its next restart.

## Licence

[MIT](LICENSE), except `tests/fixtures/wikipedia-article.html`, a test page made to look like a
Wikipedia article. Three of its sentences are adapted, with small changes, from Wikipedia's
[Lighthouse keeper](https://en.wikipedia.org/wiki/Lighthouse_keeper) article. The rest doesn't match
that article as it stood on 6 November 2026, but that file as a whole is under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
