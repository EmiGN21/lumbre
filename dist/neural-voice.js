export class NeuralVoice {
  #context
  #worker
  #pending = new Map()
  #sequence = 0
  #source
  #startedAt = 0
  #rate = 1
  #duration = 0
  #elapsed = 0
  #onProgress

  constructor(onProgress) {
    this.#onProgress = onProgress
  }

  async unlock() {
    const AudioContext = window.AudioContext ?? window.webkitAudioContext
    if (!AudioContext) throw new Error('AudioContext no está disponible.')
    this.#context ??= new AudioContext()
    if (this.#context.state !== 'running') await this.#context.resume()
  }

  #createWorker() {
    const worker = new Worker(new URL('./voice-worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      if ('progress' in data) return this.#onProgress(data.progress)
      const request = this.#pending.get(data.id)
      if (!request) return
      this.#pending.delete(data.id)
      clearTimeout(request.timeout)
      if (data.error) request.reject(new Error(data.error))
      else request.resolve(data.samples)
    }
    worker.onerror = event => {
      event.preventDefault()
      this.#resetWorker(new Error('No se pudo iniciar el motor de voz.'))
    }
    return worker
  }

  #resetWorker(error) {
    this.#worker?.terminate()
    this.#worker = undefined
    for (const request of this.#pending.values()) {
      clearTimeout(request.timeout)
      request.reject(error)
    }
    this.#pending.clear()
  }

  generate(text) {
    this.#worker ??= this.#createWorker()
    const id = ++this.#sequence
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.#resetWorker(new Error('La voz tardó demasiado en responder.')), 150_000)
      this.#pending.set(id, { resolve, reject, timeout })
      this.#worker.postMessage({ id, text })
    })
  }

  play(samples, rate, onEnd) {
    const context = this.#context
    const buffer = context.createBuffer(1, samples.length, 24_000)
    buffer.copyToChannel(samples, 0)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    source.connect(context.destination)
    this.#source = source
    this.#duration = buffer.duration
    this.#elapsed = 0
    this.#startedAt = context.currentTime
    this.#rate = rate
    source.onended = () => {
      if (this.#source !== source) return
      this.#source = undefined
      onEnd()
    }
    source.start()
  }

  fraction() {
    if (!this.#source) return 0
    return Math.min(1, (this.#elapsed + (this.#context.currentTime - this.#startedAt) * this.#rate) / this.#duration)
  }

  setRate(rate) {
    if (!this.#source) return
    const now = this.#context.currentTime
    this.#elapsed += (now - this.#startedAt) * this.#rate
    this.#startedAt = now
    this.#rate = rate
    this.#source.playbackRate.setValueAtTime(rate, now)
  }

  stop() {
    const source = this.#source
    this.#source = undefined
    source?.stop()
  }
}
