// LyricLingo — Features page interactive demos

const BASE = '/api';

// ── State ──
let currentAudio   = null;
let playingLine    = null;
let playbackRate   = 1.0;
let playAllActive  = false;
let playAllSession = 0;

// ── DOM refs ──
const tapLines       = document.querySelectorAll('#demo-tap-lines .lyric-line');
const playallLines   = document.querySelectorAll('#demo-playall-lines .lyric-line');
const speedLines     = document.querySelectorAll('#demo-speed-lines .lyric-line');
const fpPlayAllBtn   = document.getElementById('fp-play-all-btn');
const fpStopBtn      = document.getElementById('fp-stop-btn');
const fpSpeed1x      = document.getElementById('fp-speed-1x');
const fpSpeed07x     = document.getElementById('fp-speed-07x');
const tapIndicator   = document.getElementById('tap-indicator');
const playallInd     = document.getElementById('playall-indicator');
const speedInd       = document.getElementById('speed-indicator');
const speedIndLabel  = document.getElementById('speed-indicator-label');

// ── Audio helpers ──

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (playingLine) {
    playingLine.classList.remove('playing', 'active');
    playingLine = null;
  }
  [tapIndicator, playallInd, speedInd].forEach(el => { if (el) el.style.display = 'none'; });
}

async function playLine(el, text, indicator) {
  stopAudio();
  el.classList.add('active', 'playing');
  playingLine = el;
  if (indicator) indicator.style.display = 'flex';

  try {
    const res = await fetch(`${BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error('TTS failed');

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = playbackRate;
    currentAudio = audio;

    await new Promise((resolve) => {
      audio.addEventListener('ended', resolve);
      audio.addEventListener('error', resolve);
      audio.play().catch(resolve);
    });
  } catch (_) {
    // silently ignore
  } finally {
    el.classList.remove('playing', 'active');
    if (playingLine === el) playingLine = null;
    if (indicator) indicator.style.display = 'none';
    URL.revokeObjectURL(currentAudio?.src ?? '');
    currentAudio = null;
  }
}

// ── Section 01: Tap lines ──

tapLines.forEach(btn => {
  btn.addEventListener('click', () => {
    playLine(btn, btn.dataset.text, tapIndicator);
  });
});

// ── Section 02: Play All ──

fpPlayAllBtn.addEventListener('click', startPlayAll);
fpStopBtn.addEventListener('click',   stopPlayAll);

function stopPlayAll() {
  playAllActive = false;
  playAllSession++;
  stopAudio();
  fpPlayAllBtn.style.display = '';
  fpStopBtn.style.display    = 'none';
  playallLines.forEach(l => l.classList.remove('active', 'playing'));
}

async function startPlayAll() {
  if (playAllActive) return;
  playAllActive = true;
  const session = ++playAllSession;

  fpPlayAllBtn.style.display = 'none';
  fpStopBtn.style.display    = '';
  playallInd.style.display   = 'flex';

  for (const btn of playallLines) {
    if (!playAllActive || playAllSession !== session) break;
    btn.classList.add('active', 'playing');
    playingLine = btn;
    try {
      const res = await fetch(`${BASE}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: btn.dataset.text }),
      });
      if (res.ok) {
        const blob  = await res.blob();
        const url   = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.playbackRate = playbackRate;
        currentAudio = audio;
        await new Promise((resolve) => {
          audio.addEventListener('ended', resolve);
          audio.addEventListener('error', resolve);
          audio.play().catch(resolve);
        });
        URL.revokeObjectURL(url);
      }
    } catch (_) { /* ignore */ }
    btn.classList.remove('active', 'playing');
    if (playAllSession !== session) break;
    await new Promise(r => setTimeout(r, 200));
  }

  if (playAllSession === session) stopPlayAll();
}

// Allow tapping individual lines in play-all section too
playallLines.forEach(btn => {
  btn.addEventListener('click', () => {
    if (playAllActive) return;
    playLine(btn, btn.dataset.text, playallInd);
  });
});

// ── Section 03: Speed control ──

function setSpeed(rate) {
  playbackRate = rate;
  if (rate === 1.0) {
    fpSpeed1x.classList.add('active');
    fpSpeed1x.setAttribute('aria-pressed', 'true');
    fpSpeed07x.classList.remove('active');
    fpSpeed07x.setAttribute('aria-pressed', 'false');
  } else {
    fpSpeed07x.classList.add('active');
    fpSpeed07x.setAttribute('aria-pressed', 'true');
    fpSpeed1x.classList.remove('active');
    fpSpeed1x.setAttribute('aria-pressed', 'false');
  }
  if (speedIndLabel) speedIndLabel.textContent = `Playing at ${rate === 1 ? '1×' : '0.7×'}…`;
}

fpSpeed1x.addEventListener('click',  () => setSpeed(1.0));
fpSpeed07x.addEventListener('click', () => setSpeed(0.7));

speedLines.forEach(btn => {
  btn.addEventListener('click', () => {
    playLine(btn, btn.dataset.text, speedInd);
  });
});
