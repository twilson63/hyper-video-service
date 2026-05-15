import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { mkdir, writeFile, unlink, stat, readFile } from 'fs/promises';
import { join } from 'path';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Task storage (in-memory for single instance, use Redis/DB for multi-instance)
const tasks = new Map();

// Directories
const COMPOSITIONS_DIR = process.env.COMPOSITIONS_DIR || join(process.cwd(), 'compositions');
const OUTPUTS_DIR = process.env.OUTPUTS_DIR || join(process.cwd(), 'outputs');
const TEMPLATES_DIR = process.env.TEMPLATES_DIR || join(process.cwd(), 'templates');
const NARRATION_DIR = process.env.NARRATION_DIR || join(process.cwd(), 'narrations');

// ElevenLabs
const ELEVEN_LABS_API_KEY = process.env.ELEVEN_LABS_API_KEY;
const ELEVEN_LABS_BASE_URL = 'https://api.elevenlabs.io/v1';

// Ensure directories exist
await mkdir(COMPOSITIONS_DIR, { recursive: true });
await mkdir(OUTPUTS_DIR, { recursive: true });
await mkdir(TEMPLATES_DIR, { recursive: true });
await mkdir(NARRATION_DIR, { recursive: true });

// API Key authentication
const API_KEY = process.env.HYPER_VIDEO_API_KEY;

function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const auth = req.headers['authorization'];
  const key = req.headers['x-api-key'];
  const queryKey = req.query?.apiKey;
  if (auth === `Bearer ${API_KEY}` || key === API_KEY || queryKey === API_KEY) return next();
  res.status(401).json({ error: 'Unauthorized. Set Authorization: Bearer <key> or X-API-Key header.' });
}

