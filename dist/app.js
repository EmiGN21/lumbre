const $ = (selector, parent = document) => parent.querySelector(selector)
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)]

const drawings = {
  flame: '<path d="M12 2c1 5-5 7-5 12-1-1-2-2-2-4-4 6 0 12 7 12 6 0 9-5 7-10-1 2-2 3-3 3 0-5-1-9-4-13Z" fill="currentColor" stroke="none"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6z"/>',
  library: '<path d="M4 4h4v16H4zM9 4h4v16H9zM15 6l3-1 4 14-3 1z"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  pause: '<path d="M9 5v14M15 5v14" stroke-width="2.5"/>',
  previous: '<path d="M6 5v14m12-13L8 12l10 6z"/>',
  next: '<path d="M18 5v14M6 6l10 6-10 6z"/>',
  rewind: '<path d="M5 7V3m0 4h4m-4 0a8.5 8.5 0 1 1-1.3 7"/><path d="M9 11h1v6m3-6h3m-3 0v3h3v3h-3" stroke-width="1.1"/>',
  forward: '<path d="M19 7V3m0 4h-4m4 0a8.5 8.5 0 1 0 1.3 7"/><path d="M9 11h1v6m3-6h3m-3 0v3h3v3h-3" stroke-width="1.1"/>',
  moon: '<path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.1M4 12h.1M4 18h.1"/>',
  close: '<path d="m6 6 12 12m0-12L6 18"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M5 16v4h14v-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  bookmark: '<path d="M7 4h10v16l-5-4-5 4z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v6m4-6v6"/>',
  text: '<path d="M4 5h16M4 10h16M4 15h16M4 20h10"/>',
}

function icon(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + drawings[name] + '</svg>'
}

function renderIcons(root) {
  for (const node of $$('[data-icon]', root)) node.innerHTML = icon(node.dataset.icon)
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem('lumbre.' + key)) ?? fallback } catch { return fallback }
}

let storageWarned = false
function save(key, value) {
  try { localStorage.setItem('lumbre.' + key, JSON.stringify(value)) } catch {
    if (!storageWarned) {
      storageWarned = true
      notify('El navegador bloqueó el almacenamiento. Los cambios se perderán al cerrar la página.')
    }
  }
}

let db
function libraryDb() {
  if (!db) db = new Promise((resolve, reject) => {
    const request = indexedDB.open('lumbre-biblioteca', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('pdfs', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch(error => {
    db = undefined
    throw error
  })
  return db
}

async function pdfStorage(mode, operation) {
  const database = await libraryDb()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('pdfs', mode)
    const request = operation(transaction.objectStore('pdfs'))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onabort = () => reject(transaction.error)
  })
}

const audio = $('#audio')
const dock = $('#dock')
const seek = $('#seek')
const search = $('#search')
const bookDialog = $('#book-dialog')
const importDialog = $('#import-dialog')
const progress = load('progress', {})
const saved = new Set(load('saved', []))
let catalog = []
let pdfs = []
let filter = 'Todos'
let catalogError = false
let loading = true
let current = null
let detailId = ''
let speed = Number(load('speed', 1)) || 1
let lastSave = 0
let sleepTimer
let toastTimer
let utterance
let speechPlaying = false
let selectedFile
let readerPart
let readerLines = []
let activeLine = -1
$('#speed').value = String(speed).replace(/^0\./, '.')
renderIcons(document)

function notify(message) {
  const notice = $('#notice')
  notice.textContent = message
  notice.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { notice.hidden = true }, 3700)
}

function playerError(message = '') {
  const feedback = $('#player-error')
  if (feedback.textContent === message) return
  feedback.textContent = message
  feedback.hidden = !message
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds || 0))
  const hours = Math.floor(whole / 3600)
  const minute = Math.floor(whole % 3600 / 60)
  const sec = String(whole % 60).padStart(2, '0')
  return hours ? hours + ':' + String(minute).padStart(2, '0') + ':' + sec : minute + ':' + sec
}

