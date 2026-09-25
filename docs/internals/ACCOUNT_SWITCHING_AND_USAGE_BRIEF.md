# Brief: account switching, quota popup, multi-account usage, provider list

Written 2026-09-25 from a live incident on the founder's T3 setup. C0code carries the
same code, so it has the same defects. Line numbers refer to
`codex/c0code-t3-rebase-20260908` at `45dd39f7b`. Locate code by symbol name if they
have moved.

Work order: Part 1 first (it loses conversations), then Part 4 (small), then 2 and 3.

## Setup this must work with

The founder runs three ChatGPT accounts as three Codex provider instances: Dagga GPT
(`codex`), Poly GPT (`codex-poly`) and Better GPT (`codex-better`). All three share one
`homePath` (`~/.codex-daggarage`), so they share a continuation key
(`codex:home:/home/bdd-main/.codex-daggarage`). Poly and Better use `shadowHomePath` for
their own `auth.json`. They also share one Codex binary (a mise shim). Claude and
OpenCode are enabled too. When one account reaches its weekly limit, work must continue
on another account in the same thread, with the conversation intact.

## Part 1: switching accounts loses the conversation (P0)

### What happened

1. A thread on Poly GPT reached the weekly Codex limit.
2. The founder disabled Poly (and Dagga, also exhausted) and picked Better GPT in the
   thread.
3. Sending failed with `ProviderUnsupportedError: Provider 'codex-poly' is not implemented`
   at `startSession`.
4. With Poly left enabled, the send would have appeared to work, but Codex would have
   started a new thread without the conversation. The binding's resume cursor would
   then have been overwritten, and nothing would have told the user.

### Root cause

`apps/server/src/provider/Layers/ProviderService.ts`, `startSession` (around line 1358):

- The compatibility check reads the previous instance through
  `registry.getInstanceInfo(previousInstanceId)`. A disabled or deleted instance is not
  in the registry, so the lookup fails.
- `effectiveResumeCursor` and `effectiveCwd` reuse the persisted binding's values only
  when `persistedBinding.providerInstanceId === resolvedInstanceId`. After a switch
  passes the continuation-key check, the cursor is still discarded.

`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`, `ensureSessionForThread`
(line 577):

- `currentInfo` comes from `providerService.getInstanceInfo(currentInstanceId)` and fails
  for a disabled current instance with "references unknown provider instance".
- Only the live-session branch passes `activeSession.resumeCursor`. When no session is
  running (after a stop, a server restart, or disabling the account), the cursor depends
  on `startSession`, which drops it.

### Required change

1. **Resolve the continuation identity from configuration.** It must not depend on the
   live registry: a disabled or configured-but-not-running instance still has one.
   `CodexHomeLayout.resolveCodexHomeLayout` already derives the key from config. Also
   persist the key on the binding: add a `continuation_key` column to
   `provider_session_runtime` through a migration and write it in
   `upsertSessionBinding`. Then a switch away from a deleted instance still works.
2. **Carry the resume point across compatible switches.** In `startSession`, when the
   persisted binding belongs to another instance of the same driver with an equal
   continuation key, reuse `persistedBinding.resumeCursor` and the persisted cwd. Record
   the span attribute `provider.resume_cursor.source = "persisted-continuation"`.
3. **Treat a disabled instance as known but not runnable.** Disabling an account must
   never strand its threads. In `ensureSessionForThread`, the old instance only needs to
   be known, not runnable.
4. **Never start fresh without saying so.** If the binding has a resume cursor and the
   switch is incompatible (different continuation key or driver), reject it, leave the
   binding unchanged, and offer to fork into a new thread. Upstream is working on forks
   in `upstream/fork-usage-limited-turns`; reuse that instead of building a second one.

### Tests

Add these to `ProviderService.test.ts` and `ProviderCommandReactor.test.ts`:

- **No live session:** Poly → Better, same `homePath`. The adapter's `startSession`
  receives Poly's resume cursor and cwd, and the binding keeps the same Codex thread id.
