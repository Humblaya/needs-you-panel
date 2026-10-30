import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

const NOW = Date.parse('2026-01-05T12:00:00.000Z')
const HOME = '/home/tester'
// the engine hands paths on in the platform's own spelling, so match their ends
const isProjects = (p: string) => /[\\/]\.claude[\\/]projects$/.test(p)
const isGuard = (p: string) => /[\\/]needs-you[\\/]guard\.jsonl$/.test(p)
const BIG = 5_000_000

const PANE = {
  plugin: 'needs-you-panel',
  component: 'Pane',
  requestId: 'needs-you',
  surface: 'terminal',
  props: { title: 'Needs you', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

/**
 * A machine with one big, busy transcript and a guard log over 4 MB. Counts
 * how often the panel lists the project folder and reads each file.
 */
function world(on: On) {
  const clock = mock.clock(on, { now: NOW })
  const held: Record<string, unknown> = { since: 1, reduceMotion: true }
  on('store.get', (_, e) => ({ value: held[e.key] }))
  on('store.set', (_, e) => {
    held[e.key] = e.value
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'needs-you' } }))
  on('session.id', () => ({ value: 'this-session' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'needs-you', title: 'Needs you', isShown: true, isFocused: false, isPlaced: true }] }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))

  const seen = { folderLists: 0, transcriptReads: 0, guardReads: 0, wholeReads: [] as string[] }
  on('fs.list', (_, e) => {
    if (isProjects(e.path)) return { value: [{ name: 'demo-app', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
    seen.folderLists += 1
    // the session is busy: its file changes all the time
    return { value: [{ name: 'busy.jsonl', kind: 'file', size: BIG, mtimeMs: clock.now(), isLink: false }] }
  })
  on('fs.stat', (_, e) => (isGuard(e.path) ? { value: { kind: 'file', size: BIG, mtimeMs: 1, isLink: false } } : { deny: 'ENOENT' }))
  on('fs.read', (_, e) => {
    seen.wholeReads.push(e.path)
    return { deny: 'too big' }
  })
  on('process.run', (_, e) => {
    const path = e.argv[e.argv.length - (e.argv[0] === 'tail' ? 1 : 2)] ?? ''
    if (isGuard(path)) {
      seen.guardReads += 1
      const line = JSON.stringify({ time: new Date(NOW - 60_000).toISOString(), decision: 'deny', reason: 'Blocked.', project: 'demo-app' })
      return { value: { exitCode: 0, stdout: `cut line\n${line}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (path.endsWith('busy.jsonl')) {
      seen.transcriptReads += 1
      return { value: { exitCode: 0, stdout: 'cut line\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { clock, seen }
}

test('a guard log over 4 MB is read from its tail, not dropped', async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(6_000)
  expect(seen.guardReads).toBe(1)
  expect(seen.wholeReads.some(isGuard)).toBe(false)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /blocked 1/ })).toBeDefined()
  await ui.unmount()
})

test('folders are listed at most every 15 s and a big busy session read at most every 20 s', async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(41_000)
  // scans run every 5 s (about 8 here); listing and big reads are held back
  expect(seen.folderLists).toBeLessThanOrEqual(3)
  expect(seen.folderLists).toBeGreaterThanOrEqual(2)
  expect(seen.transcriptReads).toBeLessThanOrEqual(3)
  expect(seen.transcriptReads).toBeGreaterThanOrEqual(2)
})
