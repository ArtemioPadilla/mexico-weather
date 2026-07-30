# Next Work Cycle Implementation Plan (2026-07-29)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the repo's accumulated hygiene debt, land the stale dependency
updates, fix the one real remaining cold-load map bug (an rAF-gated boot on
`/forecast`) behind a regression test, and close the genuine mobile-UX gaps that
survived PR #296 — while correcting the ROADMAP, which is stale in three places.

**Architecture:** Four independent tracks, each shippable and revertible on its
own. Track A is local/repo hygiene, B is dependency merges (no local code), C is
the map boot path, D is mobile UX. **C and D are independent subsystems** and
could legitimately be separate plan documents; they are kept together here
because each is only 2–4 PRs and they share no files. Tracks may be executed in
any order, or dropped, without breaking the others. Within a track, tasks are
sequential.

**Tech Stack:** Astro 6, TypeScript 6, Tailwind **v4** (CSS-first via
`@tailwindcss/vite` + `@theme` in `src/styles/global.css` — there is **no**
`tailwind.config.js`), MapLibre GL 5, Vitest 4 (node env; jsdom per-file via
`// @vitest-environment jsdom` pragma), Playwright 1.60 (single headless
`chromium` project against the production build), Python 3 for data scripts.

## Global Constraints

- **Hard product constraints — do not regress:** no tracking, no cookies, no
  accounts, no API keys, no backend. `public/sw.js` has **no fetch handler** by
  design (scope-claimer only).
- Node `>=22` (`package.json` `engines`).
- UI copy is **Spanish-first**; English comes from `data-i18n-en` /
  `data-i18n-en-aria-label` attributes and keys in `src/i18n/ui.ts`. Every new
  user-visible string needs both.
- **`e2e/**` is excluded from both `eslint` (`eslint.config.js:22`) and
  `tsconfig.json` `include`.** No new spec gets lint or type checking — the only
  verification for e2e code is running it. Never treat `npm run lint &&
  npm run type-check` as a gate on a spec file.
- **Line numbers in this plan go stale the moment an earlier task edits the same
  file.** Every task that cites one must `grep` for the anchor text first. Tasks
  C4, D2 and D3 all edit files that earlier tasks touch.
- Every PR must pass, locally, before opening: `npm run lint`,
  `npm run type-check`, `npm test`, `npm run build`, `npx playwright test`.
- Baseline to preserve: **448 unit tests (51 files)**, **103 e2e (20 specs)**
  green. Any change to those numbers must be intentional and stated in the PR body.
- Never commit directly to `main`; branch + PR. The repo squash-merges (this is
  why 141 local branches read as "unmerged" — see Task A2).
- Commit subjects follow Conventional Commits. When a commit maps to a ROADMAP
  story, put the tag in the subject: e.g. `feat(mobile): … (Story 11.2)`.
- e2e baseURL is `http://localhost:4321/mexico-weather/` (override port with
  `PREVIEW_PORT`); `page.goto('')` is the homepage. The trailing slash in the
  base path is load-bearing.
- Scratchpad for throwaway files (never inside the repo):
  `/private/tmp/claude-501/-Users-artemiopadilla-Documents-repos-GitHub-personal-mexico-weather-site/6c1eca41-0df5-4675-947a-0367b336ecb7/scratchpad`
  — referred to below as `$SP`.

## Findings that change the plan (read before starting)

Three ROADMAP claims are stale. The plan implements the corrected reality, and
Task A4 fixes the document.

1. **Story 11.1's hamburger already shipped** in PR #296 —
   `src/layouts/BaseLayout.astro:462` `<details id="mobile-menu" class="relative sm:hidden">`
   with a 44×44 `<summary>`, 7 destinations, Esc-to-close and focus restore.
   What is actually missing: no e2e coverage at all, no close-on-focus-leave,
   `role="menu"`/`role="menuitem"` used without the keyboard semantics that role
   contract requires, and 4 footer-only destinations that are unreachable on
   `/mapa` (which passes `noFooter`). Track D1 addresses exactly that residue.
2. **Story 11.2's premise is half-wrong.** The header nav links it names
   (28px) are `hidden sm:inline-block` — desktop-only, therefore not a mobile
   tap-target problem at all. The genuinely mobile-visible small targets are the
   mobile-menu items (36px), footer links (**32px**, `text-xs` + `py-2`), the
   timeline buttons (**24px** each — `text-base leading-none` + `py-1`, all
   three, not the 18/32 an earlier draft guessed) and four `h-9 w-9` (36px) map
   buttons. Track D2 retargets to those.
   Separately, `e2e/mobile-audit.spec.ts:106` uses
   `if (effectiveW < 44 && effectiveH < 44)` — it passes any element ≥44px in
   **either** axis, which is why 36px-tall full-width links never failed.
