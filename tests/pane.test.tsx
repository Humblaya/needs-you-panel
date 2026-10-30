import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import type { Snapshot, ThemeId } from '../types'
import type { Row } from '../hooks/cells'
import { rowWidth } from '../hooks/cells'
import { widthFor } from '../hooks/register'
import { THEMES, bigWord, buildLook } from '../hooks/themes'

const NOW = Date.parse('2026-01-05T12:00:00.000Z')

// Generic sample data: no real people, projects or pull requests.
const SAMPLE: Snapshot = {
  needs: [
    { id: 'guard:1', kind: 'approve', who: 'guard', title: 'This push goes to main.', project: 'demo-app', at: NOW - 10_000, detail: ['This push goes to main.'] },
    { id: 'ask:s1:q1', kind: 'question', who: 'Colour picker work', title: 'Which colour should the button be?', project: 'demo-app', at: NOW - 120_000, detail: ['Which colour should the button be?', '• Red', '• Blue'] },
    { id: 'fail:s2:1', kind: 'failed', who: 'Test run', title: 'Bash failed', project: 'sample-site', at: NOW - 300_000, detail: ['Exit code 1'] },
    { id: 'done:s3:a1', kind: 'finished', who: 'Report writer', title: 'Turn finished', project: 'notes', at: NOW - 1_080_000, detail: ['The report is ready.'] },
  ],
  ready: {
    status: 'ok',
    at: NOW,
    prs: [
      { repo: 'example/parser', number: 12, title: 'Add a parser', url: 'https://github.com/example/parser/pull/12', pass: 20, fail: 0, running: 0, total: 20 },
      { repo: 'example/app', number: 42, title: 'Fix the streak count', url: 'https://github.com/example/app/pull/42', pass: 14, fail: 2, running: 0, total: 16 },
      { repo: 'example/site', number: 7, title: 'New header', url: 'https://github.com/example/site/pull/7', pass: 6, fail: 0, running: 5, total: 11 },
    ],
  },
  running: [
    { id: 'a1', who: 'Explore', project: 'demo-app', at: NOW - 720_000 },
    { id: 'a2', who: 'reviewer', project: 'notes', at: NOW - 180_000 },
  ],
  today: { asked: 3, blocked: 2, runs: 9, skills: { added: ['alpha-skill', 'beta-skill', 'gamma-skill'], removed: ['old-skill'] } },
  heat: [0, 1, 2, 3, 4, 2, 1, 0, 3, 4],
  at: NOW - 3_000,
}

const EMPTY_SNAP: Snapshot = { ...SAMPLE, needs: [], today: { asked: 0, blocked: 0, runs: 0, skills: null } }

