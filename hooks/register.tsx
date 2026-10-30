// Needs You: a pane beside the chat that lists what is waiting on you.
// It reads Claude Code's own transcripts, two small hook logs and the gh CLI;
// it makes no model calls, reads only files that changed, and does nothing
// while the pane is hidden.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ready, Snapshot, ThemeId } from '../types'
import type { Action } from './cells'
import { drawRows } from './cells'
import type { Transcript } from './data'
import { baseName, heatStrip, needsFromTranscript, parseAgents, parseChecks, parseGuardLog, parseSearch, parseSkills, parseTranscript } from './data'
import { THEMES, backgroundOf, buildLook, nextTheme } from './themes'

type $ = EngineInterface

const PANE = 'needs-you'
const TITLE = 'Needs you'
const TICK_MS = 250
const SCAN_MS = 5_000
const GH_MS = 120_000
const DAYS_MS = 14 * 86_400_000
const FILES_PER_SCAN = 3
const LIST_MS = 15_000
const BIG_REREAD_MS = 20_000
const READ_LIMIT = 4 * 1024 * 1024 - 1024
const TAIL_BYTES = 1024 * 1024

export const EMPTY: Snapshot = {
  needs: [],
  ready: { status: 'loading', prs: [], at: 0 },
  running: [],
  today: { asked: 0, blocked: 0, runs: 0, skills: null },
  heat: [],
  at: 0,
}

const snapshot = atom({ plugin: 'needs-you-panel', key: 'snapshot' } as const, EMPTY, { shape: 'snapshot-2' })
const theme = atom({ plugin: 'needs-you-panel', key: 'theme' } as const, 'hiscore')
const reduceMotion = atom({ plugin: 'needs-you-panel', key: 'reduceMotion' } as const, false)
const selected = atom({ plugin: 'needs-you-panel', key: 'selected' } as const, '')
const isDetailOpen = atom({ plugin: 'needs-you-panel', key: 'isDetailOpen' } as const, false)
const isKeyOpen = atom({ plugin: 'needs-you-panel', key: 'isKeyOpen' } as const, false)
const isSkillsOpen = atom({ plugin: 'needs-you-panel', key: 'isSkillsOpen' } as const, false)
const frame = atom({ plugin: 'needs-you-panel', key: 'frame' } as const, 0)

// a node one-liner that prints a file's last bytes, for transcripts too big to read whole
const NODE_TAIL =
  "const fs=require('fs');const [p,n]=process.argv.slice(1);const fd=fs.openSync(p,'r');" +
  "const s=fs.fstatSync(fd).size;const l=Math.min(s,+n);const b=Buffer.alloc(l);" +
  'fs.readSync(fd,b,0,l,s-l);process.stdout.write(b)'

const isTheme = (v: unknown): v is ThemeId => typeof v === 'string' && (THEMES as string[]).includes(v)

// Module state: rebuilt after a reload, which is fine, as it is only a cache.
let root = ''
let session = ''
let since = 0
let dismissed = new Set<string>()
let isMotionOn = true
let isShown = false
let ticks = 0
let lastScan = 0
let lastGh = 0
let isScanning = false
let isFetching = false
let projectDirs: string[] = []
let lastDirList = 0
let lastFileList = 0
let files: Array<{ path: string; mtimeMs: number; size: number; folder: string }> = []
let tailer: 'tail' | 'node' | 'none' | undefined
const transcripts = new Map<string, { mtimeMs: number; size: number; readAt: number; parsed: Transcript; folder: string }>()
const logs = new Map<string, { mtimeMs: number; text: string }>()

async function openPane($: $, focus: boolean) {
  return $.ui.open({ id: PANE, title: TITLE, backgroundColor: backgroundOf(await read($, theme)), ...(focus ? { focus: true } : {}) })
}

async function claudeRoot($: $) {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  return (custom ?? `${home}/.claude`).replace(/\\/g, '/').replace(/\/+$/, '')
}

async function readTail($: $, path: string): Promise<string | undefined> {
  const tries: Array<['tail' | 'node', string[]]> = [
    ['tail', ['tail', '-c', String(TAIL_BYTES), path]],
    ['node', ['node', '-e', NODE_TAIL, path, String(TAIL_BYTES)]],
  ]
  for (const [name, argv] of tries) {
    if (tailer !== undefined && tailer !== name) continue
    try {
      const r = await $.process.run(argv, { timeoutMs: 10_000 })
      if (r.exitCode === 0) {
        tailer = name
        return r.stdout
      }
    } catch {
      // not installed: try the next one
    }
  }
  if (tailer === undefined) tailer = 'none'
  return undefined
}