3. **E10's smoking gun is already located.** `src/pages/forecast.astro:1075`
   wraps the entire `initInteractiveMap()` call in a bare
   `window.requestAnimationFrame(...)` — the exact antipattern PR #289 removed
   from `InteractiveMap.astro:716`. `/forecast` does not use
   `InteractiveMap.astro`; it calls the factory directly, so it never got the
   #289 fix. rAF does not fire in hidden/throttled tabs, so on `/forecast` the
   map does not merely fail to paint — **it never boots**. This predicts Story
   10.1's gate resolves as "cannot reproduce in foreground", which per the
   ROADMAP demotes E10 to P2. Track C therefore separates the *unconditionally
   correct* one-line fix (C2) from the *evidence-gated* removal of the historic
   nudge stack (C4), and inverts the ROADMAP's order by building the regression
   test (10.3) **before** deleting any nudge (10.2's third bullet).
4. **`map.triggerRepaint()` is itself rAF-based**, so ROADMAP Story 10.2's first
   bullet ("after `map.once('load')` call `map.triggerRepaint()` unconditionally
   — don't rely on a frame the browser may never schedule") is technically void.
   From `node_modules/maplibre-gl/dist/maplibre-gl.js`:
   `triggerRepaint(){this.style&&!this._frameRequest&&(this._frameRequest=new AbortController,n.frame(…))}`
   where `n.frame` is `requestAnimationFrame` — and the `!this._frameRequest`
   guard makes it a no-op whenever a frame is already pending, which at
   `map.on('load')` time it almost always is. This plan therefore does **not**
   add a "synchronous repaint" (an earlier draft did; the adversarial review
   killed it), and Task A4 corrects that ROADMAP bullet.
5. **`bringToFront()` does not background a Playwright page.** Verified by
   execution in this repo, headless *and* headed, PW 1.60: `visibilityState`
   stays `visible` across `context.newPage()` + `bringToFront()`. Any "hidden
   tab" test built on it is vacuous. Track C instead **stubs
   `requestAnimationFrame` so it never fires**, via `page.addInitScript` — that
   reproduces the exact failure mechanism deterministically, and it is the only
   assertion in this plan that fails before C2's fix and passes after.
6. **Both `/mapa` and the `/forecast` embed already paint pre-interaction on
   unmodified `main`** — measured 64×64 luminance variance: `/mapa` 270 at 1s
   settling to 114; `/forecast` **0 at 1s, 21 at 3s, 45 at 5s**. So C3's pixel
   spec is a **regression lock for C4's deletions**, not a fail-before test for
   C2 — and the `/forecast` embed currently **misses** Story 10.2's "≤3s"
   acceptance criterion. That is a finding to record, not a threshold to soften.

---

# Track A — Repo hygiene

Three of four tasks are local-only or docs-only. Task A2 and A3 are
**destructive**; both have explicit confirmation gates. Do not batch them past
the gate without the human saying yes.

### Task A1: Ignore Python bytecode

**Files:**
- Modify: `.gitignore` (append; file currently ends with the Playwright block)

**Interfaces:**
- Consumes: nothing.
- Produces: a clean `git status --porcelain` on a repo where the Python scripts
  have been run. Later tasks in every track rely on `git status --porcelain`
  being empty to detect their own changes.

- [ ] **Step 1: Confirm the pollution exists and is untracked**

```bash
git status --porcelain
git ls-files | grep -c '__pycache__' || echo "0 tracked (expected)"
```

Expected: two `??` lines (`scripts/__pycache__/`, `scripts/smn-rss/__pycache__/`)
and `0 tracked`. If any `__pycache__` file is **tracked**, stop and add
`git rm -r --cached` for those paths to Step 2 — untracking is a real change
that belongs in the same commit.

- [ ] **Step 2: Append the ignore rules**

Append to `.gitignore`:

```gitignore

# Python bytecode from scripts/ (data fetchers, smn-rss)
__pycache__/
*.py[cod]
```

- [ ] **Step 3: Verify the working tree is now clean**

```bash
git status --porcelain
```

Expected: exactly one line — ` M .gitignore`. Nothing else.

- [ ] **Step 4: Commit**

```bash
git checkout -b chore/gitignore-pycache
git add .gitignore
git commit -m "chore: ignore Python bytecode from scripts/"
```

---

### Task A2: Prune squash-merged branches (destructive — gated)

**Files:**
- Create: `$SP/prune-branches.sh` (scratchpad only — **not** committed; this is
  a one-off local op, not repo surface)
- Create: `$SP/safe-delete.txt`, `$SP/needs-review.txt` (reports)

**Interfaces:**
- Consumes: nothing.
- Produces: a smaller `git branch` listing. No code artifacts other tasks depend on.

Context (numbers verified by running the classifier below, read-only): **344
refs, 147 local branches** (146 non-main), of which 142 read as "unmerged" per
`git branch --no-merged main` purely because the repo squash-merges. Exact
tip-SHA matching against `gh pr list --state merged` gives:

- **140** branches whose tip SHA equals their merged PR's `headRefOid` → safe.
- **5** with no merged PR at all: `audit-fix-skip-target`, `refactor-layer-rail`,
  `refactor-msg-toast`, `refactor-timeline-chrome`, `try-maplibre-v5`.
- **1** whose tip diverged from its merged PR head: `p0-2-legend-horizontal` —
  it has commits that never went through the PR. Triage it with the orphans.

(An earlier draft said "141 of 142, only 5 orphans", which is arithmetically
impossible — it conflated the `--no-merged` count with the branch total.)

Name-matching alone is not sufficient evidence — a branch may have gained
commits after its PR merged. The script below compares the local tip SHA to the
PR's recorded `headRefOid` and only greenlights exact matches.

- [ ] **Step 1: Write the classifier script**

Create `$SP/prune-branches.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
SP="${SP:?set SP to the scratchpad path}"
cd "$(git rev-parse --show-toplevel)"

gh pr list --state merged --limit 500 \
  --json headRefName,headRefOid,number \
  -q '.[] | [.headRefName, .headRefOid, (.number|tostring)] | @tsv' \
  | sort -u > "$SP/merged-prs.tsv"

: > "$SP/safe-delete.txt"
: > "$SP/needs-review.txt"

while read -r br; do
  [ "$br" = "main" ] && continue
  local_sha="$(git rev-parse "$br")"
  line="$(awk -F'\t' -v b="$br" '$1 == b { print; exit }' "$SP/merged-prs.tsv")"
  if [ -z "$line" ]; then
    printf '%s\tNO_MERGED_PR\t%s\n' "$br" "$local_sha" >> "$SP/needs-review.txt"
    continue
  fi
  pr_sha="$(printf '%s' "$line" | cut -f2)"
  pr_num="$(printf '%s' "$line" | cut -f3)"
  if [ "$local_sha" = "$pr_sha" ]; then
    printf '%s\t#%s\n' "$br" "$pr_num" >> "$SP/safe-delete.txt"
  else
    printf '%s\tTIP_DIVERGED_FROM_PR_#%s\tlocal=%s\tpr_head=%s\n' \
      "$br" "$pr_num" "$local_sha" "$pr_sha" >> "$SP/needs-review.txt"
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/heads)

printf 'safe to delete: %s\nneeds review:   %s\n' \
  "$(wc -l < "$SP/safe-delete.txt")" "$(wc -l < "$SP/needs-review.txt")"
```

- [ ] **Step 2: Run it (read-only) and read both reports**

```bash
SP="$SP" bash "$SP/prune-branches.sh"
cat "$SP/needs-review.txt"
head -20 "$SP/safe-delete.txt"
```

Expected shape: **140 safe, 6 needing review** (5 no-PR + `p0-2-legend-horizontal`
diverged). If `safe-delete.txt` is suspiciously large (>150) or
`needs-review.txt` is empty, the `gh` query truncated — re-run with
`--limit 1000` before proceeding.

- [ ] **Step 3: CONFIRMATION GATE — show the human the counts and the
      needs-review list, and get an explicit yes before deleting anything.**

Do not proceed on inference. Deleting local branches is recoverable via
`git reflog` for ~90 days, but the human decides.

- [ ] **Step 4: Delete the safe set**

`git branch -d` refuses squash-merged branches (git cannot see the merge), so
`-D` is required here. That is exactly why Step 1 verifies tip == PR head first.

```bash
cut -f1 "$SP/safe-delete.txt" | while read -r br; do git branch -D "$br"; done
git branch | wc -l   # expect 7 (main + 5 orphans + p0-2-legend-horizontal)
```

- [ ] **Step 5: Triage the 6 survivors individually — do not bulk-delete**

For each, determine whether its content landed under a different branch name.
`p0-2-legend-horizontal` needs the most care: it has commits its merged PR never
saw, so `git log --oneline main..p0-2-legend-horizontal` is possibly-unlanded
work. Read it before proposing anything.

```bash
for br in audit-fix-skip-target refactor-layer-rail refactor-msg-toast \
          refactor-timeline-chrome try-maplibre-v5 p0-2-legend-horizontal; do
  echo "=== $br"
  git log --oneline main.."$br" | head -5
  git log --oneline "$br"..main | wc -l
done
```

`audit-fix-skip-target`'s tip subject already cites `(#286)`, so it is very
likely a renamed-branch artifact of a merged PR — verify with
`gh pr view 286 --json headRefName,mergedAt`. Keep any branch holding unlanded
work (the three `refactor-*` and `try-maplibre-v5` are candidate future work —
`try-maplibre-v5` is superseded, maplibre-gl is already `^5.24.0`). Report the
verdicts; delete only what the human approves.

- [ ] **Step 6: Prune stale remote-tracking refs, and stop the leak at source**

```bash
git remote prune origin --dry-run   # review
git remote prune origin
gh api repos/:owner/:repo --jq '.delete_branch_on_merge'
```

If that returns `false`, propose enabling it (it is why the remote accumulated
refs). Enabling it changes repo settings — ask first:

```bash
gh api -X PATCH repos/:owner/:repo -f delete_branch_on_merge=true
```

Deleting **remote** branches (`git push origin --delete`) is outward-facing and
is **not** part of this task. Only offer it as a follow-up with its own
confirmation.

- [ ] **Step 7: No commit** — this task produces no repo changes. Record the
      final counts in the PR body of whatever ships next, or in a comment.

---

### Task A3: Triage the 8 stashes (destructive — gated)

**Files:**
- Create: `$SP/stashes/stash-<n>.patch` (one per stash), `$SP/stashes/INDEX.md`

**Interfaces:**
- Consumes: nothing. Produces: nothing other tasks depend on.

Context: 8 stashes, 7 of them from `work/*` branches that no longer exist
(`work/fix-mapa-sunlight-maploc`, `work/feat-mapa-search-dropdown`,
`work/fix-forecast-hero-polish`, `work/ux-sticky-topbar`) plus
`stash@{7}` taken on `main` at `b7fa083` (PR #68 era — very old). Since the
branches are gone, these are the only copies of that work.

- [ ] **Step 1: Export every stash to a patch before touching anything**

```bash
mkdir -p "$SP/stashes"
git stash list --format='%gd|%s|%cr|%H' > "$SP/stashes/INDEX.txt"
n=$(git stash list | wc -l | tr -d ' ')
for i in $(seq 0 $((n - 1))); do
  git stash show -p --include-untracked "stash@{$i}" > "$SP/stashes/stash-$i.patch"
  git stash show --stat "stash@{$i}" > "$SP/stashes/stash-$i.stat"
done
wc -l "$SP/stashes"/*.patch
```

- [ ] **Step 2: Summarize what each stash contains**

Read each `.stat` and write `$SP/stashes/INDEX.md`: stash id, source branch,
age, files touched, and a one-line verdict — `superseded` (the feature shipped
since), `unclear`, or `possibly-unlanded`. Cross-check "superseded" against
`git log --oneline --all -- <path>` and the shipped-feature list in
`docs/ROADMAP.md`. The mapa search dropdown, forecast hero polish and sticky
topbar all appear shipped, so expect mostly `superseded`.

- [ ] **Step 3: CONFIRMATION GATE — present INDEX.md and ask.**

Recommend: keep the patches in the scratchpad (or ask whether to park them
somewhere durable), then `git stash clear`. Do not clear without a yes.

- [ ] **Step 4: Clear, after approval**

```bash
git stash clear
git stash list   # expect empty
```

- [ ] **Step 5: No commit** — nothing in the repo changed.

---

### Task A4: Correct the stale ROADMAP

**Files:**
- Modify: `docs/ROADMAP.md:3` (Last reviewed), `:27-33` (Status at a glance),
  `:164-198` (E11 stories 11.1 + 11.2), `:116-129` (E10 context)

**Interfaces:**
- Consumes: the findings section of this plan.
- Produces: the corrected story text that Tracks C and D implement against. Do
  this task **first** if executing Track C or D, so the acceptance criteria the
  reviewer checks are the corrected ones.

**Sequencing rule (three-way conflict):** `docs/ROADMAP.md` is the one file
multiple tracks want. **A4 is the only task that edits it.** Tracks C and D put
their outcomes in PR bodies and issue comments; ticking the story checkboxes
happens in a single follow-up docs commit at the end of the cycle, on a branch
rebased on whatever landed. Do not add ROADMAP edits to C2's or D3's commits.

- [ ] **Step 1: Update the header and the glance block**

Replace `docs/ROADMAP.md:3`:

```markdown
Status: **living document** · Last reviewed: 2026-07-29
```

In "Status at a glance", replace the `**Health:**` bullet's parenthetical date
with the current state and add a staleness note:

```markdown
- **Health:** 448 unit tests (51 files) + 103 e2e (20 specs) green on `main`
  (as of commit 411e336, 2026-07-29); Core Web Vitals baseline established
  (Story 8.2). All data-refresh workflows and CD green over the last 60 runs.
  Post-#296 correction: parts of E11 shipped inside the audit PR — see E11.
```

- [ ] **Step 2: Rewrite Story 11.1 to reflect what #296 shipped**

Replace the whole Story 11.1 block (`docs/ROADMAP.md:169-178`) with:

```markdown
**Story 11.1 — Mobile navigation** · est ½d (was 1d) · **partially shipped in #296**
- [x] Hamburger button visible `< sm` — `<details id="mobile-menu">` at
      `src/layouts/BaseLayout.astro:462`, 44×44 `<summary>`, 7 destinations
      (Inicio, Mapa, Ciudades, Playas, Estados, Volcanes, Pregunta).
- [x] Esc-to-close + focus restore to the toggle (`BaseLayout.astro:556-565`).
- [ ] Close on focus leaving the menu (Tab-out currently leaves it open).
- [ ] Drop `role="menu"`/`role="menuitem"`: that role contract requires
      roving-tabindex arrow-key navigation which is not implemented. A nav
      disclosure should be a plain `<ul><li><a>` list. Same fix for
      `#catalog-dropdown`.
- [ ] Add the 4 footer-only destinations (Comparar, Huracanes, Feed RSS,
      Privacidad). They are unreachable on `/mapa`, which passes `noFooter`.
- [ ] e2e: at 360px every top-level destination is reachable; Esc closes and
      restores focus; axe clean with the menu **open**.
- **Not doing:** a focus trap, and `aria-expanded`/`aria-controls` on the
  `<summary>`. This is a non-modal disclosure, so trapping focus is the wrong
  pattern; and HTML-AAM maps `<summary>` to the expanded state natively, so a
  hand-managed `aria-expanded` would need a `toggle`-event sync and could
  desync. The acceptance test is "axe clean with the menu open", not the
  presence of a specific attribute.
- Acceptance: no top-level route is unreachable below 640px, from any page
  including `/mapa`.
```

- [ ] **Step 2b: Correct the two technically-wrong bullets in E10**

Story 10.2's first bullet is void: `map.triggerRepaint()` is implemented with
`requestAnimationFrame` internally and is a no-op when a frame is already
pending. Replace that bullet with:

```markdown
- [ ] ~~call `map.triggerRepaint()` unconditionally~~ — **void (2026-07-29):**
      `triggerRepaint()` is itself rAF-scheduled
      (`triggerRepaint(){…!this._frameRequest && n.frame(…)}`, where `n.frame`
      is rAF) and no-ops while a frame is pending. There is no synchronous
      repaint primitive in MapLibre; the fix is to never gate the *boot* on rAF,
      not to add repaint calls.
```

Story 10.3's acceptance ("the new test fails on `main` pre-10.2 and passes
after") cannot be met by a pixel test — both `/mapa` and the `/forecast` embed
already paint pre-interaction on `main` (measured variance 114 and 45). Replace
it with:

```markdown
- Acceptance: two tests. (a) An rAF-starvation test — stub
  `requestAnimationFrame` to never fire, assert the map still mounts — which
  fails on `main` pre-10.2 and passes after. (b) A pixel-variance test asserting
  non-blank canvas with zero interaction, which passes on `main` today and
  exists to gate the nudge-stack removals in 10.2's third bullet.
- Known gap (2026-07-29): the `/forecast` embed crosses the paint threshold
  between 3s and 5s, so it does **not** currently meet this epic's "≤3s"
  criterion. Not caused by the rAF boot bug; treat as separate perf work.
```

- [ ] **Step 3: Retarget Story 11.2 to the elements that are actually
      mobile-visible**

Replace the Story 11.2 block (`docs/ROADMAP.md:180-187`) with:

```markdown
**Story 11.2 — Tap targets ≥44px** · est ½d
Correction (2026-07-29): the header nav links this story originally named are
`hidden sm:inline-block` — desktop-only, so their 28px height was never a
mobile tap-target defect. The mobile-visible offenders are:
- [ ] Mobile-menu items — 36px (`block px-3 py-2`) → 44px.
- [ ] Footer links — **32px** (`inline-block px-2 py-2` + `text-xs`) → 44px.
- [ ] Timeline `#tl-play` / `#tl-prev` / `#tl-next` — **24px each** (`text-base
      leading-none` + `py-1`), visible on mobile → 44px **vertical** hit area
      (width stays natural; expanding horizontally would overlap adjacent
      buttons at `gap-1`).
- [ ] `#mw-search-toggle`, `#maploc`, `#mw-settings`, the info `<summary>` —
      `h-9 w-9` (36px) → `h-11 w-11`.
- [ ] `e2e/mobile-audit.spec.ts:106` uses `w < 44 && h < 44`, i.e. it passes
      anything ≥44px in *either* axis. Add a strict `min(w,h) >= 44` rule for a
      named selector set (header controls, mobile-menu items, footer links,
      timeline buttons) and keep the lenient rule as the global floor.
- **Documented deviation:** `.mw-model-btn` (5 segments in a corner pill,
  currently ~19px) goes to ≥24px per WCAG 2.5.8 AA, not 44px. Five 44px
  segments would be a ~220px-wide pill over the map. Desktop-only anyway
  (`hidden sm:inline-flex`).
- Acceptance: the new strict-set assertions pass; the global rule's only
  exemptions remain the documented `sr-only`, zero-size, in-map and
  parent-container cases.
```

- [ ] **Step 4: Add the located root cause to the E10 context paragraph**

Append to the E10 context paragraph after the PR #289 sentence
(`docs/ROADMAP.md:127-128`):

```markdown
Root cause of the remaining embed case, located 2026-07-29:
`src/pages/forecast.astro:1075` wraps the whole `initInteractiveMap()` call in
a bare `requestAnimationFrame` — the same antipattern #289 removed from
`InteractiveMap.astro:716`. `/forecast` calls the factory directly rather than
through `InteractiveMap.astro`, so it never received that fix. In a hidden or
throttled tab the map therefore never *boots* (not merely never paints), which
is consistent with every prior "blank canvas in automation" report.
```

- [ ] **Step 5: Verify nothing else in the doc contradicts the code**

```bash
grep -n "hidden sm:block\|hamburger\|448 unit\|103 e2e" docs/ROADMAP.md
# NOT `npm run format:check -- docs/ROADMAP.md` — that expands to
# `prettier --check . docs/ROADMAP.md` and checks the whole repo, so the
# fallback fires on any unrelated unformatted file.
npx prettier --check docs/ROADMAP.md || npx prettier --write docs/ROADMAP.md
```

- [ ] **Step 6: Commit**

```bash
git checkout -b docs/roadmap-post-296-correction
git add docs/ROADMAP.md
git commit -m "docs(roadmap): correct E10/E11 against what #296 actually shipped"
```

---

# Track B — Dependency updates

7 open Dependabot PRs, all CI-green, oldest 2026-05-31. No local code work; the
risk is entirely in what breaks *after* merge. Group them so a failure is
attributable.

### Task B1: Merge the five GitHub Actions bumps

**Files:** none locally. PRs #301 (checkout 6→7), #303 (cache 5→6),
#305 (setup-node 6→7), #306 (setup-python 6→7), #292 (github-script 8→9).

**Interfaces:**
- Consumes: nothing. Produces: `.github/workflows/**` on `main` referencing the
  new major versions; Task B2/B3 assume CI is green after this.

- [ ] **Step 1: Check each PR is still mergeable and green**

```bash
for n in 306 305 303 301 292; do
  echo "=== #$n"
  gh pr view "$n" --json mergeable,mergeStateStatus,title \
    -q '[.mergeable, .mergeStateStatus, .title] | @tsv'
  gh pr checks "$n" 2>&1 | tail -5
done
```

Any PR reporting `BEHIND` needs a rebase first:
`gh pr comment <n> --body "@dependabot rebase"`, then wait for CI.

- [ ] **Step 2: Read each changelog for breaking changes before merging**

Major action bumps do break things (Node runtime major, cache backend
rewrites). Check each PR body's release notes section — `gh pr view <n>` prints
it. Specifically confirm: `actions/cache@v6` did not change cache-key or
`restore-keys` semantics used by any workflow, and `actions/github-script@v9`
did not change the `script:` context shape used by
`.github/workflows/claude.yml` or any labeler.

```bash
grep -rn "actions/cache@\|actions/github-script@\|actions/setup-node@\|actions/setup-python@\|actions/checkout@" .github/workflows/ | sort -u
```

- [ ] **Step 3: Merge them one at a time, squash**

```bash
gh pr merge 306 --squash --delete-branch
gh pr merge 305 --squash --delete-branch
gh pr merge 303 --squash --delete-branch
gh pr merge 301 --squash --delete-branch
gh pr merge 292 --squash --delete-branch
```

- [ ] **Step 4: Verify a real workflow still runs — this is the actual test**

CI on a PR does not exercise the data-refresh or deploy workflows. Find one
with a manual trigger and run it:

```bash
grep -l workflow_dispatch .github/workflows/*.yml
gh workflow run "CD — Deploy to GitHub Pages"
sleep 60 && gh run list --limit 3
```

Then check the next scheduled data run (they fire hourly-ish):

```bash
gh run list --limit 10 --json name,conclusion,createdAt \
  -q '.[] | [.createdAt, .name, .conclusion] | @tsv'
```

Expected: no `failure`. If a data workflow fails, revert the specific bump
implicated by the log rather than all five.

- [ ] **Step 5: No local commit.** Sync afterwards: `git checkout main && git pull`.

---

### Task B2: Merge the npm minor/patch group (#304)

**Files:** none locally (PR modifies `package.json`, `package-lock.json`).

**Interfaces:**
- Consumes: B1 green. Produces: updated lockfile on `main`; B3 rebases onto it.

9 grouped updates from 2026-06-28 — a month of drift. CI green is necessary but
not sufficient: CI does not run `playwright test` on every dependency (verify
this while checking).

- [ ] **Step 1: Confirm what CI actually covers on that PR**

```bash
gh pr checks 304
grep -n "npm test\|playwright\|type-check\|lint" .github/workflows/ci.yml
```

- [ ] **Step 2: Run the full suite locally against the PR branch**

```bash
gh pr checkout 304
npm ci
npm run lint && npm run type-check && npm test && npm run build
npx playwright test
```

Expected: lint/type-check clean, 448/448 unit, build 95 pages, 103/103 e2e. If
`npm ci` warns about `engines`, stop — a dependency raised its Node floor above
22 and that is a product decision.

- [ ] **Step 3: Merge**

```bash
git checkout main
gh pr merge 304 --squash --delete-branch
git pull
```

- [ ] **Step 4: Re-verify on `main`**

```bash
npm ci && npm test && npm run build
```

---

### Task B3: Merge lint-staged 16→17 (#294) — major, verify the hook

**Files:** none locally (PR modifies `package.json`, lockfile). Check
`.husky/pre-commit` and the `lint-staged` config location.

**Interfaces:** Consumes B2 merged (avoids a lockfile conflict).

- [ ] **Step 1: Find where lint-staged is configured and what the hook runs**

```bash
cat .husky/pre-commit 2>/dev/null
python3 -c "import json; d=json.load(open('package.json')); print(d.get('lint-staged'))"
ls .lintstagedrc* lint-staged.config.* 2>/dev/null
```

- [ ] **Step 2: Read the v17 breaking changes in the PR body**

```bash
gh pr view 294
```

Look specifically for: config-format changes, Node floor, and changes to how
`--no-stash`/partially-staged files are handled (a recurring source of v-major
breakage that silently drops unstaged hunks).

- [ ] **Step 3: Prove the hook still works before merging**

The configured hook is `{"*.{js,ts,astro}": "eslint --fix", "*.{json,css}":
"prettier --write"}` — **prettier never runs on `.ts`**, and
`eslint-config-prettier` (last in `eslint.config.js:66`) disables every
whitespace rule. So trailing newlines prove nothing: the trigger has to be a
real eslint error. Use an unused variable, in a file that exists (note: the
i18n module is `src/i18n/ui.ts`, *not* `src/lib/ui.ts`):

```bash
gh pr checkout 294
npm ci
cp src/i18n/ui.ts /tmp/ui.ts.bak
printf '\nconst __hookSmokeTest: number = 1;\n' >> src/i18n/ui.ts
npx eslint src/i18n/ui.ts   # confirm this errors BEFORE testing the hook
git add src/i18n/ui.ts
git commit -m "test: lint-staged v17 hook smoke test"   # expect BLOCKED
```

Expected: the commit is rejected by eslint. If it succeeds, the hook is not
running — that is the finding.

- [ ] **Step 4: Clean up without `--hard`**

Never `git reset --hard` on a checked-out Dependabot branch — if the hook
*blocked* the commit (the success case), `HEAD~1` is the dependency bump itself.

```bash
cp /tmp/ui.ts.bak src/i18n/ui.ts
git restore --staged src/i18n/ui.ts 2>/dev/null || true
git status --porcelain          # must be clean
git log --oneline -1            # must still be the Dependabot commit
```

If the commit *did* go through (hook broken), remove just that commit:
`git reset --soft HEAD~1 && git restore --staged .` then restore the backup.

- [ ] **Step 5: Merge, or leave open with a comment**

If the hook misbehaves, do **not** force it — comment on #294 with the failure
and leave it open. Otherwise:

```bash
git checkout main
gh pr merge 294 --squash --delete-branch
git pull && npm ci
```

---

# Track C — E10: map first paint

Order deviates from the ROADMAP deliberately: build the evidence (C1) and the
regression lock (C3) **before** removing any of the historic nudge stack (C4).
The nudge stack is what "fixed" #124 six times; deleting it without a failing-
first test is how this bug class kept coming back.

### Task C1: Story 10.1 — the repro gate, automated + manual

**Files:**
- Create: `./map-paint-probe.mjs` at the **repo root**, excluded locally via
  `.git/info/exclude` (a diagnostic, not committed repo surface)
- Record the outcome in issue #124; the ROADMAP edit belongs to A4 only

**Why the repo root and not `$SP`:** Node ESM resolves bare specifiers by walking
up from the *importing module's* directory. There is no `node_modules` anywhere
above `/private/tmp`, so `node "$SP/probe.mjs"` importing `@playwright/test`
dies with `ERR_MODULE_NOT_FOUND`. Verified. Keep the file in the repo, keep it
untracked:

```bash
grep -qxF 'map-paint-probe.mjs' .git/info/exclude || \
  echo 'map-paint-probe.mjs' >> .git/info/exclude
```

**Interfaces:**
- Consumes: `@playwright/test`'s bundled `chromium` (already installed).
- Produces: a written finding — the decision gate for whether E10 stays P0.
  The pixel-variance helper written here is reused verbatim in C3.

The probe answers one question per mode: **does the map canvas contain painted
content before any interaction?** It needs no production-code changes because
`src/lib/interactive-map.ts:350` already sets
`canvasContextAttributes: { preserveDrawingBuffer: true }`, so the WebGL canvas
can be read back via `drawImage`.

- [ ] **Step 1: Write the probe**

Create `./map-paint-probe.mjs` (repo root). Note what this probe does **not**
do: it does not attempt to background the page. `bringToFront()` was verified
not to change `visibilityState` in PW 1.60, headless or headed — the rAF-
starvation test in C3 covers that mechanism instead.

```js
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:4321/mexico-weather/';
const TARGETS = [
  { name: 'mapa', url: 'mapa#view=23.6,-102.5,5z&layer=temperature' },
  {
    name: 'forecast-embed',
    url: 'forecast/?lat=19.43&lng=-99.13&name=CDMX&tz=America/Mexico_City',
  },
];

// Same sampler as e2e/map-first-paint.spec.ts (Task C3). A blank or
// solid-fill canvas has ~0 luminance variance; a painted basemap or
// field raster has hundreds.
const SAMPLE = () => {
  const c = document.querySelector('canvas.maplibregl-canvas');
  if (!c) return { painted: false, reason: 'no canvas', variance: 0 };
  const off = document.createElement('canvas');
  off.width = 64;
  off.height = 64;
  const ctx = off.getContext('2d');
  ctx.drawImage(c, 0, 0, 64, 64);
  const d = ctx.getImageData(0, 0, 64, 64).data;
  let n = 0, sum = 0, sumSq = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
    n += 1; sum += l; sumSq += l * l;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  return { painted: variance > 25, variance: Math.round(variance), mean: Math.round(mean) };
};

const results = [];

async function probe({ headless, starveRaf }) {
  const browser = await chromium.launch({ headless });
  for (const target of TARGETS) {
    const context = await browser.newContext({ locale: 'es-MX' });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));

    if (starveRaf) {
      // The real failure mechanism, deterministically: rAF callbacks that
      // never run. This is what a hidden/throttled tab does, and what
      // bringToFront() cannot simulate.
      await page.addInitScript(() => {
        window.requestAnimationFrame = () => 0;
      });
    }

    await page.goto(BASE + target.url, { waitUntil: 'domcontentloaded' });
    const visibility = await page.evaluate(() => document.visibilityState);

    // Absolute sample times: 1s, 3s, 5s, 8s from load.
    const samples = [];
    let elapsed = 0;
    for (const t of [1000, 3000, 5000, 8000]) {
      await page.waitForTimeout(t - elapsed);
      elapsed = t;
      samples.push({ t, mounted: await page.evaluate(
        () => !!document.querySelector('canvas.maplibregl-canvas'),
      ), ...(await page.evaluate(SAMPLE)) });
    }
    // Only now interact — proves the click-to-paint signature if present.
    const box = await page.locator('canvas.maplibregl-canvas').first()
      .boundingBox().catch(() => null);
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1000);
    const afterClick = await page.evaluate(SAMPLE);

    results.push({
      mode: { headless, starveRaf }, target: target.name,
      visibility, samples, afterClick, errors: errors.slice(0, 5),
    });
    await context.close();
  }
  await browser.close();
}

await probe({ headless: true,  starveRaf: false });
await probe({ headless: true,  starveRaf: true  });
await probe({ headless: false, starveRaf: false });
// One valid JSON document, not N concatenated ones.
console.log(JSON.stringify(results, null, 2));
```

The headed mode needs a GUI session, and even then nothing guarantees the window
is truly focused while an agent drives the terminal — treat its result as
suggestive, and rely on Step 5 for real foreground evidence.

- [ ] **Step 2: Serve the production build and run the probe**

```bash
npm run build
npm run preview -- --port 4321 &
sleep 5
node ./map-paint-probe.mjs > "$SP/probe-results.json"
python3 -m json.tool "$SP/probe-results.json" > /dev/null && echo "valid JSON"
```

- [ ] **Step 3: Interpret — this is the decision gate**

Baselines already measured on unmodified `main` (2026-07-29, headless, no rAF
starvation): `/mapa` variance 270 at 1s settling to 114; `/forecast` embed
**0 at 1s, 21 at 3s, 45 at 5s**. Both paint pre-interaction. Use those as the
comparison, and classify:

| Observation | Meaning |
|---|---|
| `starveRaf: true` → `forecast-embed` `mounted: false` at every sample | **Expected on `main`.** Confirms the rAF-gated boot: the map never mounts. This is the mechanism C2 fixes and C3 locks. |
| `starveRaf: true` → `mapa` stays `mounted: true` | **Expected.** `/mapa` boots off `setTimeout` since #289. Confirms the asymmetry is real and specific to `forecast.astro`. |
| Foreground (`starveRaf: false`) paints on both targets, matching the baselines | **"Cannot reproduce in foreground"** → per the ROADMAP's own gate, E10 demotes to P2. C2/C3 still ship (an rAF-gated boot is wrong regardless); C4 becomes optional cleanup **only after Step 5's real-device answer agrees**. |
| Any foreground mode stays blank until `afterClick` flips it | The historic #124 signature is real in foreground → E10 stays **P0** and C4 does not start. |
| `/forecast` crosses the floor after 3s | **Expected — record it.** Story 10.2's "≤3s" criterion is currently unmet. Separate perf finding, not the boot bug (A4 Step 2b records this). |
| All modes report `variance: 0` even after click | WebGL unavailable. (Verified working here — `{ok: true, renderer: 'WebKit WebGL'}` — so this row should not fire. If it does, re-launch with `args: ['--enable-unsafe-swiftshader']` before concluding anything.) |

- [ ] **Step 4: Record the evidence where the next person will look**

```bash
gh issue comment 124 --body-file "$SP/probe-findings.md"
```

Write `$SP/probe-findings.md` first: the three mode results, the measured
variance series against the recorded baselines, the rAF-starvation result, and
the verdict sentence. The ROADMAP edit for this verdict belongs to **A4**, not
here (see A4's sequencing rule) — Story 10.1's checkboxes get ticked in the
end-of-cycle docs commit.

- [ ] **Step 5: Manual real-device check (needs the human)**

The probe cannot speak for real hardware. Ask the human to load, on a phone
with the screen on and the browser foregrounded, with cache/SW cleared:

```
https://artemiop.com/mexico-weather/forecast/?lat=19.43&lng=-99.13&name=CDMX&tz=America/Mexico_City
https://artemiop.com/mexico-weather/mapa#view=23.6,-102.5,5z&layer=temperature
```

and report: does the map show imagery before you touch it? Record the answer in
the same issue comment. Note the site is a static GitHub Pages deploy, so this
tests the currently-deployed `main`, not the local build.

---

### Task C2: Story 10.2 (part 1) — un-gate the `/forecast` boot

**Files:**
- Create: `src/lib/map/boot-scheduling.test.ts`
- Modify: `src/pages/forecast.astro:1075` (and the callback's closing paren at
  **`:1135`** — three other `});` lines sit between, at 1128, 1129 and 1134)
- Modify: `src/components/InteractiveMap.astro:10` (stale docblock claim)

**Dropped from an earlier draft:** a "synchronous `map.triggerRepaint()`" in the
`map.on('load')` handler, and the unit test asserting it. `triggerRepaint()` is
rAF-scheduled internally and no-ops while a frame is pending, so both the change
and the test would have encoded a distinction that does not exist. See finding 4.
`src/lib/interactive-map.ts` is therefore **not** modified by this task, which
also removes the line-number drift C4 would otherwise inherit.

**Interfaces:**
- Consumes: nothing from C1 (this fix is correct regardless of the gate outcome).
- Produces: `src/lib/map/boot-scheduling.test.ts` — a source-text guard that
  C4 also relies on to stay honest.

- [ ] **Step 1: Write the failing test**

The boot schedulers live in an `.astro` `<script>` and in a 2,950-line module
with no unit test and a dynamic MapLibre import, so behavioural unit testing is
not available. A source-text guard is the honest tool: it pins the *decision*
(never gate a map boot on rAF) at the exact three call sites, and it fails
loudly if someone reintroduces the pattern.

Create `src/lib/map/boot-scheduling.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Regression guard for issue #124 / PR #289.
 *
 * requestAnimationFrame does not fire in hidden or heavily throttled
 * tabs. Anything that *gates a map boot* on rAF therefore fails to mount
 * the map at all — not merely fails to paint it. PR #289 fixed this for
 * /mapa (InteractiveMap.astro); src/pages/forecast.astro had the same
 * bug because it calls initInteractiveMap() directly.
 *
 * These are source-text assertions on purpose: both boot schedulers are
 * inline <script> blocks that vitest cannot import.
 */
const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8');

/** Strip line + block comments: the #289 tombstone comment in
 *  InteractiveMap.astro quotes `requestAnimationFrame(boot)` verbatim, so a
 *  naive source match reports the bug it documents. */
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('map boot scheduling', () => {
  it('forecast.astro does not wrap initInteractiveMap in requestAnimationFrame', () => {
    const src = code(read('../../pages/forecast.astro'));
    expect(src).toContain('initInteractiveMap({');
    // The bug shape: an rAF callback whose body contains the factory call.
    // 400 chars is comfortably wider than the real block (measured: 111).
    const rafBlocks = src.match(/requestAnimationFrame\(\s*\(\)\s*=>\s*\{[\s\S]{0,400}?\}/g) ?? [];
    for (const block of rafBlocks) {
      expect(block).not.toContain('initInteractiveMap');
    }
  });

  it('the /mapa non-lazy path still boots via setTimeout, not rAF', () => {
    const src = code(read('../../components/InteractiveMap.astro'));
    expect(src).toContain('window.setTimeout(boot, 0)');
    expect(src).not.toMatch(/requestAnimationFrame\(\s*boot\s*\)/);
  });
});
```

This is a source-text guard, and it is worth being honest about what that buys:
it pins one *decision* ("never gate a map boot on rAF") at two known call sites
and nothing more. It cannot detect a behavioural regression. The behavioural
guard is C3's rAF-starvation test — that is the one that matters.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/lib/map/boot-scheduling.test.ts
```

Expected: **test 1 FAILS** (the rAF block at `forecast.astro:1075` contains
`initInteractiveMap` — verified: 1 match, 111 chars), **test 2 PASSES** (#289
already landed, and the `code()` helper strips the tombstone comment at
`InteractiveMap.astro:706` that quotes `requestAnimationFrame(boot)` — without
that helper this test is a false red). If test 1 passes, the regex window is too
small for the actual block — widen it and re-confirm it fails before fixing
anything.

- [ ] **Step 3: Fix `/forecast`**

In `src/pages/forecast.astro`, replace:

```js
          const mapEl = document.getElementById('fc-map');
          if (mapEl) {
            window.requestAnimationFrame(() => {
              void initInteractiveMap({
```

with:

```js
          const mapEl = document.getElementById('fc-map');
          if (mapEl) {
            // setTimeout, never requestAnimationFrame: rAF is paused in
            // hidden/backgrounded tabs, so an rAF-gated boot means the
            // map never mounts at all (issue #124). Same fix PR #289
            // applied to InteractiveMap.astro's non-lazy path; this file
            // calls the factory directly so it never got it.
            window.setTimeout(() => {
              void initInteractiveMap({
```

The callback's closing `});` is at **`:1135`**, not immediately after the
factory options — the `.then(...)` chain that adds the user marker sits in
between, and there are three other `});` lines before it (1128, 1129, 1134).
Read the whole 1073→1140 range before editing, change the right one to `}, 0);`,
and let `npm run type-check` confirm the paren balance.

- [ ] **Step 4: Fix the stale docblock**

`src/components/InteractiveMap.astro:10` claims `/forecast` uses this
component. It does not. Correct that line to say `/forecast` calls
`initInteractiveMap()` directly from `src/pages/forecast.astro`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/lib/map/boot-scheduling.test.ts   # expect 2/2 PASS
npm test                                             # expect 450/450 (448 + 2)
npm run type-check && npm run lint
npm run build
```

- [ ] **Step 6: Re-run the C1 probe to confirm the behaviour change**

```bash
npm run build && npm run preview -- --port 4321 &
sleep 5 && node ./map-paint-probe.mjs > "$SP/probe-after-c2.json"
```

Expected delta: in the `starveRaf: true` mode, `forecast-embed` flips from
`mounted: false` at every sample to `mounted: true`. (Its `variance` stays 0 with
rAF starved — MapLibre cannot paint without rAF at all. Mounting is the whole
claim.) Paste the before/after into the PR body; this is the evidence the fix
does something real.

- [ ] **Step 7: Commit**

```bash
git checkout -b fix/map-boot-scheduling-forecast
git add src/pages/forecast.astro src/components/InteractiveMap.astro \
        src/lib/map/boot-scheduling.test.ts
git commit -m "fix(map): boot the /forecast embed off setTimeout, not rAF (Story 10.2)"
```

---

### Task C3: Story 10.3 — lock first paint with an e2e pixel assertion

**Files:**
- Create: `e2e/map-first-paint.spec.ts`
- Modify: `playwright.config.ts` (only if Step 1 proves WebGL is unavailable)

**Interfaces:**
- Consumes: the `SAMPLE` sampler from C1 Step 1 (copy it, adapted to TS).
- Produces: the gate C4 removes nudges against.

- [ ] **Step 1: First prove WebGL actually works in the e2e runner**

`playwright.config.ts` sets no `launchOptions`, and every existing map spec
asserts DOM state only — so nothing in the suite has ever confirmed the GL
context exists. If it does not, a pixel test can never pass.

This was already checked during plan review and **WebGL works** in this repo's
headless chromium (`{ok: true, renderer: 'WebKit WebGL'}`), so the
`--enable-unsafe-swiftshader` contingency below should not trigger. Re-confirm
anyway — it costs one command, and it must run from the **repo root** (a
scratchpad script cannot resolve `@playwright/test`; see C1's Files note):

```bash
cat > ./gl-check.mjs <<'EOF'
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('about:blank');
console.log(await p.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  return gl ? { ok: true, renderer: gl.getParameter(gl.RENDERER) } : { ok: false };
}));
await b.close();
EOF
node ./gl-check.mjs && rm ./gl-check.mjs
```

If `ok: false`, add to `playwright.config.ts` inside the `chromium` project:

```ts
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Software WebGL: MapLibre needs a GL context, and headless
          // Chromium has no GPU. Without this the map canvas never
          // paints and the first-paint spec can't mean anything.
          args: ['--enable-unsafe-swiftshader'],
        },
      },
    },
