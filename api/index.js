import express from "express";
import { Innertube, UniversalCache } from "youtubei.js";

const app = express();
const port = 3000;

app.use(express.json());

/* ---------------- CORS ---------------- */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  next();
});

/* ---------------- Youtube instance ---------------- */
let youtube;

async function getYoutube() {
  if (!youtube) {
    // ⚠注意: YouTubeの最新制限により、サーバーのIPによってはこれだけでは
    // ストリーミングURLが取得できない(403)場合があります。
    // その場合は、ブラウザから取得したCookieをオプションに追加してください。
    youtube = await Innertube.create({
      lang: "ja",
      location: "JP",
      cache: new UniversalCache(false),
      generate_session_locally: true,
      fetch: (input, init) => fetch(input, init), // Node.js 18+ の fetch を使用
    });
  }
  return youtube;
}

/* ---------------- Suggest ---------------- */
app.get("/api/suggest", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);

  try {
    const url = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(q)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const text = await response.text();
    const match = text.match(/window\.google\.ac\.h\((.*)\)/);

    if (!match) return res.json([]);
    const data = JSON.parse(match[1]);
    const suggestions = data[1].map((s) => s[0]);
    res.json(suggestions);
  } catch (err) {
    res.json([]);
  }
});

/* ---------------- Search ---------------- */
app.get("/api/search", async (req, res) => {
  try {
    const yt = await getYoutube();
    const { q, page = "1" } = req.query;
    if (!q) return res.status(400).json({ error: "missing query" });

    const ITEMS_PER_PAGE = 40;
    const targetPage = parseInt(page);
    let search = await yt.search(q);
    let videos = [...(search.videos || [])];

    const needCount = targetPage * ITEMS_PER_PAGE;
    while (videos.length < needCount && search.has_continuation) {
      search = await search.getContinuation();
      videos.push(...(search.videos || []));
    }

    const start = (targetPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;

    res.json({
      videos: videos.slice(start, end),
      nextPageToken: (videos.length > end || search.has_continuation) ? String(targetPage + 1) : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- Video info (DASH/HLS/Formats) ---------------- */
app.get("/api/video", async (req, res) => {
  try {
    const yt = await getYoutube();
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "missing id" });

    // 重要なポイント: getInfo() で詳細情報を取得
    const info = await yt.getInfo(id);

    // DASHとHLSのURLをメソッド経由で取得（これが一番確実です）
    const dashManifest = info.getDashManifestUrl();
    const hlsManifest = info.getHlsManifestUrl();

    // 全てのストリーミング形式を取得（URLが含まれるように処理される）
    const streamingData = info.streaming_data;
    const videoFormats = streamingData?.adaptive_formats.filter(f => f.has_video && !f.has_audio) || [];
    const audioFormats = streamingData?.adaptive_formats.filter(f => f.has_audio && !f.has_video) || [];
    const mixedFormats = streamingData?.formats || []; // 音声ビデオ合体済み

    res.json({
      id: info.basic_info.id,
      title: info.basic_info.title,
      description: info.basic_info.short_description,
      duration: info.basic_info.duration,
      thumbnails: info.basic_info.thumbnail,
      author: info.basic_info.author,
      viewCount: info.basic_info.view_count,
      
      dashManifest,
      hlsManifest,
      
      videoFormats,
      audioFormats,
      mixedFormats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- 4K DASH manifest ---------------- */
app.get("/api/dash/:id", async (req, res) => {
  try {
    const yt = await getYoutube();
    const info = await yt.getInfo(req.params.id);
    const dash = info.getDashManifestUrl();

    if (!dash) return res.status(404).json({ error: "no dash manifest" });
    res.json({ dash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- HLS manifest ---------------- */
app.get("/api/hls/:id", async (req, res) => {
  try {
    const yt = await getYoutube();
    const info = await yt.getInfo(req.params.id);
    const hls = info.getHlsManifestUrl();

    if (!hls) return res.status(404).json({ error: "no hls manifest" });
    res.json({ hls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- Comments ---------------- */
app.get("/api/comments", async (req, res) => {
  try {
    const yt = await getYoutube();
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "missing id" });

    const comments = await yt.getComments(id);
    res.json({
      comments: comments.contents || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- Channel ---------------- */
app.get("/api/channel", async (req, res) => {
  try {
    const yt = await getYoutube();
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "missing id" });

    const channel = await yt.getChannel(id);
    const videosFeed = await channel.getVideos();

    res.json({
      channel: {
        id: channel.metadata.id,
        name: channel.metadata.title,
        avatar: channel.metadata.avatar,
        banner: channel.metadata.banner,
        subscriberCount: channel.metadata.subscriber_count
      },
      videos: videosFeed.videos || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- Playlist ---------------- */
app.get("/api/playlist", async (req, res) => {
  try {
    const yt = await getYoutube();
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "missing id" });

    const playlist = await yt.getPlaylist(id);
    res.json(playlist);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- Home feed ---------------- */
app.get("/api/fvideo", async (req, res) => {
  try {
    const yt = await getYoutube();
    const home = await yt.getHomeFeed();
    res.json({
      videos: home.videos || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ローカル実行用
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

export default app;
