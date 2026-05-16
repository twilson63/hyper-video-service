/**
 * Rich composition generator v2 for HyperFrames.
 *
 * Uses CSS @keyframes for ambient motion (auto-discovered by runtime),
 * multi-track compositing (bg/content/overlay), data-end attributes,
 * and GSAP for scene transitions.
 *
 * HyperFrames runtime features used:
 * - CSS animation adapter (auto-discovers @keyframes, seek/pause/play)
 * - GSAP adapter (window.__timelines)
 * - data-composition-id for scoping
 * - data-start + data-duration for clip timing
 * - data-end for explicit clip end
 * - data-track-index for multi-track compositing
 * - data-timeline-role="persistent-overlay" for cross-scene elements
 */

// ── Style palettes ──
const STYLES = {
  dark: {
    bg: '#0a0a0a',
    bgTint: '#0d0d14',
    text: '#fafafa',
    accent: '#3b82f6',
    accent2: '#8b5cf6',
    sub: '#94a3b8',
    cardBg: 'rgba(255,255,255,0.05)',
    border: 'rgba(255,255,255,0.1)',
    glowColor: 'rgba(59,130,246,0.15)',
    scanColor: 'rgba(59,130,246,0.06)',
    particleColor: 'rgba(255,255,255,0.15)',
    glitchColor: 'rgba(139,92,246,0.8)',
    streamColor: 'rgba(59,130,246,0.3)',
  },
  light: {
    bg: '#f8f8f8',
    bgTint: '#f0f0f0',
    text: '#1a1a1a',
    accent: '#2563eb',
    accent2: '#7c3aed',
    sub: '#666666',
    cardBg: '#ffffff',
    border: '#e5e5e5',
    glowColor: 'rgba(37,99,235,0.12)',
    scanColor: 'rgba(37,99,235,0.04)',
    particleColor: 'rgba(0,0,0,0.08)',
    glitchColor: 'rgba(124,58,237,0.6)',
    streamColor: 'rgba(37,99,235,0.2)',
  },
  minimal: {
    bg: '#ffffff',
    bgTint: '#f5f5f5',
    text: '#111111',
    accent: '#111111',
    accent2: '#555555',
    sub: '#888888',
    cardBg: '#f5f5f5',
    border: '#dddddd',
    glowColor: 'rgba(0,0,0,0.06)',
    scanColor: 'rgba(0,0,0,0.02)',
    particleColor: 'rgba(0,0,0,0.06)',
    glitchColor: 'rgba(80,80,80,0.5)',
    streamColor: 'rgba(0,0,0,0.15)',
  },
  bold: {
    bg: '#000000',
    bgTint: '#0a0a0a',
    text: '#ffffff',
    accent: '#f97316',
    accent2: '#ef4444',
    sub: '#aaaaaa',
    cardBg: 'rgba(255,255,255,0.08)',
    border: 'rgba(255,255,255,0.15)',
    glowColor: 'rgba(249,115,22,0.18)',
    scanColor: 'rgba(249,115,22,0.06)',
    particleColor: 'rgba(255,255,255,0.12)',
    glitchColor: 'rgba(239,68,68,0.8)',
    streamColor: 'rgba(249,115,22,0.3)',
  },
};