```

Re-run the check with those args before writing the spec. **Do not write a
pixel test against a runner that has no GL** — say so and stop instead.

- [ ] **Step 2: Write the failing test**

Create `e2e/map-first-paint.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

/**
 * Story 10.3 — the map must paint with zero interaction.
 *
 * Issue #124's signature was: tiles loaded, GL context alive, canvas
 * sized, blank until a click. So the assertion has to look at pixels,
 * not DOM state — every other map spec asserts DOM only, which is why
 * this bug class survived six PRs.
 *
 * Readback works because src/lib/interactive-map.ts sets
 * canvasContextAttributes.preserveDrawingBuffer = true.
 */

// Measured on main, 2026-07-29, headless chromium, 64x64 sample:
//   /mapa            270 @1s -> 114 steady
//   /forecast embed     0 @1s ->  21 @3s -> 45 steady
// A blank or solid-fill canvas is ~0. The floor is per-target because the
// forecast embed (temperature field, z9 over CDMX) is nearly uniform and
// sits only ~2x above a shared floor — one global constant would make the
// weakest target the flakiest.
const PAINT_VARIANCE_FLOOR = { '/mapa': 40, '/forecast embed': 15 } as const;

async function sampleCanvas(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.maplibregl-canvas');
    if (!c) return { found: false, variance: 0, mean: 0 };
    const off = document.createElement('canvas');
    off.width = 64;
    off.height = 64;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(c, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    let n = 0, sum = 0, sumSq = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
      n += 1; sum += l; sumSq += l * l;
    }
    const mean = sum / n;
    return { found: true, variance: sumSq / n - mean * mean, mean };
  });
}

