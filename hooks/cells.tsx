// The panel's drawing model: rows of coloured text runs, half-block pixel
// runs and buttons, each row a fixed number of terminal cells wide. Themes
// build rows; `drawRows` turns them into the surface's elements.
import type { Elements } from 'claude-code'

export type Action =
  | { type: 'select'; id: string }
  | { type: 'open' }
  | { type: 'dismiss' }
  | { type: 'theme' }
  | { type: 'motion' }
  | { type: 'refresh' }
  | { type: 'key' }
  | { type: 'skills' }

export type TextSeg = { t: string; fg?: string; bg?: string; b?: boolean; u?: boolean }
/** Half-block pixels: each cell is [top colour, bottom colour]. */
export type PxSeg = { px: Array<[string, string]> }
export type BtnSeg = { btn: string; hotkey?: string; act: Action; segs: TextSeg[] }
export type Seg = TextSeg | PxSeg | BtnSeg
export type Row = { segs: Seg[]; press?: { key: string; act: Action } }

export const S = (t: string, o: Omit<TextSeg, 't'> = {}): TextSeg => ({ t, ...o })

const cellsOf = (t: string) => [...t].length

export function segWidth(s: Seg): number {
  if ('px' in s) return s.px.length
  if ('btn' in s) return (s.hotkey ? 3 : 0) + s.segs.reduce((n, x) => n + cellsOf(x.t), 0)
  return cellsOf(s.t)
}

export const rowWidth = (segs: Seg[]) => segs.reduce((n, s) => n + segWidth(s), 0)

export const pad = (s: string, n: number) => {
  const c = [...s]
  return c.length >= n ? c.slice(0, n).join('') : s + ' '.repeat(n - c.length)
}
export const rpad = (s: string, n: number) => {
  const c = [...s]
  return c.length >= n ? c.slice(c.length - n).join('') : ' '.repeat(n - c.length) + s
}
/** Cut to `n` cells, ending in an ellipsis when cut. */
export const fit = (s: string, n: number) => {
  const c = [...s]
  if (n <= 0) return ''
  return c.length <= n ? s : c.slice(0, n - 1).join('') + '…'
}

/** Clips a row to `w` cells: text runs are cut, pixel and button runs that do not fit are dropped. */
function clip(segs: Seg[], w: number): Seg[] {
  const out: Seg[] = []
  let used = 0
  for (const s of segs) {
    const n = segWidth(s)
    if (used + n <= w) {
      out.push(s)
      used += n
    } else {
      if ('t' in s && w - used > 0) out.push({ ...s, t: [...s.t].slice(0, w - used).join('') })
      break
    }
  }
  return out
}

/** A row of `segs`, filled to `w` cells. */
export function line(w: number, segs: Seg[], fill = ' ', fillStyle: Omit<TextSeg, 't'> = {}): Row {
  const c = clip(segs, w)
  const n = rowWidth(c)
  return { segs: n >= w ? c : [...c, S(fill.repeat(w - n), fillStyle)] }
}

/** `left` and `right` with `fill` between, `w` cells in all; the left side gives way first. */
export function lr(w: number, left: Seg[], right: Seg[], fill = ' ', fillStyle: Omit<TextSeg, 't'> = {}): Row {
  const rw = rowWidth(right)
  const l = clip(left, Math.max(0, w - rw))
  const gap = Math.max(0, w - rowWidth(l) - rw)
  return { segs: clip([...l, S(fill.repeat(gap), fillStyle), ...right], w) }
}

/** Pixel art from a grid of palette keys, two pixel rows per text row; '.' is the ground. */
export function pixels(grid: string[], pal: Record<string, string>, ground: string): PxSeg[] {
  const out: PxSeg[] = []
  for (let y = 0; y < grid.length; y += 2) {
    const top = grid[y] ?? ''
    const bot = grid[y + 1] ?? '.'.repeat(top.length)
    out.push({
      px: [...top].map((c, x) => {
        const b = bot[x] ?? '.'
        return [c === '.' ? ground : (pal[c] ?? ground), b === '.' ? ground : (pal[b] ?? ground)]
      }),
    })
  }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[n & 63]! : '='
  }
  return out
}

const rgb = (hex: string) => parseInt(hex.slice(1), 16) & 0xffffff

/** One row of half blocks as Raster cells: '▀' in the top colour over the bottom colour. */
export function rasterCells(px: PxSeg['px']): string {
  const words = new Uint32Array(px.length * 3)
  px.forEach(([top, bottom], i) => {
    words[i * 3] = 0x2580
    words[i * 3 + 1] = rgb(top)
    words[i * 3 + 2] = rgb(bottom)
  })
  return base64(new Uint8Array(words.buffer))
}

type Els = Elements['terminal'] | Elements['desktop'] | Elements['vscode'] | Elements['mobile']

const textEl = (E: Els, s: TextSeg, fg: string) => (
  <E.Text color={s.fg ?? fg} backgroundColor={s.bg} bold={s.b} underline={s.u}>
    {s.t}
  </E.Text>
)

/** The rows as elements: one Box per row; pixels as a Raster where the surface has one. */
export function drawRows(E: Els, rows: Row[], fg: string, bg: string, onAct: (a: Action) => void) {
  return (
    <E.Box flexDirection="column" backgroundColor={bg}>
      {rows.map((row, i) => {
        if (row.press) {
          const act = row.press.act
          return (
            <E.Button key={row.press.key} plain onPress={() => onAct(act)}>
              {row.segs.flatMap(s => ('t' in s ? [textEl(E, s, fg)] : []))}
            </E.Button>
          )
        }
        return (
          <E.Box flexDirection="row" height={1}>
            {row.segs.map((s, j) => {
              if ('px' in s) {
                if ('Raster' in E) {
                  return <E.Raster key={`px${i}.${j}`} columns={s.px.length} rows={1} cells={rasterCells(s.px)} />
                }
                return (
                  <E.Box flexDirection="row">
                    {s.px.map(([top, bottom], k) => (
                      <E.Text color={top} backgroundColor={bottom}>
                        ▀
                      </E.Text>
                    ))}
                  </E.Box>
                )
              }
              if ('btn' in s) {
                const act = s.act
                return (
                  <E.Button key={s.btn} plain hotkey={s.hotkey} onPress={() => onAct(act)}>
                    {s.segs.map((x, k) => textEl(E, x, fg))}
                  </E.Button>
                )
              }
              return textEl(E, s, fg)
            })}
          </E.Box>
        )
      })}
    </E.Box>
  )
}
