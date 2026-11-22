# Founder Review handoff — one click from Smoke Test to a Claude repair

## What the founder does

1. Open the Command Centre (`open-command-centre`), go to Smoke Test V4.
2. Review a page. Write each problem in its own **Issue** box; optionally say
   what you expected instead.
3. Paste screenshots (`Ctrl`+`V`), draw on them, and set **Belongs to** on each
   one so it is attached to the issue it is evidence for.
4. Mark the page **Looks good** or **Needs fixing**.
5. Press **SEND \<PAGE\> TO CLAUDE**.
6. **A new Claude Code window opens by itself and starts repairing.** Watch it,
   interrupt it, or ignore it — the Smoke Test tracks it either way.

That is the whole journey. You never open Claude, never open PowerShell or
Windows Terminal, never `cd` anywhere, never paste a kickoff command, never
find `review.md`, never move a screenshot and never retype a note. **There is
no manual Claude kickoff in the normal founder workflow.** If a document tells
you to paste a command, it is describing the fallback for a broken bridge.

## What happens on that click

```
Smoke Test V4  ──POST /review/submit──▶  local bridge (127.0.0.1:8319)
                    review + images                │
                                                   ├─▶ launch/reviews/<reviewId>/      the durable package
                                                   ├─▶ launch/founder-review.json      Mission Control's row
                                                   ├─▶ git worktree add  ../catch-comics-repairs/<reviewId>
                                                   ├─▶ mark that worktree trusted      (or the session stalls on a dialog)
                                                   ├─▶ launch.json                     everything claude is started with
                                                   └─▶ cmd /c start "Catch Comics Repair — <Page>"
                                                          └─▶ repair-session.mjs --run <package>
                                                                 └─▶ claude  (VISIBLE, interactive)
                                                                       cwd = the worktree, never your checkout
```

The bridge is `browser-trust-bridge.mjs` — the same one behind "Run Browser
Trust" — the review logic lives in `founder-review-handler.mjs`, and the window
and its reporting live in `repair-session.mjs`.

## The visible window

Until 2026-09-01 the repair ran headless: correct, durable, and invisible. You
pressed Send and got a spinner for eight minutes with no way to watch, steer or
stop it. It now opens a real terminal window, titled
**`Catch Comics Repair — <Page>`**, running a normal interactive Claude Code
session. You can read what it is doing, interrupt it, and talk to it when it
finishes.

Three things had to be true for that to work, and all three were measured on
this machine rather than assumed (CLI 2.1.251, Windows 11):

| Fact | Consequence |
|---|---|
| Node's `detached: true` gives a new console but **no tty** — libuv always sets `STARTF_USESTDHANDLES`, so the TUI will not render | the window is created by `cmd /c start`, not by spawn flags |
| An interactive session in a directory with **no persisted trust** stops on the trust dialog and never sends a turn | the bridge marks each new worktree trusted in `~/.claude.json` first — the CLI's own documented remedy |
| An interactive session **does not write its transcript to disk** while it runs; the file at `transcript_path` is not there even at `Stop` | progress and the final report come from **hooks**, not from tailing a file |

### The argv trap, written down so it cannot come back

`--allowedTools` and `--disallowedTools` are **variadic**: they swallow every
argument up to the next flag. With the prompt at the end it became the 93rd
value of `--disallowedTools`, and the session opened perfectly — right
worktree, right name, right permissions — and **sat at an empty prompt with no
turn ever sent**. Twice, before anyone looked at the screen.

The kickoff is therefore the **first** argument, where no variadic option can
reach it, and `test:founder-review` asserts that nothing positional ever trails
a variadic option again.

### The kickoff is one line

The standing instruction is written to `repair-instructions.md` inside the
package. The command line carries only:

> Read `launch/reviews/<id>/repair-instructions.md` and follow it exactly, starting now.

No founder text ever reaches a command line. The prompt, the settings JSON and
the allow/deny lists travel in `launch.json` and are handed to claude as an argv
array with no shell involved — the only things on the `cmd.exe` line are paths
the bridge generated and a window title built from the page **id**, which comes
from a fixed list.

### What it costs

`--max-budget-usd` only works with `--print`, so a visible session has no hard
spend ceiling. The ceiling it has instead is you: you can see what it is doing
and stop it, which is the whole reason for the change.

## Where the repo comes from

The bridge resolves the repo from its own location on disk (it lives at
`<repo>/launch/operations/`) and reports it at `GET /review/health`. The Smoke
Test only ever *displays* that value, in the chip at the top right. This is
what replaced the old per-handoff `showDirectoryPicker()` step: the repo is
established once, by the tooling, not chosen again for every review.