const TARGETS = [
  { name: '/mapa', url: 'mapa#view=23.6,-102.5,5z&layer=temperature' },
  {
    name: '/forecast embed',
    url: 'forecast/?lat=19.43&lng=-99.13&name=CDMX&tz=America/Mexico_City',
  },
];

for (const target of TARGETS) {
  test(`${target.name} paints without any interaction`, async ({ page }) => {
    await page.goto(target.url);
    // No click, no hover, no keypress anywhere in this test.
    await expect
      .poll(async () => (await sampleCanvas(page)).variance, {
        message: `${target.name} canvas stayed blank pre-interaction`,
        timeout: 15_000,
        intervals: [500, 500, 1000, 1000, 2000],
      })
      .toBeGreaterThan(PAINT_VARIANCE_FLOOR[target.name]);
  });
}

// The behavioural regression guard for #124 — the ONE test here that fails
// on main before C2 and passes after.
//
// Do not try to background the page instead: bringToFront() does not change
// document.visibilityState in Playwright 1.60 (verified, headless AND headed),
// so a "hidden tab" test is vacuous. Starving rAF reproduces the mechanism
// directly: a boot gated on rAF never runs, so the map never mounts.
for (const target of TARGETS) {
  test(`${target.name} still mounts when requestAnimationFrame never fires`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
    });
    await page.goto(target.url, { waitUntil: 'domcontentloaded' });
    // Pixels are impossible here — MapLibre renders via rAF — so assert the
    // map *mounted*, which is exactly what the rAF-gated boot broke.
    await expect
      .poll(
        () =>
          page.evaluate(
            () => !!document.querySelector('canvas.maplibregl-canvas'),
          ),
        { message: `${target.name} never mounted with rAF starved`, timeout: 15_000 },
      )
      .toBe(true);
  });
}
```

- [ ] **Step 3: Prove the fail-before / pass-after on the rAF-starvation tests**

This is the only test in the plan that can do it, so do it explicitly:

```bash
git checkout main -- src/pages/forecast.astro
npm run build
npx playwright test e2e/map-first-paint.spec.ts
```

Expected on pre-C2 code:
- `/forecast embed still mounts when requestAnimationFrame never fires` **FAILS**
  (the boot is inside the starved rAF, so nothing mounts).
- `/mapa still mounts when requestAnimationFrame never fires` **PASSES** (#289
  moved it to `setTimeout`). This asymmetry is the proof the fix targets the
  right line.
- The two paint tests **PASS** — expected; they are C4's lock, not C2's proof
  (measured baselines: `/mapa` 114, `/forecast` 45).

Then restore the fix and re-run:

```bash
git checkout HEAD -- src/pages/forecast.astro
npm run build
npx playwright test e2e/map-first-paint.spec.ts   # expect 4/4
```

If the `/forecast` starvation test *passes* on pre-C2 code, the init script is
not applying before the page's module script — check `addInitScript` ordering
before concluding the bug isn't real.

- [ ] **Step 4: Run the full spec, repeatedly — the ROADMAP's 10× criterion**

```bash
npx playwright test e2e/map-first-paint.spec.ts --repeat-each=10
```

Expected: 40/40 pass (4 tests × 10). Record the observed variance spread, not
just pass/fail — the `/forecast` margin is the thin one. If it flakes, report the
measured values and the margin; do not raise or lower the floor to make it green.

- [ ] **Step 5: Full suite**

```bash
npx playwright test    # expect 107/107 (103 baseline + 4)
```

Baseline re-verified as **103 tests / 20 specs** and **448 unit / 51 files**.

- [ ] **Step 6: Commit**

```bash
git add e2e/map-first-paint.spec.ts playwright.config.ts
git commit -m "test(e2e): assert the map paints with zero interaction (Story 10.3)"
```

---

### Task C4: Story 10.2 (part 2) — retire the nudge stack, one layer per commit

**Files:**
- Modify: `src/lib/interactive-map.ts` — `firstPaintNudge` (`:500-522`),
  `aggressiveNudge` (`:523-534`), `synthesizeMove` (`:535-578`) and its
  scheduler (`:619-626`), the 200 ms × 25 interval (`:604-618`) **plus its
  `let repaintNudgeInterval = 0;` declaration at `:595`, which is outside that
  range** and its clear inside `destroy()`

**Line numbers are indicative only.** `grep` for the anchor text
(`aggressiveNudge`, `synthesizeMove`, `repaintNudgeInterval`) before every
deletion — do not delete by line range.

**Interfaces:**
- Consumes: C3's `e2e/map-first-paint.spec.ts` — the only thing standing
  between this task and a sixth reopening of #124.
- Produces: nothing other tasks consume.

**Gate — two conditions, both required:**
1. C3 green (all 4 tests, `--repeat-each=10`).
2. **The human's answer to C1 Step 5** (real device, real foreground) says the
   map paints without interaction.

Condition 2 is not optional and cannot be satisfied by the automated probe: the
probe never backgrounds anything, so "cannot reproduce in foreground" is its only
possible verdict. Treating that as the gate would make it a rubber stamp on
deleting six PRs' worth of workaround. If the human has not answered, stop here.

- [ ] **Step 1: Establish the baseline**

```bash
npx playwright test e2e/map-first-paint.spec.ts --repeat-each=10   # 40/40
```

- [ ] **Step 2: Remove the synthetic pointer events (least defensible layer)**

Delete `synthesizeMove` (`:535-578`) and its scheduler block (`:619-626`).
Dispatching fake `PointerEvent`s at the canvas is the most invasive workaround
in the file and the least likely to be the thing that works.

- [ ] **Step 3: Verify, then commit**

```bash
npx playwright test e2e/map-first-paint.spec.ts --repeat-each=10
npm test && npm run type-check
git commit -am "refactor(map): drop the synthetic pointer-move first-paint hack (#124)"
```

If the repeat run flakes, `git revert` this commit and stop the task here.
Record which layer resisted removal — that is a genuine finding about the bug.

- [ ] **Step 4: Remove `aggressiveNudge`'s 6-timer stack**

Delete `aggressiveNudge` (`:523-534`) and its call site in the load handler.
Keep `firstPaintNudge` itself: it is still invoked from `map.once('idle')`
(`:692`) and the `ResizeObserver` (`:697`), which are legitimate
event-driven triggers rather than blind timers.

- [ ] **Step 5: Verify, then commit**

```bash
npx playwright test e2e/map-first-paint.spec.ts --repeat-each=10
git commit -am "refactor(map): drop the 6-timer aggressive nudge stack (#122, #124)"
```

- [ ] **Step 6: Remove the 200 ms × 25 repaint interval**

```bash
grep -n "repaintNudgeInterval" src/lib/interactive-map.ts
```

Delete **all four** sites: the `let repaintNudgeInterval = 0;` declaration
(`:595`, outside the interval block), the `window.setInterval(…)` block
(`:604-618`), the self-clear inside it, and the cleanup in `destroy()`. Deleting
only the block leaves an orphaned declaration; deleting the declaration but not
the `destroy()` clear is a type error.

The `sourcedata` handler at `:585-592` already calls `triggerRepaint()` on every
`isSourceLoaded` event, which is the same coverage, event-driven.

- [ ] **Step 7: Verify, then commit**

```bash
npx playwright test e2e/map-first-paint.spec.ts --repeat-each=10
npm test && npm run type-check && npm run build
git commit -am "refactor(map): replace the 5s repaint poll with the sourcedata hook (#124)"
```

- [ ] **Step 8: Do NOT touch `windRaf` — an earlier draft's claim was false**

A draft of this plan called the three `cancelAnimationFrame(windRaf)` calls
(`:954`, `:1011`, `:2926`) dead code on the grounds that `windRaf` is never
assigned. It **is** assigned, at `src/lib/interactive-map.ts:1074`:

```ts
          onTick: (id) => {
            windRaf = id;
          },
