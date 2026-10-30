// The four looks. Each builds the same sections (Needs you, Ready, Running,
// Today) as rows of cells, 48 columns wide or 36 when narrow.
import type { NeedItem, NeedKind, Pr, Snapshot, ThemeId } from '../types'
import type { Row, Seg, TextSeg } from './cells'
import { S, fit, line, lr, pad, pixels, rpad } from './cells'
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
  c.snap.needs.find(i => i.id === c.selected) ?? c.snap.needs[0]

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

/** The rows under the selected item: its buttons, then its details once opened. */
function actionRows(c: Ctx, lead: Seg[], on: Style, off: Style, it: NeedItem): Row[] {
  const rows: Row[] = [
    line(c.W, [
      ...lead,
      { btn: 'open', hotkey: 'o', act: { type: 'open' }, segs: [{ ...on, t: c.isDetailOpen ? 'CLOSE' : 'OPEN' }] },
      S('  '),
      { btn: 'dismiss', hotkey: 'x', act: { type: 'dismiss' }, segs: [{ ...off, t: 'SKIP' }] },
    ]),
  ]
  if (c.isDetailOpen) {
    const leadW = lead.reduce((n, s) => n + ('t' in s ? [...s.t].length : 0), 0)
    const w = c.W - leadW
    const text = [...it.detail.filter(d => d && d !== it.title), `${it.who} · ${it.project || 'no project'} · ${age(c, it.at)} ago`]
    const blank = S(' '.repeat(leadW))
    for (const para of text) for (const l of wrap(para, w, 6)) rows.push(line(c.W, [blank, S(l, { fg: off.fg })]))
  }
  return rows
}