// Create MCP server factory
function getServer() {
  const server = new McpServer({
    name: 'hyper-video-service',
    version: '0.1.0',
  });

  server.tool(
    'generate_video',
    `Generate a video from a text prompt. The service creates a HyperFrames composition (HTML+GSAP), renders it to MP4 using headless Chrome, and returns a download URL when done.

Styles: "dark" (dark background, light text), "light" (white background), "minimal" (clean, minimal), "bold" (large typography, high contrast).

Durations: 5-60 seconds. Default is 15.
Sizes: 1920x1080 (landscape), 1080x1920 (portrait/vertical), 1080x1080 (square).`,
    {
      prompt: z.string().describe('Description of the video to generate. Be specific about scenes, text, transitions, and style.'),
      duration: z.number().default(15).describe('Duration in seconds (default: 15)'),
      width: z.number().default(1920).describe('Video width in pixels (default: 1920)'),
      height: z.number().default(1080).describe('Video height in pixels (default: 1080)'),
      style: z.enum(['dark', 'light', 'minimal', 'bold']).default('dark').describe('Visual style (default: dark)'),
    },
    async ({ prompt, duration = 15, width = 1920, height = 1080, style = 'dark' }) => {
      const taskId = uuidv4();

      tasks.set(taskId, {
        id: taskId,
        status: 'generating',
        prompt,
        duration,
        width,
        height,
        style,
        createdAt: new Date().toISOString(),
      });

      processVideo(taskId, { prompt, duration, width, height, style }).catch(err => {
        const task = tasks.get(taskId);
        if (task) {
          task.status = 'failed';
          task.error = err.message;
        }
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ task_id: taskId, status: 'generating', prompt, duration, width, height, style }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'check_video_status',
    'Check the rendering status of a video generation task.',
    {
      task_id: z.string().describe('The task ID returned by generate_video'),
    },
    async ({ task_id }) => {
      const task = tasks.get(task_id);
      if (!task) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Task not found' }) }],
          isError: true,
        };
      }

      const response = {
        task_id: task.id,
        status: task.status,
        prompt: task.prompt,
        created_at: task.createdAt,
      };

      if (task.status === 'done') {
        response.download_url = task.downloadUrl;
        response.duration_seconds = task.renderDuration;
        response.file_size = task.fileSize;
        if (task.narrationStatus) {
          response.narration_status = task.narrationStatus;
          if (task.narrationError) response.narration_error = task.narrationError;
        }
      } else if (task.status === 'failed') {
        response.error = task.error;
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  server.tool(
    'list_templates',
    'List available video templates that can be used as starting points.',
    {},
    async () => {
      const templates = [
        { id: 'product-intro', name: 'Product Intro', description: 'Short product introduction with title, problem statement, and CTA', duration_range: '10-20s' },
        { id: 'feature-announce', name: 'Feature Announcement', description: 'Announce a new feature with animated code/text reveal', duration_range: '10-15s' },
        { id: 'social-clip', name: 'Social Media Clip', description: 'Short vertical video for TikTok/Reels/Shorts', duration_range: '5-15s', aspect: '9:16' },
        { id: 'demo-flow', name: 'Demo Flow', description: 'Step-by-step demo showing a product flow', duration_range: '15-30s' },
        { id: 'text-reveal', name: 'Text Reveal', description: 'Animated text reveal with transitions', duration_range: '5-10s' },
      ];

      return {
        content: [{ type: 'text', text: JSON.stringify({ templates }, null, 2) }],
      };
    }
  );

  server.tool(
    'generate_narration',
    `Generate narration audio from text using ElevenLabs text-to-speech, then mux it onto an existing video. Returns the updated video download URL when done.

Available voices: "rachel" (female, warm, conversational), "drew" (male, calm, professional), "clyde" (male, deep, authoritative), "bella" (female, bright, friendly), "rakis" (custom cloned voice). Default: "rakis".`,
    {
      task_id: z.string().describe('The task ID of a completed video to add narration to'),
      text: z.string().describe('The narration script text to convert to speech'),
      voice: z.enum(['rachel', 'drew', 'clyde', 'bella', 'rakis']).default('rakis').describe('Voice to use for narration (default: rakis)'),
    },
    async ({ task_id, text, voice = 'rachel' }) => {
      if (!ELEVEN_LABS_API_KEY) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'ELEVEN_LABS_API_KEY not configured. Set the environment variable to enable narration.' }) }],
          isError: true,
        };
      }

      const task = tasks.get(task_id);
      if (!task) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Task not found' }) }],
          isError: true,
        };
      }
      if (task.status !== 'done') {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Task is ${task.status}, not done. Wait for the video to finish rendering first.` }) }],
          isError: true,
        };
      }

      const narrationId = uuidv4();
      task.narrationStatus = 'generating';

      processNarration(task_id, narrationId, text, voice).catch(err => {
        const t = tasks.get(task_id);
        if (t) {
          t.narrationStatus = 'failed';
          t.narrationError = err.message;
        }
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ task_id, narration_id: narrationId, narration_status: 'generating', voice }, null, 2),
        }],
      };
    }
  );

  return server;
}

// Video processing pipeline
async function processVideo(taskId, params) {
  const task = tasks.get(taskId);

  task.status = 'generating';
  const composition = await generateComposition(params);

  // HyperFrames expects --input to be a directory (composition folder)
  const compDir = join(COMPOSITIONS_DIR, taskId);
  await mkdir(compDir, { recursive: true });
  const compPath = join(compDir, 'index.html');
  await writeFile(compPath, composition);

  task.status = 'rendering';
  const outputPath = join(OUTPUTS_DIR, `${taskId}.mp4`);

  const startTime = Date.now();
  await renderVideo(compDir, outputPath, params.duration, params.width, params.height);
  const renderDuration = (Date.now() - startTime) / 1000;

  const fileStat = await stat(outputPath);

  task.status = 'done';
  task.downloadUrl = `/downloads/${taskId}.mp4`;
  task.renderDuration = renderDuration;
  task.fileSize = fileStat.size;
  task.outputPath = outputPath;

  // Clean up composition directory
  try { await unlink(compPath); } catch {}
  try { await import('fs').then(f => f.promises.rmdir(compDir)); } catch {}
}

async function generateComposition(params) {
  const { prompt, duration, width, height, style } = params;

  const styles = {
    dark: { bg: '#0a0a0a', text: '#fafafa', accent: '#3b82f6', sub: '#999', cardBg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.1)' },
    light: { bg: '#fafafa', text: '#1a1a1a', accent: '#2563eb', sub: '#666', cardBg: '#fff', border: '#e5e5e5' },
    minimal: { bg: '#fff', text: '#111', accent: '#111', sub: '#888', cardBg: '#f5f5f5', border: '#ddd' },
    bold: { bg: '#000', text: '#fff', accent: '#f97316', sub: '#aaa', cardBg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.15)' },
  };

  const s = styles[style] || styles.dark;
  const isVertical = height > width;
  const fontSize = isVertical ? '48px' : '72px';

  const sentences = prompt.split(/[.!?]+/).filter(s => s.trim().length > 5);
  const sceneCount = Math.min(Math.max(sentences.length, 2), 5);
  const sceneDuration = duration / sceneCount;

  let scenesHtml = '';
  let timelineCode = '';

  for (let i = 0; i < sceneCount; i++) {
    const text = sentences[i] || (i === 0 ? prompt.split(',')[0] : '');
    const startTime = i * sceneDuration;
    const isLast = i === sceneCount - 1;

    scenesHtml += `
      <div id="scene${i+1}" class="clip scene" data-start="${startTime.toFixed(1)}" data-duration="${sceneDuration.toFixed(1)}" data-track-index="1">
        <div class="headline">${escapeHtml(text.trim())}${isLast ? '<br><span class="accent">zenbin.org</span>' : ''}</div>
      </div>`;

    timelineCode += `
      tl.from("#scene${i+1} .headline", { opacity: 0, y: 40, duration: 0.8, ease: "power2.out" }, ${startTime.toFixed(1)});`;
    if (i < sceneCount - 1) {
      timelineCode += `
      tl.to("#scene${i+1} .headline", { opacity: 0, y: -20, duration: 0.5, ease: "power2.in" }, ${(startTime + sceneDuration - 0.7).toFixed(1)});`;
    }
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${width}, height=${height}" />
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: ${s.bg}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
    #root { width: 100%; height: 100%; position: relative; }
    .scene { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    .headline { font-size: ${fontSize}; font-weight: 700; color: ${s.text}; letter-spacing: -0.03em; line-height: 1.2; max-width: ${isVertical ? '90%' : '75%'}; }
    .accent { color: ${s.accent}; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
    ${scenesHtml}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    ${timelineCode}
    window.__timelines["main"] = tl;
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function renderVideo(inputPath, outputPath, duration, width, height) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const { stdout, stderr } = await execFileAsync(npx, [
    'hyperframes@0.6.6', 'render',
    '--input', inputPath,
    '--output', outputPath,
    '--duration', String(duration),
    '--width', String(width),
    '--height', String(height),
  ], {
    cwd: process.cwd(),
    timeout: 300000,
  });

  return { stdout, stderr };
}

// ElevenLabs voice IDs
const VOICE_IDS = {
  rachel: '21m00Tcm4TlvDq8ikWAM', // Rachel - warm, conversational
  drew: '2EpgWj0sAnM8pE0GsxYs',   // Drew - calm, professional
  clyde: '2EpgWj0sAnM8pE0GsxYs',  // Clyde - deep, authoritative (using Drew as fallback)
  bella: 'EXAVITQu4ms4iquZ1x9D',   // Bella - bright, friendly
  rakis: 'KUL4O9NisC7TSWz760iD',   // Rakis - cloned voice
};

async function generateNarrationAudio(text, voice) {
  const voiceId = VOICE_IDS[voice] || VOICE_IDS.rachel;
  const response = await fetch(`${ELEVEN_LABS_BASE_URL}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': ELEVEN_LABS_API_KEY,
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} ${errorBody}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  const audioPath = join(NARRATION_DIR, `${uuidv4()}.mp3`);
  await writeFile(audioPath, audioBuffer);
  return audioPath;
}

