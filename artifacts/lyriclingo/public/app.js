// LyricLingo — vanilla JS frontend

const BASE = '/api';

// DOM refs
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const langSelect = document.getElementById('lang-select');
const resultsSection = document.getElementById('results-section');
const resultsList = document.getElementById('results-list');
const lyricsSection = document.getElementById('lyrics-section');
const lyricsList = document.getElementById('lyrics-list');
const lyricsLoading = document.getElementById('lyrics-loading');
const lyricsError = document.getElementById('lyrics-error');
const globalLoading = document.getElementById('global-loading');
const globalError = document.getElementById('global-error');
const backBtn = document.getElementById('back-btn');
const songCover = document.getElementById('song-cover');
const songTitle = document.getElementById('song-title');
const songArtist = document.getElementById('song-artist');
const audioIndicator = document.getElementById('audio-indicator');

let currentAudio = null;
let currentTrack = null;
let playingLine = null;
let currentOrigLines = [];  // cache for re-translation on lang change

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

function renderResults(tracks) {
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
  stopAudio();
  currentTrack = track;
  currentOrigLines = [];

  songCover.src = track.cover || '';
  songCover.style.display = track.cover ? '' : 'none';
  songTitle.textContent = track.title;
  songArtist.textContent = track.artist;

  hide(resultsSection);
  lyricsList.innerHTML = '';
  hide(lyricsError);
  show(lyricsLoading);
  show(lyricsSection);

  try {
    const lyricsData = await apiFetch(`/lyrics?track_id=${track.id}`);
    currentOrigLines = lyricsData.lines || [];

    const translationLines = await translateLines(currentOrigLines.map((l) => l.text));

    hide(lyricsLoading);
    renderLyrics(currentOrigLines, translationLines, lyricsData.synced);
  } catch (err) {
    hide(lyricsLoading);
    showError(lyricsError, `Could not load lyrics: ${err.message}`);
  }
}

async function translateLines(texts) {
  const lang = langSelect.value;
  if (!texts.length || !lang || lang === 'en') return [];
  try {
    const tRes = await fetch(`${BASE}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: texts, to: lang }),
    });
    if (tRes.ok) {
      const tData = await tRes.json();
      return tData.lines || [];
    }
  } catch { /* fall through */ }
  return [];
}

// Re-translate when language changes while lyrics are visible
langSelect.addEventListener('change', async () => {
  if (!currentOrigLines.length || lyricsSection.style.display === 'none') return;
  const translationLines = await translateLines(currentOrigLines.map((l) => l.text));
  const synced = lyricsList.dataset.synced === 'true';
  renderLyrics(currentOrigLines, translationLines, synced);
});

function renderLyrics(origLines, transLines, synced) {
  lyricsList.innerHTML = '';
  lyricsList.dataset.synced = String(Boolean(synced));

  if (!origLines.length) {
    showError(lyricsError, 'No lyrics available for this track.');
    return;
  }

  // Synced badge
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

    const hasTranslation = Boolean(translation && translation !== line.text);
    div.title = hasTranslation
      ? 'Click to hear the translation spoken aloud'
      : 'Click to hear this line';

    div.innerHTML = `
      <div class="lyric-original">${escHtml(line.text)}</div>
      ${hasTranslation ? `<div class="lyric-translation">
        <span class="lyric-translation-text">${escHtml(translation)}</span>
        <span class="play-hint" aria-hidden="true">▶</span>
      </div>` : ''}
    `;

    // Speak translation if available, otherwise speak original
    const textToSpeak = hasTranslation ? translation : line.text;
    const playThis = () => playLine(div, textToSpeak);
    div.addEventListener('click', playThis);
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playThis(); }
    });

    lyricsList.appendChild(div);
  });
}

// ── TTS / Audio ──

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