The old picker still exists as a **fallback**, hidden unless the bridge is
unreachable.

## The package

```
launch/reviews/<page>-<yyyy-mm-dd-hh-mm>-<id>/
  review.json          issues, issue→screenshot mapping, checkpoints, verdict
  review.md            the same review as prose
  screenshots/
    issue-01-shot-1.jpg    evidence for issue-01
    page-shot-1.jpg        about the page in general
  repair-instructions.md   the standing instruction the session opens and follows
  launch.json          exactly what claude was started with — argv, cwd, branch
  session.json         the wrapper's own pid, written before claude starts
  claude-run.jsonl     the run's evidence, appended by the recorder hooks
  stop.json            the repair reported back, with Claude's own closing words
  exit.json            claude exited, and with what code
  run.json             what the launch did (state, pid, outcome, full report)
```

Every filename is generated by the bridge from an index. The browser cannot
name a file, name a directory, or reach the command line — see the header of
`founder-review-handler.mjs` for the full boundary.

`launch/reviews/` is gitignored. Packages are local evidence and stay local.

`run.json` also records `worktreePath`, `branch` and `baseCommit` — where the
repair worked, what it committed on, and what it started from.

## Where the repair works — its own worktree, not yours

A repair never runs in your checkout. Before Claude is spawned the bridge makes
it a git worktree of its own:

```
Documents/CatchComics/
  catch-comics/                         ← yours. Untouched.
  catch-comics-repairs/
    <reviewId>/                         ← branch repair/<reviewId>, cut from HEAD
      node_modules   → junction to yours, so tsc/eslint/tsx actually run
      launch/reviews/<reviewId>/        ← the package, copied in (it is gitignored)
```

**Why.** The repair needs to commit — a repair that cannot commit leaves
unverified edits lying loose, which is exactly how `lib/identity/format.ts`,
`lib/search/priceFilter.ts` and `scripts/test-format-and-price-filter.ts` ended
up in the tree with no commit behind them. But your checkout is not a safe place
to hand an unattended session git-write rights: other Claude sessions edit this
repo live, the dev server runs against it, and it routinely carries two dozen
dirty files that are none of the repair's business. So the repair gets rights in
a tree where the only things present are HEAD and its own edits.

**Consequences worth knowing.**

- The branch is cut from **HEAD**, so the repair does not see your uncommitted
  work. If you have already half-fixed the thing you are reporting, the repair
  will fix it again from the committed state. That is deliberate: its diff is
  reproducible, and nothing it does can collide with your edits.
- The repair's commits are **local, on `repair/<reviewId>`**, in the shared
  object store. They are not pushed and not merged — see below.
- A retry **reuses** the same worktree and branch, so it continues the same
  repair rather than forking a second one.
- Worktrees are **not cleaned up automatically**, because the commit inside one
  is the deliverable. When you have taken what you need from it:

```bash
node -e "import('./launch/operations/repair-worktree.mjs').then(m=>m.removeRepairWorktree(process.cwd(),'<reviewId>'))"
```

  Use that rather than `git worktree remove` on its own, which leaves the
  `node_modules` junction standing so the directory survives and the next
  attempt at the same review cannot recreate it. **Never** delete a worktree
  with a recursive delete: it follows that junction into your real
  `node_modules`. `removeRepairWorktree` unlinks it first, after checking it
  really is a link, and leaves the `repair/<reviewId>` branch — and therefore
  the commit — alone.

If the worktree cannot be made, the run is `blocked` — never a silent fallback
into your checkout.

## What the repair may run — the permission boundary

Founder decision, 2026-08-31. Before it, the session ran with `acceptEdits` and
four deny rules, and **every** Bash command was refused: the 2026-08-29 repair
could not typecheck, could not run a test and could not commit. It burned nine
turns retrying spellings of "typecheck" and gave up.

`bypassPermissions` was offered and **declined**. What shipped is an allowlist,
and the session is **default-deny**: a command not named below is refused.

**Allowed — verification** (`npm run …`, arguments and `2>&1 | tail -n` fine):

```
check   lint
test:identity  test:url-filters  test:search-ranking  test:price-check
test:sync-backoff  test:traversal-safety  test:containment  test:ebay-uk
test:secrets  test:isbn  test:browser-trust  test:retailer-card
test:founder-review  test:claude-readiness
```

Every one is a pure local check — no database client, no network, no
`.env.local`, no paid API. A script is listed here only once it exists at HEAD:
an advertised permission that cannot run from a clean worktree is a lie, and
the gate below refuses it at runtime anyway.