```

`makeWindParticlesLayer` hands the rAF id back through `onTick`, so those cancels
are live cleanup for the wind-particle animation loop. Removing them would leak
an rAF loop after every wind-layer teardown. Left in place deliberately.

- [ ] **Step 9: Keep the `osm` visibility flip — do not remove it**

`firstPaintNudge`'s `setLayoutProperty('osm', 'visibility', …)` flip
(`:507-515`) forces a MapLibre layout recompute. It is the one nudge with a
plausible mechanism rather than a timing guess, it only runs on `idle`/resize
now, and it is cheap. Removing it is not in scope; note the decision in the PR
body.

- [ ] **Step 10: Final verification and PR**

```bash
npm run lint && npm run type-check && npm test && npm run build
npx playwright test
npx playwright test e2e/map-first-paint.spec.ts --repeat-each=10   # 40/40
```

PR body must state: which layers were removed, the 10× results after each, and
the net line count deleted from `interactive-map.ts`.

---

# Track D — E11: mobile UX

### Task D1: Story 11.1 residue — nav a11y, ARIA correctness, and the `/mapa` dead-end

**Files:**
- Modify: `src/layouts/BaseLayout.astro:402-441` (`#catalog-dropdown` roles),
  `:462-538` (`#mobile-menu` roles + new links), `:542-567` (the inline script)