// ── Prompt parser ──
function parsePrompt(prompt) {
  const lines = prompt.split('\n').map(l => l.trim()).filter(Boolean);
  const result = { title: null, stats: [], checklistItems: [], quotes: [], bodyParagraphs: [], rawLines: lines };

  for (const line of lines) {
    if (!result.title && (line === line.toUpperCase() || line.length < 60) && /^[A-Z]/.test(line)) {
      if (line.length < 80 && !line.includes('.') && !line.includes(',')) {
        result.title = line;
        continue;
      }
    }
    const statMatch = line.match(/(\d+\.?\d*x|\d+%|\$[\d,.]+|\d{2,})/g);
    if (statMatch && statMatch.length >= 1 && line.length < 100) {
      result.stats.push({ text: line, values: statMatch });
      continue;
    }
    if (/^(\d+[\.\)]|[-•✓☑*])\s/.test(line)) {
      const numMatch = line.match(/^(\d+)/);
      const num = numMatch ? numMatch[1] : String(result.checklistItems.length + 1);
      const text = line.replace(/^(\d+[\.\)]|[-•✓☑*])\s*/, '');
      result.checklistItems.push({ num, text });
      continue;
    }
    if (/^["'""'«]/.test(line) || /:"/.test(line)) {
      result.quotes.push(line);
      continue;
    }
    if (line.length > 20) {
      result.bodyParagraphs.push(line);
    }
  }
  if (!result.title) {
    const firstLine = lines[0] || 'Video';
    result.title = firstLine.length > 50 ? firstLine.split(/\s+/).slice(0, 6).join(' ') : firstLine;
  }
  if (result.bodyParagraphs.length === 0 && result.stats.length === 0 && result.checklistItems.length === 0) {
    const sentences = prompt.split(/[.!?]+/).filter(s => s.trim().length > 10);
    for (const s of sentences) result.bodyParagraphs.push(s.trim());
  }
  return result;
}

// ── Scene planner ──
function planScenes(parsed, duration) {
  const scenes = [];
  const minSceneDur = 3;
  const maxScenes = Math.floor(duration / minSceneDur);

  scenes.push({ type: 'title', text: parsed.title, duration: Math.min(5, duration * 0.15) });
  let remaining = duration - scenes[0].duration;

  if (parsed.stats.length > 0 && scenes.length < maxScenes) {
    const dur = Math.min(8, remaining * 0.3);
    scenes.push({ type: 'stats', items: parsed.stats, duration: dur });
    remaining -= dur;
  }
  if (parsed.checklistItems.length > 0 && scenes.length < maxScenes) {
    const items = parsed.checklistItems.map((item, i) => typeof item === 'string' ? { num: String(i + 1), text: item } : item);
    const itemDur = Math.max(0.8, Math.min(1.5, remaining / (items.length + 1)));
    const dur = items.length * itemDur + 1.5;
    scenes.push({ type: 'checklist', items, duration: Math.min(dur, remaining * 0.5) });
    remaining -= scenes[scenes.length - 1].duration;
  }
  const bodyScenes = Math.min(parsed.bodyParagraphs.length, maxScenes - scenes.length, 3);
  for (let i = 0; i < bodyScenes; i++) {
    const dur = Math.min(remaining / (bodyScenes - i), 8);
    scenes.push({ type: 'body', text: parsed.bodyParagraphs[i], duration: dur });
    remaining -= dur;
  }
  if (parsed.quotes.length > 0 && scenes.length < maxScenes && remaining > 3) {
    scenes.push({ type: 'quote', text: parsed.quotes[0], duration: Math.min(5, remaining) });
    remaining -= scenes[scenes.length - 1].duration;
  }
  if (remaining > 2) {
    scenes.push({ type: 'closing', text: parsed.title, duration: remaining });
  }
  let t = 0;
  for (const scene of scenes) { scene.start = t; t += scene.duration; }
  return scenes;
}