const paneAt = (columns: number) =>
  ({
    plugin: 'needs-you-panel',
    component: 'Pane',
    requestId: 'needs-you',
    surface: 'terminal',
    props: { title: 'Needs you', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }) as const



/**
 * Seeds the panel's session values as an earlier run would have left them:
 * each seed shows only until the panel writes that value itself.
 */
function seed(on: On, values: { snapshot?: Snapshot; theme?: ThemeId; reduceMotion?: boolean; isKeyOpen?: boolean }) {
  mock.clock(on, { now: NOW })
  const seeds: Record<string, unknown> = {}
  if (values.snapshot) seeds.snapshot = { shape: 'snapshot-2', value: values.snapshot }
  if (values.theme) seeds.theme = values.theme
  if (values.reduceMotion !== undefined) seeds.reduceMotion = values.reduceMotion
  if (values.isKeyOpen !== undefined) seeds.isKeyOpen = values.isKeyOpen
  on('state.get', async ($, e, next) => {
    const below = await next(e)
    if (!(e.key in seeds) || !('value' in below) || (below.value?.version ?? 0) > 0) return below
    return { value: { value: seeds[e.key], version: 0 } }
  })
}

/** A store in memory the test can read back. */
function store(on: On, start: Record<string, unknown> = {}) {
  const held: Record<string, unknown> = { ...start }
  on('store.get', (_, e) => ({ value: held[e.key] }))
  on('store.set', (_, e) => {
    held[e.key] = e.value
    return { value: undefined }
  })
  return held
}

const ctx = (theme: ThemeId, W: number, snap: Snapshot) => ({
  W,
  narrow: W < 48,
  snap,
  selected: '',
  isDetailOpen: true,
  isKeyOpen: true,
  isSkillsOpen: true,
  frame: 7,
  motion: true,
  now: NOW,
  theme,
})

for (const theme of THEMES) {
  for (const W of [60, 48, 36, 30, 24]) {
    test(`${theme} at ${W} columns: every row is exactly ${W} cells`, () => {
      for (const snap of [SAMPLE, EMPTY_SNAP]) {
        const look = buildLook(ctx(theme, W, snap))
        const wrong = look.rows.map((r, i) => [i, rowWidth(r.segs)]).filter(([, w]) => w !== W)
        expect(wrong).toEqual([])
      }
    })
  }
}

const HEADS: Record<ThemeId, { wide: RegExp; narrow: RegExp; empty: RegExp }> = {
  hiscore: { wide: /^NEEDS YOU$/, narrow: /^◆$/, empty: /STAGE CLEAR/ },
  halo: { wide: /N E E D S {2}Y O U/, narrow: /^ NEEDS YOU$/, empty: /ALL SECTORS CLEAR/ },
  metro: { wide: /◉ NEEDS YOU/, narrow: /◉ NEEDS YOU/, empty: /End of the line/ },
  thermal: { wide: /^NEEDS YOU$/, narrow: /^NEEDS YOU$/, empty: /cooled down/ },
}

for (const theme of THEMES) {
  test(`${theme} draws on the terminal at 48 and 36 columns, items and empty state`, async ($, on) => {
    seed(on, { snapshot: SAMPLE, theme, reduceMotion: true })
    for (const [cols, head] of [[60, HEADS[theme].wide], [40, HEADS[theme].narrow]] as const) {
      const ui = await $.ui.mount(paneAt(cols))
      expect(await ui.find({ type: 'Text', text: head })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /This push goes to/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /parser/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeDefined()
      expect(await ui.find({ key: 'key' })).toBeDefined()
      await ui.unmount()
    }
  })

  test(`${theme} shows its empty state when nothing needs you`, async ($, on) => {
    seed(on, { snapshot: EMPTY_SNAP, theme, reduceMotion: true })
    const ui = await $.ui.mount(paneAt(60))
    expect(await ui.find({ type: 'Text', text: HEADS[theme].empty })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Nothing needs you/ })).toBeDefined()
    await ui.unmount()
  })
}

test('the design button cycles the look and stores the choice', async ($, on) => {
  const held = store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  seed(on, { snapshot: SAMPLE, reduceMotion: true })
  const ui = await $.ui.mount(paneAt(60))
  expect(await ui.find({ type: 'Text', text: /^design$/ })).toBeDefined()
  await ui.press({ key: 'design' })
  expect(await ui.find({ type: 'Text', text: /N E E D S/ })).toBeDefined()
  expect(held.theme).toBe('halo')
  for (const [theme, head] of [['metro', /◉ NEEDS YOU/], ['thermal', /core/], ['hiscore', /^NEEDS YOU$/]] as const) {
    await ui.press({ key: 'design' })
    expect(held.theme).toBe(theme)
    expect(await ui.find({ type: 'Text', text: head })).toBeDefined()
  }
  await ui.unmount()
})

test('a stored look is used when the next session starts', async ($, on) => {
  store(on, { theme: 'thermal', reduceMotion: true, since: 1 })
  mock.clock(on, { now: NOW })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'needs-you' } }))
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(60))
  expect(await ui.find({ type: 'Text', text: /core/ })).toBeDefined()
  await ui.unmount()
})

test('the motion button turns motion off and stores it', async ($, on) => {
  const held = store(on)
  seed(on, { snapshot: SAMPLE, isKeyOpen: true })
  const ui = await $.ui.mount(paneAt(60))
  expect(await ui.find({ type: 'Text', text: /^motion: on$/ })).toBeDefined()
  await ui.press({ key: 'motion' })
  expect(await ui.find({ type: 'Text', text: /^motion: off$/ })).toBeDefined()
  expect(held.reduceMotion).toBe(true)
  await ui.unmount()
})

