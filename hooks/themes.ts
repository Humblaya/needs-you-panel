// The four looks. Each builds the same sections (Needs you, Ready, Running,
// Today) as rows of cells, 48 columns wide or 36 when narrow.
import type { NeedItem, NeedKind, Pr, Snapshot, ThemeId } from '../types'
import type { PxSeg, Row, Seg, TextSeg } from './cells'
import { S, fit, line, lr, pad, pixels, rpad, segWidth } from './cells'
import { ageLabel } from './data'

export const THEMES: ThemeId[] = ['hiscore', 'halo', 'metro', 'thermal']
export const THEME_NAMES: Record<ThemeId, string> = {
  hiscore: 'Hi-Score',
  halo: 'Halo',
  metro: 'Metro',
  thermal: 'Thermal',
}
export const nextTheme = (t: ThemeId): ThemeId => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length] ?? 'hiscore'

export type Ctx = {
  W: number
  narrow: boolean
  snap: Snapshot
  selected: string
  isDetailOpen: boolean
  isKeyOpen: boolean
  isSkillsOpen: boolean
  frame: number
  motion: boolean
  now: number
  theme: ThemeId
}

type Style = Omit<TextSeg, 't'>
export type Look = { bg: string; fg: string; rows: Row[] }

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const QUARTERS = ['◐', '◓', '◑', '◒']
const TAG: Record<NeedKind, [string, string]> = {
  approve: ['APPROVE', 'APPR'],
  question: ['ASKS', 'ASKS'],
  failed: ['FAILED', 'FAIL'],
  finished: ['DONE', 'DONE'],
}

const tagOf = (c: Ctx, k: NeedKind) => TAG[k][c.narrow ? 1 : 0]
const age = (c: Ctx, at: number) => ageLabel(Math.max(0, c.now - at))
const two = (n: number) => rpad(String(Math.min(n, 99)), 2).replace(' ', '0')
const clock = (now: number) => {
  const d = new Date(now)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}
const shortRepo = (repo: string) => repo.split('/').pop() ?? repo
const prState = (p: Pr) => (p.fail > 0 ? 'fail' : p.running > 0 ? 'run' : p.total > 0 ? 'pass' : 'none')
const prCount = (p: Pr) => (p.total > 0 ? `${p.pass}/${p.total}` : '-')
/** Two-step blink, about 0.75 s a step; still when motion is off. */
const blink = (c: Ctx, a: string, b: string) => (c.motion && Math.floor(c.frame / 3) % 2 === 1 ? b : a)
const spin = (c: Ctx, frames: string[], offset = 0) => (c.motion ? frames[(c.frame + offset) % frames.length]! : frames[0]!)

const selectedItem = (c: Ctx): NeedItem | undefined =>
  c.snap.needs.find(i => i.id === c.selected)

const wrap = (text: string, w: number, max: number) => {
  const out: string[] = []
  let cur = ''
  for (const word of text.replace(/\s+/g, ' ').trim().split(' ')) {
    if (cur && [...(cur + ' ' + word)].length > w) {
      out.push(cur)
      cur = ''
    }
    cur = cur ? `${cur} ${word}` : word
    while ([...cur].length > w) {
      out.push([...cur].slice(0, w).join(''))
      cur = [...cur].slice(w).join('')
    }
  }
  if (cur) out.push(cur)
  return out.length > max ? [...out.slice(0, max - 1), fit(out.slice(max - 1).join(' '), w)] : out
}

const leadWidth = (lead: Seg[]) => lead.reduce((n, s) => n + ('t' in s ? [...s.t].length : 0), 0)

/**
 * One needs-you item, spaced out: a gap row before it (none for the first),
 * its title on its own row (press it to open or close it), then one meta row
 * (who · project · age). The selected item then gets a row with its open
 * and skip buttons, and its details follow only while it is open.
 */
function itemRows(
  c: Ctx,
  it: NeedItem,
  gap: Seg[] | null,
  title: (sel: boolean) => Seg[],
  lead: Seg[],
  on: Style,
  off: Style,
  detailLead: Seg[] = [S(' '.repeat(leadWidth(lead)))],
): Row[] {
  const sel = selectedItem(c)?.id === it.id
  const rows: Row[] = gap ? [line(c.W, gap)] : []
  rows.push({ ...line(c.W, title(sel)), press: { key: `item:${it.id}`, act: { type: 'select', id: it.id } } })
  const when = age(c, it.at)
  // the age always shows; who and project give way first
  const room = c.W - leadWidth(lead)
  const meta = fit([it.who, it.project].filter(Boolean).join(' · '), room - when.length - 3) + ' · ' + when
  if (sel) {
    rows.push(line(c.W, [...lead, S(meta, { fg: off.fg })]))
    rows.push(
      line(c.W, [
        ...detailLead,
        { btn: 'open', hotkey: 'o', act: { type: 'open' }, segs: [{ ...on, t: c.isDetailOpen ? 'CLOSE' : 'OPEN' }] },
        S('  '),
        { btn: 'dismiss', hotkey: 'x', act: { type: 'dismiss', id: it.id }, segs: [{ ...off, t: 'SKIP' }] },
      ]),
    )
  }
  if (sel && c.isDetailOpen) {
    for (const para of it.detail.filter(d => d && d !== it.title)) {
      for (const l of wrap(para, c.W - leadWidth(detailLead), 6)) rows.push(line(c.W, [...detailLead, S(l, { fg: off.fg })]))
    }
  }
  return rows
}