- Create: `e2e/mobile-nav.spec.ts`
- Modify: `e2e/catalog-nav.spec.ts` (only if it selects by ARIA role)

**Interfaces:**
- Consumes: Task A4's corrected Story 11.1 text as the acceptance criteria.
- Produces: `#mobile-menu` markup that D2 then re-sizes (D2 changes the same
  `<a>` classes — run D1 first to avoid a conflict).

- [ ] **Step 1: Fix the spec that Step 4 will break — `catalog-nav.spec.ts`**

```bash
grep -n "menuitem\|getByRole" e2e/catalog-nav.spec.ts e2e/a11y.spec.ts
```

Confirmed: **`e2e/catalog-nav.spec.ts` uses `getByRole('menuitem')` at lines 18,
19, 20, 21 and 28.** Step 4 removes those roles, so all five break. Rewrite them
now as `getByRole('link', { name: … })` scoped to `#catalog-dropdown`, run the
spec against unmodified `main` to confirm the new selectors pass **before** the
markup changes (links have the link role today too — `role="menuitem"` overrides
it, so the link-role query only works *after* Step 4; if it fails now, that is
expected and the spec goes green in Step 7 instead). Record which way it went.

```bash
npx playwright test e2e/catalog-nav.spec.ts
```

- [ ] **Step 2: Write the failing test**

Create `e2e/mobile-nav.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Story 11.1 — the mobile menu shipped in #296 with no test coverage.
 *
 * Acceptance: below 640px, every top-level destination is reachable
 * from any page — including /mapa, which passes noFooter and therefore
 * has no footer links either.
 */

test.use({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });

const DESTINATIONS = [
  { label: 'Inicio', path: '' },
  { label: 'Mapa', path: 'mapa' },
  { label: 'Ciudades', path: 'clima/' },
  { label: 'Playas', path: 'playa/' },
  { label: 'Estados', path: 'estado/' },
  { label: 'Volcanes', path: 'volcan/' },
  { label: 'Pregunta', path: 'pregunta' },
  { label: 'Comparar', path: 'compara/' },
  { label: 'Huracanes', path: 'huracanes/' },
  { label: 'Privacidad', path: 'privacidad/' },
];
// Feed RSS is deliberately absent: it is a static file, not a route. Assert it
// separately once Step 5 confirms the href the footer uses.

test('every top-level destination is reachable from the mobile menu', async ({ page }) => {
  await page.goto('');
  for (const d of DESTINATIONS) {
    const menu = page.locator('#mobile-menu');
    await menu.locator('summary').click();
    const link = menu.getByRole('link', { name: new RegExp(d.label, 'i') });
    await expect(link, `${d.label} missing from the mobile menu`).toBeVisible();
    await expect(link).toHaveAttribute('href', new RegExp(`${d.path}$`));
    await page.keyboard.press('Escape');
  }
});

test('the mobile menu is the only nav path on /mapa (noFooter)', async ({ page }) => {
  await page.goto('mapa');
  // NOT `page.locator('footer')` — FeedbackFAB.astro:212 renders a <footer>
  // inside its <dialog> on every page, so a count-0 assertion fails for an
  // unrelated reason. Target the site footer's own link instead.
  await expect(
    page.locator('body > footer').getByRole('link', { name: /Privacidad/i }),
  ).toHaveCount(0);
  await page.locator('#mobile-menu summary').click();
  await expect(
    page.locator('#mobile-menu').getByRole('link', { name: /Huracanes/i }),
  ).toBeVisible();
});

test('Escape closes the menu and restores focus to the toggle', async ({ page }) => {
  await page.goto('');
  const summary = page.locator('#mobile-menu summary');
  await summary.click();
  await expect(page.locator('#mobile-menu')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('#mobile-menu')).not.toHaveAttribute('open', '');
  await expect(summary).toBeFocused();
});

test('tabbing out of the menu closes it', async ({ page }) => {
  await page.goto('');
  await page.locator('#mobile-menu summary').click();
  await expect(page.locator('#mobile-menu')).toHaveAttribute('open', '');
  // Shift+Tab from the summary moves focus out of the <details> entirely.
  await page.locator('#mobile-menu summary').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#mobile-menu')).not.toHaveAttribute('open', '');
});

test('axe is clean with the mobile menu open', async ({ page }) => {
  await page.goto('');
  await page.locator('#mobile-menu summary').click();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(blocking).toEqual([]);
});
```

- [ ] **Step 3: Run it and confirm which tests fail**

```bash
npx playwright test e2e/mobile-nav.spec.ts
```

Expected on current `main`: the destinations test FAILS (no Comparar / Huracanes
/ Privacidad), the `/mapa` test FAILS, the Tab-out test FAILS. Escape and axe
already pass — that is fine, they are the regression half of the spec.

Do **not** expect axe to justify Step 4: axe has no rule for "`role=menu`
without keyboard support", and `aria-required-children` is currently satisfied.
The justification for dropping the roles is the ARIA contract itself (below),
not a tool finding.

- [ ] **Step 4: Replace the ARIA menu roles with list semantics**

`role="menu"` + `role="menuitem"` promises arrow-key roving-tabindex
navigation that this disclosure does not implement, and it removes the links
from the accessibility tree's link list. A nav disclosure should be a list.

In `src/layouts/BaseLayout.astro`, in **both** `#catalog-dropdown` (`:410`-ish)
and `#mobile-menu` (`:480-537`): change the panel `<div role="menu" …>` to a
`<ul role="list" …>` (keeping every class verbatim), wrap each `<a>` in `<li>`,
and delete every `role="menuitem"` attribute. Example for one item:

```astro
            <ul
              role="list"
              class="absolute right-0 z-50 mt-1 min-w-[200px] rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900"
            >
              <li>
                <a
                  href={base}
                  class="block px-3 py-2 text-gray-700 hover:bg-blue-50 hover:text-blue-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-blue-400"
                  data-i18n-en="Home"
                  >Inicio</a
                >
              </li>
```

Note on the `<li>` wrappers and `mobile-audit.spec.ts`: they change nothing for
the existing global rule. It takes `Math.max(el, parent)` and the menu links are
already ≥44px **wide**, so they were never flagged. D2's strict rule measures the
element itself regardless — which is the right fix on its own merits, not a
mitigation for this change.

- [ ] **Step 5: Add the four footer-only destinations to the mobile menu**

After the Pregunta item, add a divider and the missing routes. Verify the paths
first (`ls dist/compara dist/huracanes dist/privacidad` after a build, or grep
`src/pages/`):

```astro
              <li aria-hidden="true"><hr class="my-1 border-gray-200 dark:border-gray-700" /></li>
              <li>
                <a
                  href={`${base}compara/`}
                  class="block px-3 py-2 text-gray-700 hover:bg-blue-50 hover:text-blue-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-blue-400"
                  data-i18n-en="Compare"
                  >Comparar</a
                >
              </li>
              <li>
                <a
                  href={`${base}huracanes/`}
                  class="block px-3 py-2 text-gray-700 hover:bg-blue-50 hover:text-blue-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-blue-400"
                  data-i18n-en="Hurricanes"
                  >Huracanes</a
                >
              </li>
```

Add `Privacidad` (`${base}privacidad/`, `data-i18n-en="Privacy"`) the same way.
**Feed RSS** points at a static file, not a route — check how the footer links
it (`grep -n "rss" src/layouts/BaseLayout.astro`) and mirror that href exactly
rather than guessing.

- [ ] **Step 6: Close the menu when focus leaves it**

In the inline script (`:542-567`), inside the existing IIFE after the
`keydown` listener, add:

```js
        dds.forEach(function (dd) {
          dd.addEventListener('focusout', function (e) {
            if (!dd.hasAttribute('open')) return;
            var to = e.relatedTarget;
            // relatedTarget is null when focus goes nowhere (e.g. a click
            // on a non-focusable spot inside the panel) — keep it open;
            // the outside-click handler covers that case.
            if (!to || dd.contains(to)) return;
            dd.removeAttribute('open');
          });
        });
```

