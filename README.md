# hyper-video-service

MCP server for programmatic video generation. Send a prompt, get an MP4.

## How it works

1. Send a video prompt via MCP tool call
2. The service generates a HyperFrames composition (HTML + GSAP)
3. Renders to MP4 using headless Chrome
4. Returns a download URL

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

Returns: `{ "task_id": "abc123", "status": "rendering" }`

### `check_video_status`

Check rendering progress.

```json
{ "task_id": "abc123" }
```

Returns: `{ "status": "done", "download_url": "https://...", "duration_seconds": 18 }`

### `list_templates`

List available video templates.

Returns: `{ "templates": ["product-intro", "feature-announce", "social-clip"] }`

## Architecture

```
Prompt → LLM (composition generation) → HyperFrames (HTML+GSAP) → Chrome (render) → MP4
```

## Deployment

```bash
# Deploy to Render
render deploy

# Or local development
npm install
npm run dev
```