function itemRows(c: Ctx, it: NeedItem, rowSegs: (sel: boolean) => Seg[], second: Seg[], lead: Seg[], on: Style, off: Style) {
  const sel = selectedItem(c)?.id === it.id
  const rows: Row[] = [{ ...line(c.W, rowSegs(sel)), press: { key: `item:${it.id}`, act: { type: 'select', id: it.id } } }]
  rows.push(line(c.W, second))
  if (sel) rows.push(...actionRows(c, lead, on, off, it))
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

/**
 * The switches, the hint line with the small key button, and, while the key
 * is open, what each colour means in this look and what each switch does.
 */
function controls(c: Ctx, accent: string, dim: string, faint: string, meanings: Meaning[]): Row[] {
  const name = THEME_NAMES[c.theme].toUpperCase()
  const rows = [
    line(c.W, [
      { btn: 'design', hotkey: 't', act: { type: 'theme' }, segs: [S(c.narrow ? name : `DESIGN ▸ ${name}`, { fg: accent, b: true })] },
      S(' '),
      { btn: 'motion', hotkey: 'm', act: { type: 'motion' }, segs: [S(c.narrow ? 'MOTION' : c.motion ? 'MOTION ON' : 'MOTION OFF', { fg: dim })] },
      S(' '),
      { btn: 'refresh', hotkey: 'r', act: { type: 'refresh' }, segs: [S('REFRESH', { fg: dim })] },
    ]),
    lr(
      c.W,
      [S(c.narrow ? 'tab move · o open · x skip' : 'tab move · enter select · o open · x skip', { fg: dim })],
      [{ btn: 'key', hotkey: 'k', act: { type: 'key' }, segs: [S('key', { fg: faint, u: true })] }],
    ),
  ]
  if (c.isKeyOpen) {
    for (const [glyph, colour, meaning] of meanings) {
      rows.push(line(c.W, [S('  '), S(glyph, { fg: colour }), S(' '), S(fit(meaning, c.W - 3 - [...glyph].length), { fg: dim })]))
    }
    rows.push(line(c.W, [S('  t design · m motion · r refresh', { fg: faint })]))
    rows.push(line(c.W, [S('  o open · x skip · k key', { fg: faint })]))
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
    lr(W, [S(` ${num} `, { bg: col, fg: C.ink, b: true }), S(' '), S(label, { fg: col, b: true }), S(' ')], [S(' ' + right, { fg: C.dim })], '·', { fg: C.rule })

  if (n > 0) {
    if (narrow) {
      rows.push(lr(W, [S('◆', { fg: C.pink, b: true }), S(' NEEDS YOU', { fg: C.lemon, b: true })], [S('HI ', { fg: C.dim }), S(two(n), { fg: C.pink, b: true })]))
      rows.push(line(W, [S(summary(c), { fg: C.dim })]))
    } else {
      const sprite = pixels(['.PPPPPPPP.', 'PPPPWWPPPP', 'PPPPWWPPPP', 'PPPPWWPPPP', 'PPPPPPPPPP', 'PPPPWWPPPP', '.PPPPPPPP.', '.PP.......'], { P: C.pink, W: '#FFFFFF' }, T.bg)
      rows.push(lr(W, [sprite[0]!, S('  '), S('NEEDS YOU', { fg: C.lemon, b: true })], [S('HI ', { fg: C.dim }), S(two(n), { fg: C.pink, b: true })]))
      rows.push(line(W, [sprite[1]!, S('  '), S(summary(c), { fg: C.dim })]))
      rows.push(line(W, [sprite[2]!]))
      rows.push(line(W, [sprite[3]!, S('  '), S('PRESS O TO OPEN · X TO SKIP', { fg: blink(c, C.lemon, C.dim), b: true })]))
    }
    rows.push(line(W, []))
    rows.push(sec(1, 'NEEDS YOU', C.pink, String(n)))
    const tagCol: Record<NeedKind, string> = { approve: C.pink, question: C.pink, failed: C.red, finished: C.lemon }
    const tw = narrow ? 4 : 8
    const indent = ' '.repeat(tw + 4)
    for (const it of snap.needs) {
      const col = tagCol[it.kind]
      const a = age(c, it.at)
      rows.push(
        ...itemRows(
          c,
          it,
          sel => [
            S(sel ? '▶' : ' ', sel ? { fg: blink(c, C.lemon, T.bg), b: true } : {}),
            S(' '),
            S(' ' + pad(tagOf(c, it.kind), tw), it.kind === 'finished' ? { fg: col, b: true } : { bg: col, fg: C.ink, b: true }),
            S(' '),
            S(pad(fit(it.title, W - tw - 9), W - tw - 8), { fg: sel ? '#FFFFFF' : T.fg, b: sel }),
            S(rpad(a, 4), { fg: a === 'now' ? C.pink : C.dim, b: a === 'now' }),
          ],
          [S(indent), S(fit(`${it.who} · ${it.project}`, W - indent.length), { fg: C.dim })],
          [S(indent)],
          { fg: C.lemon, b: true },
          { fg: C.dim },
        ),
      )
    }
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
  rows.push(sec(2, 'READY', C.mint, narrow ? String(snap.ready.prs.length) : `${snap.ready.prs.length} open, not merged`))
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
  rows.push(sec(3, 'RUNNING', C.cyan, String(snap.running.length)))
  if (snap.running.length === 0) rows.push(line(W, [S('  '), S('No agents running.', { fg: C.dim })]))
  snap.running.forEach((r, i) => {
    rows.push(
      lr(W, [S('  '), S(spin(c, QUARTERS, i), { fg: C.cyan }), S(' '), S(pad(fit(r.who, 14), 15), { fg: C.cyan, b: true }), S(fit(r.project, W - 24), { fg: T.fg })], [S(rpad(age(c, r.at), 4), { fg: C.dim })]),
    )
  })

  rows.push(line(W, []))
  rows.push(sec(4, 'TODAY', C.lemon, ''))
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
    lr(W, [S('▸ ', { fg: col }), S(label, { fg: col, b: true }), S(' [' + count + '] ', { fg: C.dim })], [], '─', { fg: C.rail })

  if (n > 0) {
    rows.push(sec('NEEDS YOU', C.alert, two(n)))
    const kc: Record<NeedKind, string> = { approve: C.alert, question: C.alert, failed: C.amber, finished: C.green }
    const tw = narrow ? 4 : 8
    for (const it of snap.needs) {
      const col = kc[it.kind]
      const sel = selectedItem(c)?.id === it.id
      const edge = sel ? S('▌', { fg: blink(c, C.alert, T.bg) }) : S(' ')
      rows.push(
        ...itemRows(
          c,
          it,
          s => [
            edge,
            S(it.kind === 'finished' ? '○' : '◉', { fg: col }),
            S(' '),
            S(pad(tagOf(c, it.kind), tw), s ? { bg: col, fg: C.ink, b: true } : { fg: col, b: true }),
            S(' '),
            S(pad(fit(it.title, W - tw - 10), W - tw - 9), { fg: C.white, b: s }),
            S(rpad(age(c, it.at), 4) + ' ', { fg: s ? C.alert : C.dim }),
          ],
          [edge, S(' └ ', { fg: C.rail }), S(fit(narrow ? it.project || it.who : `${it.who} › ${it.project}`, W - 4), { fg: C.dim })],
          [edge, S('   ')],
          { fg: C.cyan, b: true },
          { fg: C.dim },
        ),
      )
    }
  }

  rows.push(sec('READY', C.green, two(snap.ready.prs.length)))
  const msg = readyMessage(c)
  if (msg) rows.push(line(W, [S('  '), S(fit(msg, W - 2), { fg: C.dim })]))
  const segs = narrow ? 5 : 10
  for (const p of snap.ready.prs) {
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
  }

  rows.push(sec('RUNNING', C.cyan, two(snap.running.length)))
  if (snap.running.length === 0) rows.push(line(W, [S('  '), S('No agents running.', { fg: C.dim })]))
  snap.running.forEach((r, i) => {
    rows.push(
      lr(W, [S('  '), S(spin(c, SPIN, i * 5), { fg: C.cyan }), S(' '), S(pad(fit(r.who, 14), 15), { fg: C.cyan, b: true }), S(fit(r.project, W - 25), { fg: T.fg })], [S(rpad(age(c, r.at), 4) + ' ', { fg: C.dim })]),
    )
  })

  rows.push(sec('TODAY', C.dim, '··'))
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

  rows.push(lr(W, [S(' ◉ NEEDS YOU', { bg: C.sign, fg: C.ink, b: true })], [S(narrow ? `${n} stops ` : `${n} stops · ${clock(c.now)} `, { bg: C.sign, fg: C.signDim })], ' ', { bg: C.sign }))
  const q = W / 4
  rows.push({ segs: [C.red, C.green, C.blue, C.grey].map(col => ({ px: Array.from({ length: q }, (): [string, string] => [col, T.bg]) })) })
  rows.push(line(W, []))

  if (n > 0) {
    rows.push(line(W, [badge('N', C.red), S(' NEEDS YOU', { fg: T.fg, b: true }), S(`  line N · ${n} stop${n === 1 ? '' : 's'}`, { fg: C.dim })]))
    const kc: Record<NeedKind, string> = { approve: C.red, question: C.red, failed: C.orange, finished: C.white }
    const start = rows.length
    for (const it of snap.needs) {
      const mark = it.kind === 'failed' ? '×' : it.kind === 'finished' ? '○' : '●'
      const rail = S(' ┃', { fg: C.red })
      rows.push(
        ...itemRows(
          c,
          it,
          sel => [
            S(' '),
            S(mark, { fg: sel ? blink(c, kc[it.kind], C.white) : kc[it.kind], b: true }),
            S('  '),
            S(pad(fit(it.title, W - 9), W - 8), { fg: it.kind === 'failed' ? C.orange : C.white, b: true }),
            S(rpad(age(c, it.at), 4), { fg: sel ? C.red : C.dim }),
          ],
          [rail, S('  '), S(fit(narrow ? `${it.who} · ${it.project}` : `${TAG[it.kind][0].toLowerCase()} · ${it.who} · ${it.project}`, W - 4), { fg: C.dim })],
          [rail, S('  ')],
          { fg: C.white, b: true, u: true },
          { fg: C.dim, u: true },
        ),
      )
    }
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
  rows.push(line(W, [badge('R', C.green), S(' READY', { fg: T.fg, b: true }), S('  line R · not merged', { fg: C.dim })]))
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
  rows.push(line(W, [badge('A', C.blue), S(' RUNNING', { fg: T.fg, b: true }), S(`  line A · ${a} agent${a === 1 ? '' : 's'}`, { fg: C.dim })]))
  const railLen = a + 1
  // the train moves one stop every 0.4 s while agents run; parked otherwise
  const train = a > 0 && c.motion ? Math.floor((c.frame * 250) / 400) % railLen : -1
  const railCell = (k: number, end: boolean) => S(k === train ? '▼' : end ? '╹' : '┃', { fg: C.blue })
  snap.running.forEach((r, i) => {
    rows.push(lr(W, [S(' '), railCell(i, false), S('  '), S(pad(fit(r.who, 14), 15), { fg: C.blue, b: true }), S(fit(r.project, W - 24), { fg: T.fg })], [S(rpad(age(c, r.at), 4), { fg: C.dim })]))
  })
  rows.push(line(W, [S(' '), railCell(a, true), S('  '), S(a === 0 ? 'No agents running.' : '', { fg: C.dim })]))

  rows.push(line(W, []))
  rows.push(line(W, [badge('T', C.grey), S(' TODAY', { fg: T.fg, b: true })]))
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

  const sec = (label: string, col: string, right: string) => lr(W, [S(label, { fg: col, b: true })], [S(right, { fg: C.dim })])

  if (n > 0) {
    rows.push(sec('HOT · needs you', C.yellow, String(n)))
    const kc: Record<NeedKind, [string, string]> = {
      approve: [C.white, C.yellow],
      question: [C.yellow, C.orange],
      failed: [C.orange, C.magenta],
      finished: [C.magenta, C.blue],
    }
    const tw = narrow ? 5 : 9
    for (const it of snap.needs) {
      const [hot, cool] = kc[it.kind]
      rows.push(
        ...itemRows(
          c,
          it,
          sel => [
            S('██', { fg: sel ? blink(c, C.white, C.yellow) : hot }),
            S(' '),
            S(pad(tagOf(c, it.kind).toLowerCase(), tw), { fg: hot, b: true }),
            S(pad(fit(it.title, W - tw - 8), W - tw - 7), { fg: sel ? '#FFFFFF' : T.fg, b: sel }),
            S(rpad(age(c, it.at), 4), { fg: sel ? C.white : C.dim }),
          ],
          [S('██', { fg: cool }), S(' '.repeat(tw + 1)), S(fit(`${it.who} · ${it.project}`, W - tw - 3), { fg: C.dim })],
          [S('▀▀', { fg: cool }), S(' '.repeat(tw + 1))],
          { fg: C.white, b: true },
          { fg: C.dim },
        ),
      )
    }
  } else {
    rows.push(line(W, [S('▕▏', { fg: C.navy }), S(' '), S('Everything has cooled down.', { fg: C.ice, b: true })]))
    rows.push(line(W, [S('▕▏', { fg: C.navy }), S(' '), S('Nothing needs you.', { fg: T.fg, b: true })]))
    rows.push(line(W, [S('▕▏', { fg: C.navy }), S(' '), S(`${snap.ready.prs.length} PRs warm · ${snap.running.length} agents running`, { fg: C.dim })]))
  }

  rows.push(line(W, []))
  rows.push(sec(narrow ? 'WARM · ready' : 'WARM · ready, not merged', C.magenta, String(snap.ready.prs.length)))
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
  rows.push(sec('COOL · running', C.blue, String(snap.running.length)))
  if (snap.running.length === 0) rows.push(line(W, [S('▕▏', { fg: C.blue }), S(' '), S('No agents running.', { fg: C.dim })]))
  snap.running.forEach((r, i) => {
    rows.push(
      lr(W, [S('▕▏', { fg: C.blue }), S(' '), S(spin(c, SPIN, i * 3), { fg: C.blue }), S(' '), S(pad(fit(r.who, 14), 15), { fg: C.ice, b: true }), S(fit(r.project, W - 25), { fg: T.fg })], [S(rpad(age(c, r.at), 4), { fg: C.dim })]),
    )
  })

  rows.push(line(W, []))
  rows.push(line(W, [S('TODAY ', { fg: C.dim, b: true }), S(fit(todayText(c), W - 6), { fg: C.dim })]))
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