// ── CSS @keyframes ──
function generateKeyframes(s) {
  return `
@keyframes hf-float {
  0% { transform: translateY(0px) translateX(0px); opacity: var(--p-opacity, 0.15); }
  25% { transform: translateY(-20px) translateX(10px); opacity: calc(var(--p-opacity, 0.15) * 1.5); }
  50% { transform: translateY(-8px) translateX(-5px); opacity: var(--p-opacity, 0.15); }
  75% { transform: translateY(-30px) translateX(8px); opacity: calc(var(--p-opacity, 0.15) * 1.2); }
  100% { transform: translateY(0px) translateX(0px); opacity: var(--p-opacity, 0.15); }
}
@keyframes hf-scanline {
  0% { top: -2%; }
  100% { top: 102%; }
}
@keyframes hf-breathe {
  0% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.08); opacity: 0.8; }
  100% { transform: scale(1); opacity: 0.6; }
}
@keyframes hf-drift {
  0% { transform: translate(0, 0); }
  33% { transform: translate(8px, -4px); }
  66% { transform: translate(-6px, 6px); }
  100% { transform: translate(0, 0); }
}
@keyframes hf-pulse-bar {
  0% { opacity: 0.15; }
  50% { opacity: 0.4; }
  100% { opacity: 0.15; }
}
@keyframes hf-data-stream {
  0% { transform: translateY(-100%); opacity: 0; }
  10% { opacity: 0.6; }
  90% { opacity: 0.6; }
  100% { transform: translateY(100vh); opacity: 0; }
}
@keyframes hf-glitch {
  0% { transform: translate(0); filter: none; }
  7% { transform: translate(-2px, 1px); filter: hue-rotate(20deg); }
  10% { transform: translate(0); filter: none; }
  27% { transform: translate(2px, -1px); filter: saturate(1.5); }
  30% { transform: translate(0); filter: none; }
  47% { transform: translate(-1px, 2px); filter: hue-rotate(-15deg); }
  50% { transform: translate(0); filter: none; }
  67% { transform: translate(3px, 0); filter: brightness(1.2); }
  70% { transform: translate(0); filter: none; }
  87% { transform: translate(-2px, -1px); filter: contrast(1.1); }
  100% { transform: translate(0); filter: none; }
}
@keyframes hf-corner-accent {
  0% { width: 0; height: 0; }
  50% { width: 40px; height: 40px; }
  100% { width: 0; height: 0; }
}
@keyframes hf-gradient-drift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}`;
}

// ── Background layer (track 0, persistent) ──
function generateBackgroundLayer(s, width, height, duration) {
  const glowColorLight = s.glowColor.replace(/[\d.]+\)$/, '0.08)');
  // Particles
  let particlesHtml = '';
  for (let i = 0; i < 12; i++) {
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const size = 2 + Math.random() * 4;
    const delay = Math.random() * 8;
    const dur = 6 + Math.random() * 10;
    particlesHtml += `<div style="position:absolute;left:${x}%;top:${y}%;width:${size}px;height:${size}px;border-radius:50%;background:${s.particleColor};animation:hf-float ${dur.toFixed(1)}s ${delay.toFixed(1)}s infinite ease-in-out;--p-opacity:${(0.1 + Math.random() * 0.15).toFixed(2)};pointer-events:none;" data-hf-ignore></div>`;
  }

  return `
    <!-- Background layer: persistent atmosphere -->
    <div data-composition-id="bg" data-start="0" data-duration="${duration}" data-track-index="0" style="position:absolute;inset:0;overflow:hidden;">
      <!-- Radial glow -->
      <div style="position:absolute;top:35%;left:50%;width:800px;height:800px;background:radial-gradient(circle,${s.glowColor},transparent 60%);transform:translate(-50%,-50%);animation:hf-breathe 8s infinite ease-in-out;pointer-events:none;" data-hf-ignore></div>
      <div style="position:absolute;bottom:20%;right:20%;width:600px;height:600px;background:radial-gradient(circle,${glowColorLight},transparent 60%);animation:hf-breathe 10s 2s infinite ease-in-out;pointer-events:none;" data-hf-ignore></div>
      <!-- Scan line -->
      <div style="position:absolute;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,${s.scanColor},${s.accent}44,${s.scanColor},transparent);animation:hf-scanline 4s infinite linear;pointer-events:none;z-index:100;" data-hf-ignore></div>
      <!-- Floating particles -->
      ${particlesHtml}
      <!-- Data streams -->
      <div style="position:absolute;right:8%;top:0;width:1px;height:100vh;background:linear-gradient(transparent,${s.streamColor},transparent);animation:hf-data-stream 12s 0s infinite linear;pointer-events:none;opacity:0.3;" data-hf-ignore></div>
      <div style="position:absolute;right:15%;top:0;width:1px;height:100vh;background:linear-gradient(transparent,${s.streamColor},transparent);animation:hf-data-stream 18s 4s infinite linear;pointer-events:none;opacity:0.2;" data-hf-ignore></div>
    </div>`;
}