function readyMessage(c: Ctx): string | undefined {
  const r = c.snap.ready
  if (r.status === 'loading' && r.prs.length === 0) return 'Checking GitHub…'
  if (r.status === 'no-gh') return 'Install the GitHub CLI (gh) to see PRs.'
  if (r.status === 'offline' && r.prs.length === 0) return 'GitHub not reachable · r to retry'
  if (r.prs.length === 0) return 'No open pull requests.'
  return undefined
}

/** A glyph in its colour and what it means, for the key. */
type Meaning = [glyph: string, colour: string, meaning: string]

// A 3×4 pixel font for section names. A terminal draws one font size, so
// slightly bigger letters are drawn with half blocks: each letter is 3 cells
// wide and 2 rows tall, only a little taller than a line of text.
const FONT: Record<string, string[]> = {
  A: ['010', '101', '111', '101'],
  C: ['011', '100', '100', '011'],
  D: ['110', '101', '101', '110'],
  E: ['111', '110', '100', '111'],
  G: ['011', '100', '101', '011'],
  H: ['101', '111', '101', '101'],
  I: ['111', '010', '010', '111'],
  L: ['100', '100', '100', '111'],
  M: ['111', '111', '101', '101'],
  N: ['110', '101', '101', '101'],
  O: ['010', '101', '101', '010'],
  R: ['110', '101', '110', '101'],
  S: ['011', '100', '001', '110'],
  T: ['111', '010', '010', '010'],
  U: ['101', '101', '101', '111'],
  W: ['101', '101', '111', '111'],
  Y: ['101', '101', '010', '010'],
}

/** A word in big pixel letters: two rows of half blocks in `colour` over `ground`. */
export function bigWord(word: string, colour: string, ground: string): PxSeg[] {
  const grid = ['', '', '', '']
  const chars = [...word.toUpperCase()]
  chars.forEach((ch, i) => {
    const glyph = FONT[ch]
    for (let y = 0; y < 4; y++) {
      grid[y] += glyph ? (glyph[y] ?? '000').replace(/0/g, '.').replace(/1/g, 'x') : '..'
      if (glyph && i < chars.length - 1 && FONT[chars[i + 1] ?? ''] !== undefined) grid[y] += '.'
    }
  })
  return pixels(grid, { x: colour }, ground)
}

/**
 * A section header in big letters, two rows tall: `lead` and `right` sit on
 * its lower row. Where it would not fit, `right` goes; where even the word
 * does not fit, the theme's own one-row header (`small`) is used instead.
 */
function bigSec(W: number, word: string, colour: string, ground: string, lead: Seg[], right: Seg[], small: Row): Row[] {
  const px = bigWord(word, colour, ground)
  const width = (segs: Seg[]) => segs.reduce((n, x) => n + segWidth(x), 0)
  const pxW = px[0]?.px.length ?? 0
  if (width(lead) + pxW > W) return [small]
  const r = width(lead) + pxW + 1 + width(right) <= W ? right : []
  const blank = S(' '.repeat(width(lead)))
  return px.map((p, i) => (i === px.length - 1 ? lr(W, [...lead, p], r.length ? [S(' '), ...r] : []) : line(W, [blank, p])))
}

/** The keys that move between the chat and the panel: alt+n runs /needs-you (a keybinding), esc returns. */
export const FOCUS_KEYS = 'alt+n: panel · esc: chat'

/**
 * The bottom bar: small lowercase design and refresh buttons with the key
 * button at the right, then the faint focus-keys line. While the key is open,
 * what each colour means in this look, the motion switch, and how the buttons work.
 */
function controls(c: Ctx, accent: string, dim: string, faint: string, meanings: Meaning[]): Row[] {
  const buttons: Seg[] = [
    { btn: 'design', hotkey: 't', act: { type: 'theme' }, segs: [S('design', { fg: faint })] },
    S('  '),
    { btn: 'refresh', hotkey: 'r', act: { type: 'refresh' }, segs: [S('refresh', { fg: faint })] },
  ]
  const key: Seg[] = [S(' '), { btn: 'key', hotkey: 'k', act: { type: 'key' }, segs: [S('key', { fg: faint, u: true })] }]
  const width = (segs: Seg[]) => segs.reduce((n, x) => n + segWidth(x), 0)
  // the key button never gives way: on a very narrow pane it moves to a row of its own
  const bar = width(buttons) + width(key) <= c.W ? [lr(c.W, buttons, key)] : [line(c.W, buttons), lr(c.W, [], key)]
  const rows = [...bar, line(c.W, [S(fit(FOCUS_KEYS, c.W), { fg: faint })])]
  if (c.isKeyOpen) {
    rows.push(line(c.W, []))
    for (const [glyph, colour, meaning] of meanings) {
      rows.push(line(c.W, [S('  '), S(glyph, { fg: colour }), S(' '), S(fit(meaning, c.W - 3 - [...glyph].length), { fg: dim })]))
    }
    rows.push(line(c.W, []))
    rows.push(line(c.W, [S(fit('  press a button, or its letter:', c.W), { fg: accent })]))
    const sw = (k: string, what: string) => line(c.W, [S('  ' + pad(k, 6), { fg: accent, b: true }), S(fit(what, c.W - 8), { fg: dim })])
    rows.push(sw('t', 'design: the next look'))
    rows.push(sw('r', 'refresh: check again now'))
    rows.push(line(c.W, [S('  ' + pad('m', 6), { fg: accent, b: true }), { btn: 'motion', hotkey: 'm', act: { type: 'motion' }, segs: [S(c.motion ? 'motion: on' : 'motion: off', { fg: dim })] }]))
    rows.push(sw('o', 'open: show the picked item'))
    rows.push(sw('x', 'skip: hide the picked item'))
    rows.push(sw('k', 'key: show or hide this'))
    rows.push(sw('tab', 'move to the next item'))
    rows.push(sw('enter', 'open the item you are on'))
    rows.push(sw('alt+n', 'panel (from the chat)'))
    rows.push(sw('esc', 'chat (back to typing)'))
  }
  return rows
}

