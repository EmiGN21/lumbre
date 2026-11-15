import { getDocument, GlobalWorkerOptions, PasswordResponses } from './vendor/pdf.mjs'

GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href

async function readOutline(pdf) {
  const entries = await pdf.getOutline()
  const sections = new Map()
  for (const entry of entries ?? []) {
    try {
      const dest = typeof entry.dest === 'string' ? await pdf.getDestination(entry.dest) : entry.dest
      if (!Array.isArray(dest) || !dest[0]) {
        if (dest?.[0] === 0) sections.set(1, entry.title)
        continue
      }
      const index = Number.isInteger(dest[0]) ? dest[0] : await pdf.getPageIndex(dest[0])
      if (index >= 0 && index < pdf.numPages && entry.title.trim() && !sections.has(index + 1)) {
        sections.set(index + 1, entry.title.trim())
      }
    } catch {
      // An outline can contain external links and invalid destinations.
    }
  }
  return sections.size > 1 ? sections : new Map()
}

export async function extractPdf(file, report) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const job = getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true })
  try {
    const pdf = await job.promise
    const starts = await readOutline(pdf).catch(() => new Map())
    const chapters = []
    let section
    let chars = 0
    for (let number = 1; number <= pdf.numPages; number++) {
      if (number === 1 || number % 5 === 0 || number === pdf.numPages) report(number, pdf.numPages)
      const page = await pdf.getPage(number)
      const { items } = await page.getTextContent()
      const text = items.filter(item => 'str' in item)
        .map(item => item.str + (item.hasEOL ? '\n' : ' '))
        .join('')
        .replace(/(\p{L})-\s*\n\s*(?=\p{Ll})/gu, '$1')
        .replace(/\s+/g, ' ').trim()
      page.cleanup()
      if (!starts.size || starts.has(number) || !section) {
        section = { title: starts.get(number) || (starts.size ? 'Inicio' : 'Página ' + number), pages: [] }
        chapters.push(section)
      }
      if (text) section.pages.push(text)
      chars += text.length
      if (chars > 6_000_000) throw new Error('El documento supera el límite de texto. Divídelo en varios PDF.')
    }
    if (!chars) throw new Error('No encontramos texto seleccionable. Si es un escaneo, aplica OCR al PDF antes de importarlo.')
    return chapters.filter(chapter => chapter.pages.length).map(({ title, pages }) => {
      const text = pages.join('\n\n')
      return { title, text, duration: Math.max(1, Math.ceil(text.split(/\s+/).length / 2.5)) }
    })
  } catch (error) {
    if (error.name === 'PasswordException' || error.code === PasswordResponses.NEED_PASSWORD) {
      throw new Error('El PDF está protegido. Guarda una copia sin contraseña para importarlo.')
    }
    if (error.name === 'InvalidPDFException') throw new Error('El archivo no es un PDF válido o está dañado.')
    throw error
  } finally {
    await job.destroy()
  }
}
