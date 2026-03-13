import express from "express";
import { Innertube, UniversalCache } from "youtubei.js";

const app = express();

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
    youtube = await Innertube.create({
      lang: "ja",
      location: "JP",
      cache: new UniversalCache(false),
      generate_session_locally: true
    });
  }
  return youtube;
}

/* ---------------- Suggest ---------------- */

app.get("/api/suggest", async (req, res) => {
  const { q } = req.query;

  if (!q) return res.json([]);

  try {
    const url =
      "https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=" +
      encodeURIComponent(q);

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const text = await response.text();

    const match = text.match(/window\.google\.ac\.h\((.*)\)/);

    if (!match) return res.json([]);

    const data = JSON.parse(match[1]);

    const suggestions = data[1].map((s) => s[0]);

    res.json(suggestions);
  } catch {
    res.json([]);
  }
});

/* ---------------- Search ---------------- */

app.get("/api/search", async (req, res) => {
  try {
    const youtube = await getYoutube();

    const { q, page = "1" } = req.query;

    if (!q) return res.status(400).json({ error: "missing query" });

    const ITEMS = 40;

    const target = parseInt(page);

    let search = await youtube.search(q);

    let videos = [...(search.videos || [])];

    const need = target * ITEMS;

    while (videos.length < need && search.has_continuation) {
      search = await search.getContinuation();

      videos.push(...(search.videos || []));
    }

    const start = (target - 1) * ITEMS;
    const end = start + ITEMS;

    res.json({
      videos: videos.slice(start, end),
      nextPageToken:
        videos.length > end || search.has_continuation
          ? String(target + 1)
          : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- Video info ---------------- */

app.get("/api/video", async (req, res) => {
  try {
    const youtube = await getYoutube();

    const { id } = req.query;

    if (!id) return res.status(400).json({ error: "missing id" });

    const info = await youtube.getInfo(id);

    const formats = info.streaming_data?.adaptive_formats || [];

    const videoFormats = formats.filter((f) => f.mime_type?.includes("video"));

    const audioFormats = formats.filter((f) => f.mime_type?.includes("audio"));

    res.json({
      id: info.basic_info?.id,
      title: info.basic_info?.title,
      description: info.basic_info?.short_description,
      duration: info.basic_info?.duration,
      thumbnails: info.basic_info?.thumbnail,
      author: info.basic_info?.author,
      viewCount: info.basic_info?.view_count,

      dashManifest: info.streaming_data?.dash_manifest_url,
      hlsManifest: info.streaming_data?.hls_manifest_url,

      videoFormats,
      audioFormats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- 4K DASH manifest ---------------- */

app.get("/api/dash/:id", async (req, res) => {
  try {
    const youtube = await getYoutube();

    const info = await youtube.getInfo(req.params.id);

    const dash = info.streaming_data?.dash_manifest_url;

    if (!dash) {
      return res.status(404).json({ error: "no dash manifest" });
    }

    res.json({
      dash
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- HLS manifest ---------------- */

app.get("/api/hls/:id", async (req, res) => {
  try {
    const youtube = await getYoutube();

    const info = await youtube.getInfo(req.params.id);

    const hls = info.streaming_data?.hls_manifest_url;

    if (!hls) {
      return res.status(404).json({ error: "no hls manifest" });
    }

    res.json({
      hls
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- Comments ---------------- */

app.get("/api/comments", async (req, res) => {
  try {
    const youtube = await getYoutube();

    const { id } = req.query;

    if (!id) return res.status(400).json({ error: "missing id" });

    const comments = await youtube.getComments(id);

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
    const youtube = await getYoutube();

    const { id } = req.query;

    if (!id) return res.status(400).json({ error: "missing id" });

    const channel = await youtube.getChannel(id);

    const videosFeed = await channel.getVideos();

    res.json({
      channel: {
        id: channel.id,
        name: channel.metadata?.title,
        avatar: channel.metadata?.avatar?.[0]?.url,
        banner: channel.metadata?.banner?.[0]?.url,
        subscriberCount: channel.metadata?.subscriber_count?.pretty
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
    const youtube = await getYoutube();

    const { id } = req.query;

    const playlist = await youtube.getPlaylist(id);

    res.json(playlist);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- Home feed ---------------- */

app.get("/api/fvideo", async (req, res) => {
  try {
    const youtube = await getYoutube();

    const home = await youtube.getHomeFeed();

    res.json({
      videos: home.videos || home.items || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