function readingLength(seconds) {
  const mins = Math.max(1, Math.round(seconds / 60))
  return [Math.floor(mins / 60) ? Math.floor(mins / 60) + ' h' : '', mins % 60 ? mins % 60 + ' min' : ''].filter(Boolean).join(' ')
}

function findBook(id) { return [...catalog, ...pdfs].find(book => book.id === id) }
function theme(book) { return book.type === 'pdf' ? 'pdf' : book.id }
function playableProgress(book) { return progress[book.id] && !progress[book.id].finished }
function playLabel(book) { return playableProgress(book) ? 'Continuar' : 'Escuchar' }

function art(book) {
  const symbol = book.type === 'pdf' ? icon('file') : ''
  return '<span class="art ' + theme(book) + '" aria-hidden="true">' + symbol + '<span class="art-title">' + escape(book.title) + '</span></span>'
}

function overall(book) {
  const state = progress[book.id]
  if (!state) return 0
  if (state.finished) return 100
  const chapter = book.chapters[state.chapter]
  if (!chapter) return 0
  const heard = book.chapters.slice(0, state.chapter).reduce((sum, part) => sum + part.duration, 0)
  const ratio = book.type === 'pdf' ? state.position / chapter.text.length : state.position / chapter.duration
  return Math.min(100, (heard + chapter.duration * Math.min(1, ratio)) / book.duration * 100)
}

function bookCard(book) {
  const percent = overall(book)
  const meta = book.type === 'pdf' ? 'PDF · ' + book.chapters.length + ' secciones' : book.author + ' · ' + readingLength(book.duration)
  return '<article class="book"><button class="book-link" data-action="details" data-book="' + book.id + '">' + art(book) +
    '<span class="book-name">' + escape(book.title) + '</span><span class="book-meta">' + escape(meta) + '</span></button>' +
    '<button class="card-play" data-action="play-book" data-book="' + book.id + '" aria-label="' + escape(playLabel(book) + ' ' + book.title) + '">' + icon('play') + '</button>' +
    (percent > 0 ? '<div class="card-progress" role="progressbar" aria-label="Progreso de escucha" aria-valuenow="' + Math.round(percent) + '"><span style="width:' + percent + '%"></span></div>' : '') + '</article>'
}

function normalize(text) {
  return text.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '')
}

