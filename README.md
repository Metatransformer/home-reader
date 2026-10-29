# Home Reader

Home Reader turns source text into a listening script with a local Ollama chat model. On macOS it can also narrate the script into a WAV file with the built-in `say` and `afconvert` tools. It includes a local browser interface, a command-line interface, and a persistent library of saved readings.

Home Reader is a local application, not a hosted cloud demo. It has no runtime dependencies, accounts, analytics, or build step.

## Requirements

- Node.js 22 or newer
- [Ollama](https://ollama.com/) running with at least one installed chat model
- macOS for audio generation; Linux and Windows users can generate text with the CLI's `--no-audio` option

Start Ollama if it is not already running:

```sh
ollama serve
```

Home Reader prefers `qwen3:8b` when it is installed. Pull it only if you need it:

```sh
ollama pull qwen3:8b
```

You can instead select a smaller installed chat model if that is a better fit for your machine.

## Run locally

No `npm install` is required.

```sh
git clone https://github.com/Metatransformer/home-reader.git
cd home-reader
npm start
```

Open <http://127.0.0.1:3210>. Paste up to 12,000 characters, select an installed model, and choose one of three modes:

- **Quick:** the main idea, key facts, and important caveats
- **Explain:** a plain-English explanation with context
- **Deep:** a detailed walkthrough

The browser library persists saved readings across server restarts. Each reading may include the original source, generated listening script, WAV audio, and metadata in its folder under `outputs/`.

## CLI

Read from a file:

```sh
node cli.mjs --file article.txt --type deep --model qwen3:8b
```

Read from standard input:

```sh
cat article.txt | node cli.mjs --type explain
```

Generate text without macOS audio tools:

```sh
node cli.mjs --file article.txt --type quick --no-audio
```

Run `node cli.mjs --help` for all options. The same 12,000-character input limit applies to the browser and CLI.

## Storage, privacy, and failures

Readings are stored in `outputs/<reading-id>/`. Home Reader saves `source.txt` and `metadata.json` first, then adds `script.txt` and `audio.wav` as those steps succeed. If generation or narration fails, completed partial results remain available and the metadata records the error.

The original source is saved exactly as submitted. Generated summaries and explanations can omit or misstate details, so use the original as the source of truth.

`OLLAMA_URL` defaults to `http://127.0.0.1:11434`. If you override it with a remote Ollama endpoint, Home Reader sends the submitted source text to that endpoint.

## Development

```sh
npm run check
npm test
```

## License

The code is available under the [MIT License](LICENSE). The license does not cover Ollama models or the user's source and generated content; those remain subject to their own applicable terms and licenses.
