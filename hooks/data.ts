// Pure parsing for the Needs You panel: transcripts, the guard and agent
// logs, and the gh CLI's JSON. No engine calls here, so tests run it as is.
import type { NeedItem, Pr, RunningAgent, SkillChange } from '../types'

const FAIL_QUIET_MS = 30_000
const GUARD_ASK_MS = 10 * 60_000
const STALE_AGENT_MS = 2 * 3_600_000

type Json = Record<string, unknown>

export type Transcript = {
  title?: string
  cwd?: string
  question?: { id: string; text: string; options: string[]; at: number }
  failed?: { tool: string; error: string; at: number }
  finished?: { uuid: string; text: string; at: number }
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
// Text from transcripts and logs is drawn in a terminal: drop escape sequences
// and control characters (tabs and newlines stay; they become spaces later).
const clean = (s: string) =>
  s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
const str = (v: unknown) => (typeof v === 'string' ? clean(v) : '')
const time = (v: unknown) => {
  const t = Date.parse(str(v))
  return Number.isNaN(t) ? 0 : t
}

export const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''

/** Each line of a JSONL text as an object; a tail read drops its cut first line. */
export function jsonLines(text: string, isTail = false): Json[] {
  const lines = text.split('\n')
  if (isTail) lines.shift()
  const out: Json[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const o: unknown = JSON.parse(line)
      if (isObj(o)) out.push(o)
    } catch {
      // a line still being written, or cut
    }
  }
  return out
}

const blocks = (row: Json): Json[] => {
  const msg = row.message
  if (!isObj(msg) || !Array.isArray(msg.content)) return []
  return msg.content.filter(isObj)
}

const resultText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(c => (isObj(c) ? str(c.text) : '')).join(' ')
  return ''
}

const oneLine = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat
}

/** What a session's transcript says right now: its title, an open question, a failure, a finished turn. */
export function parseTranscript(text: string, options: { isTail?: boolean } = {}): Transcript {
  const out: Transcript = {}
  const toolNames = new Map<string, string>()
  const answered = new Set<string>()
  const asks: NonNullable<Transcript['question']>[] = []
  let last: Json | undefined

  for (const row of jsonLines(text, options.isTail)) {
    if (row.type === 'ai-title' && str(row.aiTitle)) out.title = str(row.aiTitle)
    if (row.type === 'custom-title' && str(row.customTitle)) out.title = str(row.customTitle)
    if (row.type !== 'user' && row.type !== 'assistant') continue
    if (row.isSidechain === true) continue
    if (str(row.cwd)) out.cwd = str(row.cwd)
    for (const b of blocks(row)) {
      if (b.type === 'tool_use') {
        toolNames.set(str(b.id), str(b.name))
        if (b.name === 'AskUserQuestion') {
          const qs = isObj(b.input) && Array.isArray(b.input.questions) ? b.input.questions.filter(isObj) : []
          const q = qs[0]
          const options = q && Array.isArray(q.options) ? q.options.filter(isObj).map(o => str(o.label)) : []
          asks.push({ id: str(b.id), text: q ? str(q.question) : 'A question', options, at: time(row.timestamp) })
        }
      }
      if (b.type === 'tool_result') answered.add(str(b.tool_use_id))
    }
    last = row
  }

  const open = asks.filter(a => !answered.has(a.id)).pop()
  if (open) out.question = open

  if (last?.type === 'user') {
    const failed = blocks(last).find(b => b.type === 'tool_result' && b.is_error === true)
    const error = failed ? resultText(failed.content) : ''
    const isPersonsOwn = /interrupted by user|doesn't want to proceed|user rejected/i.test(error)
    if (failed && !isPersonsOwn) {
      out.failed = { tool: toolNames.get(str(failed.tool_use_id)) || 'A tool', error, at: time(last.timestamp) }
    }
  }
  if (last?.type === 'assistant' && isObj(last.message) && last.message.stop_reason === 'end_turn') {
    const text = blocks(last).map(b => (b.type === 'text' ? str(b.text) : '')).join(' ')
    out.finished = { uuid: str(last.uuid), text, at: time(last.timestamp) }
  }
  return out
}

/** The needs-you items one transcript holds at `now`; `since` is when the panel first ran. */
export function needsFromTranscript(
  t: Transcript,
  ctx: { session: string; now: number; since: number; project?: string },
): NeedItem[] {
  const project = t.cwd ? baseName(t.cwd) : (ctx.project ?? '')
  const who = t.title ? oneLine(t.title, 40) : project || 'session'
  const items: NeedItem[] = []
  if (t.question) {
    items.push({
      id: `ask:${ctx.session}:${t.question.id}`,
      kind: 'question',
      who,
      title: oneLine(t.question.text, 120),
      project,
      at: t.question.at,
      detail: [t.question.text, ...t.question.options.map(o => `• ${o}`)],
    })
  }
  if (t.failed && ctx.now - t.failed.at >= FAIL_QUIET_MS) {
    items.push({
      id: `fail:${ctx.session}:${t.failed.at}`,
      kind: 'failed',
      who,
      title: `${t.failed.tool} failed`,
      project,
      at: t.failed.at,
      detail: [oneLine(t.failed.error, 300)],
    })
  }
  if (t.finished && t.finished.at > ctx.since) {
    items.push({
      id: `done:${ctx.session}:${t.finished.uuid}`,
      kind: 'finished',
      who,
      title: oneLine(t.finished.text, 120) || 'Turn finished',
      project,
      at: t.finished.at,
      detail: [oneLine(t.finished.text, 300)],
    })
  }
  return items
}

