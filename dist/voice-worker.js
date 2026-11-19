import { KokoroTTS } from './vendor/voice/kokoro.mjs'
import createEphone, { roa } from './vendor/voice/ephone.mjs'

const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX'
let model
let styleFile
let phonemizer

async function synthesise(text) {
  model ??= KokoroTTS.from_pretrained(modelId, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback({ status, file, progress }) {
      if (status === 'progress' && file?.endsWith('.onnx')) postMessage({ progress })
    },
  }).catch(error => {
    model = undefined
    throw error
  })
  styleFile ??= fetch(new URL('./vendor/voice/ef_dora.bin', import.meta.url))
    .then(response => {
      if (!response.ok) throw new Error('No se pudo descargar la voz.')
      return response.arrayBuffer()
    }).then(buffer => new Float32Array(buffer))
    .catch(error => {
      styleFile = undefined
      throw error
    })
  phonemizer ??= createEphone(roa).then(engine => {
    engine.setVoice('es-419')
    return engine
  }).catch(error => {
    phonemizer = undefined
    throw error
  })
  const [engine, embeddings, spanish] = await Promise.all([model, styleFile, phonemizer])
  const ipa = spanish.textToIpa(text).replace(/ˌ/g, '').replace(/[«»“”]/g, '"')
  const { input_ids } = engine.tokenizer(ipa, { truncation: true })
  const index = 256 * Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509)
  const Tensor = input_ids.constructor
  const { waveform } = await engine.model({
    input_ids,
    style: new Tensor('float32', embeddings.slice(index, index + 256), [1, 256]),
    speed: new Tensor('float32', [1], [1]),
  })
  const samples = new Float32Array(waveform.data)
  if (!samples.length || samples.some(sample => !Number.isFinite(sample))) throw new Error('Audio inválido.')
  return samples
}

let queue = Promise.resolve()
self.onmessage = ({ data: { id, text } }) => {
  queue = queue.then(async () => {
    try {
      const samples = await synthesise(text)
      postMessage({ id, samples }, [samples.buffer])
    } catch (error) {
      postMessage({ id, error: error.message })
    }
  })
}