Do **not** move focus back to the summary here — the user deliberately tabbed
away, and stealing focus would trap them. Focus restore stays Escape-only.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx playwright test e2e/mobile-nav.spec.ts        # expect 5/5
npx playwright test e2e/catalog-nav.spec.ts e2e/a11y.spec.ts e2e/i18n-toggle.spec.ts
```

`catalog-nav.spec.ts` must be green here with the Step 1 selector rewrite. Note
that neither `npm run lint` nor `npm run type-check` covers `e2e/**`, so running
the specs is the only verification these files get.

The i18n spec matters: every new link carries a `data-i18n-en` attribute and
that spec asserts the ES→EN swap. If it counts translated nodes, update the
expected count.

- [ ] **Step 8: Full suite + commit**

```bash
npm run lint && npm run type-check && npm test && npm run build
npx playwright test
git checkout -b feat/mobile-nav-a11y
git add src/layouts/BaseLayout.astro e2e/mobile-nav.spec.ts e2e/catalog-nav.spec.ts
git commit -m "feat(mobile): list semantics, focus-out close, and 4 missing routes in the mobile menu (Story 11.1)"
```

---

### Task D2: Story 11.2 — tap targets, retargeted at what is actually visible on a phone

**Files:**
- Modify: `src/layouts/BaseLayout.astro` — mobile-menu + catalog `<a>` classes,
  footer link classes (`:583-631`)
- Modify: `src/components/InteractiveMap.astro` — `#tl-play` (`:252`),
  `#tl-prev` (`:268`), `#tl-next` (`:282`), `#mw-search-toggle` (`:147-155`),
  `#maploc` (`:169-176`), `#mw-settings` summary (`:465`), info summary
  (`:500`), `.mw-model-btn` (`:385`)
- Modify: `e2e/mobile-audit.spec.ts` (strict rule + a `/mapa` test)

**Interfaces:**
- Consumes: D1's `<li>`-wrapped menu markup.
- Produces: the strict tap-target rule that future PRs are measured against.

- [ ] **Step 1: Write the failing assertions**

In `e2e/mobile-audit.spec.ts`, add a strict rule above the existing loop. It
measures the element itself (no parent escape hatch) for a named selector set:

```ts
// Elements a phone user actually touches. Unlike the global rule below
// (≥44px in *either* axis, with a parent-container escape hatch), these
// must clear 44px in *both* axes measured on the element itself. Listed
// explicitly so the rule can never silently widen or narrow.
const STRICT_SELECTORS: string[] = [
  '#mobile-menu summary',
  '#mobile-menu a[href]',
  'body > footer a[href]',
  '#tl-play',
  '#tl-prev',
  '#tl-next',
  '#mw-search-toggle',
  '#maploc',
  '#mw-settings',        // the ⚙ <summary>, also resized in Step 5
  '#mw-info',            // the ℹ <summary>, ditto — confirm the real id first
];

async function strictViolations(page: import('@playwright/test').Page) {
  return page.evaluate((selectors) => {
    const bad: Array<{ selector: string; w: number; h: number }> = [];
    for (const sel of selectors) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        const r = el.getBoundingClientRect();
        // Not rendered at this viewport (e.g. no map on /clima, no site
        // footer on /mapa) — nothing to measure, not a violation.
        if (r.width === 0 || r.height === 0) continue;
        if (r.width < 44 || r.height < 44) {
          bad.push({ selector: sel, w: Math.round(r.width), h: Math.round(r.height) });
        }
      }
    }
    return bad;
  }, STRICT_SELECTORS);
}
```

`page.evaluate` accepts `STRICT_SELECTORS` directly — it is a plain `string[]`
and serializes fine. (An earlier draft referenced an undefined `selectorsArg` and
claimed a spread was required; both were wrong. Since `e2e/**` is outside eslint
and tsconfig, nothing but running the spec would have caught it.)

`#mw-info` is a guess at the info `<summary>`'s id — grep
`src/components/InteractiveMap.astro` around `:500` and use the real one, or drop
it from the list. Do not ship a selector that silently matches nothing.

Then add one test per page:

```ts
    test(`${p.name}: strict-set tap targets are ≥44px in both axes`, async ({ page }) => {
      await page.goto(p.url);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);
      // Open the mobile menu so its items are measurable.
      const summary = page.locator('#mobile-menu summary');
      if (await summary.count()) await summary.click();
      expect(await strictViolations(page)).toEqual([]);
    });
```

And a dedicated `/mapa` test — `/mapa` is deliberately **not** added to `PAGES`
(its no-scroll design and dense controls would fail the overflow and global
rules for unrelated reasons):

```ts
  test('mapa: mobile-visible chrome meets the strict rule', async ({ page }) => {
    await page.goto('mapa');
    await expect(page.locator('#layerbtn-base')).toBeVisible(); // rail wired up
    expect(await strictViolations(page)).toEqual([]);
  });
```

Known coverage limit, to state in the PR rather than leave implicit: this `/mapa`
test runs with the controls panel **closed**, so everything `hidden sm:*` is
`display:none` and skipped by the zero-size guard. D3 reveals those controls on
mobile and must therefore re-check them with the panel open — see D3 Step 7.

- [ ] **Step 2: Run and record the exact failures**

```bash
npx playwright test e2e/mobile-audit.spec.ts
```

Expected failures, with the sizes re-measured during plan review: mobile-menu
items **36px** tall, footer links **32px**, `#tl-play`/`#tl-prev`/`#tl-next`
**24px each**, `#mw-search-toggle`/`#maploc`/`#mw-settings`/info summary
**36px**. Copy the reported geometry into the PR body — it is the before/after
evidence. If a reported size differs from these, trust the test and say so.

- [ ] **Step 3: Fix the menu and footer links**

Mobile-menu and catalog items: `block px-3 py-2` → 44px tall. Replace on each
item `<a>`:

```
class="flex min-h-[44px] items-center px-3 py-2 text-gray-700 hover:bg-blue-50 …"
```

(`block` → `flex min-h-[44px] items-center`; keep every colour/hover class
verbatim. For the two items with an emoji `<span>` + label `<span>`, `flex`
also needs `gap-1.5` to preserve the current spacing.)

Footer links (`:583-631`): `inline-block px-2 py-2` →
`inline-flex min-h-[44px] items-center px-2`.

- [ ] **Step 4: Fix the timeline buttons — vertically only**

The timeline is a compact centred pill (`gap-1`, `px-3 py-1.5`). Making the
buttons 44px **wide** would make adjacent 44px hit areas overlap, so taps near
a boundary would land on the wrong control. Grow the vertical axis and let the
pill get taller on mobile:

- `#tl-play` (`:252`): `px-2.5 py-1` → `flex min-h-[44px] min-w-[44px] items-center justify-center px-2.5`
- `#tl-prev` (`:268`) and `#tl-next` (`:282`): `px-1.5 py-1` →
  `inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-1.5`
- The pill container (`:242`): add `sm:py-1.5` and change the base `py-1.5` to
  `py-1` so the taller buttons do not inflate it twice over. Verify visually.

`#tl-prev`/`#tl-next` at 44px wide plus `#tl-play` and the `min-w-[7rem]` time
label must still fit inside 360px: 44×3 + 112 + gaps ≈ 260px + `px-3` — it
fits, but confirm with the overflow test in Step 6 rather than by arithmetic
alone.

- [ ] **Step 5: Fix the 36px map buttons and the model toggle**

- `#mw-search-toggle` (`:147-155`), `#maploc` (`:169-176`), `#mw-settings`
  summary (`:465`), info summary (`:500`): `h-9 w-9` → `h-11 w-11`.
  **Check the right-edge stack offsets after this.** They are `top-3` / `top-14`
  / `top-[6.25rem]`, tuned for 36px: at 44px they become exactly flush
  (12+44=56=`top-14`; 56+44=100=`6.25rem`) — adjacent with zero gap, so no test
  fails but it looks wrong. Add ~8px of separation and eyeball `/mapa`.
- `.mw-model-btn` (`:385`): `px-1.5 py-0.5` →
  `inline-flex min-h-[24px] items-center px-2` — WCAG 2.5.8 AA (24×24), not 44,
  because five 44px segments would make this corner pill ~220px wide over the
  map. **But** the "desktop-only anyway" half of that rationale expires in D3,
  which reveals `#mw-model-toggle` on mobile. So also add the touch-only bump
  that D3's reveal requires (vertical axis only, keeping the pill narrow):

```astro
      {/* 24px base floor, not 44: five 44px segments would make this corner
          pill ~220px wide over the map. WCAG 2.5.8 AA (24x24) plus the
          spacing exemption is the right target for a segmented control.
          When D3's mobile controls panel reveals this toggle on a phone,
          the group-data variant lifts each segment to a 44px-tall touch
          target while the width stays compact. */}
```

and on the button class list:
`group-data-[controls=open]/chrome:min-h-[44px] sm:min-h-[24px]`.

- [ ] **Step 6: Verify**

```bash
npx playwright test e2e/mobile-audit.spec.ts        # strict + overflow + axe
npx playwright test e2e/mapa.spec.ts               # timeline scrub still works
npm run build
```

The overflow test is the real guard on Step 4 — a wider timeline pill that
overflows 360px will fail `no horizontal overflow`. If it does, reduce
`min-w-[44px]` to `min-w-[40px]` on prev/next and document the deviation with
the measured numbers rather than silently loosening the rule.

- [ ] **Step 7: Commit**

```bash
git checkout -b feat/mobile-tap-targets
git add src/layouts/BaseLayout.astro src/components/InteractiveMap.astro e2e/mobile-audit.spec.ts
git commit -m "feat(mobile): 44px hit areas on menu, footer and timeline controls (Story 11.2)"
```

---

### Task D3: Story 11.3 — reveal `/mapa`'s hidden chrome on mobile

**Files:**
- Modify: `src/components/InteractiveMap.astro` — root div (`:118-126`),
  `#opacitywrap` (`:194`), Superposiciones `<details>` (`:223`),
  `#mw-model-toggle` (`:371`), `#mw-snapshot-wrap` (`:396`),
  `#mw-measure-wrap` (`:425`), plus a new trigger button
- Create: `e2e/mapa-mobile-controls.spec.ts`

**Interfaces:**
- Consumes: D2's sizing (the trigger must meet the strict 44px rule, so add it
  to `STRICT_SELECTORS` in the same PR).
- Produces: nothing downstream.

**Deviation from the ROADMAP:** it says "a single bottom-sheet 'Controles'
trigger that expands the rail contents". A literal bottom sheet would mean
moving DOM nodes at runtime (every one of these controls is wired by `id` from
`interactive-map.ts`, and three of them are absolutely-positioned siblings of
the rail, not children). Instead: one trigger toggles a `data-controls`
attribute on the map root, and the existing `hidden sm:*` groups gain a
`group-data-*` variant that reveals them in place. Same user outcome, no DOM
moves, no new state machine. Record this in the ROADMAP acceptance note.

- [ ] **Step 1: Write the failing test**

Create `e2e/mapa-mobile-controls.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

/**
 * Story 11.3 — opacity, overlays and the model toggle are hidden below
 * sm on /mapa, so a phone user cannot reach them at all. One "Controles"
 * trigger reveals them in place (no DOM moves — every control is wired
 * by id from interactive-map.ts).
 *
 * Asserts UI state only, matching e2e/mapa.spec.ts's convention of not
 * depending on tile pixels.
 */

test.use({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });

test('the Controles trigger reveals the hidden map chrome', async ({ page }) => {
  await page.goto('mapa');
  await expect(page.locator('#layerbtn-base')).toBeVisible();

  const trigger = page.locator('#mw-controls-toggle');
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await expect(page.locator('#opacitywrap')).toBeHidden();
  await expect(page.locator('#mw-model-toggle')).toBeHidden();

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#opacitywrap')).toBeVisible();
  await expect(page.locator('#mw-model-toggle')).toBeVisible();

  // The three acceptance actions: opacity, an overlay, the model.
  await page.locator('#opacity').fill('40');
  await expect(page.locator('#opacity')).toHaveValue('40');

  // The Superposiciones <details> has NO id; its checkbox container is
  // id={`${ids.layerBtns}-overlays`} → #layerbtns-overlays on /mapa.
  await page.locator('#layerbtns-overlays').locator('xpath=..').locator('summary').click();
  const firstOverlay = page.locator('#layerbtns-overlays input[type="checkbox"]').first();
  await firstOverlay.check();
  await expect(firstOverlay).toBeChecked();

  const gfs = page.locator('.mw-model-btn[data-model="gfs_seamless"]');
  await gfs.click();
  await expect(gfs).toHaveAttribute('aria-pressed', 'true');
});

test('Escape closes the controls panel', async ({ page }) => {
  await page.goto('mapa');
  await expect(page.locator('#layerbtn-base')).toBeVisible();
  await page.locator('#mw-controls-toggle').click();
  await expect(page.locator('#opacitywrap')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#opacitywrap')).toBeHidden();
});

test('the timeline is still usable with the panel open', async ({ page }) => {
  await page.goto('mapa');
  await expect(page.locator('#layerbtn-base')).toBeVisible();
  await page.locator('#mw-controls-toggle').click();
  await expect(page.locator('#tl-next')).toBeVisible();
  await page.locator('#tl-next').click();
  const overflow = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
});
```

Selector status, verified during plan review — `#opacitywrap`, `#opacity`,
`#mw-model-toggle`, `.mw-model-btn[data-model="gfs_seamless"]` (with
`aria-pressed`) and `#layerbtn-base` are all **correct on `/mapa`**. The one that
does not exist is `#overlays`: the Superposiciones `<details>` has no id at all,
and its checkbox container is `id={`${ids.layerBtns}-overlays`}` →
`#layerbtns-overlays`. Re-confirm before running, since these ids are
`mapId`-dependent (`InteractiveMap.astro:78-99`):

```bash
grep -n "opacitywrap\|layerBtns\|mw-model-toggle\|overlays" src/components/InteractiveMap.astro | head -20
```

Prefer giving the `<details>` a real id in Step 5 over the `xpath=..` hop above —
it is more readable and the component already namespaces every other id.

- [ ] **Step 2: Run and confirm it fails**

```bash
npx playwright test e2e/mapa-mobile-controls.spec.ts
```

Expected: fails on `#mw-controls-toggle` not existing.

- [ ] **Step 3: Add the group marker to the map root**

`src/components/InteractiveMap.astro:118-126` — add a named Tailwind v4 group
so descendants and absolutely-positioned siblings inside the root can react:

```astro
  class:list={[
    'im-root group/chrome relative w-full overflow-hidden bg-gray-100 dark:bg-gray-950',
    className,
  ]}
```

- [ ] **Step 4: Add the trigger button — gated to `/mapa`, NOT every embed**

