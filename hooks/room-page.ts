// The mailbox's web page, published as the artifact itself. A mailbox holds one person's half of a room, so the page
// shows no conversation: it says what the link is for and how to open the room in Claude Code. The page holds no
// data and runs no script; the mod reads and writes the mailbox's db. It is written in its creator's language.
import { pick } from './kit/lang'

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

const DARK = '--bg:#191917;--card:#1F1F1C;--line:#2E2E2A;--fg:#F0EEE8;--muted:#8E8A80;color-scheme:dark'

const STYLE = `
:root{--bg:#F4F2EC;--card:#FFFFFF;--line:#E4E0D6;--fg:#1C1B19;--muted:#77726A;--font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
body{background:var(--bg);color:var(--fg);font-family:var(--font);font-size:15px;line-height:1.5;margin:0}
.app{max-width:760px;margin:0 auto;padding-inline:16px}
header{padding-block:14px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
header h1{font-size:16px;margin:0;overflow-wrap:anywhere}header span{color:var(--muted);font-size:12px}
.steps{margin:0;padding:16px 0 16px 20px;display:flex;flex-direction:column;gap:10px}
code{font-family:var(--mono);font-size:13px;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:1px 6px;overflow-wrap:anywhere}`

const INSTALL = '<code>/plugin install transceiver --marketplace partalemre/transceiver</code>'

const PAGE = {
  en: {
    tagline: 'Inside Claude, invited people only',
    steps: [
      'This link is a Transceiver mailbox: one person\'s side of a room lives here. The chat itself runs inside Claude Code.',
      `If Transceiver is not installed: ${INSTALL}`,
      'Then copy this page\'s link and type: <code>/transceiver join &lt;link&gt;</code>',
    ],
  },
  tr: {
    tagline: 'Claude içinde, yalnızca davetliler',
    steps: [
      'Bu link bir Transceiver kutusu: bir kişinin bir odaya yazdıkları burada durur. Sohbet Claude Code\'un içinde akar.',
      `Transceiver kurulu değilse: ${INSTALL}`,
      'Sonra bu sayfanın linkini kopyalayıp yaz: <code>/transceiver katıl &lt;link&gt;</code>',
    ],
  },
}

export function roomPageHtml(opts: { title: string }): string {
  const title = escapeHtml(opts.title)
  const page = pick(PAGE)
  return `<title>${title}</title>\n<style>${STYLE}</style>\n<div class="app"><header><h1>${title}</h1><span>${page.tagline}</span></header>`
    + `<ol class="steps">${page.steps.map(step => `<li>${step}</li>`).join('')}</ol></div>\n`
}