**Allowed — git, inside the repair worktree:**

```
git status / diff / log / show / rev-parse
git branch --show-current / --list          (inspection only)
git add <path>                               path-scoped
git commit
```

Branch creation is **not** granted. The bridge checks the worktree out on
`repair/<reviewId>` before Claude starts, so `git checkout -b` and
`git switch -c` were permission surface with nothing behind them. `git checkout`
and `git switch` are now denied outright in both directions.

**Denied, permanently:** `git push`, `vercel`, `npx vercel`, `gh pr merge` (and
`gh` altogether); `git stash`, `reset`, `clean`, `restore`, `checkout -- .`,
`rebase`, `merge`, `cherry-pick`, `revert`, `worktree`, `tag`, branch delete and
rename; `git add -A` / `.` / `-u` and `git commit -a` / `-am`; `git -C`,
`--git-dir`, `--work-tree`; `npx` and `npm install/ci/exec/publish`; and every
`db:`, `purge:`, `cleanup:`, `backfill:`, `enrich:`, `seed:`, `ingest:`,
`sync:` and `test:e2e*` script in `package.json`.

**Why each script is named in full.** The CLI's matcher, measured on 2.1.251,
stops at a token boundary: `Bash(npm run check:*)` matches `npm run check` and
`npm run check 2>&1 | tail -30`, but **not** `npm run check:cost-hazards`. A
`test:*`-style wildcard would not even grant the `test:xyz` scripts — and a
script added tomorrow cannot inherit an existing rule. That is what keeps this
list bounded as `package.json` grows, and the handoff test asserts it.

The repair prompt lists these commands verbatim, generated from the same
constants, so it cannot drift from what the session is actually permitted to do
— and so a repair stops and reports instead of hunting for another spelling.

Deny rules beat allow rules, and beat `bypassPermissions` too, so the four
shipping refusals hold no matter what a future change does to the allow list.

## The hole an allowlist alone leaves, and the gate that closes it

An allowlist authorises command **strings**. The repair can edit **files**. So
`npm run check` meant "run whatever `check` has been redefined to mean".

That was measured, not theorised. On 2026-08-31, against the real CLI in a
throwaway repo, a session rewrote `package.json` so `check` was
`echo PWNED-VIA-PACKAGE-JSON`, ran `npm run check`, and it executed — **zero
permission denials**. The sibling case worked too: leave the script definition
innocent and rewrite the runner it invokes.

`verification-integrity.mjs` closes both. It is a **PreToolUse hook**, wired on
the argv and addressed in the *founder's* checkout — not the worktree copy — so
the repair can neither edit the gate nor find a settings file to rewrite. Before
any gated `npm run <script>` executes, it compares against the repair's base
commit:

- the script's definition in `package.json`, and
- every repo file that definition names as its entrypoint.

Unchanged → it runs. Changed, or **not present at base** → refused, with the
reason stated plainly to the session.

**What is deliberately not checked:** the application and library code *under*
test. A repair exists to edit `lib/` and `app/` and then run the approved suite
over its changes. Only the mechanism is frozen; never the subject.

**A consequence worth knowing:** a repair cannot write a new test and then run
it — a runner that did not exist at base is not a reviewed mechanism. The prompt
tells it to write the test, say so, and leave it for a human. That is the
property working.

Proven end to end in a real repair worktree with the shipped argv: with
`check` redefined and `test-edition-identity.ts` tampered, both were refused by
the gate, the marker never executed, and untouched `npm run lint` still ran.

## The states, and why `blocked` is not `failed`

| State | Means |
|---|---|
| `sending` / `packaging` | The browser is encoding the review |
| `packaged` | Every file is on disk and verified non-empty |
| `launching` | The terminal has been asked to open, and has not proved it yet |
| `running` | The wrapper inside the window wrote its pid to `session.json` **and** that pid is alive |
| `completed` | Claude exited 0 and did not report an error — **the process, not the repair**; see the outcome table below |
| `failed` | Claude ran and something went wrong |
| `blocked` | The *environment* stopped Claude starting |
| `stale` | A repair was started and nobody can say how it ended |

`blocked` covers "Claude Code is not installed", "not signed in", and "another
repair is already running". None of those are a product failure and none of
them lose the review: the package is already written, and the button becomes
**Retry sending to Claude**, which reuses the same package rather than writing
a second one.

`stale` exists because the card once showed **Claude repair running** for a
repair that had already exited. Two things caused it and both are fixed: the
page kept polling a bridge that was no longer answering and treated silence as
"still working", and the bridge kept its run registry only in memory, so a
restart answered 404 for the very run the founder was watching and the spinner
had nothing left to resolve against.

