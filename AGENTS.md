# stock-trend-assistant

## Agent skills

### Issue tracker

Issues live as GitHub issues on `arktikos004/Stock-Trend-Assistant`, driven through the
REST API with `curl` (no `gh` CLI on the development machine). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Team workflow (parallel multi-agent development)

For work that splits into independent vertical slices: PM plans tickets into waves,
one `Agent` + `isolation: "worktree"` per ticket in a wave, then review, integrate,
retro. See `docs/agents/team-workflow.md`.