`features.layerRail` is **also true on the homepage** (`src/pages/index.astro:66-78`,
`mapId="home-map"`, `layerRail: true`). Gating on it would drop a ⚙ FAB onto the
400px homepage teaser and let a visitor unfold the opacity slider,
Superposiciones, model toggle, snapshot and measure tools inside a 400px-tall box
with a `max-h-[70vh]` scrolling rail. No D3 test visits `/`, so nothing would
catch it.

Gate on the full-page map instead. Add a `mobileControls` feature flag
(default `false`) to the component's `features` prop, set it `true` only in
`src/pages/mapa.astro`, and namespace the id through the existing `ids` table
(`InteractiveMap.astro:78-99`) as `ids.controlsToggle` rather than hardcoding
`mw-controls-toggle` — every other `mw-*` id is hardcoded, which is exactly why
this class of leak happens. Then place it near the timeline block inside
`{features.mobileControls && (…)}`:

```astro
    <button
      id={ids.controlsToggle}
      type="button"
      aria-expanded="false"
      aria-label="Controles del mapa"
      data-i18n-en-aria-label="Map controls"
      class="absolute bottom-3 left-3 z-30 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-gray-900/85 px-3 text-sm text-white shadow-lg backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:hidden"
      >⚙</button
    >
```

`bottom-3 left-3` sits beside the centred timeline (`bottom-3 left-1/2`) rather
than under it; at 360px the timeline pill is ~260px wide and centred, leaving
~50px each side — verify no overlap in Step 7 and move the trigger to
`bottom-16 left-3` if it collides.

- [ ] **Step 5: Reveal the hidden groups when open**

Add the `group-data-*` variant alongside each existing `hidden sm:*` (keep the
`sm:` class so desktop is untouched). Tailwind v4 supports arbitrary data
variants; `group/chrome` names the ancestor:

| Line | Element | Add to class list |
|---|---|---|
| `:194` | `#opacitywrap` | `group-data-[controls=open]/chrome:block` |
| `:223` | Superposiciones `<details>` | `group-data-[controls=open]/chrome:block` |
| `:371` | `#mw-model-toggle` | `group-data-[controls=open]/chrome:inline-flex` |
| `:396` | `#mw-snapshot-wrap` | `group-data-[controls=open]/chrome:flex` |
| `:425` | `#mw-measure-wrap` | `group-data-[controls=open]/chrome:flex` |

Each variant must match the element's own desktop `display` value (`block`,
`inline-flex`, `flex`) — using the wrong one silently mislays the layout.

Cascade check, already verified against this repo's `tailwindcss@4.3.0`: the
variant compiles to
`.group-data-\[controls\=open\]\/chrome\:block{&:is(:where(.group\/chrome)[data-controls="open"] *){display:block}}`
— specificity 0,2,0 versus `.hidden`'s 0,1,0, no `!important`. The reveal wins
over `hidden`. All three display values compile. (Named groups with arbitrary
data variants are valid v4 syntax.)

The rail can now exceed a 640px-tall viewport, so add to the rail container:
`max-h-[70vh] overflow-y-auto sm:max-h-none sm:overflow-visible`.

- [ ] **Step 6: Wire the toggle**

In the component's inline `<script>` (the same one holding `bootAll`), after
the boot wiring:

```ts
  const controlsToggle = document.getElementById('mw-controls-toggle');
  const chromeRoot = controlsToggle?.closest('.im-root') as HTMLElement | null;
  if (controlsToggle && chromeRoot) {
    const setOpen = (open: boolean): void => {
      if (open) chromeRoot.dataset.controls = 'open';
      else delete chromeRoot.dataset.controls;
      controlsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    controlsToggle.addEventListener('click', () => {
      setOpen(chromeRoot.dataset.controls !== 'open');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && chromeRoot.dataset.controls === 'open') setOpen(false);
    });
  }
```

Note: `/mapa` already binds Escape elsewhere (keyboard shortcuts in
`interactive-map.ts`). Check for a conflict before shipping:

```bash
grep -n "Escape" src/lib/interactive-map.ts src/components/InteractiveMap.astro
```

If Escape already closes a popup or the search box, make this handler
last-resort (only act when nothing else is open) rather than adding a second
competing binding.

- [ ] **Step 7: Verify**

```bash
npx playwright test e2e/mapa-mobile-controls.spec.ts   # expect 3/3
npx playwright test e2e/mapa.spec.ts e2e/mobile-audit.spec.ts e2e/a11y.spec.ts
npx playwright test e2e/home.spec.ts                   # the homepage embed
npm run build
```

Three additions to D2's spec, all consequences of revealing controls on mobile:

1. Add the trigger's id to `STRICT_SELECTORS`.
2. Add a **panel-open** variant of the `/mapa` strict test — D2's version runs
   with the panel closed, so every control D3 reveals is `display:none` and
   skipped. Without this, the newly-touchable controls are untested:

```ts
  test('mapa: revealed mobile controls meet the strict rule', async ({ page }) => {
    await page.goto('mapa');
    await expect(page.locator('#layerbtn-base')).toBeVisible();
    await page.locator('#mw-controls-toggle').click();   // use the real ids.controlsToggle
    expect(await strictViolations(page)).toEqual([]);
  });
```

   Add `.mw-model-btn` to `STRICT_SELECTORS` **only if** you keep the 44px
   `group-data` bump from D2 Step 5; otherwise assert its 24px floor separately
   so the documented deviation is actually enforced somewhere.
3. Confirm `/` is unaffected: the trigger must not exist there
   (`await expect(page.locator('#mw-controls-toggle')).toHaveCount(0)` in
   `e2e/home.spec.ts` or the new spec).

- [ ] **Step 8: Commit**

```bash
git checkout -b feat/mapa-mobile-controls
git add src/components/InteractiveMap.astro e2e/mapa-mobile-controls.spec.ts e2e/mobile-audit.spec.ts
git commit -m "feat(mapa): reveal opacity, overlays and model controls on mobile (Story 11.3)"
```

- [ ] **Step 9: Hand the ROADMAP updates to the end-of-cycle docs commit**

Do **not** edit `docs/ROADMAP.md` on this branch — A4 owns that file (see its
sequencing rule). Note in the PR body what needs ticking (11.1/11.2/11.3) and the
D3 deviation (reveal-in-place instead of a bottom sheet, and why), and fold it
into the single docs commit at the end of the cycle.

---

## Self-review

**Spec coverage.** Every item in the sitrep and every open ROADMAP story
touched by it maps to a task: gitignore → A1; branch sprawl → A2; stashes → A3;
stale roadmap → A4; 7 Dependabot PRs → B1 (5 actions) + B2 (npm group) + B3
(lint-staged); Story 10.1 → C1; Story 10.2 → C2 (fix) + C4 (nudge removal);
Story 10.3 → C3; Story 11.1 → D1; Story 11.2 → D2; Story 11.3 → D3.
**Deliberately not covered:** E12 (plugin-registry migration, P2 — sequenced
after E10/E11 by the ROADMAP's own execution order), E13/E14, and issue #136.
The three `refactor-*` orphan branches in A2 Step 5 are E12 groundwork and are
kept, not deleted.

**Placeholder scan.** One real placeholder existed and was fixed after review:
D2's `strictViolations` referenced an undefined `selectorsArg`. Two values still
defer to a runtime check rather than a source claim — the info `<summary>`'s id in
D2's `STRICT_SELECTORS` (`#mw-info` is a guess) and the Feed RSS href in D1 Step 5
— each with an explicit "verify, do not guess" instruction.

**Type/name consistency.** `sampleCanvas`/`SAMPLE` share one variance formula
across C1 and C3, now with per-target floors (`/mapa` 40, `/forecast` 15) derived
from measured baselines rather than one guessed constant.
`STRICT_SELECTORS`/`strictViolations` are defined once in D2 and extended twice in
D3 Step 7. `data-controls="open"` and `group/chrome` are consistent across D3
Steps 3–7; the trigger is `ids.controlsToggle`, not a hardcoded id.

**Corrections applied after adversarial review.** The review found 5 blockers and
12 majors by executing the plan's own code against the repo. The substantive
reversals: the "synchronous `triggerRepaint()`" fix and its unit test were deleted
(`triggerRepaint` is rAF-based internally); the hidden-tab tests were replaced
with rAF-starvation tests (`bringToFront()` does not background a page); both
probe scripts moved out of the scratchpad (no `node_modules` above `/private/tmp`);
the `windRaf` "dead code" claim was retracted (it is assigned at
`interactive-map.ts:1074`); D3's trigger was gated off the homepage embed; the
branch counts were corrected (140 safe / 6 to review, not 141 / 5); and B3's hook
smoke test was rewritten (it targeted a nonexistent file, could not fail, and its
cleanup would have discarded a Dependabot commit).

## Risks and open decisions

Ordered worst-first, including the two the pre-review draft omitted.

1. **Track C's only behavioural guard is one narrow test.** C3's pixel tests pass
   on unmodified `main` (both targets already paint), so they prove nothing about
   C2 — they exist solely to gate C4's deletions. The rAF-starvation test is the
   only fail-before/pass-after assertion in the track, and the source-text unit
   test cannot detect a behavioural regression at all. If that test turns out not
   to fail on `main`, **Track C has no proof and C4 must not run.**
2. **C4 deletes six PRs' worth of workaround on thin evidence.** The gate now
   requires the human's real-device answer, not just the probe — because the probe
   cannot produce a "reproduces in foreground" verdict, which would make it a
   rubber stamp. The risk is inherent, not eliminated: "we couldn't reproduce it"
   is weaker grounds for deletion than "we understand it".
3. **`docs/ROADMAP.md` is a three-way conflict** (A4, C, D all want it). Resolved
   by making A4 its only editor and deferring checkbox ticks to one end-of-cycle
   commit. `src/components/InteractiveMap.astro` is a three-way too (C2 docblock,
   D2 classes, D3 structure) — run C before D, or rebase.
4. **`e2e/**` gets no static checking** (excluded from eslint and tsconfig), so
   every spec here is verified only by running it. Budget for selector iteration;
   `npm run lint && npm run type-check` is not a gate on spec code.
5. **The `/forecast` pixel margin is thin** — measured variance 45 against a floor
   of 15, on a near-uniform temperature field. Expect occasional flake; report the
   measured spread, never move the floor to get green.
6. **D2 Step 4 could overflow 360px.** The overflow assertion is the gate; the
   documented fallback is a narrower `min-w` with the measured numbers recorded,
   not a loosened rule.
7. **D3 changes a component shared by two pages.** The homepage leak is now gated
   behind a `mobileControls` flag plus a `toHaveCount(0)` assertion on `/`, but any
   future embed that flips that flag inherits the whole panel.
8. **A2/A3 are irreversible-ish.** Both have explicit confirmation gates.
   Remote-branch deletion is out of scope entirely.
9. **B3 (lint-staged v17) may need to stay open.** Comment and leave it rather
   than force a broken pre-commit hook.
10. **Two `Escape` bindings on `/mapa`** (D3 Step 6) — grep first, subordinate the
    new one if the map already handles it.

**Uncovered by design:** Story 10.2's fourth bullet (evaluate an eager
`maplibre-gl` import on `/mapa`) has no task — it is a perf experiment, not part of
the boot fix, and needs its own measurement. The `/forecast` embed's "≤3s paint"
miss is likewise recorded, not fixed. Both belong in a follow-up.

**Resolved during review, no longer risks:** headless WebGL works here
(`{ok: true, renderer: 'WebKit WebGL'}`); Tailwind v4's
`group-data-[controls=open]/chrome:*` compiles and beats `hidden` on specificity;
vitest collects `src/lib/map/boot-scheduling.test.ts` and its relative paths
resolve; `expect.poll(...).toBeGreaterThan(...)` and `fill()` on a range input are
correct for PW 1.60.
