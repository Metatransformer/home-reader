#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { stdin } from 'node:process';
import { DEFAULT_MODEL, ReaderError, generateReading, listModels } from './reader.mjs';

const HELP = `Home Reader CLI

Usage:
  cat article.txt | node cli.mjs [options]
  node cli.mjs --file article.txt [options]

Options:
  --file PATH                  Read source text from a file
  --type quick|explain|deep    Reading style (default: explain)
  --model NAME                 Ollama chat model (default: qwen3:8b when installed)
  --no-audio                   Save text only; skip macOS speech synthesis
  --help                       Show this help
`;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = { file: null, type: 'explain', model: null, noAudio: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--no-audio') options.noAudio = true;
    else if (['--file', '--type', '--model'].includes(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new ReaderError(`${arg} requires a value.`);
      options[arg.slice(2)] = value;
      index += 1;
    } else throw new ReaderError(`Unknown option: ${arg}`);
  }
  return options;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
  } else {
    const text = options.file ? await readFile(options.file, 'utf8') : await readStdin();
    let model = options.model;
    if (!model) {
      const available = await listModels();
      model = available.defaultModel ?? DEFAULT_MODEL;
      if (!available.defaultModel) throw new ReaderError('No Ollama chat models were found. Install one, then try again.');
    }
    console.error(`Creating ${options.type} reading with ${model}…`);
    const reading = await generateReading({ text, type: options.type, model, noAudio: options.noAudio });
    console.log(`Saved: ${reading.id}`);
    console.log(`Status: ${reading.status}`);
    console.log(`Audio: ${reading.audio.available ? 'audio.wav' : 'not requested'}`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  if (error?.readingId) console.error(`Partial reading saved: ${error.readingId}`);
}