// ── Overlay layer (track 2, persistent) ──
function generateOverlayLayer(s, duration) {
  return `
    <!-- Overlay layer: persistent UI elements -->
    <div data-composition-id="overlay" data-start="0" data-duration="${duration}" data-track-index="2" data-timeline-role="persistent-overlay" style="position:absolute;inset:0;pointer-events:none;">
      <!-- Corner accents -->
      <div style="position:absolute;top:0;left:0;width:0;height:0;border-top:2px solid ${s.accent};border-left:2px solid ${s.accent};animation:hf-corner-accent 6s infinite ease-in-out;" data-hf-ignore></div>
      <div style="position:absolute;top:0;right:0;width:0;height:0;border-top:2px solid ${s.accent};border-right:2px solid ${s.accent};animation:hf-corner-accent 6s 3s infinite ease-in-out;" data-hf-ignore></div>
      <!-- Bottom progress bar -->
      <div style="position:absolute;bottom:0;left:0;width:100%;height:3px;background:linear-gradient(90deg,${s.accent},${s.accent2},${s.accent});animation:hf-pulse-bar 3s infinite ease-in-out;" data-hf-ignore></div>
      <!-- Side accent lines -->
      <div style="position:absolute;left:20px;top:15%;height:70%;width:1px;background:${s.border};pointer-events:none;" data-hf-ignore></div>
    </div>`;
}

// ── Scene generators (track 1 = content) ──

function generateTitleScene(scene, s, sceneIndex) {
  const id = `scene${sceneIndex}`;
  const end = (scene.start + scene.duration).toFixed(1);
  return `
      <div id="${id}" class="clip scene" data-start="${scene.start.toFixed(1)}" data-duration="${scene.duration.toFixed(1)}" data-end="${end}" data-track-index="1">
        <div class="ghost-text" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:200px;font-weight:900;color:${s.text};opacity:0.02;white-space:nowrap;pointer-events:none;" data-hf-ignore>${escapeHtml(scene.text.split(/\s+/)[0] || '')}</div>
        <div class="grain" style="position:absolute;inset:0;opacity:0.03;background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%224%22 stitchTiles=%22stitch%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22 opacity=%221%22/></svg>');pointer-events:none;" data-hf-ignore></div>
        <div class="reg-mark" style="position:absolute;top:16px;left:16px;width:12px;height:12px;border-top:2px solid ${s.border};border-left:2px solid ${s.border};opacity:0.3;" data-hf-ignore></div>
        <div class="reg-mark" style="position:absolute;bottom:16px;right:16px;width:12px;height:12px;border-bottom:2px solid ${s.border};border-right:2px solid ${s.border};opacity:0.3;" data-hf-ignore></div>
        <div class="coord-label" style="position:absolute;top:20px;right:24px;font-size:14px;font-family:monospace;color:${s.sub};opacity:0;" data-hf-ignore>0:${String(Math.floor(scene.start)).padStart(2,'0')}</div>
        <div class="headline" style="font-size:80px;font-weight:800;color:${s.text};letter-spacing:-0.03em;line-height:1.1;text-align:left;max-width:75%;position:relative;z-index:2;opacity:0;">${escapeHtml(scene.text)}</div>
        <div class="accent-line" style="width:0;height:3px;background:${s.accent};margin-top:24px;border-radius:2px;"></div>
      </div>`;
}

function generateStatsScene(scene, s, sceneIndex) {
  const id = `scene${sceneIndex}`;
  const end = (scene.start + scene.duration).toFixed(1);
  const stats = scene.items;
  let statsHtml = '';
  let tlCode = '';

  for (let i = 0; i < stats.length; i++) {
    const sid = `stat${sceneIndex}_${i}`;
    const val = stats[i].values[0] || '';
    const rest = stats[i].text.replace(val, '').trim();
    statsHtml += `
        <div id="${sid}" class="stat-card" style="display:flex;flex-direction:column;align-items:center;padding:24px 32px;background:${s.cardBg};border:1px solid ${s.border};border-radius:12px;min-width:180px;opacity:0;">
          <span class="stat-value" style="font-size:64px;font-weight:900;color:${s.accent};line-height:1;">${escapeHtml(val)}</span>
          <span class="stat-label" style="font-size:18px;color:${s.sub};margin-top:8px;text-align:center;">${escapeHtml(rest)}</span>
        </div>`;
    const enterT = scene.start + 0.3 + i * 0.4;
    tlCode += `
      tl.fromTo("#${sid}", { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(1.7)" }, ${enterT.toFixed(2)});`;
  }

  return `
      <div id="${id}" class="clip scene stats-scene" data-start="${scene.start.toFixed(1)}" data-duration="${scene.duration.toFixed(1)}" data-end="${end}" data-track-index="1">
        <div class="divider-line" style="position:absolute;left:40px;top:50%;width:2px;height:60%;background:${s.border};transform:translateY(-50%);opacity:0.3;" data-hf-ignore></div>
        <div class="stats-row" style="display:flex;gap:24px;align-items:center;justify-content:center;position:relative;z-index:2;">
          ${statsHtml}
        </div>
      </div>`;
}

