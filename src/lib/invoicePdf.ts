import type { Invoice } from '../types'

// A price-change invoice as a PDF, for the email that carries it. jsPDF loads on demand.

const usd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export async function invoicePdf(inv: Invoice): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const M = 56
  let y = M
  const line = (t: string, x: number, size = 10, style: 'normal' | 'bold' = 'normal', color = 20, align: 'left' | 'right' = 'left') => {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    doc.setTextColor(color)
    doc.text(t, x, y, { align })
  }

  doc.setFillColor(199, 255, 159)
  doc.rect(0, 0, W, 8, 'F')
  y += 10
  line('INVOICE', M, 18, 'bold')
  line(inv.id, W - M, 11, 'bold', 20, 'right')
  y += 16
  line('ThiboLiSoft · farm software, sensors and advisory', M, 9, 'normal', 90)
  line(`Issued ${date(inv.issueDate)}`, W - M, 9, 'normal', 90, 'right')
  y += 13
  line(`Due ${date(inv.dueDate)} (${inv.paymentTerms})`, W - M, 9, 'normal', 90, 'right')

  y += 28
  line('Bill to', M, 9, 'bold', 90)
  line('Service period', W / 2 + 20, 9, 'bold', 90)
  y += 14
  line(inv.billTo.name, M, 11, 'bold')
  line(`${date(inv.periodStart)} to ${date(inv.periodEnd)}`, W / 2 + 20, 10)
  y += 14
  line(`${inv.billTo.contact} · ${inv.billTo.email}`, M, 10, 'normal', 60)
  y += 13
  line(inv.billTo.location, M, 10, 'normal', 60)

  y += 30
  const cols = { item: M, qty: W - M - 250, unit: W - M - 110, amount: W - M }
  doc.setDrawColor(200)
  doc.line(M, y - 12, W - M, y - 12)
  line('Item', cols.item, 9, 'bold', 90)
  line('Qty', cols.qty, 9, 'bold', 90, 'right')
  line('Unit price / mo', cols.unit, 9, 'bold', 90, 'right')
  line('Amount', cols.amount, 9, 'bold', 90, 'right')
  y += 8
  doc.line(M, y, W - M, y)
  for (const l of inv.lines) {
    y += 18
    line(l.description, cols.item, 10)
    line(l.units.toLocaleString('en-US'), cols.qty, 10, 'normal', 20, 'right')
    line(usd(l.unitPrice), cols.unit, 10, 'normal', 20, 'right')
    line(usd(l.amount), cols.amount, 10, 'normal', 20, 'right')
    if (l.unitPrice !== l.previousUnitPrice) {
      y += 12
      line(`per ${l.unitLabel.replace(' / mo', '')}, was ${usd(l.previousUnitPrice)}`, cols.item, 8, 'normal', 110)
    }
  }
  y += 14
  doc.line(M, y, W - M, y)
  y += 20
  line(`Total due each month (was ${usd(inv.previousTotal)})`, cols.unit, 10, 'normal', 60, 'right')
  line(usd(inv.total), cols.amount, 12, 'bold', 20, 'right')

  y += 36
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(90)
  for (const t of doc.splitTextToSize(inv.memo, W - M * 2) as string[]) {
    doc.text(t, M, y)
    y += 12
  }
  y += 10
  doc.text('Demo invoice from Herdbook CRM. Synthetic data; not a request for payment.', M, y)
  return doc.output('blob')
}
