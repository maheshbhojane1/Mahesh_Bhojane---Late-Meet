let mediaStream = null;
let mediaRecorder = null;
let audioContext = null;
let analyserNode = null;
let chunkTimer = null;

let pendingChunks = [];
let isChunkRequested = false;
let isStopping = false;
let isDrainingQueue = false;

const CHUNK_MS = 8000;
const RMS_THRESHOLD = 0.012;
const SILENCE_LIMIT = 3;
const BASE64_CHUNK_SIZE = 0x8000;
let consecutiveSilent = 0;
let isFlushInProgress = false;

function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunks = [];

  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    const slice = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    let chunk = '';
    for (let j = 0; j < slice.length; j += 1) {
      chunk += String.fromCharCode(slice[j]);
    }
    chunks.push(chunk);
  }

  return btoa(chunks.join(''));
}

function pickSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus'
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function getCurrentRms() {
  if (!analyserNode) return 0;

  const buffer = new Uint8Array(analyserNode.fftSize);
  analyserNode.getByteTimeDomainData(buffer);

  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const normalized = (buffer[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }

  return Math.sqrt(sumSquares / buffer.length);
}

async function flushAudioChunk() {
  if (isFlushInProgress || isChunkRequested || !mediaRecorder || mediaRecorder.state !== 'recording') return;

  isFlushInProgress = true;
  try {
    const rms = getCurrentRms();
    if (rms < RMS_THRESHOLD) {
      consecutiveSilent += 1;
      if (consecutiveSilent >= SILENCE_LIMIT) {
        return;
      }
    } else {
      consecutiveSilent = 0;
    }

    isChunkRequested = true;
    mediaRecorder.requestData();
  } finally {
    isFlushInProgress = false;
  }
}

async function postChunk(blob) {
  if (!blob || blob.size === 0) return;

  const buffer = await blob.arrayBuffer();
  const audioBase64 = toBase64(buffer);

  await chrome.runtime.sendMessage({
    type: 'OFFSCREEN_AUDIO_CHUNK',
    audioBase64
  });
}

async function drainPendingChunks() {
  if (isDrainingQueue) return;
  isDrainingQueue = true;
  try {
    while (pendingChunks.length > 0) {
      const blob = pendingChunks.shift();
      await postChunk(blob);
    }
  } finally {
    isDrainingQueue = false;
  }
}

async function startCapture(tabId) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    return;
  }

  mediaStream = await chrome.tabCapture.capture({
    audio: true,
    video: false,
    targetTabId: tabId
  });

  if (!mediaStream) {
    throw new Error('Failed to capture tab audio stream');
  }

  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(mediaStream);
  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 1024;
  source.connect(analyserNode);

  const mimeType = pickSupportedMimeType();
  mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);

  mediaRecorder.addEventListener('dataavailable', event => {
    if (event.data && event.data.size > 0) {
      pendingChunks.push(event.data);
    }
    isChunkRequested = false;
  });

  mediaRecorder.start();

  chunkTimer = setInterval(async () => {
    try {
      if (isStopping) return;
      await flushAudioChunk();
      await drainPendingChunks();
    } catch (err) {
      console.error('[LateMeet][offscreen] Chunk pipeline error:', err);
    }
  }, CHUNK_MS);
}

async function stopCapture() {
  if (chunkTimer) {
    clearInterval(chunkTimer);
    chunkTimer = null;
  }
  isStopping = true;

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    const recorder = mediaRecorder;
    await new Promise(resolve => {
      recorder.addEventListener('stop', resolve, { once: true });
      recorder.stop();
    });
  }

  await drainPendingChunks();

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }

  mediaRecorder = null;
  analyserNode = null;
  pendingChunks = [];
  isChunkRequested = false;
  isStopping = false;
  consecutiveSilent = 0;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'OFFSCREEN_START_CAPTURE') {
      try {
        await startCapture(message.tabId);
        sendResponse({ success: true });
      } catch (err) {
        console.error('[LateMeet][offscreen] Failed to start capture:', err);
        sendResponse({ success: false, error: err.message || 'Start capture failed' });
      }
      return;
    }

    if (message?.type === 'OFFSCREEN_STOP_CAPTURE') {
      try {
        await stopCapture();
      } finally {
        await chrome.runtime.sendMessage({ type: 'OFFSCREEN_CAPTURE_STOPPED' });
      }
      sendResponse({ success: true });
      return;
    }

    sendResponse({ success: false, error: 'Unknown message type' });
  })();

  return true;
});
