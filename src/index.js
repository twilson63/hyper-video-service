import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { mkdir, writeFile, readFile, unlink, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Task storage (in-memory for single instance, use Redis/DB for multi-instance)
const tasks = new Map();

// Directories
const COMPOSITIONS_DIR = process.env.COMPOSITIONS_DIR || join(process.cwd(), 'compositions');
const OUTPUTS_DIR = process.env.OUTPUTS_DIR || join(process.cwd(), 'outputs');
const TEMPLATES_DIR = process.env.TEMPLATES_DIR || join(process.cwd(), 'templates');

// Ensure directories exist
await mkdir(COMPOSITIONS_DIR, { recursive: true });
await mkdir(OUTPUTS_DIR, { recursive: true });
await mkdir(TEMPLATES_DIR, { recursive: true });

// Create MCP server
const server = new McpServer({
  name: 'hyper-video-service',
  version: '0.1.0',
});

// Tool: generate_video
server.tool(
  'generate_video',
  `Generate a video from a text prompt. The service creates a HyperFrames composition (HTML+GSAP), renders it to MP4 using headless Chrome, and returns a download URL when done.

Styles: "dark" (dark background, light text), "light" (white background), "minimal" (clean, minimal), "bold" (large typography, high contrast).

Durations: 5-60 seconds. Default is 15.
Sizes: 1920x1080 (landscape), 1080x1920 (portrait/vertical), 1080x1080 (square).`,
  {
    prompt: { type: 'string', description: 'Description of the video to generate. Be specific about scenes, text, transitions, and style.' },
    duration: { type: 'number', description: 'Duration in seconds (default: 15)', default: 15 },
    width: { type: 'number', description: 'Video width in pixels (default: 1920)', default: 1920 },
    height: { type: 'number', description: 'Video height in pixels (default: 1080)', default: 1080 },
    style: { type: 'string', description: 'Visual style: dark, light, minimal, bold (default: dark)', default: 'dark' },
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

    // Start async processing
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

// Tool: check_video_status
server.tool(
  'check_video_status',
  'Check the rendering status of a video generation task.',
  {
    task_id: { type: 'string', description: 'The task ID returned by generate_video' },
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
    } else if (task.status === 'failed') {
      response.error = task.error;
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
    };
  }
);

// Tool: list_templates
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

// Video processing pipeline
async function processVideo(taskId, params) {
  const task = tasks.get(taskId);
  
  // Step 1: Generate composition
  task.status = 'generating';
  const composition = await generateComposition(params);
  
  const compPath = join(COMPOSITIONS_DIR, `${taskId}.html`);
  await writeFile(compPath, composition);
  
  // Step 2: Render to MP4
  task.status = 'rendering';
  const outputPath = join(OUTPUTS_DIR, `${taskId}.mp4`);
  
  const startTime = Date.now();
  await renderVideo(compPath, outputPath, params.duration, params.width, params.height);
  const renderDuration = (Date.now() - startTime) / 1000;
  
  // Step 3: Get file info
  const fileStat = await stat(outputPath);
  
  task.status = 'done';
  task.downloadUrl = `/downloads/${taskId}.mp4`;
  task.renderDuration = renderDuration;
  task.fileSize = fileStat.size;
  task.outputPath = outputPath;
  
  // Clean up composition
  try { await unlink(compPath); } catch {}
}

async function generateComposition(params) {
  const { prompt, duration, width, height, style } = params;
  
  // Color schemes
  const styles = {
    dark: { bg: '#0a0a0a', text: '#fafafa', accent: '#3b82f6', sub: '#999', cardBg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.1)' },
    light: { bg: '#fafafa', text: '#1a1a1a', accent: '#2563eb', sub: '#666', cardBg: '#fff', border: '#e5e5e5' },
    minimal: { bg: '#fff', text: '#111', accent: '#111', sub: '#888', cardBg: '#f5f5f5', border: '#ddd' },
    bold: { bg: '#000', text: '#fff', accent: '#f97316', sub: '#aaa', cardBg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.15)' },
  };
  
  const s = styles[style] || styles.dark;
  const isVertical = height > width;
  const fontSize = isVertical ? '48px' : '72px';
  const subFontSize = isVertical ? '24px' : '36px';
  
  // Parse prompt into scenes (simple heuristic)
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
    
    // GSAP animations
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
    timeout: 300000, // 5 minute timeout
  });
  
  return { stdout, stderr };
}

// Express server for MCP + downloads
const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', tasks: tasks.size });
});

// Download endpoint
app.get('/downloads/:filename', (req, res) => {
  const filePath = join(OUTPUTS_DIR, req.params.filename);
  res.download(filePath);
});

// MCP endpoint
const transport = new StreamableHTTPServerTransport({
  port: process.env.PORT || 3000,
});

const PORT = process.env.PORT || 3000;

// Connect MCP transport
await server.connect(transport);

// Start Express
app.listen(PORT, () => {
  console.log(`hyper-video-service running on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Downloads: http://localhost:${PORT}/downloads/:id.mp4`);
});