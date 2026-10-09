// Who wrote an entry. In this person's own mailbox the key is their uid (`selfUid`); in another member's mailbox the
// uid is joined to that mailbox, so a uid one member writes into their own mailbox never stands for anyone in
// another: a line is always from the mailbox it came from, whatever uid it names.
const SEP = '@'

const boxIdOf = (url: string): string => url.replace(/\/+$/, '').split('/').at(-1) ?? url

export const authorKey = (opts: { uid: string; url: string; isOwn: boolean }): string =>
  (opts.isOwn ? opts.uid : `${opts.uid}${SEP}${boxIdOf(opts.url)}`)

// The uid the author's mailbox knows them by, for its profile lookup.
export const uidOf = (author: string): string => author.split(SEP)[0] ?? author
