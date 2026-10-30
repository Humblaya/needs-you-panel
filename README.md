# Needs You panel

A mod for [Claude Code](https://code.claude.com) that keeps a **Needs You** pane beside the chat. It gathers everything that is waiting on you, across all your Claude Code sessions, in one list:

1. **Needs you**: questions Claude asked you and you have not answered yet, runs that failed and then went quiet, finished turns you have not looked at, and approvals your guard hook asked for.
2. **Ready**: your open pull requests on GitHub, with how many checks pass, fail or are still running.
3. **Running**: sub-agents that are working right now.
4. **Today**: how many times your guard hook asked or blocked today, how many agent runs finished, and any skills installed or removed today.

It comes in four looks, and a **change design** button (or the `t` key) switches between them. Your choice is remembered for the next session.

It makes no model calls. It reads only files that changed since its last look, does a small amount of work per tick, and stops working while the pane is hidden.

## The four looks

The pictures below are text versions of the 48-column layout with made-up sample data. In the terminal each look has its own colours and pixel art (drawn with half blocks), and gentle motion: blinking cursors, spinners, a sweeping scanline, a train running down a line. The pane narrows to a 36-column layout when there is less room.

### Hi-Score: an arcade cabinet
Every item is a level to clear; an empty list says **STAGE CLEAR**.

```text
▄████████▄  NEEDS YOU                      HI 04
██████████  4 need you · 3 ready · 2 running
██████████
 ██▀▀▀▀▀▀   PRESS O TO OPEN · X TO SKIP

 1  NEEDS YOU ································ 4
▶  APPROVE  This push goes to main.          now
            guard · demo-app
            o: OPEN  x: SKIP
   ASKS     Which colour should the button…   2m
            Colour picker work · demo-app
   FAILED   Bash failed                       5m
            Test run · sample-site
   DONE     The report is ready.             18m
            Report writer · notes

 2  READY ··················· 3 open, not merged
  #12  parser        Add a parser        ✓ 20/20
  #42  app           Fix the streak cou… × 14/16
  #7   site          New header          ◐  6/11

 3  RUNNING ·································· 2
  ◐ Explore        demo-app                  12m
  ◐ reviewer       notes                      3m

 4  TODAY ·····································
  blocked 2 · asked 3 · runs 9

t: DESIGN ▸ HI-SCORE m: MOTION OFF r: REFRESH
tab move · enter select · o open · x skip k: key
```

### Halo: a heads-up display
Corner brackets, a reticle and a threat meter that fills with each waiting item; an empty list says **ALL SECTORS CLEAR**.

```text
┌─                                            ─┐
  ▄▀▀▀▀▄   N E E D S  Y O U        THREAT ▮▮▮▮▯
 █  ██  █  4 open · 3 PRs · 2 agents      14:02
  ▀▄▄▄▄▀   link ok · synced just now
└─                                            ─┘
▸ NEEDS YOU [04] ───────────────────────────────
▌◉ APPROVE  This push goes to main.         now
▌ └ guard › demo-app
▌   o: OPEN  x: SKIP
 ◉ ASKS     Which colour should the butto…   2m
  └ Colour picker work › demo-app
 ◉ FAILED   Bash failed                      5m
  └ Test run › sample-site
 ○ DONE     The report is ready.            18m
  └ Report writer › notes
▸ READY [03] ───────────────────────────────────
  parser #12        ▰▰▰▰▰▰▰▰▰▰            20/20
   └ Add a parser · not merged
  app #42           ▰▰▰▰▰▰▰▰▰▱            14/16
   └ Fix the streak count · not merged
  site #7           ▰▰▰▰▰▱▱▱▱▱             6/11
   └ New header · not merged
▸ RUNNING [02] ─────────────────────────────────
  ⠋ Explore        demo-app                 12m
  ⠋ reviewer       notes                     3m
▸ TODAY [··] ───────────────────────────────────
  guard 2 blocked · 3 asked · 9 runs

t: DESIGN ▸ HALO m: MOTION OFF r: REFRESH
tab move · enter select · o open · x skip k: key
```

### Metro: a transit map
Each section is a coloured line, each item a stop, and running agents are a train moving down line A; an empty list says **End of the line**.

```text
 ◉ NEEDS YOU                    4 stops · 14:02
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀

 N  NEEDS YOU  line N · 4 stops
 ●  This push goes to main.                  now
 ┃  approve · guard · demo-app
 ┃  o: OPEN  x: SKIP
 ●  Which colour should the button be?        2m
 ┃  asks · Colour picker work · demo-app
 ×  Bash failed                               5m
 ┃  failed · Test run · sample-site
 ○  The report is ready.                     18m
 ╹  done · Report writer · notes

 R  READY  line R · not merged
 ┃  #12  parser        Add a parser      ✓ 20/20
 ┃  #42  app           Fix the streak …  × 14/16
 ╹  #7   site          New header        ◌  6/11

 A  RUNNING  line A · 2 agents
 ┃  Explore        demo-app                  12m
 ┃  reviewer       notes                      3m
 ╹

 T  TODAY
 ╹  blocked 2 · asked 3 · runs 9

t: DESIGN ▸ METRO m: MOTION OFF r: REFRESH
tab move · enter select · o open · x skip k: key
```

### Thermal: a heat camera
The hotter an item glows, the sooner it needs you, with a strip of the last day's activity on top; an empty list says **Everything has cooled down**.

```text
NEEDS YOU  core 4°         hot 4  warm 3  cool 2
         ▄  ▄█▄          ▄  ▄█▄          ▄  ▄█▄
▄▄▄▄▄▄█▄████████▄▄▄▄▄▄█▄████████▄▄▄▄▄▄█▄████████
-24h                              activity · now

HOT · needs you                                4
██ approve  This push goes to main.          now
██          guard · demo-app
▀▀          o: OPEN  x: SKIP
██ asks     Which colour should the button…   2m
██          Colour picker work · demo-app
██ failed   Bash failed                       5m
██          Test run · sample-site
██ done     The report is ready.             18m
██          Report writer · notes

WARM · ready, not merged                       3
▐▌ #12  parser        Add a parser       ✓ 20/20
▐▌ #42  app           Fix the streak co… × 14/16
▐▌ #7   site          New header         ⠋  6/11

COOL · running                                 2
▕▏ ⠋ Explore        demo-app                 12m
▕▏ ⠋ reviewer       notes                     3m

TODAY blocked 2 · asked 3 · runs 9

t: DESIGN ▸ THERMAL m: MOTION OFF r: REFRESH
tab move · enter select · o open · x skip k: key
```

## Install

At the prompt of a Claude Code terminal session:

```text
/plugin install needs-you-panel --marketplace Humblaya/needs-you-panel
```

Answer `y` to add the marketplace, then pick a scope (the user scope is first; press Enter).

From a shell instead:

```text
claude plugin install needs-you-panel --marketplace Humblaya/needs-you-panel
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `Humblaya/needs-you-panel`, then Add plugin.

## Use

- The pane opens by itself beside the chat when the terminal is wide enough (Claude Code docks it in fullscreen mode). Type `/needs-you` to open it at any width and give it the keyboard.
- **Tab** moves between items and buttons. **Enter** on an item selects it; Enter again shows its details.
- **o** opens or closes the selected item's details, **x** skips (hides) it. Skipped items stay hidden in later sessions.
- **t** changes the design, **m** turns motion on or off (Reduce motion), **r** refreshes now.
- The small, dim, underlined **key** button (or **k**) opens a short legend of what each colour and marker means in the current look, and the switches. Press it again to close it; it stays open or closed in later sessions.
- When skills changed today, Today shows a button such as **+3 skills**; press it to list their names.

The keys work while the pane has the keyboard (after `/needs-you`, a click on the pane, or ctrl+x tab).

## Where the data comes from

| Section | Source |
| --- | --- |
| Open questions | Claude Code transcripts in `~/.claude/projects/*/*.jsonl` changed in the last 14 days: an `AskUserQuestion` call with no answer yet |
| Failed runs | The same transcripts: the last thing in a session is a failed tool result, and nothing came after it for 30 seconds (failures you caused by interrupting are left out) |
| Finished work | The same transcripts: the session ends on a finished turn that came after the panel was first installed, and you have not skipped it (the session you are in is left out) |
| Guard approvals | `~/.claude/needs-you/guard.jsonl`, written by the optional guard hook below; asks from the last 10 minutes are listed |
| Ready | `gh search prs --author @me --state open`, then `gh pr checks` for each (up to 10), at most every 2 minutes or when you press `r` |
| Running | `~/.claude/needs-you/agents.jsonl`, written by the optional agent hook below: agents that started and have not stopped (older than 2 hours counts as stale and is left out) |
| Today | The two log files above, and `~/.claude/needs-you/skills.json` when present |

Transcripts bigger than 4 MB are read from their last 1 MB, using `tail` or, where that is missing (as on Windows), `node`.

## Optional hook scripts

The Running, Today and guard-approval parts need two small logs that Claude Code's settings hooks write. Example scripts are in [`extras/hooks`](extras/hooks). Both need [Node.js](https://nodejs.org), never block anything, and fail silently.

- **`needs-you-agents.js`** writes one line per sub-agent start and stop (time, start or stop, agent type, project folder name, agent id). Copy it to `~/.claude/hooks/` and add it to `~/.claude/settings.json`, next to any hooks you already have:

  ```json
  {
    "hooks": {
      "SubagentStart": [{ "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/needs-you-agents.js", "timeout": 10 }] }],
      "SubagentStop": [{ "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/needs-you-agents.js", "timeout": 10 }] }]
    }
  }
  ```

- **`guard.js`** is an example PreToolUse guard for the Bash and PowerShell tools. It asks before a push or commit to `main`, a pull-request merge or a force push, and blocks committing files that look like secrets and piping a download straight into a shell. Each ask or block also writes one line (time, decision, the reason's first sentence, project folder name; never the command) to `~/.claude/needs-you/guard.jsonl`. If you already have a guard, you only need its logging part: the `logDecision` function. Register it as a `PreToolUse` hook with the matcher `Bash|PowerShell`.

### skills.json: an optional input any hook can write

The panel also reads `~/.claude/needs-you/skills.json`, if it exists. Any script of yours (for example a SessionStart hook that notices new skills) can write it:

```json
{ "time": "2026-01-05T09:30:00.000Z", "added": ["skill-one", "skill-two"], "removed": ["old-skill"] }
```

When `time` is today, Today shows the change and lists the names on request. Keep the first `time` when you report the same change again, so it does not show as new every day. No script for this ships here.

Tests for both: `node extras/hooks/guard.test.js` and `node extras/hooks/needs-you-agents.test.js`.

On Windows, write the script path with forward slashes and quotes, for example `node "C:/Users/<you>/.claude/hooks/needs-you-agents.js"`.

## Requirements

- Claude Code with mods (plugins with a function-hooks module); built and tested on 2.1.314.
- The [GitHub CLI](https://cli.github.com) (`gh`), signed in, for the Ready section. Without it the section says so and the rest still works.
- Node.js for the optional hook scripts.
- A terminal font that has the box-drawing, block and braille characters (Cascadia Mono, the Windows Terminal default, does).

## Develop

```text
claude plugin validate .
claude plugin test .
```

`claude --plugin-dir .` starts a session with the mod loaded from this folder.

## Licence

MIT, see [LICENSE](LICENSE).
