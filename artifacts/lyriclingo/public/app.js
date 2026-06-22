// LyricLingo — vanilla JS frontend

const BASE = '/api';

// DOM refs
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const langSelect = document.getElementById('lang-select');
const heroContent = document.getElementById('hero-content');
const featuresSection = document.getElementById('features-section');
const resultsSection = document.getElementById('results-section');
const resultsList = document.getElementById('results-list');
const lyricsSection = document.getElementById('lyrics-section');
const lyricsList = document.getElementById('lyrics-list');
const lyricsLoading = document.getElementById('lyrics-loading');
const lyricsError = document.getElementById('lyrics-error');
const globalLoading = document.getElementById('global-loading');
const globalError = document.getElementById('global-error');
const backBtn = document.getElementById('back-btn');
const playAllBtn = document.getElementById('play-all-btn');
const navLogoBtn = document.getElementById('nav-logo-btn');
const songCover = document.getElementById('song-cover');
const songTitle = document.getElementById('song-title');
const songArtist = document.getElementById('song-artist');
const audioIndicator = document.getElementById('audio-indicator');

let currentAudio = null;
let currentTrack = null;
let playingLine = null;

// ── Play All state ──
let lineEls = [];        // { el, text }[] — repopulated on each renderLyrics
let playAllSession = 0;  // incremented on every start/stop to cancel orphaned chains
let playAllActive = false;
let playAllResolve = null; // lets stopAudio() unblock a mid-playback await

// ── Utilities ──

function show(el) { el.style.display = ''; }
function hide(el) { el.style.display = 'none'; }

function showError(el, msg) {
  el.textContent = msg;
  show(el);
}

async function apiFetch(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// ── Search ──

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;

  hide(resultsSection);
  hide(lyricsSection);
  hide(globalError);
  show(globalLoading);

  try {
    const tracks = await apiFetch(`/search?q=${encodeURIComponent(q)}`);
    hide(globalLoading);
    renderResults(tracks);
  } catch (err) {
    hide(globalLoading);
    showError(globalError, `Search failed: ${err.message}`);
  }
});

function showHome() {
  stopAudio();
  show(heroContent);
  show(featuresSection);
  hide(resultsSection);
  hide(lyricsSection);
  hide(globalLoading);
  hide(globalError);
  searchInput.value = '';
  currentTrack = null;
  lineEls = [];
}

navLogoBtn.addEventListener('click', showHome);

function renderResults(tracks) {
  // Collapse hero on first search
  hide(heroContent);
  hide(featuresSection);
  resultsList.innerHTML = '';

  if (!tracks.length) {
    showError(globalError, 'No results found. Try a different search.');
    return;
  }

  for (const track of tracks) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'track-item';
    btn.setAttribute('role', 'listitem');

    const coverEl = track.cover
      ? `<img class="track-cover" src="${escHtml(track.cover)}" alt="" width="48" height="48" loading="lazy" />`
      : `<div class="track-cover no-cover" aria-hidden="true">♪</div>`;

    btn.innerHTML = `
      ${coverEl}
      <div class="track-info">
        <div class="track-title">${escHtml(track.title)}</div>
        <div class="track-artist">${escHtml(track.artist)}</div>
      </div>
    `;

    btn.addEventListener('click', () => loadLyrics(track));
    li.appendChild(btn);
    resultsList.appendChild(li);
  }

  show(resultsSection);
}

// ── Lyrics ──

async function loadLyrics(track) {
  stopAudio(); // also resets Play All if active
  currentTrack = track;

  songCover.src = track.cover || '';
  songCover.style.display = track.cover ? '' : 'none';
  songTitle.textContent = track.title;
  songArtist.textContent = track.artist;

  hide(resultsSection);
  lyricsList.innerHTML = '';
  lineEls = [];
  hide(lyricsError);
  show(lyricsLoading);
  show(lyricsSection);

  try {
    const lang = langSelect.value;
    const lyricsData = await apiFetch(
      `/lyrics?track_id=${track.id}&lang=${encodeURIComponent(lang)}`
    );

    // Use Musixmatch translation if /api/lyrics already found one;
    // otherwise call /api/translate for the keyless fallback.
    let translationLines = lyricsData.translationLines || [];
    if (translationLines.length === 0 && lang) {
      try {
        const tRes = await fetch(`${BASE}/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            track_id: String(track.id),
            lang,
            lines: (lyricsData.lines || []).map((l) => l.text),
          }),
        });
        if (tRes.ok) {
          const tData = await tRes.json();
          translationLines = tData.lines || [];
        }
      } catch { /* silently ignore — show lyrics without translation */ }
    }

    hide(lyricsLoading);
    renderLyrics(lyricsData.lines, translationLines, lyricsData.synced);
  } catch (err) {
    hide(lyricsLoading);
    showError(lyricsError, `Could not load lyrics: ${err.message}`);
  }
}

// Re-fetch with new language when dropdown changes (lyrics already open)
langSelect.addEventListener('change', () => {
  if (currentTrack && lyricsSection.style.display !== 'none') {
    loadLyrics(currentTrack);
  }
});

function renderLyrics(origLines, transLines, synced) {
  lyricsList.innerHTML = '';
  lineEls = [];

  if (!origLines.length) {
    showError(lyricsError, 'No lyrics available for this track.');
    return;
  }

  // Time-synced badge
  if (synced) {
    const badge = document.createElement('div');
    badge.className = 'synced-badge';
    badge.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/>
      </svg>
      Time-synced lyrics
    `;
    lyricsList.appendChild(badge);
  }

  origLines.forEach((line, i) => {
    const translation = transLines[i] || '';
    const div = document.createElement('div');
    div.className = 'lyric-line';
    div.setAttribute('role', 'listitem');
    div.tabIndex = 0;
    div.title = 'Click to hear this line';

    div.innerHTML = `
      <div class="lyric-original">${escHtml(line.text)}</div>
      ${translation ? `<div class="lyric-translation">${escHtml(translation)}</div>` : ''}
    `;

    // Always speak the original line via ElevenLabs
    const playThis = () => playLine(div, line.text);
    div.addEventListener('click', playThis);
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playThis(); }
    });

    lyricsList.appendChild(div);
    lineEls.push({ el: div, text: line.text });
  });
}

