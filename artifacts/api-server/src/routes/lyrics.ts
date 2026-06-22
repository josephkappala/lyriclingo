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

// GET /api/lyrics?track_id=
router.get("/lyrics", async (req, res) => {
  try {
    const track_id = String(req.query["track_id"] ?? "");

    // Try time-synced subtitles first
    try {
      const body = (await mmFetch("track.subtitle.get", {
        track_id,
        subtitle_format: "lrc",
      })) as { subtitle: { subtitle_body: string } };

      const raw = body.subtitle.subtitle_body;
      let lines: { text: string; t: number }[] = [];

      try {
        const parsed = JSON.parse(raw) as { text: string; time: { total: number } }[];
        lines = parsed
          .filter((l) => l.text && l.text.trim())
          .map((l) => ({ text: l.text, t: l.time.total }));
      } catch {
        // subtitle_body might be LRC format
        lines = raw
          .split("\n")
          .map((line) => {
            const m = line.match(/^\[(\d+):(\d+\.\d+)\](.*)/);
            if (!m) return null;
            const t = parseInt(m[1]!) * 60 + parseFloat(m[2]!);
            const text = m[3]!.trim();
            return text ? { text, t } : null;
          })
          .filter(Boolean) as { text: string; t: number }[];
      }

      if (lines.length > 0) {
        res.json({ synced: true, lines });
        return;
      }
    } catch {
      // fall through to plain lyrics
    }

    // Fall back to plain lyrics
    const body = (await mmFetch("track.lyrics.get", { track_id })) as {
      lyrics: { lyrics_body: string };
    };
    const raw = body.lyrics.lyrics_body ?? "";
    const disclaimerMarker = "******* This Lyrics is NOT for Commercial use *******";
    const clean = raw.includes(disclaimerMarker)
      ? raw.substring(0, raw.indexOf(disclaimerMarker))
      : raw;

    const lines2 = clean
      .split("\n")
      .map((l, i) => ({ text: l.trim(), t: i }))
      .filter((l) => l.text);

    res.json({ synced: false, lines: lines2 });
    return;
  } catch (err) {
    req.log.error(err);
    res.status(502).json({ error: "Lyrics fetch failed" });
  }
});

// GET /api/translate?track_id=&lang=
router.get("/translate", async (req, res) => {
  try {
    const track_id = String(req.query["track_id"] ?? "");
    const lang = String(req.query["lang"] ?? "en");

    try {
      const body = (await mmFetch("track.lyrics.translation.get", {
        track_id,
        selected_language: lang,
        min_completed: "0.4",
      })) as { lyrics: { lyrics_body: string } };

      const raw = body.lyrics.lyrics_body ?? "";
      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
      res.json({ lines });
    } catch {
      res.json({ lines: [] });
    }
  } catch (err) {
    req.log.error(err);
    res.status(502).json({ error: "Translation fetch failed" });
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
