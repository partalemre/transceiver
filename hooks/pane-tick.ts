// After every room poll: keep the connection flag honest, time the poll, follow whether the pane is on screen
// (read marks depend on it), and redraw.
import { setConnected } from './connection'
import type { TickEvent } from './room-loop'
import { patchSession, portNow, refreshPane, setPaneShown } from './state'

export async function onPaneTick(ev: TickEvent): Promise<void> {
  const p = portNow()
  if (p === null) return
  // A write refused after connecting means the approval is gone (a new session behind the same module).
  if (ev.isDenied) setConnected(false)
  if (ev.tookMs !== undefined) patchSession({ latencyMs: ev.tookMs })
  const isShown = await p.ui.isPaneShown().catch(() => false)
  setPaneShown(isShown)
  await refreshPane()
}
