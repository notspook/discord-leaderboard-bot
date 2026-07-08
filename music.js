const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType
} = require("@discordjs/voice");

const playdl = require("play-dl");
const youtubedl = require("youtube-dl-exec");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const FFMPEG = require("ffmpeg-static");

const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      connection: null,
      player: null,
      tracks: [],
      current: null
    });
  }
  return queues.get(guildId);
}

async function expandUrl(url) {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    return res.url || url;
  } catch {
    return url;
  }
}

function httpsGetStream(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGetStream(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`CDN fetch failed: ${res.statusCode}`));
      resolve(res);
    }).on("error", reject);
  });
}

// Download a URL to a temp file, resolve when complete
function downloadToTemp(url) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `larpbot_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
    const file = fs.createWriteStream(tmpFile);
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(tmpFile, () => {});
        return downloadToTemp(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(tmpFile, () => {});
        return reject(new Error(`Download failed: ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve(tmpFile)));
      file.on("error", (e) => { fs.unlink(tmpFile, () => {}); reject(e); });
    }).on("error", (e) => { fs.unlink(tmpFile, () => {}); reject(e); });
  });
}

// Download YouTube audio via play-dl, return { path, type }
async function downloadYtdlToTemp(url) {
  try {
    const info = await playdl.stream(url, { quality: 0 });
    const ext = info.type === "opus" ? "opus" : "webm";
    const tmpFile = path.join(os.tmpdir(), `larpbot_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
    const writeStream = fs.createWriteStream(tmpFile);
    await new Promise((resolve, reject) => {
      info.stream.pipe(writeStream);
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
      info.stream.on("error", reject);
    });
    return { path: tmpFile, streamType: info.type };
  } catch (e) {
    console.log("[music] play-dl failed, falling back to yt-dlp:", e.message);
    const prefix = `larpbot_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await youtubedl(url, {
      output: path.join(os.tmpdir(), `${prefix}.%(ext)s`),
      format: "bestaudio/best",
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
    });
    const files = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(prefix));
    if (!files.length) throw new Error("yt-dlp produced no output");
    const dlPath = path.join(os.tmpdir(), files[0]);
    return { path: dlPath, streamType: "webm" };
  }
}