/** Guard asks from the last ten minutes as items, plus today's ask and block counts. */
export function parseGuardLog(text: string, now: number, dayStart: number) {
  const items: NeedItem[] = []
  let asked = 0
  let blocked = 0
  for (const row of jsonLines(text)) {
    const at = time(row.time)
    if (at >= dayStart) {
      if (row.decision === 'ask') asked += 1
      if (row.decision === 'deny') blocked += 1
    }
    if (row.decision === 'ask' && now - at < GUARD_ASK_MS) {
      items.push({
        id: `guard:${str(row.time)}`,
        kind: 'approve',
        who: 'guard',
        title: oneLine(str(row.reason) || 'Approval asked', 120),
        project: str(row.project),
        at,
        detail: [str(row.reason)],
      })
    }
  }
  return { items, asked, blocked }
}

/** Agents started and not yet stopped (younger than two hours), and today's finished runs. */
export function parseAgents(text: string, now: number, dayStart: number) {
  const open: RunningAgent[] = []
  let runs = 0
  for (const row of jsonLines(text)) {
    const at = time(row.time)
    const who = str(row.agent_type) || 'agent'
    const project = str(row.project)
    const id = str(row.agent_id)
    if (row.event === 'start') {
      // a resumed agent starts again under the same id: keep one row
      const again = id ? open.findIndex(a => a.id === id) : -1
      if (again >= 0) open.splice(again, 1)
      open.push({ id: id || `${who}@${project}@${at}`, who, project, at })
    }
    if (row.event === 'stop') {
      if (at >= dayStart) runs += 1
      const i = id
        ? open.findIndex(a => a.id === id)
        : open.findIndex(a => a.who === who && a.project === project)
      if (i >= 0) open.splice(i, 1)
    }
  }
  const running = open.filter(a => now - a.at < STALE_AGENT_MS).sort((a, b) => b.at - a.at)
  return { running, runs }
}

/** `gh search prs --json repository,number,title,url` output. */
export function parseSearch(text: string): Pr[] {
  try {
    const rows: unknown = JSON.parse(text)
    if (!Array.isArray(rows)) return []
    return rows.filter(isObj).map(r => ({
      repo: isObj(r.repository) ? str(r.repository.nameWithOwner) || str(r.repository.name) : '',
      number: typeof r.number === 'number' ? r.number : 0,
      title: str(r.title),
      url: str(r.url),
      pass: 0,
      fail: 0,
      running: 0,
      total: 0,
    }))
  } catch {
    return []
  }
}

/** `gh pr checks --json bucket` output, counted. Skipped checks count as passing. */
export function parseChecks(text: string) {
  const c = { pass: 0, fail: 0, running: 0, total: 0 }
  try {
    const rows: unknown = JSON.parse(text)
    if (!Array.isArray(rows)) return c
    for (const r of rows.filter(isObj)) {
      c.total += 1
      if (r.bucket === 'fail' || r.bucket === 'cancel') c.fail += 1
      else if (r.bucket === 'pending') c.running += 1
      else c.pass += 1
    }
  } catch {
    // no checks reported
  }
  return c
}

/**
 * `needs-you/skills.json`, which any hook may write: `{ time, added, removed }`.
 * The change when it happened today and named a skill, else null.
 */
export function parseSkills(text: string, dayStart: number): SkillChange | null {
  try {
    const o: unknown = JSON.parse(text)
    if (!isObj(o) || time(o.time) < dayStart) return null
    const names = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => str(x)).filter(Boolean) : [])
    const change = { added: names(o.added), removed: names(o.removed) }
    return change.added.length || change.removed.length ? change : null
  } catch {
    return null
  }
}

export function ageLabel(ms: number) {
  if (ms < 60_000) return 'now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

/** Event counts per half hour over the last `cells` half hours, oldest first. */
export function heatStrip(times: number[], now: number, cells: number) {
  const strip = new Array<number>(cells).fill(0)
  for (const t of times) {
    const back = Math.floor((now - t) / 1_800_000)
    if (back >= 0 && back < cells) strip[cells - 1 - back] = (strip[cells - 1 - back] ?? 0) + 1
  }
  return strip
}