function generateChecklistScene(scene, s, sceneIndex) {
  const id = `scene${sceneIndex}`;
  const end = (scene.start + scene.duration).toFixed(1);
  const items = scene.items;
  let itemsHtml = '';
  let tlCode = '';

  for (let i = 0; i < items.length; i++) {
    const iid = `item${sceneIndex}_${i}`;
    const itemText = typeof items[i] === 'string' ? items[i] : items[i].text;
    const itemNum = typeof items[i] === 'string' ? String(i + 1) : items[i].num;
    itemsHtml += `
        <div id="${iid}" class="checklist-item" style="display:flex;align-items:center;gap:20px;padding:14px 0;opacity:0;">
          <span class="check-num" style="width:36px;height:36px;border-radius:50%;background:${s.accent};display:flex;align-items:center;justify-content:center;font-size:18px;color:${s.bg};font-weight:800;flex-shrink:0;">${escapeHtml(itemNum)}</span>
          <span class="check-text" style="font-size:30px;font-weight:600;color:${s.text};">${escapeHtml(itemText)}</span>
        </div>`;
    const enterT = scene.start + 0.2 + i * 0.6;
    tlCode += `
      tl.fromTo("#${iid}", { opacity: 0, x: 80 }, { opacity: 1, x: 0, duration: 0.4, ease: "back.out(1.4)" }, ${enterT.toFixed(2)});`;
  }

  return `
      <div id="${id}" class="clip scene checklist-scene" data-start="${scene.start.toFixed(1)}" data-duration="${scene.duration.toFixed(1)}" data-end="${end}" data-track-index="1">
        <div class="ghost-text" style="position:absolute;bottom:10%;right:5%;font-size:120px;font-weight:900;color:${s.text};opacity:0.02;pointer-events:none;" data-hf-ignore>${escapeHtml(items.length <= 6 ? String(items.length) : 'GO')}</div>
        <div class="checklist-container" style="position:relative;z-index:2;max-width:70%;">
          ${itemsHtml}
        </div>
      </div>`;
}

function generateBodyScene(scene, s, sceneIndex) {
  const id = `scene${sceneIndex}`;
  const end = (scene.start + scene.duration).toFixed(1);
  const isLong = scene.text.length > 120;
  const fontSize = isLong ? '32px' : '44px';

  return `
      <div id="${id}" class="clip scene body-scene" data-start="${scene.start.toFixed(1)}" data-duration="${scene.duration.toFixed(1)}" data-end="${end}" data-track-index="1">
        <div class="accent-line" style="position:absolute;left:40px;top:50%;width:3px;height:40%;background:${s.accent};transform:translateY(-50%);opacity:0;border-radius:2px;"></div>
        <div class="coord-label" style="position:absolute;bottom:20px;left:24px;font-size:14px;font-family:monospace;color:${s.sub};opacity:0;" data-hf-ignore>0:${String(Math.floor(scene.start)).padStart(2,'0')}</div>
        <div class="data-bar" style="position:absolute;bottom:0;left:0;width:30%;height:3px;background:${s.accent};opacity:0;transform-origin:left center;" data-hf-ignore></div>
        <div class="body-text" style="font-size:${fontSize};font-weight:400;color:${s.text};line-height:1.5;max-width:70%;position:relative;z-index:2;text-align:left;opacity:0;">
          ${escapeHtml(scene.text)}
        </div>
      </div>`;
}

