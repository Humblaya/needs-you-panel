import { expect, test } from 'claude-code/testing'

import {
  ageLabel,
  heatStrip,
  needsFromTranscript,
  parseAgents,
  parseChecks,
  parseGuardLog,
  parseSearch,
  parseSkills,
  parseTranscript,
} from '../hooks/data'

const T0 = Date.parse('2026-01-05T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()
const jl = (...rows: object[]) => rows.map(r => JSON.stringify(r)).join('\n') + '\n'

const user = (at: number, content: unknown, extra: object = {}) => ({
  type: 'user', uuid: 'u' + at, timestamp: iso(at), cwd: '/home/sam/demo-app', message: { role: 'user', content }, ...extra,
})
const assistant = (at: number, content: unknown[], stop = 'tool_use') => ({
  type: 'assistant', uuid: 'a' + at, timestamp: iso(at), cwd: '/home/sam/demo-app',
  message: { role: 'assistant', content, stop_reason: stop },
})
const ask = (id: string, question: string) => ({
  type: 'tool_use', id, name: 'AskUserQuestion',
  input: { questions: [{ question, header: 'Pick', options: [{ label: 'Red' }, { label: 'Blue' }] }] },
})

test('an AskUserQuestion with no result yet is an open question', () => {
  const text = jl(
    { type: 'ai-title', aiTitle: 'Colour picker work' },
    user(T0, 'make it nicer'),
    assistant(T0 + 1000, [ask('q1', 'Which colour should the button be?')]),
  )
  const parsed = parseTranscript(text)
  const items = needsFromTranscript(parsed, { session: 's1', now: T0 + 5000, since: 0 })
  expect(items.length).toBe(1)
  expect(items[0]?.kind).toBe('question')
  expect(items[0]?.title).toBe('Which colour should the button be?')
  expect(items[0]?.who).toBe('Colour picker work')
  expect(items[0]?.project).toBe('demo-app')
  expect(items[0]?.detail.join(' ')).toContain('Red')
})

test('an answered question is not open', () => {
  const text = jl(
    assistant(T0, [ask('q1', 'Which colour?')]),
    user(T0 + 1000, [{ type: 'tool_result', tool_use_id: 'q1', content: 'Red' }]),
    assistant(T0 + 2000, [{ type: 'text', text: 'Done.' }], 'end_turn'),
  )
  const items = needsFromTranscript(parseTranscript(text), { session: 's1', now: T0 + 60000, since: T0 + 99999 })
  expect(items.length).toBe(0)
})

test('a failed last tool result counts after 30 seconds of silence', () => {
  const text = jl(
    assistant(T0, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }]),
    user(T0 + 1000, [{ type: 'tool_result', tool_use_id: 't1', content: 'Exit code 1\n3 tests failed', is_error: true }]),
  )
  const parsed = parseTranscript(text)
  expect(needsFromTranscript(parsed, { session: 's1', now: T0 + 20000, since: 0 }).length).toBe(0)
  const items = needsFromTranscript(parsed, { session: 's1', now: T0 + 40000, since: 0 })
  expect(items[0]?.kind).toBe('failed')
  expect(items[0]?.title).toBe('Bash failed')
  expect(items[0]?.detail.join(' ')).toContain('3 tests failed')
})