/** Under Today: a button naming today's skill changes, and the names once opened. */
function skillsRows(c: Ctx, lead: Seg[], colour: string, dim: string): Row[] {
  const change = c.snap.today.skills
  if (!change) return []
  const parts = [change.added.length ? `+${change.added.length} skills` : '', change.removed.length ? `-${change.removed.length} removed` : '']
  const rows = [line(c.W, [...lead, { btn: 'skills', act: { type: 'skills' }, segs: [S(parts.filter(Boolean).join(' · '), { fg: colour })] }])]
  if (c.isSkillsOpen) {
    const leadW = lead.reduce((n, x) => n + ('t' in x ? [...x.t].length : 0), 0)
    const blank = S(' '.repeat(leadW))
    const lists: Array<[string, string[]]> = [['+ ', change.added], ['- ', change.removed]]
    for (const [mark, names] of lists) {
      if (!names.length) continue
      for (const l of wrap(mark + names.join(', '), c.W - leadW, 6)) rows.push(line(c.W, [blank, S(l, { fg: dim })]))
    }
  }
  return rows
}

const summary = (c: Ctx) =>
  `${c.snap.needs.length} need you · ${c.snap.ready.prs.length} ready · ${c.snap.running.length} running`
const todayText = (c: Ctx) =>
  `blocked ${c.snap.today.blocked} · asked ${c.snap.today.asked} · runs ${c.snap.today.runs}`