test('skip hides the selected item and remembers it', async ($, on) => {
  const held = store(on)
  seed(on, { snapshot: SAMPLE, reduceMotion: true })
  const ui = await $.ui.mount(paneAt(60))
  await ui.press({ key: 'item:fail:s2:1' })
  await ui.press({ key: 'dismiss' })
  expect(await ui.find({ type: 'Text', text: /Bash failed/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /This push goes to main/ })).toBeDefined()
  expect(held.dismissed).toEqual(['fail:s2:1'])
  await ui.unmount()
})

test('with nothing selected there is no skip, so x dismisses nothing', async ($, on) => {
  const held = store(on)
  seed(on, { snapshot: SAMPLE, reduceMotion: true })
  const ui = await $.ui.mount(paneAt(60))
  expect(await ui.find({ key: 'dismiss' })).toBeUndefined()
  expect(await ui.find({ key: 'open' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /This push goes to main/ })).toBeDefined()
  expect(held.dismissed).toBeUndefined()
  await ui.unmount()
})

test('details stay hidden until an item is pressed; a second press hides them', async ($, on) => {
  seed(on, { snapshot: SAMPLE, reduceMotion: true })
  const ui = await $.ui.mount(paneAt(60))
  expect(await ui.find({ type: 'Text', text: /• Blue/ })).toBeUndefined()
  await ui.press({ key: 'item:ask:s1:q1' })
  expect(await ui.find({ type: 'Text', text: /• Blue/ })).toBeDefined()
  await ui.press({ key: 'item:ask:s1:q1' })
  expect(await ui.find({ type: 'Text', text: /• Blue/ })).toBeUndefined()
  await ui.press({ key: 'open' })
  expect(await ui.find({ type: 'Text', text: /• Blue/ })).toBeDefined()
  await ui.unmount()
})

test('only one item is open at a time', async ($, on) => {
  seed(on, { snapshot: SAMPLE, reduceMotion: true })
  const ui = await $.ui.mount(paneAt(60))
  await ui.press({ key: 'item:ask:s1:q1' })
  await ui.press({ key: 'item:done:s3:a1' })
  expect(await ui.find({ type: 'Text', text: /• Blue/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /report is ready/ })).toBeDefined()
  await ui.unmount()
})

/** Rows of pixel art in each look's own header, at 48 and at 36 columns. */
const HEADER_PX: Record<ThemeId, [number, number]> = { hiscore: [4, 0], halo: [3, 0], metro: [1, 1], thermal: [2, 2] }

const LEGEND: Record<ThemeId, RegExp> = {
  hiscore: /question or approval/,
  halo: /threat: items waiting/,
  metro: /line A: agents/,
  thermal: /white-hot: approval/,
}

for (const theme of THEMES) {
  test(`${theme}: the key button opens and closes the legend and remembers it`, async ($, on) => {
    const held = store(on)
    seed(on, { snapshot: SAMPLE, theme, reduceMotion: true })
    for (const cols of [60, 40]) {
      const ui = await $.ui.mount(paneAt(cols))
      expect(await ui.find({ key: 'key' })).toBeDefined()
      const wasOpen = (await ui.find({ type: 'Text', text: LEGEND[theme] })) !== undefined
      if (!wasOpen) {
        await ui.press({ key: 'key' })
        expect(held.keyOpen).toBe(true)
      }
      expect(await ui.find({ type: 'Text', text: LEGEND[theme] })).toBeDefined()
      expect(await ui.find({ key: 'motion' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /press a button, or its letter/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /move to the next item/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /skip: hide the picked item/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /panel \(from the chat\)/ })).toBeDefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount(paneAt(60))
    await ui.press({ key: 'key' })
    expect(await ui.find({ type: 'Text', text: LEGEND[theme] })).toBeUndefined()
    expect(held.keyOpen).toBe(false)
    await ui.unmount()
  })
}

test('the key button is dim and underlined', async ($, on) => {
  seed(on, { snapshot: SAMPLE, reduceMotion: true })
  const ui = await $.ui.mount(paneAt(60))
  const label = await ui.find({ type: 'Text', text: /^key$/ })
  expect(label?.props).toEqual(expect.objectContaining({ underline: true }))
  await ui.unmount()
})

test('an open legend is shown again when the next session starts', async ($, on) => {
  store(on, { keyOpen: true, reduceMotion: true, since: 1 })
  mock.clock(on, { now: NOW })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'needs-you' } }))
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(60))
  expect(await ui.find({ type: 'Text', text: /question or approval/ })).toBeDefined()
  await ui.unmount()
})