- **Old account disabled:** the same switch with Poly disabled succeeds.
- **Old account deleted:** the same switch with Poly removed from settings succeeds,
  using the persisted `continuation_key`.
- **Incompatible switch:** a different `homePath` is rejected, and the binding and its
  cursor are unchanged.
- **Live session:** the existing live-session switch still passes.

### Acceptance

A dev build replays the incident: exhaust or disable Poly, pick Better, send
`continue`. The reply shows the model still has the thread's context.

### Stopgap on the founder's machine

Until this ships, `~/.local/bin/t3-account-switch` installs an SQLite trigger in the T3
shared backend's database. On `thread.turn-start-requested`, it rebinds
`provider_session_runtime` to the requested instance when both instances share a
continuation key. It is removed before every T3 start and reinstalled once T3 listens
(drop-in `~/.config/systemd/user/t3-shared.service.d/account-switch.conf`). C0code must
not depend on it. Once C0code is the daily driver with this fix, run
`t3-account-switch remove` and disable `t3-account-switch.path`.

## Part 2: suggest another account when quota runs out

### When to show it

- **After a failed turn.** A turn fails on a usage limit. `CodexAdapter.ts` already
  detects `codexErrorInfo === "usageLimitExceeded"` (lines 2382 and 2396); add the Claude
  equivalent.
- **Before sending.** The selected instance's latest `usageLimits` show an exhausted
  window (`usedPercent >= 100`, or Codex `ordinaryUsageAllowed: false`). Show the popup
  instead of sending a turn that will fail.

### Server

