# Goal Forge Integration

Goal Forge checkout not detected. Place it at ../goal-forge relative to this project, or set GOAL_FORGE_PATH / GOAL_FORGE_HOME.

This directory is managed by `agent-team deploy`. It connects the project Task Contract / design-review workflow to a sibling Goal Forge source checkout without vendoring Goal Forge into this project.

Use Goal Forge when the deliverable is a design artifact, architecture/API/data model decision, migration plan, or any high-risk plan that benefits from adversarial review before implementation.

## Commands

Create a local review run:

```bash
cd "<path-to-sibling-goal-forge>"
npx tsx src/index.ts init --goal "<design goal>" --config "/Users/zhd/workspace/supaoauth/.agents/goal-forge/goal-forge.config.json" --out "/Users/zhd/workspace/supaoauth/.agents/goal-forge/runs/<run-id>"
```

Run a deterministic local round:

```bash
cd "<path-to-sibling-goal-forge>"
npx tsx src/index.ts run "/Users/zhd/workspace/supaoauth/.agents/goal-forge/runs/<run-id>" --rounds 1 --adapter local
npx tsx src/index.ts validate "/Users/zhd/workspace/supaoauth/.agents/goal-forge/runs/<run-id>" --strict
```

Run repository-aware verification through the Codex adapter:

```bash
cd "<path-to-sibling-goal-forge>"
npx tsx src/index.ts run "/Users/zhd/workspace/supaoauth/.agents/goal-forge/runs/<run-id>" --rounds 1 --adapter codex --repo "/Users/zhd/workspace/supaoauth" --model gpt-5.3-codex
```

Shortcuts from this project:

```bash
agent-team goal-forge status .
agent-team goal-forge init . "<design goal>"
```

## Coordination Rules

- Keep `tasks.md`, `progress.md`, and `.mailbox/` as the agent-team execution source.
- Keep Goal Forge runs under `.agents/goal-forge/runs/` as review evidence for design artifacts.
- Record the final Goal Forge run path in the Task Contract under `goal_forge.run_dir`.
- Do not place secrets in Goal Forge config or ledgers.