// ── TTS / Audio (ElevenLabs) ──

async function playLine(el, text) {
  if (playingLine === el && currentAudio && !currentAudio.paused) {
    stopAudio();
    return;
  }

  stopAudio();
  playingLine = el;
  el.classList.add('active');
  show(audioIndicator);

  try {
    const res = await fetch(`${BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `TTS request failed (${res.status})`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    currentAudio = new Audio(url);
    el.classList.add('playing');

    currentAudio.addEventListener('ended', () => {
      el.classList.remove('playing', 'active');
      hide(audioIndicator);
      URL.revokeObjectURL(url);
      currentAudio = null;
      playingLine = null;
    });

    currentAudio.addEventListener('error', () => {
      el.classList.remove('playing', 'active');
      hide(audioIndicator);
    });

    await currentAudio.play();
  } catch (err) {
    el.classList.remove('active', 'playing');
    hide(audioIndicator);
    showError(globalError, `Audio failed: ${err.message}`);
    setTimeout(() => hide(globalError), 4000);
  }
}

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (playingLine) {
    playingLine.classList.remove('active', 'playing');
    playingLine = null;
  }
  hide(audioIndicator);
  // Unblock any mid-playback await in playLineForChain
  if (playAllResolve) {
    const resolve = playAllResolve;
    playAllResolve = null;
    resolve();
  }
  // Cancel the Play All chain and reset button
  if (playAllActive) {
    playAllSession++;
    playAllActive = false;
    setPlayAllBtn(false);
  }
}

// ── Play All ──

function setPlayAllBtn(active) {
  if (active) {
    playAllBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12"/>
      </svg>
      Stop
    `;
    playAllBtn.classList.add('playing');
    playAllBtn.setAttribute('aria-label', 'Stop playback');
  } else {
    playAllBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z"/>
      </svg>
      Play All
    `;
    playAllBtn.classList.remove('playing');
    playAllBtn.setAttribute('aria-label', 'Play all lines aloud');
  }
}

playAllBtn.addEventListener('click', () => {
  if (playAllActive) {
    stopAudio(); // stopAudio handles the reset
  } else {
    playAll();
  }
});

async function playAll() {
  if (!lineEls.length) return;

  stopAudio();           // clear any single-line playback first
  playAllActive = true;
  playAllSession++;
  const session = playAllSession;
  setPlayAllBtn(true);

  for (let i = 0; i < lineEls.length; i++) {
    if (playAllSession !== session) break;

    const { el, text } = lineEls[i];
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    await playLineForChain(el, text, session);

    if (playAllSession !== session) break;
  }

  // Only reset if no newer session has taken over
  if (playAllSession === session) {
    playAllActive = false;
    setPlayAllBtn(false);
  }
}

async function playLineForChain(el, text, session) {
  if (playAllSession !== session) return;

  playingLine = el;
  el.classList.add('active');
  show(audioIndicator);

  let res;
  try {
    res = await fetch(`${BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch {
    el.classList.remove('active');
    if (playingLine === el) { playingLine = null; hide(audioIndicator); }
    return;
  }

  if (playAllSession !== session || !res.ok) {
    el.classList.remove('active');
    if (playingLine === el) { playingLine = null; hide(audioIndicator); }
    return;
  }

  let blob;
  try {
    blob = await res.blob();
  } catch {
    el.classList.remove('active');
    if (playingLine === el) { playingLine = null; hide(audioIndicator); }
    return;
  }

  if (playAllSession !== session) {
    el.classList.remove('active');
    if (playingLine === el) { playingLine = null; hide(audioIndicator); }
    return;
  }

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  el.classList.add('playing');

  await new Promise((resolve) => {
    playAllResolve = resolve;

    audio.addEventListener('ended', () => {
      playAllResolve = null;
      resolve();
    });
    audio.addEventListener('error', () => {
      playAllResolve = null;
      resolve();
    });
    audio.play().catch(() => {
      playAllResolve = null;
      resolve();
    });
  });

  el.classList.remove('playing', 'active');
  if (playingLine === el) playingLine = null;
  if (currentAudio === audio) {
    currentAudio = null;
    hide(audioIndicator);
  }
  URL.revokeObjectURL(url);
}

// ── Back button ──

backBtn.addEventListener('click', () => {
  stopAudio();
  hide(lyricsSection);
  show(resultsSection);
});

// ── XSS safety ──

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