- Add an RPC (or a snapshot field) that returns switch candidates for a thread. Cover
  every configured instance, enabled or not, except unauthenticated ones. For each,
  return:
  - display name and driver
  - `keepsConversation` (same continuation key as the thread's binding)
  - remaining percent per window and `resetsAt`
  - enabled state
  - available reset credits
- Rank the candidates: `keepsConversation` first, then the most remaining quota, then
  the soonest reset. Put ranking in a pure function in `packages/shared` with unit tests.
- **Probe disabled accounts too.** The registry drops disabled instances today, so their
  quota is unknown. Probe every configured account with Codex `account/rateLimits/read`,
  using that instance's effective `CODEX_HOME` (the shadow home when set); the mapping
  already exists in `codexUsageLimits.ts`. Cache results and probe when the popup opens
  and every few minutes. Never probe more often than every 60 seconds per account.

### Web

**The popup.** Show it as a dialog anchored to the composer, not a toast.

- **Title:** "Poly GPT reached its weekly limit", with the reset in local time ("Resets
  Tue 30 Sep, 21:58").
- **One row per candidate:**
  - the full account name
  - a remaining-quota bar, reusing `LimitWindows` and `barColor` from
    `components/usage/UsageLimits.tsx`
  - the reset time
  - a label: "Keeps this conversation" or "Starts a new thread"
- **Primary action:** "Continue on Better GPT". It switches the thread's model selection
  and resends the failed message in one step.
- **Secondary actions:**
  - "Wait for reset"
  - "Use reset credit", only when credits exist (reuse `useResetCredit` and
    `ResetCreditDialog`)
  - an "Always switch automatically" checkbox
- **Keyboard:** Enter runs the primary action, Esc closes the dialog.

**Setting.** Add `usageLimitSwitch: "ask" | "auto" | "off"`, defaulting to `"ask"`. In
`"auto"`, switch to the best candidate that keeps the conversation, resend, and show an
inline notice with Undo: "Switched to Better GPT. Poly resets Tue 30 Sep."

**Model picker.** Show remaining quota next to each account, with a warning mark on
exhausted accounts. They stay selectable; selecting one opens the popup.

**Motion.** Animate the popup's entrance and each state change with the existing motion
tokens (SMT rule).

## Part 3: multi-account usage, stats and graphs

What exists: per-instance `ServerProvider.usageLimits`, merged live through
`applyUsageLimitsUpdate`; the pooled view (`UsageLimitsPooled.tsx`, using
`@t3tools/shared/usageLimits`); external `UsageLimitSources`; and the composer banner
(`ComposerUsageLimits.tsx`). No history is stored, so stats and graphs are impossible
today.

1. **Every configured account shows live usage, disabled ones included** (using the
   probe from Part 2), for example "Disabled · resets in 4d 22h".
2. **Updates are reliable:**
   - after every turn
   - when the popup or usage view opens
   - on the existing refresh interval
   - through a per-account refresh button that visibly spins and reports failure
   "Checked just now" must reflect the last successful probe for that account.
3. **History.** Add a `provider_usage_samples` table (instance id, window id,
   used percent, resets at, sampled at). Write a sample when a value changes, and at
   most every 5 minutes per window. Keep 90 days.
4. **Stats per account:**
   - used this window
   - burn rate over the last 24 hours
   - projected run-out time compared with the reset ("At this pace Better runs out Mon
     14:00, a day before reset")
   - turns and tokens per account (token counts already exist in the
     `context-window.updated` thread activities)
5. **Graphs,** in a Usage view under Settings:
   - used percent over the current window per account, with reset markers
   - daily work by account as stacked bars
   - a reset timeline showing when capacity returns
   Colour each account with its stored accent colour (`ProviderAccentColorPicker`).
   Follow the repo's chart conventions and keep them legible in light and dark themes.
6. **Pooled summary** for accounts that share a conversation store, for example "1 of 3
   GPT accounts available. Next reset Tue 30 Sep, 11:24."

## Part 4: provider list in Settings → Providers

### Problems

- **Truncated names.** `components/settings/ProviderInstanceCard.tsx`, list mode (around
  lines 593–680), puts the display name, the instance-id chip, the version and the update
  icon in one flex row. Only the name truncates, so "Better GPT" renders as "Be...".
- **Low-value items crowd the row.** The instance id and version take space that
  account state needs more.
- **The update click does nothing useful.** In list mode the `ArrowUpCircleIcon` either
  copies the update command to the clipboard or is a non-interactive `span`.
  `onRunUpdate` is wired only for `mode === "editor"` (`ProviderSettingsPanel.tsx`,
  around lines 961–970), and only for instances that pass
  `isProviderSettingsUpdateCandidate`. The founder's Codex binary is a mise shim shared
  by three instances, which is likely why no real update action appears.

### Required change

- **Line 1:** the icon and the full display name. The name gets priority width and may
  wrap to two lines. Never truncate it to a few characters.
- **Line 2:** the existing status summary, plus a small remaining-quota bar for
  accounts that report usage.
- **Right side:** the enable switch, plus an "Update" pill only when an update exists.
- **Move to the editor panel:** the instance-id chip (also add it as a tooltip on the
  name) and the version.
- **Make the update pill work:**
  - Wire `runProviderUpdate` in list mode, with "Updating..." and a result toast.
  - When an instance cannot update itself (custom binary path, or a binary shared with
    other instances), open a popover that explains why, shows the exact command, and
    offers Copy.
  - Offer "Update all instances using this binary": one update should refresh all three
    GPT cards.
- **Screenshot gate:** capture Settings → Providers before and after, at 1280 px and at
  a narrow width, using the founder's real instance set.

## Delivery

- Cut the work from the current head of the C0code branch. Deliver Part 1 as its own PR.
- **Gates:** `bun fmt`, `bun lint`, `bun typecheck`, `bun run test`. Never run
  `bun test`.
- **Where gates run:** heavy gates run on the fleet, not the founder's laptop:
  `cd ~/DEV/SMA && ./tools/spl-exec --lease auto --label "c0code gates" --host sing|song -- <cmd>`
- **Upstream:** the Part 1 fix belongs upstream in pingdotgg/t3code. Keep it
  self-contained and draft the upstream PR text with it.
- **Report back with:**
  - the tests you added
  - the Part 4 screenshots
  - a recording or log of the Part 1 replay
  - anything you could not verify, stated as not verified
