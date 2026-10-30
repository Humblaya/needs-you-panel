export type ThemeId = 'hiscore' | 'halo' | 'metro' | 'thermal'

export type NeedKind = 'approve' | 'question' | 'failed' | 'finished'

export type NeedItem = {
  id: string
  kind: NeedKind
  who: string
  title: string
  project: string
  at: number
  detail: string[]
}

export type Pr = {
  repo: string
  number: number
  title: string
  url: string
  pass: number
  fail: number
  running: number
  total: number
}

export type ReadyStatus = 'loading' | 'ok' | 'no-gh' | 'offline'

export type Ready = { status: ReadyStatus; prs: Pr[]; at: number }

export type RunningAgent = { id: string; who: string; project: string; at: number }

export type SkillChange = { added: string[]; removed: string[] }

export type Today = { asked: number; blocked: number; runs: number; skills: SkillChange | null }

export type Snapshot = {
  needs: NeedItem[]
  ready: Ready
  running: RunningAgent[]
  today: Today
  heat: number[]
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'needs-you-panel': {
      snapshot: Shaped<Snapshot>
      theme: ThemeId
      reduceMotion: boolean
      selected: string
      isDetailOpen: boolean
      isKeyOpen: boolean
      isSkillsOpen: boolean
      frame: number
    }
  }
}
