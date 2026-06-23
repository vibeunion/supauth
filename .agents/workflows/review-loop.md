---
description: Review Loop — loop strategy selection and bounded multi-panel convergence
---
// turbo-all

# Review Loop Workflow

Use this workflow only after a Task Contract exists. Its purpose is to decide
whether a task should use fanout, Goal/TDD, a bounded micro-loop, a macro-loop
with real-world data, or a human-owned loop.

## 0. Strategy Gate

Run the selector first:

```bash
agent-team automation loop-strategy . --task <task_id> --domain auto
```

Decision rules:

| Next step is decided by | Use | Boundary |
|---|---|---|
| Fixed independent checklist | `fanout` / workflow | No iterative judge loop is needed. |
| Machine-verifiable acceptance | `goal` or `micro-loop` | Tests, QC gates, release checks, and verifier findings can drive the loop. |
| Real-world demand or growth data | `macro-loop` | Require real interaction, lead, payment, retention, or conversion data. |
| Taste, positioning, irreversible tradeoff | `human-loop` | Agents may prepare options; the human decides direction. |

`agent-team automation review-loop` is allowed only for `goal` and
`micro-loop` outcomes. It must not be used to fake demand validation,
marketing conversion, business viability, or irreversible product direction.

## 1. Bounded Review Loop

Generate a plan:

```bash
agent-team automation review-loop . \
  --task <task_id> \
  --domain delivery \
  --panels contract,tests,runtime,docs \
  --max-rounds 3 \
  --threshold 9
```

The command writes `.agents/state/review-loops/<task_id>.json`. It does not
launch agents by itself. The plan lists panel commands that can be dispatched
through the normal `agent-team subagent dispatch` runtime.

Hard limits:

- maximum 6 panels
- maximum 5 rounds
- every panel must use the standard structured schema
- every round feeds unresolved `blocking_findings` / `missing` into the next
  round
- stop when required panels pass, verification commands pass, or the next
  decision belongs to a human or real-world data source

## 2. Panels

Recommended panels:

| Panel | Role | Focus |
|---|---|---|
| `contract` | critic | Goal, non-goals, scope, acceptance criteria, rollback. |
| `tests` | verifier | Test/typecheck/build evidence tied to acceptance criteria. |
| `runtime` | verifier | Runtime behavior, timeout, deployment, smoke evidence. |
| `docs` | critic | README, workflows, templates, and user-facing wording. |
| `security` | critic | Secrets, permissions, auth, data exposure, irreversible operations. |
| `release` | verifier | Release gate, packaging, clean diff, rollback evidence. |

Each panel output must include:

- `verdict`
- `score` as advisory proxy only
- `missing`
- `blocking_findings`
- `evidence`
- `next_action`

## 3. Signal Boundary

Agent score is only a proxy. It is not CTR, CVR, payment, retention, production
truth, or user demand. For demand discovery, marketing, and business direction,
use agent panels only to organize angles; the next round must be driven by real
signals or a human decision.

## 4. Completion

Before claiming done:

- cite the review-loop plan path when used
- cite each mailbox result that was actually run
- run the Task Contract verification commands
- update `progress.md` with the final PASS/FAIL/PARTIAL verdict
- do not claim multi-agent review if only a plan was generated
