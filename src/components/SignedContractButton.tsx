import { useEffect, useState } from 'react'
import { Copy, FileText, Download } from 'lucide-react'
import type { Account } from '../types'
import { useBook } from '../lib/useData'
import { useCrm } from '../store'
import { signedContractPdf, signedContractText, type SignedContractInput } from '../lib/contractPdf'
import { isFramed, saveText } from '../lib/format'
import { Button, Modal } from './ui'

/** The account's signed agreement: the preferred contract (a won deal's own) when it's active, else the account's active contract. */
export function useSignedContract(a: Account, preferId?: string) {
  const book = useBook()
  const pref = preferId ? book.contractById[preferId] : undefined
  const c = pref?.status === 'Active' && pref.accountId === a.id ? pref : a.contractId ? book.contractById[a.contractId] : undefined
  if (!c || c.status !== 'Active') return null
  // The deal that signed this agreement. Seeded agreements have none and were signed when they took effect.
  const won = book.opportunities.find((o) => o.accountId === a.id && o.stage === 'Closed Won' && (o.id === c.opportunityId || o.contractId === c.id))
  return { contract: c, signedAt: won?.stageChangedAt ?? won?.closeDate ?? c.start }
}

/** Opens the signed contract as a PDF, in a viewer with a download button (as text with a copy button inside a sandboxed frame). */
export function SignedContractButton({ account: a, contractId, compact }: { account: Account; contractId?: string; compact?: boolean }) {
  const signed = useSignedContract(a, contractId)
  const decisions = useCrm((s) => (signed ? s.decisions[signed.contract.id] : undefined))
  const copy = useCrm((s) => (signed ? s.signedCopies[signed.contract.id] : undefined))
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [copied, setCopied] = useState<'downloaded' | 'copied' | 'failed' | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])
  if (!signed) return null
  const input = (): SignedContractInput => {
    const agreedChanges = signed.contract.redlines
      .map((r) => {
        const d = decisions?.[r.id]
        if (d?.decision === 'Accept') return { clauseId: r.clauseId, text: r.proposed }
        if (d?.decision === 'Counter' && d.language) return { clauseId: r.clauseId, text: d.language }
        return null
      })
      .filter((x) => !!x)
    return { account: a, contract: signed.contract, rep: a.rep, signedAt: signed.signedAt, agreedChanges }
  }
  const open = async () => {
    // A sandboxed frame blocks the PDF viewer and downloads, so the agreement opens as text there.
    if (isFramed()) {
      setText(signedContractText(input()))
      return
    }
    setBusy(true)
    try {
      setUrl(URL.createObjectURL(await signedContractPdf(input())))
    } finally {
      setBusy(false)
    }
  }
  const close = () => {
    setUrl(null)
    setText(null)
    setCopied(null)
  }
  const name = `${a.name} - signed agreement ${signed.contract.id}.pdf`
  return (
    <>
      {compact ? (
        <button type="button" onClick={open} disabled={busy} className="inline-flex items-center gap-1 text-[12px] text-ink underline-offset-4 hover:underline disabled:opacity-50" title="View the signed contract as a PDF">
          <FileText size={12} aria-hidden /> {busy ? 'Opening…' : 'Signed contract (PDF)'}
        </button>
      ) : (
        <Button size="sm" onClick={open} disabled={busy}>
          <FileText size={12} /> {busy ? 'Opening…' : 'View signed contract (PDF)'}
        </Button>
      )}
      {(url || text !== null) && (
        <Modal open onClose={close} title={`Signed contract ${signed.contract.id}`} wide>
          <p className="mb-3 text-[13px] text-ink-2">
            {copy
              ? `Signed copy ${copy.file} received by email from ${copy.from} on ${new Date(copy.receivedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}, confirmed by ${copy.confirmedBy}. This ${url ? 'PDF' : 'copy'} is Herdbook's record of the executed terms; the customer's scan stays in the email.`
              : "Herdbook's record of the executed agreement, built from the contract's final terms. No signed scan was received by tracked email for this contract."}
            {!url && ' The PDF viewer is blocked in this embedded view, so the agreement is shown as text.'}
          </p>
          {url ? (
            <iframe src={url} title={name} className="h-[70vh] w-full rounded-[12px] border border-line bg-surface" />
          ) : (
            <pre className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap rounded-[12px] border border-line bg-surface p-4 font-sans text-[13px] leading-relaxed text-ink">{text}</pre>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {copied && (
              <span role="status" className="mr-auto text-[13px] text-ink-2">
                {copied === 'failed' ? "Couldn't copy. Allow clipboard access in your browser and try again." : copied === 'copied' ? 'Copied to clipboard' : 'Downloaded'}
              </span>
            )}
            {url ? (
              <a href={url} download={name} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent-soft px-4 text-[14px] text-ink transition-colors hover:bg-accent-soft-2">
                <Download size={14} aria-hidden /> Download PDF
              </a>
            ) : (
              <Button onClick={async () => setCopied(await saveText(name.replace(/\.pdf$/, '.txt'), text ?? ''))}>
                <Copy size={14} /> Copy contract text
              </Button>
            )}
            <Button variant="primary" onClick={close}>Close</Button>
          </div>
        </Modal>
      )}
    </>
  )
}
