import { Router, type IRouter } from "express";

const router: IRouter = Router();

const MUSIXMATCH_BASE =
  process.env["MUSIXMATCH_BASE"] ?? "https://api.musixmatch.com/ws/1.1";
const MUSIXMATCH_API_KEY = process.env["MUSIXMATCH_API_KEY"] ?? "";
const ELEVENLABS_API_KEY = process.env["ELEVENLABS_API_KEY"] ?? "";

function mmUrl(method: string, params: Record<string, string>): string {
  const url = new URL(`${MUSIXMATCH_BASE}/${method}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("apikey", MUSIXMATCH_API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

async function mmFetch(method: string, params: Record<string, string>) {
  const res = await fetch(mmUrl(method, params));
  const json = (await res.json()) as {
    message: { header: { status_code: number }; body: unknown };
  };
  const status = json.message.header.status_code;
  if (status !== 200) {
    throw Object.assign(new Error(`Musixmatch error ${status}`), { status });
  }
  return json.message.body;
}

function splitLyricsBody(raw: string): string[] {
  const disclaimerMarker = "******* This Lyrics is NOT for Commercial use *******";
  const clean = raw.includes(disclaimerMarker)
    ? raw.substring(0, raw.indexOf(disclaimerMarker))
    : raw;
  return clean.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

// ── In-memory translation cache: "track_id:lang" → translated lines ──
const translationCache = new Map<string, string[]>();

// GET /api/health
router.get("/health", (_req, res) => {
  res.json({
    musixmatch: Boolean(MUSIXMATCH_API_KEY),
    elevenlabs: Boolean(ELEVENLABS_API_KEY),
  });
});

// GET /api/search?q=
router.get("/search", async (req, res) => {
  try {
    const q = String(req.query["q"] ?? "");
    const body = (await mmFetch("track.search", {
      q_track_artist: q,
      f_has_lyrics: "1",
      s_track_rating: "desc",
      page_size: "8",
    })) as { track_list: { track: { track_id: number; track_name: string; artist_name: string; album_coverart_100x100: string } }[] };

    const tracks = (body.track_list ?? []).map(
      (t: { track: { track_id: number; track_name: string; artist_name: string; album_coverart_100x100: string } }) => ({
        id: t.track.track_id,
        title: t.track.track_name,
        artist: t.track.artist_name,
        cover: t.track.album_coverart_100x100,
      }),
    );
    res.json(tracks);
  } catch (err) {
    req.log.error(err);
    res.status(502).json({ error: "Search failed" });
  }
});

// GET /api/lyrics?track_id=&lang=
// Returns plain lyrics lines paired with Musixmatch translation lines (when available).
// Also checks for time-synced subtitles to set the `synced` flag.
router.get("/lyrics", async (req, res) => {
  try {
    const track_id = String(req.query["track_id"] ?? "");
    const lang = String(req.query["lang"] ?? "").toLowerCase().trim();

    // Fetch plain lyrics (always — used for display and pairing with translation)
    const lyricsBody = (await mmFetch("track.lyrics.get", { track_id })) as {
      lyrics: { lyrics_body: string };
    };
    const origLines = splitLyricsBody(lyricsBody.lyrics.lyrics_body ?? "");

    // Check for time-synced subtitles (for the badge only)
    let synced = false;
    try {
      await mmFetch("track.subtitle.get", { track_id, subtitle_format: "lrc" });
      synced = true;
    } catch {
      // no subtitles — that's fine
    }

    // Fetch Musixmatch translation when a non-English language is requested
    let translationLines: string[] = [];
    if (lang && lang !== "en") {
      try {
        const tBody = (await mmFetch("track.lyrics.translation.get", {
          track_id,
          selected_language: lang,
        })) as { lyrics: { lyrics_body: string } };

        const tLines = splitLyricsBody(tBody.lyrics.lyrics_body ?? "");

        // Only use if at least one line differs from the original
        const hasDiff = tLines.some((l, i) => l !== origLines[i]);
        if (hasDiff) {
          translationLines = tLines;
        }
      } catch {
        // No translation available — silently omit
      }
    }

    const lines = origLines.map((text, i) => ({ text, t: i }));

    res.json({ synced, lines, translationLines });
  } catch (err) {
    req.log.error(err);
    res.status(502).json({ error: "Lyrics fetch failed" });
  }
});

// POST /api/translate  { track_id, lang, lines: string[] }
// Order: (1) Musixmatch track.lyrics.translation.get  (2) keyless Google fallback
// NEVER throws or returns non-200; silently falls back to original text on any error.
router.post("/translate", async (req, res) => {
  const fallbackLines: string[] = [];
  try {
    const {
      track_id = "",
      lang = "",
      lines = [],
    } = req.body as { track_id?: string; lang?: string; lines?: string[] };

    const safeLines = Array.isArray(lines) ? lines.map(String) : [];
    fallbackLines.push(...safeLines);
    const safeLang = String(lang).toLowerCase().trim();

    if (safeLines.length === 0 || !safeLang || safeLang === "en") {
      res.json({ lines: safeLines });
      return;
    }

    const cacheKey = `${track_id}:${safeLang}`;
    if (track_id && translationCache.has(cacheKey)) {
      res.json({ lines: translationCache.get(cacheKey)! });
      return;
    }

    let translated: string[] = [];

    // ── Step 1: Musixmatch translation ──
    if (track_id) {
      try {
        const tBody = (await mmFetch("track.lyrics.translation.get", {
          track_id,
          selected_language: safeLang,
        })) as { lyrics: { lyrics_body: string } };
        const tLines = splitLyricsBody(tBody.lyrics.lyrics_body ?? "");
        if (tLines.some((l, i) => l !== safeLines[i])) {
          translated = tLines;
        }
      } catch { /* fall through to keyless fallback */ }
    }

    // ── Step 2: keyless Google unofficial API fallback ──
    if (translated.length === 0) {
      try {
        const BATCH = 25;
        const result: string[] = [];
        for (let i = 0; i < safeLines.length; i += BATCH) {
          const batch = safeLines.slice(i, i + BATCH);
          try {
            const q = batch.join("\n");
            const url =
              `https://translate.googleapis.com/translate_a/single` +
              `?client=gtx&sl=auto&tl=${encodeURIComponent(safeLang)}` +
              `&dt=t&q=${encodeURIComponent(q)}`;
            const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
            if (!r.ok) throw new Error(`status ${r.status}`);
            const json = (await r.json()) as [[string][]] | unknown;
            if (!Array.isArray(json) || !Array.isArray(json[0])) throw new Error("bad shape");
            const pieces = (json[0] as [string][]).map((p) => p[0]);
            const full = pieces.join("").split("\n");
            while (full.length < batch.length) full.push(batch[full.length] ?? "");
            result.push(...full.slice(0, batch.length));
          } catch {
            result.push(...batch); // keep originals for this batch on any error/timeout
          }
        }
        if (result.some((l, i) => l !== safeLines[i])) translated = result;
      } catch { /* silently ignore */ }
    }

    if (translated.length === 0) translated = safeLines; // final fallback: originals
    if (track_id) translationCache.set(cacheKey, translated);
    res.json({ lines: translated });
  } catch {
    res.json({ lines: fallbackLines }); // outermost guard — always 200
  }
});

// POST /api/tts  { text }
router.post("/tts", async (req, res) => {
  try {
    const text = String((req.body as { text?: string }).text ?? "").trim();
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    const ttsRes = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM",
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );

    if (!ttsRes.ok) {
      const msg = await ttsRes.text();
      req.log.error({ status: ttsRes.status, msg }, "ElevenLabs TTS error");
      res.status(502).json({ error: "TTS failed" });
      return;
    }

    const buf = Buffer.from(await ttsRes.arrayBuffer());
    res.set("Content-Type", "audio/mpeg");
    res.send(buf);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "TTS internal error" });
  }
});

export default router;
