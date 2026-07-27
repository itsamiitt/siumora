# Siumora

## gstack

This project vendors [gstack](https://github.com/garrytan/gstack) — an AI builder skill
suite — under `.claude/`. It is committed to the repo, so every teammate and every
AI coding session gets the same skills on clone. No global install is required for the
skill playbooks; some browser/QA-heavy skills additionally need gstack's build step
(see "Full tooling" below).

### Layout

- `.claude/skills/gstack/` — the full gstack tree. Each subdirectory with a `SKILL.md`
  is a skill (the router lives at `.claude/skills/gstack/SKILL.md`).
- `.claude/commands/` — one slash-command wrapper per skill. Typing `/review`,
  `/qa`, `/ship`, etc. loads and runs the matching gstack skill.
- `.claude/agents/gstack.yaml` — the gstack agent manifest.

### Using gstack

Invoke a skill by its slash command, e.g. `/office-hours`, `/autoplan`, `/review`,
`/ship`. Each command reads the corresponding `SKILL.md` and follows it against this
repo. Use `/browse` for all web browsing rather than other browser tooling.
Reference gstack files by their vendored path, e.g. `.claude/skills/gstack/<skill>/SKILL.md`.

### Available commands

**Plan & strategy:** `/office-hours` `/autoplan` `/spec` `/plan-ceo-review`
`/plan-eng-review` `/plan-design-review` `/plan-devex-review` `/plan-tune`

**Review & QA:** `/review` `/qa` `/qa-only` `/design-review` `/devex-review`
`/cso` (security) `/health` `/investigate` `/learn`

**Design:** `/design-consultation` `/design-shotgun` `/design-html` `/diagram`

**Ship & deploy:** `/ship` `/land-and-deploy` `/canary` `/landing-report`
`/setup-deploy` `/document-release` `/document-generate`

**Browser:** `/browse` `/connect-chrome` `/open-gstack-browser` `/scrape`
`/skillify` `/setup-browser-cookies` `/benchmark` `/benchmark-models` `/pair-agent`

**iOS:** `/ios-qa` `/ios-fix` `/ios-clean` `/ios-sync` `/ios-design-review`

**Safety & session:** `/careful` `/guard` `/freeze` `/unfreeze` `/context-save`
`/context-restore` `/retro`

**gbrain / maintenance:** `/setup-gbrain` `/sync-gbrain` `/gstack-upgrade` `/codex`

### Full tooling (optional)

The vendored skills are complete as playbooks. The headless browser engine
(`.claude/skills/gstack/browse/`) and helper binaries need gstack's own build step
to be fully functional:

```bash
cd .claude/skills/gstack && ./setup
```

This requires the `bun` runtime and is only needed for browser-backed skills
(`/browse`, `/qa`, `/benchmark`). It is intentionally NOT run automatically.