// =====================================================================
// 1. HI-SCORE: an arcade cabinet
// =====================================================================
function hiscore(c: Ctx): Look {
  const T = { bg: '#14102A', fg: '#F6F3FF' }
  const C = { pink: '#FF5CAB', red: '#FF6B57', mint: '#4CF2AE', cyan: '#5CD0FF', lemon: '#FFE45C', dim: '#A9A3CF', ink: '#14102A', rule: '#4A436E' }
  const { W, narrow, snap } = c
  const rows: Row[] = []
  const n = snap.needs.length

  const sec = (num: number, label: string, col: string, right: string) =>
    bigSec(
      W,
      label,
      col,
      T.bg,
      [S(` ${num} `, { bg: col, fg: C.ink, b: true }), S(' ')],
      right ? [S(right, { fg: C.dim })] : [],
      lr(W, [S(` ${num} `, { bg: col, fg: C.ink, b: true }), S(' '), S(label, { fg: col, b: true }), S(' ')], [S(' ' + right, { fg: C.dim })], '·', { fg: C.rule }),
    )

  if (n > 0) {
    if (narrow) {
      rows.push(lr(W, [S('◆', { fg: C.pink, b: true }), S(' NEEDS YOU', { fg: C.lemon, b: true })], [S('HI ', { fg: C.dim }), S(two(n), { fg: C.pink, b: true })]))
      rows.push(line(W, [S(summary(c), { fg: C.dim })]))
    } else {
      const sprite = pixels(['.PPPPPPPP.', 'PPPPWWPPPP', 'PPPPWWPPPP', 'PPPPWWPPPP', 'PPPPPPPPPP', 'PPPPWWPPPP', '.PPPPPPPP.', '.PP.......'], { P: C.pink, W: '#FFFFFF' }, T.bg)
      rows.push(lr(W, [sprite[0]!, S('  '), S('NEEDS YOU', { fg: C.lemon, b: true })], [S('HI ', { fg: C.dim }), S(two(n), { fg: C.pink, b: true })]))
      rows.push(line(W, [sprite[1]!, S('  '), S(summary(c), { fg: C.dim })]))
      rows.push(line(W, [sprite[2]!]))
      rows.push(line(W, [sprite[3]!, S('  '), S('TAB TO PICK · ENTER TO OPEN', { fg: blink(c, C.lemon, C.dim), b: true })]))
    }
    rows.push(line(W, []))
    rows.push(...sec(1, 'NEEDS YOU', C.pink, String(n)))
    const tagCol: Record<NeedKind, string> = { approve: C.pink, question: C.pink, failed: C.red, finished: C.lemon }
    const tw = narrow ? 4 : 8
    const indent = ' '.repeat(tw + 4)
    snap.needs.forEach((it, i) => {
      const col = tagCol[it.kind]
      rows.push(
        ...itemRows(
          c,
          it,
          i === 0 ? null : [],
          sel => [
            S(sel ? '▶' : ' ', sel ? { fg: blink(c, C.lemon, T.bg), b: true } : {}),
            S(' '),
            S(' ' + pad(tagOf(c, it.kind), tw), it.kind === 'finished' ? { fg: col, b: true } : { bg: col, fg: C.ink, b: true }),
            S(' '),
            S(fit(it.title, W - tw - 4), { fg: sel ? '#FFFFFF' : T.fg, b: true }),
          ],
          [S(indent)],
          { fg: C.lemon, b: true },
          { fg: C.dim },
        ),
      )
    })
  } else {
    const trophy = pixels(['.YYYYYY.', 'YYYYYYYY', '.YYYYYY.', '..YYYY..', '...YY...', '..YYYY..'], { Y: C.lemon }, T.bg)
    rows.push(line(W, []))
    rows.push(line(W, [S('  '), trophy[0]!, S('  '), S('STAGE CLEAR', { fg: C.lemon, b: true })]))
    rows.push(line(W, [S('  '), trophy[1]!, S('  '), S('Nothing needs you.', { fg: T.fg, b: true })]))
    rows.push(
      line(W, [S('  '), trophy[2]!, S('  '), S(`${snap.ready.prs.length} ready · ${snap.running.length} running · `, { fg: C.dim }), S('HI 00', { fg: blink(c, C.pink, C.dim) })]),
    )
  }

  rows.push(line(W, []))
  rows.push(...sec(2, 'READY', C.mint, narrow ? String(snap.ready.prs.length) : `${snap.ready.prs.length} open, not merged`))
  const msg = readyMessage(c)
  if (msg) rows.push(line(W, [S('  '), S(fit(msg, W - 2), { fg: C.dim })]))
  snap.ready.prs.forEach((p, i) => {
    const s = prState(p)
    const st =
      s === 'pass' ? S('✓ ' + rpad(prCount(p), 5), { fg: C.mint, b: true })
      : s === 'fail' ? S('× ' + rpad(prCount(p), 5), { fg: C.red, b: true })
      : s === 'run' ? S(spin(c, QUARTERS, i) + ' ' + rpad(prCount(p), 5), { fg: C.cyan, b: true })
      : S('· ' + rpad(prCount(p), 5), { fg: C.dim })
    if (narrow) {
      rows.push(lr(W, [S('  '), S(pad('#' + p.number, 5), { fg: C.dim }), S(fit(shortRepo(p.repo), W - 15), { fg: T.fg })], [st]))
      rows.push(line(W, [S('    '), S(fit(p.title, W - 4), { fg: C.dim })]))
    } else {
      rows.push(lr(W, [S('  '), S(pad('#' + p.number, 5), { fg: C.dim }), S(pad(fit(shortRepo(p.repo), 13), 14), { fg: T.fg }), S(fit(p.title, W - 29), { fg: C.dim })], [S(' '), st]))
    }
  })

  rows.push(line(W, []))
  rows.push(...sec(3, 'RUNNING', C.cyan, String(snap.running.length)))
  if (snap.running.length === 0) rows.push(line(W, [S('  '), S('No agents running.', { fg: C.dim })]))
  snap.running.forEach((r, i) => {
    rows.push(
      lr(W, [S('  '), S(spin(c, QUARTERS, i), { fg: C.cyan }), S(' '), S(pad(fit(r.who, 14), 15), { fg: C.cyan, b: true }), S(fit(r.project, W - 24), { fg: T.fg })], [S(rpad(age(c, r.at), 4), { fg: C.dim })]),
    )
  })

  rows.push(line(W, []))
  rows.push(...sec(4, 'TODAY', C.lemon, ''))
  rows.push(line(W, [S('  '), S(todayText(c), { fg: C.dim })]))
  rows.push(...skillsRows(c, [S('  ')], C.lemon, C.dim))
  rows.push(line(W, []))
  rows.push(
    ...controls(c, C.lemon, C.dim, '#6E6896', [
      ['■', C.pink, 'question or approval'],
      ['■', C.red, 'failed run'],
      ['■', C.lemon, 'finished, not viewed yet'],
      ['✓', C.mint, 'checks pass'],
      ['×', C.red, 'checks fail'],
      ['◐', C.cyan, 'checks or agent running'],
    ]),
  )
  return { ...T, rows }
}