function generateQuoteScene(scene, s, sceneIndex) {
  const id = `scene${sceneIndex}`;
  const end = (scene.start + scene.duration).toFixed(1);

  return `
      <div id="${id}" class="clip scene quote-scene" data-start="${scene.start.toFixed(1)}" data-duration="${scene.duration.toFixed(1)}" data-end="${end}" data-track-index="1">
        <div class="grain" style="position:absolute;inset:0;opacity:0.04;background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%224%22 stitchTiles=%22stitch%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22 opacity=%221%22/></svg>');pointer-events:none;" data-hf-ignore></div>
        <div class="quote-mark" style="font-size:120px;color:${s.accent};opacity:0;line-height:0.8;position:relative;z-index:2;">"</div>
        <div class="quote-text" style="font-size:36px;font-weight:300;color:${s.text};line-height:1.4;max-width:65%;font-style:italic;position:relative;z-index:2;opacity:0;">
          ${escapeHtml(scene.text.replace(/^["'""']/, '').replace(/["'""']$/, ''))}
        </div>
      </div>`;
}

function generateClosingScene(scene, s, sceneIndex) {
  const id = `scene${sceneIndex}`;
  const end = (scene.start + scene.duration).toFixed(1);

  return `
      <div id="${id}" class="clip scene closing-scene" data-start="${scene.start.toFixed(1)}" data-duration="${scene.duration.toFixed(1)}" data-end="${end}" data-track-index="1">
        <div class="headline" style="font-size:72px;font-weight:800;color:${s.text};letter-spacing:-0.03em;line-height:1.1;text-align:center;max-width:80%;position:relative;z-index:2;opacity:0;">
          ${escapeHtml(scene.text)}
        </div>
        <div class="accent-line" style="width:0;height:3px;background:${s.accent};margin-top:24px;border-radius:2px;"></div>
      </div>`;
}

// ── GSAP timeline builder ──
function buildTimeline(scenes, s) {
  let tlCode = '';

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const t = scene.start;

    switch (scene.type) {
      case 'title': {
        tlCode += `
      tl.fromTo("#scene${i} .headline", { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 0.7, ease: "expo.out" }, ${(t + 0.15).toFixed(2)});
      tl.fromTo("#scene${i} .accent-line", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power4.out" }, ${(t + 0.6).toFixed(2)});
      tl.to("#scene${i} .coord-label", { opacity: 0.4, duration: 0.5 }, ${(t + 0.8).toFixed(2)});`;
        if (i < scenes.length - 1) {
          const exitT = t + scene.duration - 0.6;
          tlCode += `
      tl.to("#scene${i} .headline", { opacity: 0, y: -30, duration: 0.4, ease: "power2.in" }, ${exitT.toFixed(2)});
      tl.to("#scene${i} .accent-line", { opacity: 0, duration: 0.3 }, ${(exitT + 0.1).toFixed(2)});`;
        }
        break;
      }
      case 'stats': {
        for (let j = 0; j < scene.items.length; j++) {
          const enterT = t + 0.3 + j * 0.4;
          tlCode += `
      tl.fromTo("#stat${i}_${j}", { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(1.7)" }, ${enterT.toFixed(2)});`;
        }
        if (i < scenes.length - 1) {
          const exitT = t + scene.duration - 0.5;
          tlCode += `
      tl.to("#scene${i} .stat-card", { opacity: 0, scale: 0.9, duration: 0.3, stagger: 0.05, ease: "power2.in" }, ${exitT.toFixed(2)});`;
        }
        break;
      }
      case 'checklist': {
        for (let j = 0; j < scene.items.length; j++) {
          const enterT = t + 0.2 + j * 0.6;
          tlCode += `
      tl.fromTo("#item${i}_${j}", { opacity: 0, x: 80 }, { opacity: 1, x: 0, duration: 0.4, ease: "back.out(1.4)" }, ${enterT.toFixed(2)});`;
        }
        if (i < scenes.length - 1) {
          const exitT = t + scene.duration - 0.5;
          tlCode += `
      tl.to("#scene${i} .checklist-item", { opacity: 0, x: -40, duration: 0.3, stagger: 0.04, ease: "power2.in" }, ${exitT.toFixed(2)});`;
        }
        break;
      }
      case 'body': {
        tlCode += `
      tl.fromTo("#scene${i} .body-text", { opacity: 0, x: 60 }, { opacity: 1, x: 0, duration: 0.6, ease: "power3.out" }, ${(t + 0.2).toFixed(2)});
      tl.fromTo("#scene${i} .accent-line", { scaleY: 0, opacity: 0 }, { scaleY: 1, opacity: 0.4, duration: 0.4, ease: "power2.out" }, ${(t + 0.3).toFixed(2)});
      tl.to("#scene${i} .data-bar", { opacity: 0.2, scaleX: 1, duration: 0.6, ease: "none" }, ${t.toFixed(2)});
      tl.to("#scene${i} .coord-label", { opacity: 0.3, duration: 0.5 }, ${(t + 0.4).toFixed(2)});`;
        if (i < scenes.length - 1) {
          const exitT = t + scene.duration - 0.4;
          tlCode += `
      tl.to("#scene${i} .body-text", { opacity: 0, duration: 0.3, ease: "power2.in" }, ${exitT.toFixed(2)});`;
        }
        break;
      }
      case 'quote': {
        tlCode += `
      tl.fromTo("#scene${i} .quote-mark", { opacity: 0, scale: 0.3 }, { opacity: 0.3, scale: 1, duration: 0.5, ease: "back.out(2)" }, ${(t + 0.1).toFixed(2)});
      tl.fromTo("#scene${i} .quote-text", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, ${(t + 0.4).toFixed(2)});`;
        if (i < scenes.length - 1) {
          const exitT = t + scene.duration - 0.5;
          tlCode += `
      tl.to("#scene${i} .quote-text", { opacity: 0, duration: 0.4, ease: "power2.in" }, ${exitT.toFixed(2)});
      tl.to("#scene${i} .quote-mark", { opacity: 0, scale: 0.5, duration: 0.3 }, ${(exitT + 0.1).toFixed(2)});`;
        }
        break;
      }
      case 'closing': {
        tlCode += `
      tl.fromTo("#scene${i} .headline", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.8, ease: "expo.out" }, ${(t + 0.2).toFixed(2)});
      tl.fromTo("#scene${i} .accent-line", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power4.out" }, ${(t + 0.8).toFixed(2)});`;
        break;
      }
    }
  }
  return tlCode;
}