for (const theme of THEMES) {
  test(`${theme}: today shows new skills, and opening it lists them`, async ($, on) => {
    seed(on, { snapshot: SAMPLE, theme, reduceMotion: true })
    const ui = await $.ui.mount(paneAt(40))
    expect(await ui.find({ type: 'Text', text: /\+3 skills/})).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /beta-skill/ })).toBeUndefined()
    await ui.press({ key: 'skills' })
    expect(await ui.find({ type: 'Text', text: /beta-skill/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /old-skill/ })).toBeDefined()
    await ui.press({ key: 'skills' })
    expect(await ui.find({ type: 'Text', text: /beta-skill/ })).toBeUndefined()
    await ui.unmount()
  })
}

test('no skills row when nothing changed today', async ($, on) => {
  seed(on, { snapshot: EMPTY_SNAP, reduceMotion: true })
  const ui = await $.ui.mount(paneAt(60))
  expect(await ui.find({ key: 'skills' })).toBeUndefined()
  await ui.unmount()
})

const rowText = (r: Row) => r.segs.map(x => ('t' in x ? x.t : 'btn' in x ? x.segs.map(y => y.t).join('') : '')).join('')

for (const theme of THEMES) {
  for (const W of [48, 36]) {
    test(`${theme} at ${W}: by default an item is only its title, spaced out`, () => {
      const look = buildLook({ ...ctx(theme, W, SAMPLE), selected: '', isDetailOpen: false, isKeyOpen: false, isSkillsOpen: false })
      const all = look.rows.map(rowText).join('\n')
      // no meta: who and project stay hidden, and so do the open and skip buttons
      expect(all).not.toMatch(/guard · demo-app|Colour picker work|sample-site|Report writer/)
      expect(all).not.toMatch(/SKIP/)
      const titles = look.rows.map((r, i) => [r, i] as const).filter(([r]) => r.press)
      expect(titles.length).toBe(4)
      // a spacer row between items: nothing but blanks and rails
      for (const [, i] of titles.slice(1)) expect(rowText(look.rows[i - 1]!).replace(/[ ┃]/g, '')).toBe('')
    })

    test(`${theme} at ${W}: the picked item shows its meta, its open and skip row, and (opened) its details`, () => {
      const pick = { ...ctx(theme, W, SAMPLE), selected: 'ask:s1:q1', isKeyOpen: false, isSkillsOpen: false }
      const closed = buildLook({ ...pick, isDetailOpen: false })
      const at = closed.rows.findIndex(r => r.press?.key === 'item:ask:s1:q1')
      expect(rowText(closed.rows[at + 1]!)).toMatch(/· 2m/)
      expect(rowText(closed.rows[at + 2]!)).toMatch(/OPEN.*SKIP/)
      expect(closed.rows.map(rowText).join('\n')).not.toMatch(/• Blue/)
      // the other items still show only their titles
      expect(closed.rows.map(rowText).join('\n')).not.toMatch(/sample-site/)
      const opened = buildLook({ ...pick, isDetailOpen: true })
      expect(opened.rows.map(rowText).join('\n')).toMatch(/• Blue/)
    })

    test(`${theme} at ${W}: the key lists every switch`, () => {
      const look = buildLook({ ...ctx(theme, W, SAMPLE), isKeyOpen: true })
      const all = look.rows.map(rowText).join('\n')
      for (const want of [/t +design/, /r +refresh/, /m +motion/, /o +open/, /x +skip/, /k +key/, /tab +move/, /enter +open/, /alt\+n +panel/, /esc +chat/]) {
        expect(all).toMatch(want)
      }
    })

    test(`${theme} at ${W}: the bottom bar holds small design and refresh buttons, the key, and the alt+n hint`, () => {
      const look = buildLook({ ...ctx(theme, W, SAMPLE), isKeyOpen: false })
      const all = look.rows.map(r => r.segs.map(x => ('t' in x ? x.t : 'btn' in x ? `[${x.btn}:${x.hotkey}:${x.segs.map(y => y.t).join('')}]` : '')).join(''))
      expect(all.some(l => /tab move|MOTION|REFRESH|DESIGN/.test(l))).toBe(false)
      const bar = all[all.length - 2]!
      expect(bar.startsWith('[design:t:design]  [refresh:r:refresh]')).toBe(true)
      expect(bar.endsWith('[key:k:key]')).toBe(true)
      expect(all[all.length - 1]!.trimEnd()).toBe('alt+n: panel · esc: chat')
    })

    test(`${theme} at ${W}: section names are drawn in big pixel letters`, () => {
      const look = buildLook({ ...ctx(theme, W, SAMPLE), isKeyOpen: false, isSkillsOpen: false })
      const pxRows = look.rows.filter(r => r.segs.some(x => 'px' in x)).length
      const art = HEADER_PX[theme][W === 48 ? 0 : 1]
      // four sections, exactly two rows of half blocks each: only a little bigger than one row
      expect(pxRows - art).toBe(8)
    })
  }
}