function renderShelf() {
  const library = location.hash === '#biblioteca'
  const reading = location.hash === '#lectura'
  const query = normalize(search.value.trim())
  for (const link of $$('[data-view]')) {
    if (link.dataset.view === (reading ? 'lectura' : library ? 'biblioteca' : 'explorar')) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  $('#reading').hidden = !reading
  $('#shelf').hidden = reading
  $('#credits').hidden = reading
  $('.search').hidden = reading
  $('.topbar').classList.toggle('reader-topbar', reading)
  $('[data-action="read-current"]', dock).setAttribute('aria-pressed', String(reading))
  $('#home').hidden = reading || library || !!query
  if (reading) {
    renderReader()
    return
  }
  const title = library ? 'Mi biblioteca' : query ? 'Resultados de búsqueda' : 'Catálogo'
  $('#shelf-title').textContent = title
  let entries = library ? [...pdfs.slice().reverse(), ...catalog.filter(book => saved.has(book.id) || progress[book.id])] : catalog
  if (!library && query) entries = [...catalog, ...pdfs]
  entries = entries.filter(book => (!query && !library && filter !== 'Todos' ? book.genre === filter : true) &&
    (!query || normalize(book.title + ' ' + book.author + ' ' + book.genre).includes(query)))

  const filters = $('#filters')
  const options = ['Todos', ...new Set(catalog.map(book => book.genre))]
  const optionsKey = (library || query || !catalog.length) ? '' : options.join('|')
  if (filters.dataset.options !== optionsKey) {
    filters.dataset.options = optionsKey
    filters.innerHTML = optionsKey ? options.map(value => '<button class="filter" data-action="filter" data-filter="' + value + '">' + value + '</button>').join('') : ''
  }
  for (const button of $$('[data-filter]', filters)) button.setAttribute('aria-pressed', String(button.dataset.filter === filter))

  const list = $('#books')
  $('#shelf-count').textContent = entries.length ? entries.length + (entries.length === 1 ? ' título' : ' títulos') : ''
  if (entries.length) list.innerHTML = entries.map(bookCard).join('')
  else if (loading) list.innerHTML = '<p class="muted">Cargando audiolibros…</p>'
  else if (query) list.innerHTML = '<div class="empty"><h3>Sin resultados</h3><p>Prueba con otro título, autor o género.</p><button class="button outline" data-action="clear-search">Borrar búsqueda</button></div>'
  else if (library) list.innerHTML = '<div class="empty"><h3>Tu biblioteca está vacía</h3><p>Importa un PDF o empieza a escuchar un libro del catálogo.</p><button class="button primary" data-action="import">' + icon('plus') + ' Importar PDF</button></div>'
  else if (catalogError) list.innerHTML = '<div class="empty"><h3>El catálogo no cargó</h3><p>Vuelve a intentarlo en unos segundos.</p><button class="button outline" data-action="retry">Reintentar</button></div>'
  const featured = findBook('quijote')
  $('[data-book="quijote"][data-action="play-book"]', $('#home')).disabled = !featured
  $('#hero-action').textContent = featured && playableProgress(featured) ? 'Continuar escucha' : 'Escuchar ahora'
}

function showDetails(book) {
  if (!book) return
  detailId = book.id
  const state = progress[book.id]
  const bookmarked = saved.has(book.id)
  const pdf = book.type === 'pdf'
  const resume = playableProgress(book) ? 'Continuar' : 'Escuchar'
  const meta = pdf ? 'PDF · Lectura en voz alta' : [book.author, book.tag, readingLength(book.duration)].filter(Boolean).join(' · ')
  const description = pdf ? 'Sigue el texto en la pestaña Lectura o escúchalo en español.' : book.description
  const secondary = pdf
    ? '<button class="button outline" data-action="delete-pdf">' + icon('trash') + ' Eliminar PDF</button>'
    : '<button class="button outline" data-action="bookmark" aria-pressed="' + bookmarked + '">' + icon(bookmarked ? 'check' : 'bookmark') + (bookmarked ? ' Guardado' : ' Guardar') + '</button>'
  const source = pdf ? '' : '<a class="source" href="' + book.source + '" target="_blank" rel="noopener">Edición y narradores en LibriVox</a>'
  const read = pdf ? '<button class="button outline" data-action="read-book" data-book="' + book.id + '">' + icon('text') + ' Leer</button>' : ''
  const chapters = book.chapters.map((part, i) => {
    const selected = current?.book.id === book.id ? current.chapter === i : state?.chapter === i && !state?.finished
    const extra = !pdf && part.reader ? '<br><small>' + escape(part.reader) + '</small>' : ''
    const duration = formatTime(part.duration)
    return '<li><button class="chapter" type="button" data-action="chapter" data-chapter="' + i + '"' + (selected ? ' aria-current="true"' : '') +
      '><small>' + String(i + 1).padStart(2, '0') + '</small><span>' + escape(part.title) + extra + '</span><small>' + (pdf ? '≈ ' : '') + duration + '</small></button></li>'
  }).join('')
  $('#detail-body').innerHTML = '<div class="detail-head">' + art(book) + '<div><h2 id="detail-title">' + escape(book.title) + '</h2><p class="muted">' + escape(meta) +
    '</p><p>' + escape(description) + '</p><div class="detail-actions"><button class="button primary" data-action="play-book" data-book="' + book.id + '">' + icon('play') + ' ' + resume +
    '</button>' + read + secondary + '</div>' + source + '</div></div><h3 class="chapter-heading">' + (pdf ? 'Secciones' : 'Capítulos') + '</h3><ol class="chapters">' + chapters + '</ol>'
  if (!bookDialog.open) {
    bookDialog.showModal()
    bookDialog.scrollTop = 0
  }
}

function activePart() { return current?.book.chapters[current.chapter] }
function speaking() { return current?.book.type === 'pdf' }
function isPlaying() { return current && (speaking() ? speechPlaying : !audio.paused) }
function partDuration() { return current && !speaking() && current.ready && Number.isFinite(audio.duration) ? audio.duration : activePart()?.duration ?? 0 }
function shownPosition() {
  const part = activePart()
  if (!part) return 0
  return speaking() ? current.position / part.text.length * part.duration : current.position
}

function renderReader() {
  const part = activePart()
  const container = $('#reader-text')
  const empty = $('#reader-empty')
  const hasText = !!part?.text
  $('#reading-title').textContent = hasText ? current.book.title : 'Lectura'
  $('#reading-meta').textContent = hasText ? part.title : ''
  $('#reading-actions').hidden = !hasText
  empty.hidden = hasText
  if (!hasText) {
    readerPart = undefined
    readerLines = []
    container.replaceChildren()
    const hint = current ? 'Este capítulo de LibriVox no tiene texto sincronizado. Puedes usar Lectura con tus PDF importados.' :
      'Abre un PDF de tu biblioteca para seguir el texto mientras lo escuchas.'
    empty.innerHTML = '<h3>' + (current ? 'Texto sincronizado para tus PDF' : 'Elige un PDF para empezar') +
      '</h3><p>' + hint + '</p><a class="button primary" href="#biblioteca">Ir a mi biblioteca</a> ' +
      '<button class="button outline" data-action="import">Importar PDF</button>'
    return
  }
  if (readerPart === part) {
    updateReader()
    return
  }
  readerPart = part
  readerLines = []
  activeLine = -1
  const lines = document.createDocumentFragment()
  const text = part.text
  for (let start = 0; start < text.length;) {
    const fragment = speechChunk(text, start)
    if (fragment.trim()) {
      const line = document.createElement('button')
      line.type = 'button'
      line.className = 'reader-line'
      line.dataset.action = 'read-from'
      line.dataset.offset = start
      line.textContent = fragment.trim()
      lines.append(line)
      readerLines.push({ start, element: line })
    }
    start += fragment.length
  }
  container.replaceChildren(lines)
  container.scrollTop = 0
  updateReader()
}

function lineIndex(position) {
  let left = 0
  let right = readerLines.length
  while (left < right) {
    const middle = (left + right) >>> 1
    if (readerLines[middle].start <= position) left = middle + 1
    else right = middle
  }
  return left - 1
}

function updateReader() {
  if ($('#reading').hidden || !speaking() || readerPart !== activePart()) return
  const index = lineIndex(current.position)
  if (index < 0 || index === activeLine) return
  readerLines[activeLine]?.element.removeAttribute('aria-current')
  activeLine = index
  const line = readerLines[index].element
  line.setAttribute('aria-current', 'true')
  const container = $('#reader-text')
  const desired = line.offsetTop - Math.max(8, (container.clientHeight - line.offsetHeight) * .43)
  container.scrollTo({ top: desired, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}

function openReader(book) {
  if (book?.type === 'pdf' && current?.book.id !== book.id) {
    const savedPosition = progress[book.id]
    const chapter = savedPosition?.finished ? 0 : savedPosition?.chapter ?? 0
    openPart(book, chapter, savedPosition?.finished ? 0 : savedPosition?.position ?? 0, false)
  }
  if (bookDialog.open) bookDialog.close()
  search.value = ''
  location.hash = 'lectura'
  renderShelf()
  $('#reading-title').focus({ preventScroll: true })
}

function updateTimeline() {
  const duration = partDuration()
  const position = shownPosition()
  seek.max = duration || 1
  seek.value = position
  seek.setAttribute('aria-valuetext', (speaking() ? 'Tiempo aproximado ' : '') + formatTime(position) + ' de ' + formatTime(duration))
  $('#elapsed').textContent = formatTime(position)
  $('#total').textContent = (speaking() ? '≈ ' : '') + formatTime(duration)
  updateReader()
}

function updatePlayer() {
  if (!current) return
  const part = activePart()
  const toggle = $('[data-action="toggle"]', dock)
  const action = isPlaying() ? 'pause' : 'play'
  if (toggle.dataset.icon !== action) {
    toggle.dataset.icon = action
    toggle.innerHTML = icon(action)
  }
  toggle.setAttribute('aria-label', isPlaying() ? 'Pausar' : 'Reproducir')
  $('[data-action="previous"]', dock).disabled = current.chapter < 1
  $('[data-action="next"]', dock).disabled = current.chapter >= current.book.chapters.length - 1
  $('#now-title').textContent = current.book.title
  $('#now-chapter').textContent = part.title
  $('#dock-art').className = 'mini-art ' + theme(current.book)
  dock.hidden = false
  updateTimeline()
}

function persist(force = false) {
  if (!current || !current.started || (!force && Date.now() - lastSave < 900)) return
  progress[current.book.id] = { chapter: current.chapter, position: current.position, finished: current.finished }
  save('progress', progress)
  save('recent', current.book.id)
  lastSave = Date.now()
}

function stopSpeech() {
  utterance = undefined
  speechPlaying = false
  window.speechSynthesis?.cancel()
}

function halt() {
  if (!current) return
  if (speaking()) {
    stopSpeech()
    playerError()
  }
  else audio.pause()
  persist(true)
  updatePlayer()
}

function openPart(book, index, position = 0, play = true) {
  halt()
  const part = book.chapters[index]
  if (!part) return
  current = { book, chapter: index, position: Math.min(speakingLimit(book, part), Math.max(0, position)), ready: false, started: play || !!progress[book.id], finished: false }
  playerError()
  if (book.type === 'audio') {
    audio.src = part.url
    audio.playbackRate = speed
  }
  if (play) start()
  persist(true)
  updatePlayer()
  renderShelf()
}

function speakingLimit(book, part) {
  return book.type === 'pdf' ? Math.max(0, part.text.length - 1) : part.duration
}

function playBook(book, chapter) {
  if (!book) return
  const previous = progress[book.id]
  if (bookDialog.open) bookDialog.close()
  if (chapter === undefined && current?.book.id === book.id && !current.finished) {
    if (!isPlaying()) start()
    return
  }
  if (chapter !== undefined) openPart(book, chapter, chapter === previous?.chapter && !previous.finished ? previous.position : 0)
  else if (previous && !previous.finished) openPart(book, previous.chapter, previous.position)
  else openPart(book, 0)
}

function start() {
  if (!current) return
  if (current.finished) {
    openPart(current.book, 0)
    return
  }
  current.started = true
  playerError()
  if (speaking()) startNarration()
  else {
    const request = current
    if (audio.error) audio.load()
    audio.play().catch(error => {
      if (current === request && error.name !== 'AbortError') playerError('No se pudo reproducir el audio. Comprueba tu conexión e inténtalo de nuevo.')
    })
  }
  persist(true)
  updatePlayer()
}

function spanishVoice() {
  return window.speechSynthesis?.getVoices().filter(voice => voice.localService && /^es(?:-|_|$)/i.test(voice.lang))
    .sort((a, b) => Number(/^es[-_]MX$/i.test(b.lang)) - Number(/^es[-_]MX$/i.test(a.lang)))[0]
}

function speechChunk(text, start) {
  const windowText = text.slice(start, start + 220)
  const sentence = /[.!?…]+["”»]?(?:\s+|$)|\n{2,}/.exec(windowText)
  if (sentence?.index >= 8) return windowText.slice(0, sentence.index + sentence[0].length)
  if (start + windowText.length >= text.length) return windowText
  const space = windowText.search(/\s+\S*$/)
  return windowText.slice(0, space > 0 ? space + 1 : windowText.length)
}

function startNarration() {
  stopSpeech()
  startSpeech()
}

function startSpeech() {
  const voice = spanishVoice()
  if (!voice || !window.SpeechSynthesisUtterance) {
    playerError('Activa una voz de español en los ajustes del dispositivo y vuelve a pulsar Reproducir.')
    return
  }
  speechPlaying = true
  const text = activePart().text
  const offset = Math.floor(current.position)
  const phrase = speechChunk(text, offset)
  if (!phrase.trim()) {
    finishPart()
    return
  }
  const nextUtterance = new SpeechSynthesisUtterance(phrase)
  utterance = nextUtterance
  nextUtterance.voice = voice
  nextUtterance.lang = voice.lang
  nextUtterance.rate = speed
  nextUtterance.onboundary = event => {
    if (utterance !== nextUtterance) return
    current.position = offset + event.charIndex
    updateTimeline()
    persist()
  }
  nextUtterance.onend = () => {
    if (utterance !== nextUtterance) return
    current.position = offset + phrase.length
    persist(true)
    if (current.position >= text.length) finishPart()
    else startSpeech()
  }
  nextUtterance.onerror = () => {
    if (utterance !== nextUtterance) return
    stopSpeech()
    updatePlayer()
    playerError('La lectura en voz alta se interrumpió. Pulsa Reproducir para reanudar.')
  }
  window.speechSynthesis.speak(nextUtterance)
}

function positionAt(seconds) {
  if (!current) return
  const duration = partDuration()
  const position = Math.min(Math.max(0, duration - 0.15), Math.max(0, seconds))
  if (speaking()) {
    const wasPlaying = speechPlaying
    const text = activePart().text
    const index = Math.floor(position / duration * text.length)
    current.position = index > 0 ? text.lastIndexOf(' ', index - 1) + 1 : 0
    if (wasPlaying) startNarration()
  } else {
    current.position = position
    if (current.ready) audio.currentTime = position
  }
  current.started = true
  current.finished = false
  updateTimeline()
  persist(true)
}

function readFrom(offset) {
  if (!speaking() || !Number.isInteger(offset) || offset < 0 || offset >= activePart().text.length) return
  current.position = offset
  current.finished = false
  start()
}

function relativeChapter(direction) {
  if (!current) return
  const index = current.chapter + direction
  if (current.book.chapters[index]) openPart(current.book, index)
}

function finishPart() {
  if (!current) return
  if (current.book.chapters[current.chapter + 1]) {
    relativeChapter(1)
    return
  }
  if (speaking()) stopSpeech()
  current.finished = true
  persist(true)
  updatePlayer()
  renderShelf()
  notify('Terminaste ' + current.book.title + '.')
}

function isCurrentAudio() {
  return current && !speaking() && audio.currentSrc === activePart().url
}

audio.addEventListener('loadedmetadata', () => {
  if (!isCurrentAudio()) return
  current.ready = true
  audio.playbackRate = speed
  if (current.position) audio.currentTime = Math.min(current.position, Math.max(0, audio.duration - 0.15))
  updateTimeline()
})
audio.addEventListener('timeupdate', () => {
  if (!isCurrentAudio() || !current.ready || current.finished) return
  current.position = audio.currentTime
  updateTimeline()
  persist()
})
audio.addEventListener('playing', () => { if (isCurrentAudio()) { playerError(); updatePlayer() } })
audio.addEventListener('pause', () => { if (isCurrentAudio()) { persist(true); updatePlayer(); renderShelf() } })
audio.addEventListener('ended', () => { if (isCurrentAudio()) finishPart() })
audio.addEventListener('error', () => {
  if (isCurrentAudio() && current.started) playerError('No se pudo cargar este capítulo. Comprueba tu conexión o elige otro capítulo.')
})
seek.addEventListener('input', () => positionAt(Number(seek.value)))
$('#speed').addEventListener('change', event => {
  speed = Number(event.target.value)
  save('speed', speed)
  audio.playbackRate = speed
  if (speechPlaying) startNarration()
})

function setSleep(minutes) {
  clearTimeout(sleepTimer)
  const control = $('.sleep')
  control.open = false
  control.toggleAttribute('data-active', !!minutes)
  if (minutes) {
    sleepTimer = setTimeout(() => {
      halt()
      control.removeAttribute('data-active')
      notify('Temporizador terminado. La reproducción se pausó.')
    }, minutes * 60_000)
  }
  notify(minutes ? 'La reproducción se pausará en ' + minutes + ' minutos.' : 'Temporizador desactivado.')
}

function importFeedback(message, error = false) {
  const status = $('#import-status')
  status.hidden = !message
  status.textContent = message
  status.toggleAttribute('data-error', error)
}

function chooseFile(file) {
  selectedFile = file
  $('#file-label').textContent = file?.name ?? 'Seleccionar un PDF'
  $('#pdf-title').value = file?.name.replace(/\.pdf$/i, '').slice(0, 120) ?? ''
  importFeedback('')
}

function openImport() {
  if (!importDialog.open) importDialog.showModal()
}

$('#file').addEventListener('change', event => chooseFile(event.target.files[0]))
const dropzone = $('#dropzone')
dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('drag') })
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'))
dropzone.addEventListener('drop', event => {
  event.preventDefault()
  dropzone.classList.remove('drag')
  if ($('#import-submit').disabled || !event.dataTransfer.files.length) return
  $('#file').files = event.dataTransfer.files
  chooseFile(event.dataTransfer.files[0])
})

$('#import-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (!selectedFile || !/\.pdf$/i.test(selectedFile.name)) return importFeedback('Elige un archivo .pdf.', true)
  if (selectedFile.size > 40 * 1024 * 1024) return importFeedback('El PDF pesa más de 40 MB. Divídelo en archivos más pequeños.', true)
  const submit = $('#import-submit')
  submit.disabled = true
  $('#file').disabled = true
  $('#pdf-title').readOnly = true
  importFeedback('Abriendo el documento…')
  try {
    const { extractPdf } = await import('./pdf-import.js')
    const chapters = await extractPdf(selectedFile, (page, total) => importFeedback('Leyendo página ' + page + ' de ' + total + '…'))
    const title = $('#pdf-title').value.trim() || selectedFile.name.replace(/\.pdf$/i, '').slice(0, 120) || 'Documento PDF'
    const book = { id: 'pdf-' + crypto.randomUUID(), title, author: '', type: 'pdf', genre: 'PDF', chapters, duration: chapters.reduce((sum, chapter) => sum + chapter.duration, 0) }
    await pdfStorage('readwrite', store => store.add(book))
    pdfs.push(book)
    $('#import-form').reset()
    chooseFile(undefined)
    importDialog.close()
    search.value = ''
    location.hash = 'biblioteca'
    renderShelf()
    showDetails(book)
    notify('PDF agregado a tu biblioteca.')
  } catch (error) {
    importFeedback(error instanceof Error && error.message ? error.message : 'No se pudo importar el PDF. Comprueba el archivo y el espacio del navegador.', true)
  } finally {
    $('#file').disabled = false
    $('#pdf-title').readOnly = false
    submit.disabled = false
  }
})

async function removePdf(book, button) {
  if (!book || !window.confirm('¿Eliminar «' + book.title + '» y su progreso de esta biblioteca?')) return
  button.disabled = true
  try {
    await pdfStorage('readwrite', store => store.delete(book.id))
    if (current?.book.id === book.id) {
      halt()
      current = null
      dock.hidden = true
    }
    if (load('recent', '') === book.id) save('recent', '')
    pdfs = pdfs.filter(item => item.id !== book.id)
    delete progress[book.id]
    save('progress', progress)
    bookDialog.close()
    renderShelf()
    notify('PDF eliminado.')
  } catch {
    notify('No se pudo eliminar el PDF. Vuelve a intentarlo.')
    button.disabled = false
  }
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]')
  if (!target) return
  const book = findBook(target.dataset.book ?? detailId)
  const action = target.dataset.action
  switch (action) {
    case 'filter': filter = target.dataset.filter; renderShelf(); break
    case 'details': showDetails(book); break
    case 'details-current': showDetails(current?.book); break
    case 'read-book': openReader(book); break
    case 'read-current': openReader(current?.book); break
    case 'read-from': readFrom(Number(target.dataset.offset)); break
    case 'play-book': playBook(book); break
    case 'chapter': playBook(book, Number(target.dataset.chapter)); break
    case 'toggle':
      if (isPlaying()) { halt(); renderShelf() } else start()
      break
    case 'previous': relativeChapter(-1); break
    case 'next': relativeChapter(1); break
    case 'rewind': positionAt(shownPosition() - 15); break
    case 'forward': positionAt(shownPosition() + 15); break
    case 'import': openImport(); break
    case 'close': target.closest('dialog').close(); break
    case 'sleep': setSleep(Number(target.dataset.minutes)); break
    case 'clear-search': search.value = ''; renderShelf(); search.focus(); break
    case 'retry': loadCatalog(); break
    case 'bookmark':
      if (saved.has(book.id)) saved.delete(book.id)
      else saved.add(book.id)
      save('saved', [...saved])
      target.setAttribute('aria-pressed', String(saved.has(book.id)))
      target.innerHTML = icon(saved.has(book.id) ? 'check' : 'bookmark') + (saved.has(book.id) ? ' Guardado' : ' Guardar')
      renderShelf()
      break
    case 'delete-pdf': removePdf(book, target); break
  }
})

