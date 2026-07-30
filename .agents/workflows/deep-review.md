---
description: 深度审查 — 模糊或高风险请求的苏格拉底式澄清
---

# Deep Review Workflow

Use this when the request is broad, ambiguous, or potentially high-risk.
Clarify before you execute.

## When to Use
- Request is vague ("improve performance", "fix this", "make it better")
- Request touches auth, security, data migration, or production systems
- Multiple valid interpretations exist
- Scope is unclear or potentially very large
- User says "don't assume" or "let's think about this first"

## When NOT to Use
- Request has specific file paths, function names, or error messages
- Simple bug fix with obvious solution
- User explicitly says "just do it"

## 1. Context Intake
- Gather codebase facts FIRST (don't ask the user what you can discover)
- Read relevant files, check git history, understand current architecture
- Create a brief context summary:
  - Task statement
  - Desired outcome (as understood)
  - Known facts from codebase
  - Constraints
  - Open questions

## 2. Clarify Intent (Ask ONE question at a time)
Focus order:
1. **Intent** — WHY does the user want this change?
2. **Outcome** — What end state do they want?
3. **Scope** — How far should the change go?
4. **Non-goals** — What should explicitly NOT be touched?
5. **Constraints** — Technical or business limits?
6. **Success criteria** — How will we know it's done?

Rules:
- Ask about intent and boundaries BEFORE implementation details
- Gather codebase facts via tools, don't ask the user for discoverable info
- Each question should probe assumptions, not just gather data
- If the user's answer is vague, follow up on the SAME topic before moving on

## 3. Pressure Test
Before proceeding to execution:
- Challenge at least one assumption from the answers
- Probe the simplest viable scope (could we do less?)
- Identify one thing the user would explicitly reject

## 4. Crystallize
When clarity is sufficient:
- Write a brief spec in the artifact/plan with:
  - Intent (why)
  - In-scope / Out-of-scope
  - Acceptance criteria (testable)
  - Assumptions made
  - Risks identified
- Present to user for confirmation before executing

## 5. Hand Off
- Transition to `/dev` workflow for implementation
- Or to `/deploy-verify` if changes need deployment
- Carry the spec as execution context

## Notes
- This is a CLARIFICATION mode, not an implementation mode
- Do NOT start coding during deep review
- Maximum 8 questions before crystallizing (hard cap)
- If the user wants to skip, respect that but note the risk