// =====================================================================
// 2. HALO: a heads-up display
// =====================================================================
function halo(c: Ctx): Look {
  const T = { bg: '#06131C', fg: '#DDF8FF' }
  const C = { cyan: '#53E6FF', alert: '#FF5C77', amber: '#FFB547', green: '#6DFFB4', dim: '#86A9B5', rail: '#2A4A57', ink: '#06131C', white: '#FFFFFF' }
  const { W, narrow, snap } = c
  const rows: Row[] = []
  const n = snap.needs.length
  const corner = (l: string, r: string) => lr(W, [S(l, { fg: C.rail })], [S(r, { fg: C.rail })])
  const synced = snap.ready.status === 'offline' ? S('link down · retrying', { fg: C.amber }) : S(`link ok · synced ${age(c, snap.at)} ago`.replace('now ago', 'just now'), { fg: C.dim })

  if (n > 0) {
    const k = Math.min(5, n)
    const meter = [S('▮'.repeat(k), { fg: C.alert }), S('▯'.repeat(5 - k) + ' ', { fg: C.rail })]
    rows.push(corner('┌─', '─┐'))
    if (narrow) {
      rows.push(lr(W, [S(' '), S('◉', { fg: C.alert }), S(' NEEDS YOU', { fg: C.white, b: true })], meter))
      rows.push(lr(W, [S(' '), S(`${n} open · ${snap.ready.prs.length} PRs · ${snap.running.length} agents`, { fg: C.dim })], [S(clock(c.now) + ' ', { fg: C.cyan })]))
    } else {
      const ret = pixels(['..CCCC..', '.C....C.', 'C..AA..C', 'C..AA..C', '.C....C.', '..CCCC..'], { C: C.cyan, A: C.alert }, T.bg)
      rows.push(lr(W, [S(' '), ret[0]!, S('  '), S('N E E D S  Y O U', { fg: C.white, b: true })], [S('THREAT ', { fg: C.dim }), ...meter]))
      rows.push(lr(W, [S(' '), ret[1]!, S('  '), S(`${n} open · ${snap.ready.prs.length} PRs · ${snap.running.length} agents`, { fg: C.dim })], [S(clock(c.now) + ' ', { fg: C.cyan })]))
      rows.push(line(W, [S(' '), ret[2]!, S('  '), synced]))
    }
    rows.push(corner('└─', '─┘'))
  } else {
    const ring = pixels(['..GGGG..', '.G....G.', 'G..GG..G', 'G..GG..G', '.G....G.', '..GGGG..'], { G: C.green }, T.bg)
    rows.push(corner('┌─', '─┐'))
    rows.push(line(W, [S(' '), ring[0]!, S('  '), S('ALL SECTORS CLEAR', { fg: C.green, b: true })]))
    rows.push(line(W, [S(' '), ring[1]!, S('  '), S('Nothing needs you.', { fg: C.white, b: true })]))
    rows.push(line(W, [S(' '), ring[2]!, S('  '), S(`${snap.ready.prs.length} PRs ready · ${snap.running.length} agents running`, { fg: C.dim })]))
    rows.push(corner('└─', '─┘'))
  }

  const sec = (label: string, col: string, count: string) =>
    bigSec(
      W,
      label,
      col,
      T.bg,
      [S('▸ ', { fg: col })],
      [S('[' + count + ']', { fg: C.dim })],
      lr(W, [S('▸ ', { fg: col }), S(label, { fg: col, b: true }), S(' [' + count + '] ', { fg: C.dim })], [], '─', { fg: C.rail }),
    )

  if (n > 0) {
    rows.push(line(W, []))
    rows.push(...sec('NEEDS YOU', C.alert, two(n)))
    const kc: Record<NeedKind, string> = { approve: C.alert, question: C.alert, failed: C.amber, finished: C.green }
    const tw = narrow ? 4 : 8
    snap.needs.forEach((it, i) => {
      const col = kc[it.kind]
      const sel = selectedItem(c)?.id === it.id
      const edge = sel ? S('▌', { fg: blink(c, C.alert, T.bg) }) : S(' ')
      rows.push(
        ...itemRows(
          c,
          it,
          i === 0 ? null : [],
          s => [
            edge,
            S(it.kind === 'finished' ? '○' : '◉', { fg: col }),
            S(' '),
            S(pad(tagOf(c, it.kind), tw), s ? { bg: col, fg: C.ink, b: true } : { fg: col, b: true }),
            S(' '),
            S(fit(it.title, W - tw - 4), { fg: C.white, b: true }),
          ],
          [edge, S(' └ ', { fg: C.rail })],
          { fg: C.cyan, b: true },
          { fg: C.dim },
        ),
      )
    })
  }

  rows.push(line(W, []))
  rows.push(...sec('READY', C.green, two(snap.ready.prs.length)))
  const msg = readyMessage(c)
  if (msg) rows.push(line(W, [S('  '), S(fit(msg, W - 2), { fg: C.dim })]))
  const segs = narrow ? 5 : 10
  snap.ready.prs.forEach((p, i) => {
    if (i > 0) rows.push(line(W, []))
    const s = prState(p)
    const col = s === 'pass' ? C.green : s === 'fail' ? C.alert : s === 'run' ? C.cyan : C.dim
    const frac = p.total > 0 ? p.pass / p.total : 0
    let on = Math.round(frac * segs)
    if (s === 'run' && c.motion && Math.floor(c.frame / 3) % 2 === 1) on = Math.min(segs, on + 1)
    const nameW = narrow ? 14 : 18
    rows.push(
      lr(W, [S('  '), S(pad(fit(`${shortRepo(p.repo)} #${p.number}`, nameW - 1), nameW), { fg: T.fg, b: true }), S('▰'.repeat(on), { fg: col }), S('▱'.repeat(segs - on), { fg: C.rail })], [S(' ' + rpad(prCount(p), 5) + ' ', { fg: col, b: true })]),
    )
    rows.push(line(W, [S('   └ ', { fg: C.rail }), S(fit(narrow ? p.title : p.title + ' · not merged', W - 5), { fg: C.dim })]))
  })

  rows.push(line(W, []))
  rows.push(...sec('RUNNING', C.cyan, two(snap.running.length)))
  if (snap.running.length === 0) rows.push(line(W, [S('  '), S('No agents running.', { fg: C.dim })]))
  snap.running.forEach((r, i) => {
    rows.push(
      lr(W, [S('  '), S(spin(c, SPIN, i * 5), { fg: C.cyan }), S(' '), S(pad(fit(r.who, 14), 15), { fg: C.cyan, b: true }), S(fit(r.project, W - 25), { fg: T.fg })], [S(rpad(age(c, r.at), 4) + ' ', { fg: C.dim })]),
    )
  })

  rows.push(line(W, []))
  rows.push(...sec('TODAY', C.dim, '··'))
  rows.push(
    line(W, [S('  '), S('guard ', { fg: C.dim }), S(`${snap.today.blocked} blocked`, { fg: C.amber }), S(` · ${snap.today.asked} asked · ${snap.today.runs} runs`, { fg: C.dim })]),
  )
  rows.push(...skillsRows(c, [S('  ')], C.cyan, C.dim))
  rows.push(line(W, []))
  rows.push(
    ...controls(c, C.cyan, C.dim, '#4F7684', [
      ['◉', C.alert, 'lock: question or approval'],
      ['◉', C.amber, 'caution: failed run'],
      ['○', C.green, 'clear: finished, not viewed'],
      ['▰', C.green, 'checks passed (meter)'],
      ['▰', C.alert, 'checks failing'],
      ['⠋', C.cyan, 'scan: agent running'],
      ['▮', C.alert, 'threat: items waiting'],
    ]),
  )

  // the scanline: one row brightens as it sweeps down, about every six seconds
  if (c.motion) {
    const at = c.frame % (rows.length + 8)
    const row = rows[at]
    if (row) rows[at] = { ...row, segs: row.segs.map(s => ('t' in s && s.fg === C.dim ? { ...s, fg: T.fg } : s)) }
  }
  return { ...T, rows }
}

