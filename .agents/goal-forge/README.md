# Goal Forge Integration

Selected runtime: bundled (in-binary)

Source checkout fallback not detected. Optional: place it at ../goal-forge, or set GOAL_FORGE_PATH / GOAL_FORGE_HOME for local development templates.

This directory is managed by `agent-team deploy`. It connects the project Task Contract / design-review workflow to Goal Forge without vendoring Goal Forge into this project. Runtime discovery prefers an explicit/local binary first, then the latest published npm package, and keeps a sibling source checkout as a development fallback.

Use Goal Forge when the deliverable is a design artifact, architecture/API/data model decision, migration plan, or any high-risk plan that benefits from adversarial review before implementation.

## Commands

Create a local review run:

```bash
agmesh goal-forge <command> init --goal <design goal> --config /Users/zhd/workspace/supaoauth/.agents/goal-forge/goal-forge.config.json --out /Users/zhd/workspace/supaoauth/.agents/goal-forge/runs/<run-id>
```

Run a deterministic local round:

```bash
agmesh goal-forge <command> run /Users/zhd/workspace/supaoauth/.agents/goal-forge/runs/<run-id> --rounds 1 --adapter local
agmesh goal-forge <command> validate /Users/zhd/workspace/supaoauth/.agents/goal-forge/runs/<run-id> --strict
```

Run repository-aware verification through the Codex adapter:

```bash
agmesh goal-forge <command> run /Users/zhd/workspace/supaoauth/.agents/goal-forge/runs/<run-id> --rounds 1 --adapter codex --repo /Users/zhd/workspace/supaoauth --model gpt-5.3-codex
```

Shortcuts from this project:

```bash
agent-team goal-forge status .
agent-team goal-forge init . "<design goal>"
```

## Coordination Rules

- In coordination DB v2 projects, keep `.agents/state/coordination.db` as the execution source and use `agent-team context` / `automation status` / `automation doctor` for bounded reads.
- In legacy projects only, `tasks.md`, `progress.md`, and `.mailbox/` remain the fallback coordination files until migration.
- Keep Goal Forge runs under `.agents/goal-forge/runs/` as review evidence for design artifacts.
- Record the final Goal Forge run path in the Task Contract under `goal_forge.run_dir`.
- Do not place secrets in Goal Forge config or ledgers.

## Development Fallback

When working on Goal Forge itself, a source checkout at `<path-to-sibling-goal-forge>` can still provide config templates and a fallback runtime when no binary/package runner is available.