// ── Main composition generator ──
export async function generateComposition(params) {
  const { prompt, duration, width, height, style } = params;
  const s = STYLES[style] || STYLES.dark;

  const parsed = parsePrompt(prompt);
  const scenes = planScenes(parsed, duration);

  // Track 0: Persistent background (atmosphere, particles, scan lines, glows)
  const bgLayer = generateBackgroundLayer(s, width, height, duration);

  // Track 1: Content scenes
  let contentHtml = '';
  for (let i = 0; i < scenes.length; i++) {
    switch (scenes[i].type) {
      case 'title': contentHtml += generateTitleScene(scenes[i], s, i); break;
      case 'stats': contentHtml += generateStatsScene(scenes[i], s, i); break;
      case 'checklist': contentHtml += generateChecklistScene(scenes[i], s, i); break;
      case 'body': contentHtml += generateBodyScene(scenes[i], s, i); break;
      case 'quote': contentHtml += generateQuoteScene(scenes[i], s, i); break;
      case 'closing': contentHtml += generateClosingScene(scenes[i], s, i); break;
    }
  }

  // Track 2: Persistent overlay (corner accents, progress bar, side lines)
  const overlayLayer = generateOverlayLayer(s, duration);

  // GSAP timeline (content transitions only)
  const timelineCode = buildTimeline(scenes, s);

  // CSS keyframes
  const keyframes = generateKeyframes(s);

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
    .scene { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 80px; }
    .stats-scene { align-items: center; }
    .checklist-scene { align-items: flex-start; padding-left: 80px; }
    .body-scene { align-items: flex-start; padding-left: 80px; }
    .quote-scene { text-align: center; }
    .closing-scene { text-align: center; }
    ${keyframes}
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
    ${bgLayer}
    ${contentHtml}
    ${overlayLayer}
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