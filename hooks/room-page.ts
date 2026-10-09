// The room's web page, published as the artifact itself: a live chat for the browser and the phone. It holds no
// data of its own; everything comes from the room's db through `onSnapshot`, and it writes only to the viewer's
// own `outbox/{uid}`. The page cannot batch, so it writes the message first and then moves the head forward
// with `update` (a merge), which never drops the read cursors or `gh` the mod keeps on the same head.

import { KEEP_ENTRIES, PAGE_MAX_CHARS } from './limits'

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

const DARK = '--bg:#191917;--card:#1F1F1C;--line:#2E2E2A;--fg:#F0EEE8;--muted:#8E8A80;--signal:#5CC8B8;--mine:#1A2E2B;--mine-line:#2E5650;--agent:#B19CF3;--read:#7FB6E8;color-scheme:dark'

const STYLE = `
:root{--bg:#F4F2EC;--card:#FFFFFF;--line:#E4E0D6;--fg:#1C1B19;--muted:#77726A;--signal:#0E6F66;--mine:#E3F3F0;--mine-line:#A9D8CF;--agent:#6243C4;--read:#2464A0;--font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
html,body{height:100%}body{background:var(--bg);color:var(--fg);font-family:var(--font);font-size:15px;margin:0}
.app{height:100%;display:flex;flex-direction:column;max-width:760px;margin:0 auto;padding-inline:16px;box-sizing:border-box}
header{padding-block:14px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
header h1{font-size:16px;margin:0;overflow-wrap:anywhere}header span{color:var(--muted);font-size:12px}
ol{list-style:none;margin:0;padding:16px 0;flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px}
li{max-width:80%;padding:8px 12px;border-radius:4px 14px 14px 14px;background:var(--card);border:1px solid var(--line);overflow-wrap:anywhere;white-space:pre-wrap}
li.mine{align-self:flex-end;background:var(--mine);border-color:var(--mine-line);border-radius:14px 4px 14px 14px}
li.agent{max-width:100%;align-self:stretch;background:none;border:none;border-top:1px dashed var(--line);border-radius:0;font-family:var(--mono);font-size:12px;color:var(--agent)}
li small{display:block;text-align:right;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
form{display:flex;gap:8px;padding-block:12px 20px;border-top:1px solid var(--line)}
input{flex:1;min-width:0;height:44px;border-radius:22px;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:0 16px;font:inherit}
button{height:44px;padding:0 18px;border-radius:22px;border:none;background:var(--signal);color:var(--bg);font:inherit;font-weight:600}
button:focus-visible,input:focus-visible{outline:2px solid var(--signal);outline-offset:2px}
.empty{color:var(--muted);text-align:center;margin:auto}`

const SCRIPT = `
(async () => {
  const list = document.getElementById("log"), state = document.getElementById("state"), form = document.getElementById("send")
  const db = await claude.use("db"), user = await claude.use("user")
  const me = user ? await user.id() : null
  if (!db || !me) { state.textContent = "Bu görünümden odaya bağlanılamıyor."; form.hidden = true; return }
  const rows = new Map()
  const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  const newId = now => { let t = now, s = ""; for (let i = 0; i < 10; i++) { s = ALPHA[t % 32] + s; t = Math.floor(t / 32) } for (let i = 0; i < 16; i++) s += ALPHA[Math.floor(Math.random() * 32)]; return s }
  const render = async () => {
    const all = [...rows.values()].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1))
    const names = user ? await user.profiles([...new Set(all.map(r => r.author))]) : {}
    list.replaceChildren(...all.map(r => {
      const li = document.createElement("li")
      li.className = r.author === me ? "mine" : r.kind === "human" ? "" : "agent"
      const who = r.author === me || r.kind !== "human" ? "" : ((names[r.author] && names[r.author].name) || "Biri") + ": "
      li.textContent = who + r.text
      const small = document.createElement("small"); small.textContent = new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); li.append(small)
      return li
    }))
    state.textContent = all.length ? "" : "Henüz mesaj yok. İlk mesajı aşağıdan yaz."
    list.scrollTop = list.scrollHeight
  }
  const watched = new Set()
  db.collection("outbox").onSnapshot(snap => {
    for (const d of snap.docs) {
      if (watched.has(d.id)) continue
      watched.add(d.id)
      db.collection("outbox/" + d.id + "/msgs").orderBy("ts", "desc").limit(${KEEP_ENTRIES}).onSnapshot(ms => {
        for (const m of ms.docs) { const x = m.data(); if (x && typeof x.text === "string" && typeof x.ts === "number") rows.set(m.id, { ...x, id: m.id, author: d.id }) }
        render()
      })
    }
  }, () => { state.textContent = "Bağlantı koptu; sayfa yeniden bağlanmayı deneyecek." })
  form.addEventListener("submit", async ev => {
    ev.preventDefault()
    const input = document.getElementById("text"), text = input.value.trim()
    if (!text) return
    input.value = ""
    try {
      const headRef = db.doc("outbox/" + me), head = await headRef.get()
      const prevTs = head.exists && typeof head.data().headTs === "number" ? head.data().headTs : 0
      const ts = Math.max(Date.now(), prevTs + 1), id = newId(ts)
      await db.collection("outbox/" + me + "/msgs").doc(id).set({ v: 1, id, ts, kind: "human", text })
      if (head.exists) await headRef.update({ head: id, headTs: ts })
      else await headRef.set({ v: 1, head: id, headTs: ts, seenUpTo: "", readUpTo: "", readTs: 0 })
    } catch (e) { state.textContent = "Gönderilemedi: " + (e && e.message ? e.message : "bilinmeyen hata"); input.value = text }
  })
})()`

export function roomPageHtml(opts: { title: string }): string {
  const title = escapeHtml(opts.title)
  return `<title>${title}</title>\n<style>${STYLE}</style>\n<div class="app"><header><h1>${title}</h1><span>Claude içinde, yalnızca davetliler</span></header>`
    + `<p id="state" class="empty">Mesajlar yükleniyor.</p><ol id="log" aria-live="polite"></ol>`
    + `<form id="send"><label for="text" hidden>Mesaj</label><input id="text" autocomplete="off" placeholder="Mesaj" maxlength="${PAGE_MAX_CHARS}"><button type="submit">Gönder</button></form></div>`
    + `<script>${SCRIPT}</script>\n`
}