// =====================================================================
// 3. METRO: a transit map
// =====================================================================
function metro(c: Ctx): Look {
  const T = { bg: '#101216', fg: '#F1F2F4' }
  const C = { red: '#FF5252', orange: '#FF9A3D', green: '#2FD67F', blue: '#4C9BFF', grey: '#9AA0AC', sign: '#F4F4EF', ink: '#101216', dim: '#A2A8B4', white: '#FFFFFF', signDim: '#4A4F59' }
  const { W, narrow, snap } = c
  const rows: Row[] = []
  const n = snap.needs.length
  const badge = (l: string, col: string) => S(' ' + l + ' ', { bg: col, fg: C.ink, b: true })
  const sec = (l: string, col: string, word: string, info: string) =>
    bigSec(W, word, col, T.bg, [badge(l, col), S(' ')], info ? [S(info, { fg: C.dim })] : [], line(W, [badge(l, col), S(' ' + word, { fg: T.fg, b: true }), S(info ? '  ' + info : '', { fg: C.dim })]))

  rows.push(lr(W, [S(' ◉ NEEDS YOU', { bg: C.sign, fg: C.ink, b: true })], [S(narrow ? `${n} stops ` : `${n} stops · ${clock(c.now)} `, { bg: C.sign, fg: C.signDim })], ' ', { bg: C.sign }))
  const q = Math.floor(W / 4)
  rows.push({ segs: [C.red, C.green, C.blue, C.grey].map((col, i) => ({ px: Array.from({ length: i === 3 ? W - 3 * q : q }, (): [string, string] => [col, T.bg]) })) })
  rows.push(line(W, []))

  if (n > 0) {
    rows.push(...sec('N', C.red, 'NEEDS YOU', `${n} stop${n === 1 ? '' : 's'}`))
    const kc: Record<NeedKind, string> = { approve: C.red, question: C.red, failed: C.orange, finished: C.white }
    const start = rows.length
    const rail = S(' ┃', { fg: C.red })
    snap.needs.forEach((it, i) => {
      const mark = it.kind === 'failed' ? '×' : it.kind === 'finished' ? '○' : '●'
      rows.push(
        ...itemRows(
          c,
          it,
          i === 0 ? null : [rail],
          sel => [
            S(' '),
            S(mark, { fg: sel ? blink(c, kc[it.kind], C.white) : kc[it.kind], b: true }),
            S('  '),
            S(fit(it.title, W - 4), { fg: it.kind === 'failed' ? C.orange : C.white, b: true }),
          ],
          [rail, S('  ')],
          { fg: C.white, b: true, u: true },
          { fg: C.dim, u: true },
          [rail, S('  ')],
        ),
      )
    })
    // the line ends at its last stop
    const last = rows[rows.length - 1]
    if (rows.length > start && last && 't' in last.segs[0]! && last.segs[0].t === ' ┃') {
      rows[rows.length - 1] = { ...last, segs: [S(' ╹', { fg: C.red }), ...last.segs.slice(1)] }
    }
  } else {
    rows.push(line(W, [S(' ╺' + '━'.repeat(W - 4) + '◉', { fg: C.green })]))
    rows.push(line(W, [S(narrow ? ' End of the line. ' : '  End of the line. ', { fg: T.fg, b: true }), S('Nothing needs you.', { fg: C.dim })]))
    rows.push(line(W, [S(fit(`  ${snap.ready.prs.length} PRs waiting at line R · ${snap.running.length} agents on line A`, W), { fg: C.dim })]))
  }

  rows.push(line(W, []))
  rows.push(...sec('R', C.green, 'READY', 'not merged'))
  const msg = readyMessage(c)
  if (msg) rows.push(line(W, [S(' ╹', { fg: C.green }), S('  '), S(fit(msg, W - 4), { fg: C.dim })]))
  snap.ready.prs.forEach((p, i) => {
    const s = prState(p)
    const col = s === 'pass' ? C.green : s === 'fail' ? C.red : s === 'run' ? C.blue : C.dim
    const sym = s === 'pass' ? '✓' : s === 'fail' ? '×' : s === 'run' ? '◌' : '·'
    const end = i === snap.ready.prs.length - 1 ? ' ╹' : ' ┃'
    const left: Seg[] = [S(end, { fg: C.green }), S('  '), S(pad('#' + p.number, 5), { fg: C.dim }), S(pad(fit(shortRepo(p.repo), 13), 14), { fg: T.fg, b: true })]
    if (!narrow) left.push(S(fit(p.title, W - 32), { fg: C.dim }))
    rows.push(lr(W, left, [S(' ' + sym + ' ' + rpad(prCount(p), 5), { fg: col, b: true })]))
  })

  rows.push(line(W, []))
  const a = snap.running.length
  rows.push(...sec('A', C.blue, 'RUNNING', `${a} agent${a === 1 ? '' : 's'}`))
  const railLen = a + 1
  // the train moves one stop every 0.4 s while agents run; parked otherwise
  const train = a > 0 && c.motion ? Math.floor((c.frame * 250) / 400) % railLen : -1
  const railCell = (k: number, end: boolean) => S(k === train ? '▼' : end ? '╹' : '┃', { fg: C.blue })
  snap.running.forEach((r, i) => {
    rows.push(lr(W, [S(' '), railCell(i, false), S('  '), S(pad(fit(r.who, 14), 15), { fg: C.blue, b: true }), S(fit(r.project, W - 24), { fg: T.fg })], [S(rpad(age(c, r.at), 4), { fg: C.dim })]))
  })
  rows.push(line(W, [S(' '), railCell(a, true), S('  '), S(a === 0 ? 'No agents running.' : '', { fg: C.dim })]))

  rows.push(line(W, []))
  rows.push(...sec('T', C.grey, 'TODAY', ''))
  rows.push(line(W, [S(' ╹', { fg: C.grey }), S('  '), S(fit(todayText(c), W - 4), { fg: C.dim })]))
  rows.push(...skillsRows(c, [S('    ')], C.white, C.dim))
  rows.push(line(W, []))
  rows.push(
    ...controls(c, C.white, C.dim, '#6B717C', [
      ['●', C.red, 'stop: question or approval'],
      ['×', C.orange, 'stop: failed run'],
      ['○', C.white, 'stop: finished, not viewed'],
      ['R', C.green, 'line R: ready PRs (✓ pass, × fail)'],
      ['A', C.blue, 'line A: agents (▼ is the train)'],
      ['◌', C.blue, 'checks running'],
    ]),
  )
  return { ...T, rows }
}

