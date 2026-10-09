// The words the UI shows for each query type: a short Turkish label and a one-line description. Pure data; which
// argument a type takes lives in `QUERY_TYPES` (protocol.ts), and the compiler keeps the two lists in step.
import type { QueryType } from './protocol'

export type QueryLabel = { label: string; description: string }

export const QUERY_CATALOG: Readonly<Record<QueryType, QueryLabel>> = {
  status: { label: 'Durum', description: 'Dalı ve değişen dosya sayısını gösterir' },
  branch: { label: 'Dallar', description: 'Yerel dalları listeler' },
  log: { label: 'Son commit\'ler', description: 'Son 20 commit\'in başlığını gösterir' },
  diff: { label: 'Değişiklikler', description: 'Commit\'lenmemiş değişiklikleri gösterir' },
  tests: { label: 'Testler', description: 'Son test sonucunu gösterir' },
  plan: { label: 'Plan', description: 'Görev listesini ve ilerlemesini gösterir' },
  file: { label: 'Dosya', description: 'Bir dosyanın içeriğini gösterir' },
  grep: { label: 'Metin ara', description: 'Repoda bir metni arar' },
  files: { label: 'Dosyalar', description: 'Bir klasördeki dosyaları listeler' },
  todo: { label: 'Notlar', description: 'TODO, FIXME, HACK ve XXX notlarını toplar' },
  deps: { label: 'Bağımlılıklar', description: 'Paket dosyalarındaki bağımlılıkları özetler' },
  commit: { label: 'Commit', description: 'Bir commit\'in mesajını ve değişen dosyalarını gösterir' },
  ask: { label: 'Serbest soru', description: 'Karşı tarafta küçük bir model cevaplar (günde 10)' },
}