Now the bridge reads every `run.json` back at startup, and any run left
mid-flight by a previous session is settled to `stale` rather than re-claimed as
running — this process did not start it and cannot prove what became of it. The
page does the same from its side: after ~20 seconds of unanswered polls it stops
claiming a repair it can no longer see. `stale` is retryable exactly like
`blocked` and `failed`, against the package already on disk.

`running` is never inferred from a launch request, a saved package, a stored
status or a 200 from the bridge. The pid the bridge watches is the **wrapper's**,
not `cmd.exe`'s: cmd exits the moment the window is up and proves nothing about
the session inside it. Until `session.json` exists the card says
**Opening Claude Code…**, and if no window appears within the grace period the
run is `blocked` with *Could not open Claude Code* — it never claims a terminal
that is not there.

### If you close the window

Three files decide what happened, and their order is the whole honesty of it:

> `stop.json` beats `exit.json` beats the pid.

- Closed **before** it reported back → `stale` or `failed`. Never "fixed",
  whatever it had already edited. Continue/Retry reuses the same package,
  branch and worktree, so nothing is rebuilt.
- Reported back and **then** closed → `completed`, and the report stands. The
  terminal is not the source of truth, and the report never depends on it
  staying open.

A finished window is left on screen deliberately, so you can read Claude's last
message and carry on talking to it. Closing it changes nothing already recorded.

This mirrors the PASS / FAIL / BLOCKED model the Browser Trust runner uses, for
the same reason: a run that never started is not evidence of anything.

## The outcome, which is not the state

A process exiting is not a defect being repaired. Until 2026-09-01 the card
said **Claude repair complete** on the strength of exit code 0 alone, and the
2026-08-30 Search run is what that cost: it exited 0 having committed nothing,
with both of its checks refused, and its own final message said so — under a
green headline, in a 300-character slice nobody read to the end of.

So a finished run now carries a second, separate verdict. `state` says whether
the process ended. `report.outcome` says whether the work got done, and it is
the one the card leads with.

| Outcome | Means | Button |
|---|---|---|
| `verified-local` | Changed, verified and committed on its own branch | Send again |
| `incomplete` | Changed something, but a check failed or nothing was committed | **Continue this repair** |
| `no-change` | Claude changed no code at all | **Continue this repair** |
| `failed` | The repair did not complete | Retry |

**Nothing tops out above `verified-local`, ever.** An unattended repair cannot
push, merge or deploy — those are refused — so nothing it does is evidence
about production. Every verified report says that outright and lists the three
steps that are still yours: integrate, deploy, re-check the page live.

### What the report is made of

Two kinds of evidence, kept apart on purpose:

- **From git, in your checkout** — the commits, and anything left uncommitted
  in the repair worktree. A repair cannot write a commit into existence by
  claiming one, and anything you would act on comes from here.
- **From the transcript** — which verification commands ran and whether the
  command itself errored, which files were edited, what was refused. These are
  the stream's own `tool_result` records, not Claude's summary of them.

A failing check outranks a commit that exists, because a repair can commit a
broken change and every other signal would still look green. A check that
failed and was then re-run and passed counts as passed — it is keyed by script,
at its final result.

Claude's own report is kept whole at the bottom of the panel, as the author's
account rather than the verdict, and written to `<package>/report.md` so it
outlives the browser. The whole report is stored in `run.json`, so it survives
a page reload, a bridge restart and the worktree being removed.

### What it must never do

`recordRepairOutcome` writes exactly one new key — `repair` — onto the page in
`launch/founder-review.json`. It does not touch `status`, `resolution`,
`resolvedAt` or your evidence counts. Those are your verdict on what you saw on
production, and a local commit is not evidence about production. A bridge that
flipped a page to fixed because a commit exists would be inventing the one fact
you actually need. The handoff test asserts this directly.

### Continue

An `incomplete` or `no-change` run is retryable on the **same** reviewId, so
the bridge reuses the package on disk, the branch that already holds the first
attempt's commits, and the worktree that already holds its edits. The prompt
tells the session not to revert them, so Continue genuinely continues. A
`verified-local` run is refused as a duplicate — there is nothing left to do.

## If it says "Claude Code is signed out"

Press **Sign in to Claude Code** — in the Smoke Test header, on the send card,
or on the Claude Code card in Mission Control. A window opens in the repo and
runs the sign-in; you approve it in the browser; the page notices by itself.
Then press **Retry sending to Claude**: the saved review is handed over
unchanged, screenshots and all, and nothing needs re-typing.

