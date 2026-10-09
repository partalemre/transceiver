import { loadDrafts, onDrafts, settleDraft } from './drafts'
import type { AgentHost } from './host'
import { wireIdentity } from './identity'
import { wireLive } from './live'
import { wireResponder } from './responder-wire'
import { wireRetention } from './retention'
import { refreshPane, setDraftSettler, setDraftSource } from './state'

// The agent side on the room loop: the responder, the gh login on the head, live wake, retention (compaction and
// rollover), and the pane's drafts.
// A second session start (a reload keeps none of this) unwires the first, so no listener runs twice.
let unwire: Array<() => void> = []

export function wireAgents(host: AgentHost): void {
  for (const off of unwire) off()
  unwire = [
    wireResponder(host), wireIdentity(host), wireLive(host), wireRetention(host),
    onDrafts(() => { void refreshPane().catch(() => undefined) }),
  ]
  setDraftSource(() => loadDrafts(host))
  setDraftSettler((qid, isApproved) => settleDraft(host, { qid, isApproved }))
}