// =====================================================================
// 4. THERMAL: a heat camera
// =====================================================================
function thermal(c: Ctx): Look {
  const T = { bg: '#0B0912', fg: '#EEE9F7' }
  const C = { white: '#FFF6CC', yellow: '#FFD23F', orange: '#FF7A1A', magenta: '#F0478A', blue: '#5B7CFF', navy: '#2B2F7A', dim: '#9C97B0', ice: '#8FA6FF', mintText: '#7DF0B0', floor: '#1C1830' }
  const { W, narrow, snap } = c
  const rows: Row[] = []
  const n = snap.needs.length

  rows.push(
    lr(
      W,
      [S('NEEDS YOU', { fg: C.white, b: true }), S('  core ', { fg: C.dim }), S(`${n}°`, { fg: blink(c, C.white, C.yellow), b: true })],
      narrow ? [] : [S(`hot ${n}  warm ${snap.ready.prs.length}  cool ${snap.running.length}`, { fg: C.dim })],
    ),
  )
  // the heat strip: activity per half hour, newest at the right
  const vals = snap.heat.slice(-W).map(v => Math.min(4, v))
  while (vals.length < W) vals.unshift(0)
  if (c.motion && Math.floor(c.frame / 2) % 2 === 1 && (vals[W - 1] ?? 0) > 0) vals[W - 1] = Math.min(4, (vals[W - 1] ?? 0) + 1)
  const heat = [C.blue, C.magenta, C.orange, C.yellow]
  const px = (v: number, level: number, ground: string) => (v > level ? heat[Math.min(4, v) - 1]! : ground)
  rows.push({ segs: [{ px: vals.map((v): [string, string] => [px(v, 3, T.bg), px(v, 2, T.bg)]) }] })
  rows.push({ segs: [{ px: vals.map((v): [string, string] => [px(v, 1, T.bg), px(v, 0, C.floor)]) }] })
  rows.push(lr(W, [S(narrow ? '-18h' : '-24h', { fg: C.dim })], [S('activity · now', { fg: C.dim })]))
  rows.push(line(W, []))

  const sec = (label: string, col: string, right: string) => {
    const [word = label, ...rest] = label.split(' · ')
    const note = [rest.join(' · '), right].filter(Boolean).join('  ')
    return bigSec(W, word, col, T.bg, [], note ? [S(note, { fg: C.dim })] : [], lr(W, [S(label, { fg: col, b: true })], [S(right, { fg: C.dim })]))
  }

  if (n > 0) {
    rows.push(...sec('HOT · needs you', C.yellow, String(n)))
    const kc: Record<NeedKind, [string, string]> = {
      approve: [C.white, C.yellow],
      question: [C.yellow, C.orange],
      failed: [C.orange, C.magenta],
      finished: [C.magenta, C.blue],
    }
    const tw = narrow ? 5 : 9
    snap.needs.forEach((it, i) => {
      const [hot, cool] = kc[it.kind]
      rows.push(
        ...itemRows(
          c,
          it,
          i === 0 ? null : [],
          sel => [
            S('██', { fg: sel ? blink(c, C.white, C.yellow) : hot }),
            S(' '),
            S(pad(tagOf(c, it.kind).toLowerCase(), tw), { fg: hot, b: true }),
            S(fit(it.title, W - tw - 3), { fg: sel ? '#FFFFFF' : T.fg, b: true }),
          ],
          [S('██', { fg: cool }), S(' '.repeat(tw + 1))],
          { fg: C.white, b: true },
          { fg: C.dim },
        ),
      )
    })
  } else {
    rows.push(line(W, [S('▕▏', { fg: C.navy }), S(' '), S('Everything has cooled down.', { fg: C.ice, b: true })]))
    rows.push(line(W, [S('▕▏', { fg: C.navy }), S(' '), S('Nothing needs you.', { fg: T.fg, b: true })]))
    rows.push(line(W, [S('▕▏', { fg: C.navy }), S(' '), S(`${snap.ready.prs.length} PRs warm · ${snap.running.length} agents running`, { fg: C.dim })]))
  }

  rows.push(line(W, []))
  rows.push(...sec(narrow ? 'WARM · ready' : 'WARM · ready, not merged', C.magenta, String(snap.ready.prs.length)))
  const msg = readyMessage(c)
  if (msg) rows.push(line(W, [S('▐▌', { fg: C.magenta }), S(' '), S(fit(msg, W - 3), { fg: C.dim })]))
  snap.ready.prs.forEach((p, i) => {
    const s = prState(p)
    const st =
      s === 'pass' ? S('✓ ' + rpad(prCount(p), 5), { fg: C.mintText, b: true })
      : s === 'fail' ? S('× ' + rpad(prCount(p), 5), { fg: C.orange, b: true })
      : s === 'run' ? S(spin(c, SPIN, i * 3) + ' ' + rpad(prCount(p), 5), { fg: C.blue, b: true })
      : S('· ' + rpad(prCount(p), 5), { fg: C.dim })
    const left: Seg[] = [S('▐▌', { fg: C.magenta }), S(' '), S(pad('#' + p.number, 5), { fg: C.dim }), S(pad(fit(shortRepo(p.repo), 13), 14), { fg: T.fg, b: true })]
    if (!narrow) left.push(S(fit(p.title, W - 30), { fg: C.dim }))
    rows.push(lr(W, left, [S(' '), st]))
  })

  rows.push(line(W, []))
  rows.push(...sec('COOL · running', C.blue, String(snap.running.length)))
  if (snap.running.length === 0) rows.push(line(W, [S('▕▏', { fg: C.blue }), S(' '), S('No agents running.', { fg: C.dim })]))
  snap.running.forEach((r, i) => {
    rows.push(
      lr(W, [S('▕▏', { fg: C.blue }), S(' '), S(spin(c, SPIN, i * 3), { fg: C.blue }), S(' '), S(pad(fit(r.who, 14), 15), { fg: C.ice, b: true }), S(fit(r.project, W - 25), { fg: T.fg })], [S(rpad(age(c, r.at), 4), { fg: C.dim })]),
    )
  })

  rows.push(line(W, []))
  rows.push(...sec('TODAY', C.dim, ''))
  rows.push(line(W, [S(fit(todayText(c), W), { fg: C.dim })]))
  rows.push(...skillsRows(c, [S('      ')], C.yellow, C.dim))
  rows.push(line(W, []))
  rows.push(
    ...controls(c, C.yellow, C.dim, '#6A6580', [
      ['██', C.white, 'white-hot: approval'],
      ['██', C.yellow, 'hot: question'],
      ['██', C.orange, 'burning: failed run'],
      ['██', C.magenta, 'warm: finished or ready PR'],
      ['▕▏', C.blue, 'cool: agent running'],
      ['▀▀', C.yellow, 'strip: activity per half hour'],
    ]),
  )
  return { ...T, rows }
}

const BUILDERS: Record<ThemeId, (c: Ctx) => Look> = { hiscore, halo, metro, thermal }

export const buildLook = (c: Ctx): Look => BUILDERS[c.theme](c)
export const backgroundOf = (t: ThemeId) => buildLook({ ...EMPTY_CTX, theme: t }).bg

const EMPTY_CTX: Ctx = {
  W: 48,
  narrow: false,
  snap: { needs: [], ready: { status: 'ok', prs: [], at: 0 }, running: [], today: { asked: 0, blocked: 0, runs: 0, skills: null }, heat: [], at: 0 },
  selected: '',
  isDetailOpen: false,
  isKeyOpen: false,
  isSkillsOpen: false,
  frame: 0,
  motion: false,
  now: 0,
  theme: 'hiscore',
}