You are told this **before** you start a review, not at the moment you press
Send — see [CLAUDE-READINESS.md](CLAUDE-READINESS.md).

The manual fallback, if you ever want it, is `claude auth login`.

## Retry safety

A submission carries a stable `reviewId`, generated once and reused by every
retry. The bridge keys its run registry on it, so:

- a double- or triple-click produces **one** package and **one** Claude process;
- a retry after `blocked`, `failed` or `stale` relaunches against the package
  already on disk instead of writing a second copy;
- two different pages cannot repair at the same time — the second is `blocked`
  with "a repair is already running", and its review is still saved.

That last refusal is now checked against reality before it is made: a lock held
by a child that has since exited is released rather than enforced, so a dead run
can never lock the founder out of the next one. The check is deliberately
limited to what can be proven — a live child *this* bridge is holding. A pid
recovered from a previous bridge's `run.json` is recorded but never used to
refuse a launch, because pids are reused and refusing on one would block a
founder on a guess.

## Tests

```bash
npm run test:founder-review      # the handoff itself
npm run test:claude-readiness    # the readiness capability behind the buttons
```

`test:founder-review` drives the real handler with a deterministic four-issue,
four-screenshot review and a fake Claude binary: no money spent, no repo edits,
no sign-in needed. It covers path traversal, MIME smuggling, issue↔screenshot
mapping, the launch argv, every state, the duplicate/retry rules, and the
signed-out path — that a signed-out machine is caught *before* Claude is
launched, that the package and every screenshot survive it, and that Retry
after signing in reuses that same package.

Two of its sections cover the permission boundary specifically:

- **What an unattended repair is allowed to run** asserts on real command
  strings, not on argv spelling: that `npm run check` (piped form included),
  lint, the approved tests, path-scoped `git add` and `git commit` are allowed;
  that `git push`, vercel, `gh pr merge`, destructive git, broad staging,
  database and catalogue writes, production E2E, `npx`, unapproved scripts and
  colon-suffixed siblings of approved scripts are all refused; that every
  dangerous script actually present in `package.json` is refused (79 of them
  today, re-read from disk each run, so new ones are covered); and that the
  argv never becomes `bypassPermissions`.
- **The repair worktree leaves the founder's tree alone** builds a real git
  repository with a dirty tracked file, a staged change and untracked files,
  makes a real worktree, commits in it, and asserts the founder's branch, HEAD,
  index, dirty files, untracked files and full `git status` are byte-for-byte
  unchanged.

- **A verification command runs the reviewed mechanism** covers the integrity
  gate: an approved unchanged script and its committed runner are permitted;
  application code under test can change freely and still be tested; a redefined
  script definition and a tampered runner are both refused, with the refusal
  naming which one; a script absent at the base commit is refused; and the gate
  is proven to be addressed in the founder's checkout with no settings file on
  disk to rewrite.

The rules were also proven end to end against the real CLI (2.1.251) in a real
repair worktree on 2026-08-31: `npm run check` and a focused `git add` +
`git commit` ran; `git push --dry-run`, `git add -A`, `npm run check:cost-hazards`,
`npx tsc --version` and `git stash` were all refused by the CLI itself. In a
second run with the mechanism deliberately tampered, `npm run check` (redefined)
and `npm run test:identity` (rewritten runner) were both refused by the gate
while untouched `npm run lint` still ran.

### Independent re-verification, 2026-08-31 (second session, CLI 2.1.251)

The claims above were re-tested from scratch by a session that had not written
them, using throwaway git repos and a **filesystem side effect** as the marker.
A transcript can quote a string; only execution can create a file, so
`existsSync()` is the evidence rather than grepping output — the first attempt
at this probe was misleading precisely because the model quoted a refusal that
contained the marker text.

| Probe | Gate | Side effect on disk | CLI denial |
|---|---|---|---|
| `package.json` "check" redefined | off | **file created** | none |
| same | **on** | none | `npm run check` |
| runner `scripts/verify.mjs` rewritten | off | **file created** | none |
| same | **on** | none | `npm run check` |
| only `lib/` (subject) edited | on | reviewed runner ran | none |

Both bypasses are real on this CLI, and both are closed. The positive control
matters as much as the refusals: with the gate on and application code edited,
the approved script still ran — a repair can still repair.

Reproduce: throwaway repo whose `check` is `node scripts/verify.mjs`, commit as
base, mutate one of the two, then run the CLI with `--allowedTools
'Bash(npm run check:*)'` with and without `--settings` carrying the hook.