search.addEventListener('input', renderShelf)
$('.search').addEventListener('submit', event => event.preventDefault())
document.addEventListener('keydown', event => {
  if (event.key === '/' && !document.querySelector('dialog[open]') && !event.target.closest('input,textarea,[contenteditable]')) {
    if (search.closest('form').hidden) return
    event.preventDefault()
    search.focus()
  }
})
for (const nav of $$('[data-view], .brand')) nav.addEventListener('click', () => {
  search.value = ''
  filter = 'Todos'
  renderShelf()
})
window.addEventListener('hashchange', () => { renderShelf(); window.scrollTo(0, 0) })
window.addEventListener('pagehide', () => { persist(true); if (speaking()) stopSpeech() })
window.addEventListener('pageshow', event => { if (event.persisted) updatePlayer() })
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(true) })
window.speechSynthesis?.getVoices()

async function loadCatalog() {
  loading = true
  renderShelf()
  try {
    const response = await fetch(new URL('./catalog.json', import.meta.url))
    if (!response.ok) throw new Error('Catálogo no disponible')
    catalog = await response.json()
    catalogError = false
  } catch {
    catalogError = true
  } finally {
    loading = false
    renderShelf()
  }
}

await Promise.all([
  loadCatalog(),
  pdfStorage('readonly', store => store.getAll()).then(books => { pdfs = books; renderShelf() }).catch(() => {
    notify('El navegador no permitió abrir la biblioteca de PDF.')
  }),
])
const recent = findBook(load('recent', ''))
const previous = recent && progress[recent.id]
if (!current && previous && !previous.finished && recent.chapters[previous.chapter]) {
  openPart(recent, previous.chapter, previous.position, false)
}