test('a failure the person interrupted is not reported', () => {
  const text = jl(
    assistant(T0, [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
    user(T0 + 1000, [{ type: 'tool_result', tool_use_id: 't1', content: '[Request interrupted by user for tool use]', is_error: true }]),
  )
  expect(needsFromTranscript(parseTranscript(text), { session: 's1', now: T0 + 90000, since: 0 }).length).toBe(0)
})

test('a finished turn after the panel started is unviewed work', () => {
  const text = jl(
    user(T0, 'write the report'),
    assistant(T0 + 5000, [{ type: 'text', text: 'The report is ready in docs/report.md.' }], 'end_turn'),
    { type: 'system', subtype: 'turn_duration', timestamp: iso(T0 + 5001) },
  )
  const parsed = parseTranscript(text)
  const items = needsFromTranscript(parsed, { session: 's1', now: T0 + 9000, since: T0 - 1 })
  expect(items[0]?.kind).toBe('finished')
  expect(items[0]?.id).toBe('done:s1:a' + (T0 + 5000))
  expect(items[0]?.detail.join(' ')).toContain('report is ready')
  // finished before the panel's first run: not shown
  expect(needsFromTranscript(parsed, { session: 's1', now: T0 + 9000, since: T0 + 6000 }).length).toBe(0)
})

test('a transcript read from its tail skips the cut first line', () => {
  const whole = jl(user(T0, 'hi'), assistant(T0 + 1, [ask('q9', 'Ship it?')]))
  const parsed = parseTranscript(whole.slice(10), { isTail: true })
  expect(parsed.question?.text).toBe('Ship it?')
})

test('sidechain rows and broken lines are ignored', () => {
  const text = jl(
    assistant(T0, [{ type: 'text', text: 'ok' }], 'end_turn'),
    { ...assistant(T0 + 10, [ask('q2', 'Sub-agent question?')]), isSidechain: true },
  ) + '{"broken'
  const parsed = parseTranscript(text)
  expect(parsed.question).toBeUndefined()
  expect(parsed.finished?.uuid).toBe('a' + T0)
})

test('the guard log gives recent asks as items and today counts', () => {
  const now = T0
  const text = jl(
    { time: iso(now - 2 * 60000), decision: 'ask', reason: 'This push goes to main.', project: 'demo-app' },
    { time: iso(now - 60 * 60000), decision: 'ask', reason: 'Force push rewrites history.', project: 'demo-app' },
    { time: iso(now - 3 * 60000), decision: 'deny', reason: 'Looks like a secret.', project: 'site' },
    { time: iso(now - 30 * 3600000), decision: 'deny', reason: 'old', project: 'site' },
  ) + 'not json\n'
  const g = parseGuardLog(text, now, now - 6 * 3600000)
  expect(g.items.length).toBe(1)
  expect(g.items[0]?.kind).toBe('approve')
  expect(g.items[0]?.title).toBe('This push goes to main.')
  expect(g.items[0]?.who).toBe('guard')
  expect(g.asked).toBe(2)
  expect(g.blocked).toBe(1)
})

test('agents that started and have not stopped are running; stale ones drop', () => {
  const now = T0
  const text = jl(
    { time: iso(now - 5 * 60000), event: 'start', agent_type: 'Explore', project: 'demo-app', agent_id: 'a1' },
    { time: iso(now - 4 * 60000), event: 'start', agent_type: 'Plan', project: 'demo-app', agent_id: 'a2' },
    { time: iso(now - 1 * 60000), event: 'stop', agent_type: 'Plan', project: 'demo-app', agent_id: 'a2' },
    { time: iso(now - 3 * 3600000), event: 'start', agent_type: 'old-one', project: 'x', agent_id: 'a3' },
    { time: iso(now - 2 * 60000), event: 'start', agent_type: 'reviewer', project: 'site' },
    { time: iso(now - 1 * 60000), event: 'stop', agent_type: 'reviewer', project: 'site' },
  )
  const a = parseAgents(text, now, now - 6 * 3600000)
  expect(a.running.map(r => r.who).join(',')).toBe('Explore')
  expect(a.runs).toBe(2)
})

test('gh search output becomes pull requests', () => {
  const prs = parseSearch(JSON.stringify([
    { number: 4, title: 'Add parser', url: 'https://github.com/o/r/pull/4', repository: { name: 'r', nameWithOwner: 'o/r' } },
  ]))
  expect(prs[0]?.repo).toBe('o/r')
  expect(prs[0]?.number).toBe(4)
  expect(parseSearch('not json').length).toBe(0)
})

test('gh checks output is counted by bucket', () => {
  const c = parseChecks(JSON.stringify([
    { bucket: 'pass' }, { bucket: 'pass' }, { bucket: 'fail' }, { bucket: 'pending' }, { bucket: 'skipping' },
  ]))
  expect(c).toEqual({ pass: 3, fail: 1, running: 1, total: 5 })
  expect(parseChecks('')).toEqual({ pass: 0, fail: 0, running: 0, total: 0 })
})

test('ages read as now, minutes, hours and days', () => {
  expect(ageLabel(20000)).toBe('now')
  expect(ageLabel(5 * 60000)).toBe('5m')
  expect(ageLabel(3 * 3600000)).toBe('3h')
  expect(ageLabel(50 * 3600000)).toBe('2d')
})

test('the heat strip buckets the last day into half hours', () => {
  const strip = heatStrip([T0 - 1000, T0 - 2000, T0 - 31 * 60000, T0 - 25 * 3600000], T0, 48)
  expect(strip.length).toBe(48)
  expect(strip[47]).toBe(2)
  expect(strip[46]).toBe(1)
  expect(strip.reduce((a, b) => a + b, 0)).toBe(3)
})

test('terminal control characters in transcript text are removed', () => {
  const text = jl(assistant(T0, [ask('q1', 'Pick \u001b[31mred\u001b[0m or blue?\u0007')]))
  const items = needsFromTranscript(parseTranscript(text), { session: 's1', now: T0 + 5000, since: 0 })
  const all = JSON.stringify(items)
  expect(/[\u0000-\u001f\u007f-\u009f]/.test(items[0]?.title ?? '')).toBe(false)
  expect(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(items[0]?.detail.join('') ?? '')).toBe(false)
  expect(all.includes('red')).toBe(true)
})

test('a skills note from today gives the added and removed names', () => {
  const dayStart = T0 - 3_600_000
  const today = parseSkills(JSON.stringify({ time: iso(T0), added: ['alpha', 'beta', 'gamma'], removed: ['old'] }), dayStart)
  expect(today).toEqual({ added: ['alpha', 'beta', 'gamma'], removed: ['old'] })
  expect(parseSkills(JSON.stringify({ time: iso(dayStart - 1), added: ['alpha'], removed: [] }), dayStart)).toBeNull()
  expect(parseSkills('not json', dayStart)).toBeNull()
  expect(parseSkills(JSON.stringify({ time: iso(T0), added: [], removed: [] }), dayStart)).toBeNull()
  expect(parseSkills(JSON.stringify({ time: iso(T0), added: [3, 'ok\u001b[1m'] }), dayStart)).toEqual({ added: ['ok'], removed: [] })
})
