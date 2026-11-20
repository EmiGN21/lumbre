# Lumbre · Audiolibros

Demo gratuita con grabaciones en español de LibriVox. Abre un título, elige un capítulo y vuelve a la misma posición al entrar desde el mismo navegador.

Para probar localmente desde esta carpeta:

```powershell
python -m http.server 8773 --bind 127.0.0.1 --directory dist
```

Abre http://127.0.0.1:8773. Para alojarlo, publica el contenido de `dist/` en un servidor estático con HTTPS.

**Importar PDF** guarda el texto extraído en la biblioteca del navegador. Usa los marcadores del PDF si hay varios destinos de página distintos o divide por páginas. Los escaneos necesitan una capa de texto (OCR).

La pestaña **Lectura** resalta el fragmento narrado y permite saltar a otro tocándolo. **Dora** usa Kokoro-82M y fonetización en español latinoamericano. La primera reproducción descarga aproximadamente 92 MB de parámetros, además del entorno de ejecución, y sintetiza el texto en el dispositivo. La opción **Voz del dispositivo** usa una voz local en español. Se guarda el punto del audio original o la posición aproximada del texto en cada navegador.

En Android, abre el sitio en Chrome y usa la opción de instalación del menú. En iPhone, abre el sitio en Safari y usa **Compartir → Añadir a pantalla de inicio → Abrir como app web**, si aparece. La aplicación instalable es una PWA.

El catálogo incluye la [primera parte de Don Quijote](https://librivox.org/don-quijote-vol-1-by-miguel-de-cervantes-saavedra/), [Lazarillo de Tormes](https://librivox.org/lazarillo-de-tormes/) y [Leyendas](https://librivox.org/leyendas-by-gustavo-adolfo-becquer/). Los MP3 se reproducen desde Internet Archive. El extractor usa PDF.js 6.5.438, con su licencia en `dist/vendor/LICENSE`.

El motor de voz usa [Kokoro JS 1.2.1](https://github.com/hexgrad/kokoro/tree/main/kokoro.js), los [pesos ONNX de Kokoro](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) y [el código fuente de ephone](https://github.com/sjmik/ephone-js/tree/master/emscripten), distribuido como [ephone 1.0.2](https://www.npmjs.com/package/ephone/v/1.0.2). Sus licencias se incluyen en `dist/vendor/voice`.

La ilustración principal y las tres portadas en `dist/assets` fueron creadas con ImageGen. Cada WebP guarda su prompt en los metadatos de la imagen.

[Ver la demo publicada](https://lumbre-audiolibros.awaketrout65.chatgpt.site/).
