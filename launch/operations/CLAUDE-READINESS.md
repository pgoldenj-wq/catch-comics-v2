# Claude Code readiness — know before you need it

## The problem this removes

The old order of events was backwards:

1. Complete a Smoke Test page review.
2. Press **Send to Claude**.
3. *Then* be told Claude Code's sign-in had expired.
4. Open a terminal, remember the command, sign in, come back, retry.

Readiness is now checked when Command Centre opens, shown on its own card, and
fixed with one button.

## What the founder does now

1. Open Command Centre. The **Claude Code** card is near the top.
2. It says one of four things:

| Card | Means | Button |
|---|---|---|
| `Claude Code · Connected` | Installed, signed in, repo found | **Open Claude Code** |
| `Claude Code · Sign-in required` | Installed, signed out | **Sign in to Claude Code** |
| `Claude Code · Not installed` | The executable is not on this machine | Copy install command |
| `Claude Code · Repo not found` | Signed in, but this is not the catch-comics repo | Re-check |

3. If sign-in is required: press the button. A window opens **already in the
   repo** and runs the sign-in. Approve it in the browser. The card turns green
   by itself — no reload, no restart.
4. Press **Open Claude Code** whenever you want a session rooted in
   `catch-comics`. No PowerShell, no `cd`, no typing `claude`.

`Command Centre bridge offline` is a **fifth, separate** state. It is not a
sign-in problem and is never described as one: if the bridge is not running,
nothing can be asked and nothing pretends otherwise.

## One capability, two interfaces

```
Mission Control card ─┐
                      ├─▶ bridge 127.0.0.1:8319 ─▶ claude-readiness.mjs ─▶ Claude Code CLI
Smoke Test V4 chip  ──┘        /claude/status
                               /claude/signin
                               /claude/open
```

`launch/operations/claude-readiness.mjs` is the only thing on this machine that
decides what "ready" means. The Smoke Test does **not** run its own check: its
chip reads the same object, carried on `GET /review/health`, so the two surfaces
cannot disagree about whether Send-to-Claude will work.

## The CLI commands it uses

Read from the installed binary, not from memory. Claude Code **2.1.251**:

| Purpose | Command |
|---|---|
| Is it installed? | the executable itself, found on disk |
| Which version? | `claude --version` |
| Is it signed in? | `claude auth status --json` → `{ "loggedIn": true, … }` |
| Sign in | `claude auth login` |
| Open in the repo | `claude`, started with the repo as its working directory |

**Before changing any of these, run `claude auth --help` against the installed
binary and read what it actually says.** These moved once already
(`claude login` → `claude auth login`); assume they will move again. The test
suite asserts the commands against the installed CLI's own help output, so a
rename shows up as a test failure rather than a dead button.

## Polling

Nothing polls while idle. One read when a page opens; that answer is cached for
20 seconds.

Polling starts only when a sign-in has actually been launched: every 3 seconds,
stopping the moment it succeeds, and in any case after 10 minutes. Even then
`claude-readiness.mjs` refuses to spawn the CLI more than once every 2.5
seconds, so a stuck page cannot turn into a subprocess storm. If a sign-in is
abandoned, the state stays honestly at `Sign-in required`.

## Safety

- **No credential ever leaves.** Only `loggedIn`, the auth method, the account
  label and the plan are carried — the same things the CLI prints for you. A
  token in the CLI's output is not passed through, and nothing is logged.
- **The browser cannot supply a command.** Three fixed actions; the executable,
  the arguments and the working directory are all decided in
  `claude-readiness.mjs`. There is no code path from an HTTP request to an argv.
- **The repo is proved, not assumed** — `package.json` must exist and name
  `catch-comics` before anything is opened in it.
- **Console launches refuse shell punctuation** in a path or argument rather
  than passing it to `cmd`.
- **Local only** — 127.0.0.1, with the Command Centre origin allowlist that
  already guarded the other bridge actions.
- **Nothing is installed, and no consent is automated.** The browser approval
  Anthropic requires is done by you, in your browser, as normal.

## Fallbacks

Still there, no longer the journey:

- **Copy login command** on the card → `claude auth login`
- `npm run claude:status` → the same state, in the terminal
  (`-- --json` for the raw object; exit 0 when connected)

## Tests

```bash
npm run test:claude-readiness
```

Covers all four states, the precedence between them, the credential boundary,
the cache floor, the exact argv each button would hand to Windows, the repo
validation, the bridge's route closure — and asserts `claude auth status` /
`claude auth login` against the installed CLI's own help.
