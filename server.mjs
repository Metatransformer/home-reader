import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import {
  OUTPUTS_DIR,
  PROJECT_ROOT,
  ReaderError,
  generateReading,
  getReading,
  listModels,
  listReadings,
  readingFilePath,
} from './reader.mjs';

const HOST = '127.0.0.1';
const PORT = 3210;
const JSON_LIMIT = 100_000;
const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/style.css', 'style.css'],
]);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
let generationInProgress = false;

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function localRequest(request) {
  const host = String(request.headers.host ?? '').split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  if (!['127.0.0.1', 'localhost'].includes(host)) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return ['127.0.0.1', 'localhost'].includes(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function readJson(request) {
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new ReaderError('Content-Type must be application/json.', { code: 'CONTENT_TYPE', status: 415 });
  }
  const declared = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > JSON_LIMIT) {
    throw new ReaderError('Request body is too large.', { code: 'BODY_TOO_LARGE', status: 413 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw new ReaderError('Request body is too large.', { code: 'BODY_TOO_LARGE', status: 413 });
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new ReaderError('Request body must be a valid JSON object.', { code: 'BAD_JSON' });
  }
}

async function serveStatic(pathname, response) {
  const file = STATIC_FILES.get(pathname);
  if (!file) return false;
  const body = await readFile(join(PROJECT_ROOT, 'public', file));
  response.writeHead(200, {
    'content-type': MIME[extname(file)],
    'content-length': body.length,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; media-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
  return true;
}

async function serveFile(path, contentType, request, response, downloadName) {
  let fileStat;
  try { fileStat = await stat(path); }
  catch (error) {
    if (error?.code === 'ENOENT') throw new ReaderError('Saved file not found.', { code: 'NOT_FOUND', status: 404 });
    throw error;
  }
  const headers = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-cache',
    'content-disposition': `inline${downloadName ? `; filename="${downloadName}"` : ''}`,
  };
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416, { 'content-range': `bytes */${fileStat.size}` });
      return response.end();
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : fileStat.size - 1;
    if (start > end || end >= fileStat.size) {
      response.writeHead(416, { 'content-range': `bytes */${fileStat.size}` });
      return response.end();
    }
    response.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${fileStat.size}` });
    return createReadStream(path, { start, end }).pipe(response);
  }
  response.writeHead(200, { ...headers, 'content-length': fileStat.size });
  createReadStream(path).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    if (!localRequest(request)) throw new ReaderError('This app accepts local requests only.', { code: 'LOCAL_ONLY', status: 403 });
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && await serveStatic(url.pathname, response)) return;

    if (request.method === 'GET' && url.pathname === '/api/models') {
      return sendJson(response, 200, await listModels());
    }
    if (request.method === 'GET' && url.pathname === '/api/readings') {
      return sendJson(response, 200, { readings: await listReadings() });
    }
    if (request.method === 'POST' && url.pathname === '/api/readings') {
      if (generationInProgress) throw new ReaderError('Another reading is being created. Wait for it to finish and try again.', { code: 'BUSY', status: 409 });
      generationInProgress = true;
      try {
        const body = await readJson(request);
        const reading = await generateReading({ text: body.text, type: body.type, model: body.model });
        return sendJson(response, 201, { reading });
      } finally {
        generationInProgress = false;
      }
    }

    const detailMatch = /^\/api\/readings\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'GET' && detailMatch) {
      return sendJson(response, 200, { reading: await getReading(decodeURIComponent(detailMatch[1])) });
    }
    const fileMatch = /^\/api\/readings\/([^/]+)\/(audio|source|script)$/.exec(url.pathname);
    if (request.method === 'GET' && fileMatch) {
      const id = decodeURIComponent(fileMatch[1]);
      const kind = fileMatch[2];
      const reading = await getReading(id);
      if (kind === 'audio' && !reading.audio?.available) throw new ReaderError('This reading has no playable audio.', { code: 'NO_AUDIO', status: 404 });
      const types = { audio: 'audio/wav', source: 'text/plain; charset=utf-8', script: 'text/plain; charset=utf-8' };
      return await serveFile(readingFilePath(id, kind, { outputsDir: OUTPUTS_DIR }), types[kind], request, response, `${kind}.${kind === 'audio' ? 'wav' : 'txt'}`);
    }
    throw new ReaderError('Not found.', { code: 'NOT_FOUND', status: 404 });
  } catch (error) {
    if (response.headersSent) return response.destroy(error);
    const status = error instanceof ReaderError ? error.status : 500;
    sendJson(response, status, {
      error: error instanceof ReaderError ? error.message : 'Unexpected server error.',
      code: error instanceof ReaderError ? error.code : 'INTERNAL_ERROR',
      readingId: error?.readingId ?? null,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Home Reader is available at http://${HOST}:${PORT}`);
});
