const MAX_LENGTH = 12_000;
const form = document.querySelector('#reading-form');
const sourceInput = document.querySelector('#source-text');
const countOutput = document.querySelector('#character-count');
const modelSelect = document.querySelector('#model-select');
const createButton = document.querySelector('#create-button');
const formStatus = document.querySelector('#form-status');
const libraryList = document.querySelector('#library-list');
const refreshButton = document.querySelector('#refresh-button');
const detailEmpty = document.querySelector('#detail-empty');
const detailContent = document.querySelector('#detail-content');
const audioPlayer = document.querySelector('#audio-player');
const playbackRate = document.querySelector('#playback-rate');

let selectedId = null;
let busy = false;

function setStatus(message, kind = '') {
  formStatus.textContent = message;
  formStatus.className = `status ${kind}`.trim();
}

function updateCounter() {
  const length = sourceInput.value.length;
  countOutput.textContent = `${length.toLocaleString()} / ${MAX_LENGTH.toLocaleString()}`;
  countOutput.classList.toggle('near-limit', length > MAX_LENGTH * 0.9);
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (HTTP ${response.status}).`);
    error.readingId = data.readingId;
    throw error;
  }
  return data;
}

function displayDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function statusLabel(status) {
  return ({
    success: 'Ready',
    error: 'Needs attention',
    pending: 'Pending',
    generating: 'Writing script',
    creating_audio: 'Creating audio',
  })[status] || status;
}

async function loadModels() {
  try {
    const data = await requestJson('/api/models');
    modelSelect.replaceChildren();
    if (!data.models.length) {
      const option = document.createElement('option');
      option.textContent = 'No chat models found';
      option.value = '';
      modelSelect.append(option);
      setStatus('No Ollama chat models were found. Install a chat model and refresh.', 'error');
      return;
    }
    for (const model of data.models) {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      option.selected = model === data.defaultModel;
      modelSelect.append(option);
    }
    modelSelect.disabled = false;
    createButton.disabled = false;
  } catch (error) {
    modelSelect.replaceChildren();
    const option = document.createElement('option');
    option.textContent = 'Ollama unavailable';
    modelSelect.append(option);
    setStatus(error.message, 'error');
  }
}

function renderLibrary(readings) {
  libraryList.replaceChildren();
  if (!readings.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No readings yet. Your first one will appear here.';
    libraryList.append(empty);
    return;
  }
  for (const reading of readings) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'library-item';
    button.classList.toggle('selected', reading.id === selectedId);
    button.setAttribute('aria-pressed', String(reading.id === selectedId));

    const title = document.createElement('strong');
    title.textContent = reading.title || 'Untitled reading';
    const meta = document.createElement('span');
    meta.textContent = `${displayDate(reading.date)} · ${reading.type}`;
    const status = document.createElement('span');
    status.className = `item-status ${reading.status}`;
    status.textContent = statusLabel(reading.status);
    button.append(title, meta, status);
    button.addEventListener('click', () => selectReading(reading.id));
    libraryList.append(button);
  }
}

async function loadLibrary({ select = null } = {}) {
  try {
    const { readings } = await requestJson('/api/readings');
    if (select) selectedId = select;
    renderLibrary(readings);
    if (select) await selectReading(select);
  } catch (error) {
    libraryList.replaceChildren();
    const message = document.createElement('p');
    message.className = 'empty-state error-text';
    message.textContent = error.message;
    libraryList.append(message);
  }
}

function setDownload(link, id, kind) {
  link.href = `/api/readings/${encodeURIComponent(id)}/${kind}`;
}

async function selectReading(id) {
  selectedId = id;
  for (const item of libraryList.querySelectorAll('.library-item')) {
    const isSelected = item.querySelector('strong') && item === document.activeElement;
    item.classList.toggle('selected', isSelected);
  }
  try {
    const { reading } = await requestJson(`/api/readings/${encodeURIComponent(id)}`);
    detailEmpty.hidden = true;
    detailContent.hidden = false;
    document.querySelector('#detail-meta').textContent = `${displayDate(reading.date)} · ${reading.type} · ${reading.model}`;
    document.querySelector('#selected-title').textContent = reading.title || 'Untitled reading';
    const badge = document.querySelector('#detail-status');
    badge.textContent = statusLabel(reading.status);
    badge.className = `status-badge ${reading.status}`;

    const errorPanel = document.querySelector('#detail-error');
    errorPanel.hidden = !reading.error;
    errorPanel.textContent = reading.error || '';
    document.querySelector('#script-text').textContent = reading.script || 'No script was saved for this reading.';
    document.querySelector('#source-text-display').textContent = reading.source || '';
    const scriptDownload = document.querySelector('#script-download');
    scriptDownload.hidden = !reading.script;
    if (reading.script) setDownload(scriptDownload, id, 'script');
    setDownload(document.querySelector('#source-download'), id, 'source');

    const audioPanel = document.querySelector('#audio-panel');
    audioPlayer.pause();
    audioPlayer.removeAttribute('src');
    if (reading.audio?.available) {
      const audioUrl = `/api/readings/${encodeURIComponent(id)}/audio`;
      audioPlayer.src = audioUrl;
      audioPlayer.playbackRate = Number(playbackRate.value);
      setDownload(document.querySelector('#audio-download'), id, 'audio');
      audioPanel.hidden = false;
    } else {
      audioPanel.hidden = true;
    }
    const { readings } = await requestJson('/api/readings');
    renderLibrary(readings);
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const text = sourceInput.value;
  if (!text.trim()) {
    setStatus('Paste some text before creating a reading.', 'error');
    sourceInput.focus();
    return;
  }
  if (text.length > MAX_LENGTH) {
    setStatus('This text exceeds 12,000 characters. Shorten it before creating a reading.', 'error');
    return;
  }
  busy = true;
  createButton.disabled = true;
  modelSelect.disabled = true;
  setStatus('Creating your script and audio. This can take a few minutes…', 'working');
  try {
    const type = new FormData(form).get('type');
    const { reading } = await requestJson('/api/readings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, type, model: modelSelect.value }),
    });
    setStatus('Reading saved and ready to play.', 'success');
    await loadLibrary({ select: reading.id });
  } catch (error) {
    setStatus(error.message, 'error');
    await loadLibrary({ select: error.readingId || null });
  } finally {
    busy = false;
    createButton.disabled = false;
    modelSelect.disabled = false;
  }
});

sourceInput.addEventListener('input', updateCounter);
refreshButton.addEventListener('click', () => loadLibrary());
playbackRate.addEventListener('change', () => { audioPlayer.playbackRate = Number(playbackRate.value); });

updateCounter();
await Promise.all([loadModels(), loadLibrary()]);
