# Issue tracker: GitHub Issues

Issues and specs for this repo live as **GitHub issues** on `arktikos004/Stock-Trend-Assistant`.

There is no `gh` CLI on the development machine. All operations go through the GitHub
**REST API** with `curl`.

## Authentication

Every write needs a token with the `repo` scope (a fine-grained token limited to this
repository with *Issues: read and write* is enough).

```bash
API="https://api.github.com/repos/arktikos004/Stock-Trend-Assistant"
TOKEN=$(cat ~/.config/github-issues-token)
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json")
```

Never echo `$TOKEN`, never paste it into an issue body, and never commit it. The file
lives outside the repo on purpose. A `401` means the token is missing or expired.

## Conventions

- **Create an issue**: `POST $API/issues` with `{"title": "...", "body": "...", "labels": ["needs-triage"]}`.
  Build multi-line bodies with a heredoc piped through `jq -Rs` so newlines are encoded correctly.
- **Read an issue**: `GET $API/issues/<number>` plus `GET $API/issues/<number>/comments`.
- **List issues**: `GET $API/issues?state=open&labels=<name>&per_page=50` (labels by **name**, comma-separated).
- **Comment**: `POST $API/issues/<number>/comments` with `{"body": "..."}`.
- **Apply labels**: `POST $API/issues/<number>/labels` with `{"labels": ["<name>"]}`.
  **Remove**: `DELETE $API/issues/<number>/labels/<name>`.
- **Close**: `PATCH $API/issues/<number>` with `{"state": "closed"}` (comment first for a closing note).

## Notes

- **Sub-issues**: express parent/child with a task list in the parent body plus a
  `Part of #<n>` line at the top of the child.
- **Blocking**: write `Blocked by: #<n>` as the first body line of the blocked issue.
- **Issues and PRs share one number space.** An issue payload carrying a `pull_request`
  object is a PR.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature
requests; `/triage` reads this flag.)_

This is a solo project with no external contributors, so the flag stays off.

## When a skill says "publish to the issue tracker"

Create a GitHub issue via the `POST $API/issues` call above.

## When a skill says "fetch the relevant ticket"

`GET $API/issues/<number>` plus its `/comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with one **child** issue per ticket.

- **Map**: an issue labelled `wayfinder:map` holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: an issue labelled `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`),
  with `Part of #<map>` as the first body line, and listed as a task-list item in the map body.
- **Blocking**: a `Blocked by: #<n>` first body line. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children, drop any with an open blocker or an
  assignee; first in map order wins.
- **Claim**: `PATCH $API/issues/<number>` with `{"assignees": ["<your username>"]}`, the
  session's first write.
- **Resolve**: comment the answer, `PATCH` the issue to `closed`, then append a context
  pointer to the map's Decisions-so-far.