// Run a downloaded file through ffmpeg → clean ogg/opus, resolve with output path
function convertToOpus(inputPath) {
  return new Promise((resolve, reject) => {
    const outPath = inputPath.replace(/\.[^.]+$/, "") + "_opus.ogg";
    const ffmpeg = spawn(FFMPEG, [
      "-i", inputPath,
      "-ac", "2",
      "-ar", "48000",
      "-c:a", "libopus",
      "-b:a", "128k",
      "-vbr", "on",
      "-f", "ogg",
      "-vn",
      outPath,
      "-y",   // overwrite if exists
    ], { stdio: ["ignore", "ignore", "pipe"] });

    let errOut = "";
    ffmpeg.stderr.on("data", d => errOut += d.toString());
    ffmpeg.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${errOut.slice(0, 200)}`));
      resolve(outPath);
    });
    ffmpeg.on("error", reject);
  });
}

async function getSoundCloudCdnUrl(trackUrl) {
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID;

  const resolveRes = await fetch(
    `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(trackUrl)}&client_id=${clientId}`
  );
  if (!resolveRes.ok) throw new Error(`SC resolve failed: ${resolveRes.status}`);
  const trackData = await resolveRes.json();

  const media = trackData.media?.transcodings ?? [];
  const usable = media.filter(t => {
    const proto = t.format?.protocol ?? "";
    return (proto === "progressive" || proto === "hls") && !t.url?.includes("encrypted");
  });

  if (usable.length === 0) throw new Error("No unencrypted transcodings available.");

  const ordered = [
    ...usable.filter(t => t.format?.protocol === "progressive"),
    ...usable.filter(t => t.format?.protocol === "hls"),
  ];

  let lastErr = null;
  for (const transcoding of ordered) {
    try {
      const sep = transcoding.url.includes("?") ? "&" : "?";
      const streamRes = await fetch(`${transcoding.url}${sep}client_id=${clientId}`);
      if (!streamRes.ok) { lastErr = new Error(`SC endpoint ${streamRes.status}`); continue; }
      const body = await streamRes.json();
      if (!body.url) { lastErr = new Error("No URL in SC response"); continue; }
      return body.url;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All SC transcodings failed.");
}

async function resolveTrack(input) {
  if (input.includes("soundcloud.com")) {
    try {
      const fullUrl = await expandUrl(input);
      const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
      const res = await fetch(
        `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(fullUrl)}&client_id=${clientId}`
      );
      if (!res.ok) throw new Error(`SC resolve failed: ${res.status}`);
      const data = await res.json();
      return { type: "soundcloud", url: fullUrl, title: data.title || data.permalink || fullUrl };
    } catch (e) {
      throw new Error("Could not resolve SoundCloud track: " + e.message);
    }
  }

  try {
    if (input.includes("youtube.com") || input.includes("youtu.be")) {
      try {
        const info = await playdl.video_basic_info(input);
        return {
          type: "youtubedl",
          url: input,
          title: info.video_details.title,
          webpage_url: info.video_details.url
        };
      } catch (e1) {
        console.log("[music] play-dl video_basic_info failed:", e1.message);
        // fall back to yt-dlp metadata
        const out = await youtubedl(input, {
          dumpSingleJson: true,
          noCheckCertificates: true,
          noWarnings: true,
          preferFreeFormats: true
        });
        return {
          type: "youtubedl",
          url: out.webpage_url || input,
          title: out.title || "Unknown",
          webpage_url: out.webpage_url || input
        };
      }
    }
    const results = await playdl.search(input, { limit: 1 });
    if (!results.length) throw new Error("No results");
    return {
      type: "youtubedl",
      url: results[0].url,
      title: results[0].title,
      webpage_url: results[0].url
    };
  } catch (e) {
    console.log("[music] resolveTrack error:", e.message);
    throw new Error("Could not find track.");
  }
}

async function playNext(guildId, textChannel) {
  const queue = getQueue(guildId);

  if (queue.tracks.length === 0) {
    queue.current = null;
    setTimeout(() => {
      const q = queues.get(guildId);
      if (q && !q.current && q.connection) {
        q.connection.destroy();
        queues.delete(guildId);
      }
    }, 30000);
    return;
  }

  const track = queue.tracks.shift();
  queue.current = track;

  let tempFiles = []; // track temp files to clean up after playback

  try {
    let opusPath;

    if (track.type === "soundcloud") {
      textChannel.send(`⏳ Loading **${track.title}**...`).catch(() => {});
      const cdnUrl = await getSoundCloudCdnUrl(track.url);
      console.log("[music] SC downloading from CDN...");
      const rawPath = await downloadToTemp(cdnUrl);
      const rawSize = fs.statSync(rawPath).size;
      console.log(`[music] SC download complete: ${rawPath} (${(rawSize/1024).toFixed(1)}kb)`);
      tempFiles.push(rawPath);
      console.log("[music] SC converting to opus...");
      opusPath = await convertToOpus(rawPath);
      const opusSize = fs.statSync(opusPath).size;
      console.log(`[music] SC opus ready: ${opusPath} (${(opusSize/1024).toFixed(1)}kb)`);
      tempFiles.push(opusPath);

    } else if (track.type === "file") {
      const resource = createAudioResource(track.url, {
        inputType: StreamType.Arbitrary,
        inlineVolume: false
      });
      queue.player.play(resource);
      textChannel.send(`▶ Now playing: **${track.title}**`).catch(() => {});
      return;

    } else {
      textChannel.send(`⏳ Loading **${track.title}**...`).catch(() => {});
      console.log("[music] YT downloading...");
      const result = await downloadYtdlToTemp(track.url);
      const rawSize = fs.statSync(result.path).size;
      console.log(`[music] YT download complete: ${result.path} (${(rawSize/1024/1024).toFixed(2)}mb) type=${result.streamType}`);
      tempFiles.push(result.path);

      if (result.streamType === "opus") {
        opusPath = result.path;
      } else {
        console.log("[music] YT converting to opus...");
        opusPath = await convertToOpus(result.path);
        const opusSize = fs.statSync(opusPath).size;
        console.log(`[music] YT opus ready: ${opusPath} (${(opusSize/1024/1024).toFixed(2)}mb)`);
        tempFiles.push(opusPath);
      }
    }

    // Verify the file is valid before playing
    const finalSize = fs.statSync(opusPath).size;
    if (finalSize === 0) throw new Error("Converted opus file is empty.");

    const resource = createAudioResource(opusPath, {
      inputType: StreamType.OggOpus,
      inlineVolume: false
    });

    resource.playStream.on("close", () => {
      tempFiles.forEach(f => fs.unlink(f, () => {}));
    });

    queue.player.play(resource);
    textChannel.send(`▶ Now playing: **${track.title}**`).catch(() => {});

  } catch (err) {
    console.error("[music] Playback error:", err.message);
    tempFiles.forEach(f => fs.unlink(f, () => {}));
    textChannel.send(`❌ Failed to play **${track.title}**, skipping...`).catch(() => {});
    playNext(guildId, textChannel);
  }
}

async function handleMusic(msg, args) {
  const guild = msg.guild;
  const member = msg.member;
  const textChannel = msg.channel;
  const sub = args[0]?.toLowerCase();

  if (sub === "stop") {
    const queue = queues.get(guild.id);
    if (!queue) return msg.reply("Nothing is playing.");
    queue.tracks = [];
    queue.current = null;
    queue.player?.stop();
    queue.connection?.destroy();
    queues.delete(guild.id);
    return msg.reply("⏹ Stopped and left VC.");
  }

  if (sub === "skip") {
    const queue = queues.get(guild.id);
    if (!queue?.current) return msg.reply("Nothing is playing.");
    queue.player.stop();
    return msg.reply("⏭ Skipped.");
  }

  if (sub === "queue") {
    const queue = queues.get(guild.id);
    if (!queue?.current && !queue?.tracks?.length) return msg.reply("Queue is empty.");
    const lines = [];
    if (queue.current) lines.push(`▶ **Now:** ${queue.current.title}`);
    queue.tracks.forEach((t, i) => lines.push(`${i + 1}. ${t.title}`));
    return msg.reply(lines.join("\n") || "Queue is empty.");
  }

  if (sub === "pause") {
    const queue = queues.get(guild.id);
    if (!queue?.player) return msg.reply("Nothing is playing.");
    queue.player.pause();
    return msg.reply("⏸ Paused.");
  }

  if (sub === "resume") {
    const queue = queues.get(guild.id);
    if (!queue?.player) return msg.reply("Nothing is playing.");
    queue.player.unpause();
    return msg.reply("▶ Resumed.");
  }

  if (sub === "play") {
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) return msg.reply("You need to be in a voice channel.");

    const botMember = guild.members.cache.get(msg.client.user.id);
    const perms = voiceChannel.permissionsFor(botMember);
    if (!perms.has("Connect") || !perms.has("Speak")) {
      return msg.reply("I don't have permission to join that voice channel.");
    }

    let track = null;

    if (msg.attachments.size > 0) {
      const attachment = msg.attachments.first();
      if (!attachment.contentType?.startsWith("audio/")) {
        return msg.reply("Please attach an audio file.");
      }
      track = { type: "file", url: attachment.url, title: attachment.name };
    } else {
      const input = args.slice(1).join(" ").trim();
      if (!input) return msg.reply("Usage: `!music play <url or search terms>`");

      const searching = await msg.reply("🔍 Searching...");
      try {
        track = await resolveTrack(input);
      } catch (e) {
        await searching.delete().catch(() => {});
        return msg.reply(`❌ ${e.message}`);
      }
      await searching.delete().catch(() => {});
    }

    const queue = getQueue(guild.id);

    if (!queue.connection) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator
      });

      const player = createAudioPlayer();
      connection.subscribe(player);
      queue.connection = connection;
      queue.player = player;

      player.on(AudioPlayerStatus.Idle, () => playNext(guild.id, textChannel));
      player.on("error", err => {
        console.error("[music] Player error:", err.message);
        textChannel.send("❌ Playback error, skipping...").catch(() => {});
        playNext(guild.id, textChannel);
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5000)
          ]);
        } catch {
          queues.delete(guild.id);
          connection.destroy();
        }
      });
    }

    queue.tracks.push(track);

    if (queue.current) {
      return msg.reply(`✅ Added to queue: **${track.title}**`);
    } else {
      playNext(guild.id, textChannel);
    }
    return;
  }

  return msg.reply(
    "🎵 **Music Commands**\n" +
    "`!music play <soundcloud/youtube url or search>` — play a track\n" +
    "`!music play` + attach audio file — play a file\n" +
    "`!music skip` — skip current track\n" +
    "`!music stop` — stop and leave VC\n" +
    "`!music pause` — pause\n" +
    "`!music resume` — resume\n" +
    "`!music queue` — show queue"
  );
}

module.exports = { handleMusic };