async function processNarration(taskId, narrationId, text, voice) {
  const task = tasks.get(taskId);

  // Generate audio with ElevenLabs
  task.narrationStatus = 'generating_audio';
  const audioPath = await generateNarrationAudio(text, voice);

  // Mux audio onto video using ffmpeg
  task.narrationStatus = 'muxing';
  const originalVideo = task.outputPath;
  const narratedVideo = join(OUTPUTS_DIR, `${taskId}-narrated.mp4`);

  await execAsync(
    `ffmpeg -y -i "${originalVideo}" -i "${audioPath}" ` +
    `-c:v copy -c:a aac -b:a 192k ` +
    `-map 0:v:0 -map 1:a:0 ` +
    `-shortest "${narratedVideo}"`,
    { timeout: 120000 }
  );

  // Replace the original video with narrated version
  const fileStat = await stat(narratedVideo);
  task.outputPath = narratedVideo;
  task.downloadUrl = `/downloads/${taskId}-narrated.mp4`;
  task.fileSize = fileStat.size;
  task.narrationStatus = 'done';

  // Clean up audio file
  try { await unlink(audioPath); } catch {}
}

// Express app
const app = express();
app.use(express.json());

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', tasks: tasks.size, narration: !!ELEVEN_LABS_API_KEY });
});

// llms.txt (no auth required)
app.get('/llms.txt', (req, res) => {
  res.sendFile(join(process.cwd(), 'public', 'llms.txt'));
});

// Auth-protected downloads
app.use('/downloads', requireApiKey, express.static(OUTPUTS_DIR));

// MCP POST handler
app.post('/mcp', requireApiKey, async (req, res) => {
  try {
    // Stateless mode: create a new transport per request
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    const server = getServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// MCP GET handler (SSE streams - not used in stateless mode, but required by spec)
app.get('/mcp', requireApiKey, async (req, res) => {
  // In stateless mode, we don't maintain SSE connections
  res.status(405).json({ error: 'Method not allowed in stateless mode' });
});

// MCP DELETE handler (session termination - not needed in stateless mode)
app.delete('/mcp', requireApiKey, async (req, res) => {
  res.status(405).json({ error: 'Method not allowed in stateless mode' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`hyper-video-service running on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Downloads: http://localhost:${PORT}/downloads/:id.mp4`);
  console.log(`Auth: ${API_KEY ? 'API key required' : 'Open (no key set)'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  process.exit(0);
});