/** A log's text, read again only when its mtime changed; a big one from its last 1 MB. */
async function readLog($: $, path: string) {
  const st = await $.fs.stat(path).catch(() => undefined)
  if (!st || st.kind !== 'file') return ''
  const held = logs.get(path)
  if (held && held.mtimeMs === st.mtimeMs) return held.text
  const text = st.size <= READ_LIMIT ? await $.fs.read(path).catch(() => '') : ((await readTail($, path)) ?? '')
  logs.set(path, { mtimeMs: st.mtimeMs, text })
  return text
}

async function scanTranscripts($: $, now: number) {
  const base = `${root}/projects`
  if (now - lastDirList > 60_000) {
    lastDirList = now
    const entries = await $.fs.list(base).catch(() => [])
    projectDirs = entries.filter(d => d.kind === 'dir').map(d => d.name)
  }
  // each project folder is listed at most every 15 s
  if (now - lastFileList >= LIST_MS) {
    lastFileList = now
    const found: typeof files = []
    for (const folder of projectDirs) {
      const entries = await $.fs.list(`${base}/${folder}`).catch(() => [])
      for (const f of entries) {
        if (f.kind === 'file' && f.name.endsWith('.jsonl') && now - f.mtimeMs < DAYS_MS) {
          found.push({ path: `${base}/${folder}/${f.name}`, mtimeMs: f.mtimeMs, size: f.size, folder })
        }
      }
    }
    files = found
  }
  const live = new Set(files.map(f => f.path))
  for (const path of transcripts.keys()) if (!live.has(path)) transcripts.delete(path)
  const changed = files
    .filter(f => {
      const held = transcripts.get(f.path)
      if (!held) return true
      // a big, busy session is read again at most every 20 s
      return held.mtimeMs !== f.mtimeMs && (f.size <= READ_LIMIT || now - held.readAt >= BIG_REREAD_MS)
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, FILES_PER_SCAN)
  for (const f of changed) {
    const text = f.size <= READ_LIMIT ? await $.fs.read(f.path).catch(() => undefined) : await readTail($, f.path)
    transcripts.set(f.path, { mtimeMs: f.mtimeMs, size: f.size, readAt: now, folder: f.folder, parsed: text === undefined ? {} : parseTranscript(text, { isTail: f.size > READ_LIMIT }) })
  }
}

async function scan($: $) {
  const now = await $.clock.now()
  lastScan = now
  if (!root) root = await claudeRoot($)
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const dayStart = midnight.getTime()

  await scanTranscripts($, now)
  const items = []
  for (const [path, t] of transcripts) {
    const id = baseName(path).replace(/\.jsonl$/, '')
    const found = needsFromTranscript(t.parsed, { session: id, now, since, project: t.folder })
    // this session's own finished turn is on screen already
    items.push(...found.filter(i => !(id === session && i.kind === 'finished')))
  }
  const guardText = await readLog($, `${root}/needs-you/guard.jsonl`)
  const agentText = await readLog($, `${root}/needs-you/agents.jsonl`)
  const skillsText = await readLog($, `${root}/needs-you/skills.json`)
  const guard = parseGuardLog(guardText, now, dayStart)
  const agents = parseAgents(agentText, now, dayStart)

  const needs = [...items, ...guard.items].filter(i => !dismissed.has(i.id)).sort((a, b) => b.at - a.at)
  await update($, snapshot, s => ({
    ...s,
    needs,
    running: agents.running,
    today: { asked: guard.asked, blocked: guard.blocked, runs: agents.runs, skills: parseSkills(skillsText, dayStart) },
    heat: heatStrip([...guard.times, ...agents.times], now, 48),
    at: now,
  }))
}

async function fetchPrs($: $) {
  const now = await $.clock.now()
  lastGh = now
  const set = (ready: Ready) => update($, snapshot, s => ({ ...s, ready }))
  let found
  try {
    found = await $.process.run(['gh', 'search', 'prs', '--author', '@me', '--state', 'open', '--json', 'repository,number,title,url', '--limit', '20'], { timeoutMs: 20_000 })
  } catch {
    await set({ status: 'no-gh', prs: [], at: now })
    return
  }
  if (found.exitCode !== 0) {
    await update($, snapshot, s => ({ ...s, ready: { ...s.ready, status: 'offline' as const, at: now } }))
    return
  }
  const prs = parseSearch(found.stdout).slice(0, 10)
  for (const pr of prs) {
    // exit 8 means checks are still running; the JSON is printed either way
    const checks = await $.process.run(['gh', 'pr', 'checks', String(pr.number), '-R', pr.repo, '--json', 'bucket'], { timeoutMs: 20_000 }).catch(() => undefined)
    if (checks) Object.assign(pr, parseChecks(checks.stdout))
  }
  await set({ status: 'ok', prs, at: now })
}

async function tick($: $) {
  ticks += 1
  if (ticks % 4 === 1) {
    const panes = await $.ui.panes()
    isShown = panes.some(p => p.id === PANE && p.isShown && p.isPlaced)
  }
  if (!isShown) return
  if (isMotionOn) await update($, frame, f => (f + 1) % 1_000_000)
  const now = await $.clock.now()
  if (!isScanning && now - lastScan >= SCAN_MS) {
    isScanning = true
    void scan($).catch(() => undefined).finally(() => (isScanning = false))
  }
  if (!isFetching && now - lastGh >= GH_MS) {
    isFetching = true
    void fetchPrs($).catch(() => undefined).finally(() => (isFetching = false))
  }
}

async function act($: $, a: Action) {
  if (a.type === 'select') {
    const was = await read($, selected)
    // pressing an item opens it (one at a time); pressing it again closes it
    if (was === a.id) await update($, isDetailOpen, v => !v)
    else {
      await update($, selected, () => a.id)
      await update($, isDetailOpen, () => true)
    }
  }
  if (a.type === 'open') {
    const snap = await read($, snapshot)
    const sel = await read($, selected)
    if (snap.needs.some(i => i.id === sel)) await update($, isDetailOpen, v => !v)
  }
  if (a.type === 'dismiss') {
    // only the item whose skip button was drawn, never a stand-in
    const id = a.id
    if (!id) return
    dismissed.add(id)
    await $.store.set('dismissed', [...dismissed].slice(-500))
    await update($, snapshot, s => ({ ...s, needs: s.needs.filter(i => i.id !== id) }))
    await update($, selected, () => '')
    await update($, isDetailOpen, () => false)
  }
  if (a.type === 'theme') {
    const t = nextTheme(await read($, theme))
    await update($, theme, () => t)
    await $.store.set('theme', t)
    await openPane($, false)
  }
  if (a.type === 'motion') {
    const still = await update($, reduceMotion, v => !v)
    isMotionOn = !still
    await $.store.set('reduceMotion', still)
  }
  if (a.type === 'key') {
    const open = await update($, isKeyOpen, v => !v)
    await $.store.set('keyOpen', open)
  }
  if (a.type === 'skills') await update($, isSkillsOpen, v => !v)
  if (a.type === 'refresh') {
    lastScan = 0
    lastFileList = 0
    lastGh = 0
    isShown = true
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'needs-you', description: 'Open the Needs You pane: what is waiting on you' })
    const storedTheme = await $.store.get('theme')
    if (isTheme(storedTheme)) await update($, theme, () => storedTheme)
    const still = (await $.store.get('reduceMotion')) === true
    await update($, reduceMotion, () => still)
    isMotionOn = !still
    const keyOpen = (await $.store.get('keyOpen')) === true
    await update($, isKeyOpen, () => keyOpen)
    const gone = await $.store.get('dismissed')
    dismissed = new Set(Array.isArray(gone) ? gone.filter((x): x is string => typeof x === 'string') : [])
    const first = await $.store.get('since')
    if (typeof first === 'number') since = first
    else {
      since = await $.clock.now()
      await $.store.set('since', since)
    }
    session = await $.session.id()
    $.clock.every(TICK_MS, () => tick($))
    void openPane($, false)
    return started
  })

  on('command.run', { command: 'needs-you' }, async $ => {
    await openPane($, true)
    lastScan = 0
    lastFileList = 0
    isShown = true
    return { text: 'Needs You pane opened.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) isShown = false
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const E = $.ui.resolve(e)
    const t = await read($, theme)
    const still = await read($, reduceMotion)
    const look = buildLook({
      W: e.props.bodyColumns >= 48 ? 48 : 36,
      narrow: e.props.bodyColumns < 48,
      snap: await read($, snapshot),
      selected: await read($, selected),
      isDetailOpen: await read($, isDetailOpen),
      isKeyOpen: await read($, isKeyOpen),
      isSkillsOpen: await read($, isSkillsOpen),
      frame: still ? 0 : await read($, frame),
      motion: !still,
      now: await $.clock.now(),
      theme: isTheme(t) ? t : 'hiscore',
    })
    return drawRows(E, look.rows, look.fg, look.bg, a => void act($, a))
  })
}