test('the focus keys line is faint', async ($, on) => {
  seed(on, { snapshot: SAMPLE, reduceMotion: true })
  const ui = await $.ui.mount(paneAt(60))
  const focus = await ui.find({ type: 'Text', text: /^alt\+n: panel · esc: chat$/ })
  expect(focus?.props).toEqual(expect.objectContaining({ color: '#6E6896' }))
  await ui.unmount()
})

test('the bottom bar buttons work without opening the key', async ($, on) => {
  const held = store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  seed(on, { snapshot: SAMPLE, reduceMotion: true })
  const ui = await $.ui.mount(paneAt(40))
  await ui.press({ key: 'design' })
  expect(held.theme).toBe('halo')
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ key: 'refresh' })).toBeDefined()
  await ui.unmount()
})

test('/needs-you opens the pane with the keyboard and leaves no transcript row', async ($, on) => {
  const opened: unknown[] = []
  store(on, { since: 1, reduceMotion: true })
  mock.clock(on, { now: NOW })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'needs-you' } }))
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.open', (_, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'needs-you', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(ran).toEqual({})
  expect(opened[opened.length - 1]).toEqual(expect.objectContaining({ id: 'needs-you', focus: true }))
})

test('big letters are two rows tall and three cells wide', () => {
  for (const word of ['NEEDS YOU', 'READY', 'RUNNING', 'TODAY', 'HOT', 'WARM', 'COOL']) {
    const rows = bigWord(word, '#FFFFFF', '#000000')
    expect(rows.length).toBe(2)
    const letters = word.replace(/ /g, '').length
    const spaces = word.split(' ').length - 1
    // 3 cells a letter, 1 between letters of a word, 2 for a space
    expect(rows[0]!.px.length).toBe(letters * 3 + (letters - 1 - spaces) + spaces * 2)
  }
})

for (const cols of [24, 30, 80]) {
  test(`at a ${cols}-column pane the design, refresh and key buttons are all drawn and the key opens`, async ($, on) => {
    const held = store(on)
    seed(on, { snapshot: SAMPLE, reduceMotion: true })
    const ui = await $.ui.mount(paneAt(cols))
    for (const key of ['design', 'refresh', 'key']) expect(await ui.find({ key })).toBeDefined()
    await ui.press({ key: 'key' })
    expect(held.keyOpen).toBe(true)
    expect(await ui.find({ type: 'Text', text: /skip: hide/ })).toBeDefined()
    await ui.unmount()
  })
}

test('the drawing fills the pane between 24 and 64 columns', () => {
  expect([10, 24, 30, 36, 47, 48, 60, 64, 100].map(widthFor)).toEqual([24, 24, 30, 36, 47, 48, 60, 64, 64])
})
