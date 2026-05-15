# hyper-video-service

MCP server for programmatic video generation. Send a prompt, get an MP4.

## How it works

1. Send a video prompt via MCP tool call
2. The service generates a HyperFrames composition (HTML + GSAP)
3. Renders to MP4 using headless Chrome
4. Returns a download URL

## Authentication

Set `HYPER_VIDEO_API_KEY` as an environment variable. All MCP and download endpoints require this key.

If the key is not set, the service runs in open mode (no auth). **Always set this in production.**

Clients authenticate via:
- `Authorization: Bearer <key>` header
- `X-API-Key: <key>` header
- `?apiKey=<key>` query parameter

### OpenClaw MCP config

```json
{
  "mcpServers": {
    "hyper-video": {
      "url": "https://hyper-video-service.onrender.com/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

## MCP Tools

### `generate_video`

Generate a video from a text prompt.

```json
{
  "prompt": "15s product intro for ZenBin, dark theme, showing CAP Protocol headers",
  "duration": 15,
  "width": 1920,
  "height": 1080,
  "style": "dark"
}
```

Returns: `{ "task_id": "abc123", "status": "generating" }`

### `check_video_status`

Check rendering progress.

```json
{ "task_id": "abc123" }
```

Returns: `{ "status": "done", "download_url": "/downloads/abc123.mp4", "duration_seconds": 18 }`

### `list_templates`

List available video templates.

Returns: `{ "templates": ["product-intro", "feature-announce", "social-clip"] }`

## Architecture

```
Prompt → LLM (composition generation) → HyperFrames (HTML+GSAP) → Chrome (render) → MP4
```

Interactive diagram: https://zed.zenbin.org/hyper-video-architecture

## Deployment

```bash
# Deploy to Render
# Set HYPER_VIDEO_API_KEY in Render dashboard

# Or local development
npm install
HYPER_VIDEO_API_KEY=your-secret-key npm run dev
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HYPER_VIDEO_API_KEY` | Yes (prod) | API key for authentication |
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Set to `production` for production |
| `COMPOSITIONS_DIR` | No | Directory for generated HTML (default: ./compositions) |
| `OUTPUTS_DIR` | No | Directory for rendered MP4s (default: ./outputs) |
| `TEMPLATES_DIR` | No | Directory for video templates (default: ./templates) |