/**
 * Rich composition generator for HyperFrames.
 *
 * Produces HTML+GSAP compositions with:
 * - Parsed prompt structure (title, stats, checklist, quotes, body text)
 * - Background atmosphere (radial glows, ghost text, grain, accent lines)
 * - Varied animations per element (scale-pop, slide, typewriter, drift)
 * - Scene transitions (crossfade, hard cut, dissolve)
 * - Visual density (8-10 elements per scene per HyperFrames guidelines)
 * - Proper GSAP fromTo for deterministic seeking
 */

// ── Style palettes ──
const STYLES = {
  dark: {
    bg: '#0a0a0a',
    bgTint: '#0d0d14',
    text: '#fafafa',
    accent: '#3b82f6',
    sub: '#94a3b8',
    cardBg: 'rgba(255,255,255,0.05)',
    border: 'rgba(255,255,255,0.1)',
    glowColor: 'rgba(59,130,246,0.15)',
  },
  light: {
    bg: '#f8f8f8',
    bgTint: '#f0f0f0',
    text: '#1a1a1a',
    accent: '#2563eb',
    sub: '#666666',
    cardBg: '#ffffff',
    border: '#e5e5e5',
    glowColor: 'rgba(37,99,235,0.12)',
  },
  minimal: {
    bg: '#ffffff',
    bgTint: '#f5f5f5',
    text: '#111111',
    accent: '#111111',
    sub: '#888888',
    cardBg: '#f5f5f5',
    border: '#dddddd',
    glowColor: 'rgba(0,0,0,0.06)',
  },
  bold: {
    bg: '#000000',
    bgTint: '#0a0a0a',
    text: '#ffffff',
    accent: '#f97316',
    sub: '#aaaaaa',
    cardBg: 'rgba(255,255,255,0.08)',
    border: 'rgba(255,255,255,0.15)',
    glowColor: 'rgba(249,115,22,0.18)',
  },
};

// ── Prompt parser ──
// Extracts structured content from a text prompt
function parsePrompt(prompt) {
  const lines = prompt.split('\n').map(l => l.trim()).filter(Boolean);
  const result = { title: null, stats: [], checklistItems: [], quotes: [], bodyParagraphs: [], rawLines: lines };

  for (const line of lines) {
    // Title: usually first line or all-caps lines
    if (!result.title && (line === line.toUpperCase() || line.length < 60) && /^[A-Z]/.test(line)) {
      // Check if it looks like a section header vs body text
      if (line.length < 80 && !line.includes('.') && !line.includes(',')) {
        if (!result.title) {
          result.title = line;
          continue;
        }
      }
    }

    // Stats: lines with percentages, multipliers, numbers as emphasis
    const statMatch = line.match(/(\d+\.?\d*x|\d+%|\$[\d,.]+|\d{2,})/g);
    if (statMatch && statMatch.length >= 1 && line.length < 100) {
      result.stats.push({ text: line, values: statMatch });
      continue;
    }

    // Checklist: lines starting with numbers, bullets, or checkmarks
    if (/^(\d+[\.\)]|[-•✓☑*])\s/.test(line)) {
      result.checklistItems.push(line.replace(/^(\d+[\.\)]|[-•✓☑*])\s*/, ''));
      continue;
    }

    // Quotes: lines in quotes or starting with quotation marks
    if (/^["'""'«]/.test(line) || /:"/.test(line)) {
      result.quotes.push(line);
      continue;
    }

    // Body text
    if (line.length > 20) {
      result.bodyParagraphs.push(line);
    }
  }

  // Fallback: if no title extracted, use first short line or first 5 words
  if (!result.title) {
    const firstLine = lines[0] || 'Video';
    result.title = firstLine.length > 50 ? firstLine.split(/\s+/).slice(0, 6).join(' ') : firstLine;
  }

  // If prompt is one big paragraph, split into scenes by sentences
  if (result.bodyParagraphs.length === 0 && result.stats.length === 0 && result.checklistItems.length === 0) {
    const sentences = prompt.split(/[.!?]+/).filter(s => s.trim().length > 10);
    for (const s of sentences) {
      result.bodyParagraphs.push(s.trim());
    }
  }

  return result;
}

// ── Scene planner ──
// Distributes parsed content across beats in the timeline
function planScenes(parsed, duration) {
  const scenes = [];
  const minSceneDur = 3;
  const maxScenes = Math.floor(duration / minSceneDur);

  // Scene 1: Title (always)
  scenes.push({
    type: 'title',
    text: parsed.title,
    duration: Math.min(5, duration * 0.15),
  });

  let remaining = duration - scenes[0].duration;

  // Scene 2: Stats (if any)
  if (parsed.stats.length > 0 && scenes.length < maxScenes) {
    const dur = Math.min(8, remaining * 0.3);
    scenes.push({ type: 'stats', items: parsed.stats, duration: dur });
    remaining -= dur;
  }

  // Scene 3: Checklist (if any)
  if (parsed.checklistItems.length > 0 && scenes.length < maxScenes) {
    const itemDur = Math.max(0.8, Math.min(1.5, remaining / (parsed.checklistItems.length + 1)));
    const dur = parsed.checklistItems.length * itemDur + 1.5;
    scenes.push({ type: 'checklist', items: parsed.checklistItems, duration: Math.min(dur, remaining * 0.5) });
    remaining -= scenes[scenes.length - 1].duration;
  }

  // Scene 4+: Body paragraphs
  const bodyScenes = Math.min(parsed.bodyParagraphs.length, maxScenes - scenes.length, 3);
  for (let i = 0; i < bodyScenes; i++) {
    const dur = Math.min(remaining / (bodyScenes - i), 8);
    scenes.push({ type: 'body', text: parsed.bodyParagraphs[i], duration: dur });
    remaining -= dur;
  }

  // Quote scene (if any and space)
  if (parsed.quotes.length > 0 && scenes.length < maxScenes && remaining > 3) {
    scenes.push({ type: 'quote', text: parsed.quotes[0], duration: Math.min(5, remaining) });
    remaining -= scenes[scenes.length - 1].duration;
  }

  // Closing scene (always if room)
  if (remaining > 2) {
    scenes.push({ type: 'closing', text: parsed.title, duration: remaining });
  }

  // Assign start times
  let t = 0;
  for (const scene of scenes) {
    scene.start = t;
    t += scene.duration;
  }

  return scenes;
}

// ── HTML generators per scene type ──

function generateTitleScene(scene, s, width, height, sceneIndex) {
  const id = `scene${sceneIndex}`;
  const accentLine = `<div class="accent-line" style="width:0;height:3px;background:${s.accent};margin-top:24px;border-radius:2px;"></div>`;
  const ghostText = `<div class="ghost-text" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:200px;font-weight:900;color:${s.text};opacity:0.03;white-space:nowrap;pointer-events:none;">${escapeHtml(scene.text.split(/\s+/)[0] || '')}</div>`;
  const glow = `<div class="radial-glow" style="position:absolute;top:40%;left:50%;width:600px;height:600px;background:radial-gradient(circle,${s.glowColor},transparent 70%);transform:translate(-50%,-50%);pointer-events:none;"></div>`;
  const grain = `<div class="grain" style="position:absolute;inset:0;opacity:0.03;background-image:url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\"><filter id=\"n\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.9\" numOctaves=\"4\" stitchTiles=\"stitch\"/></filter><rect width=\"100%\" height=\"100%\" filter=\"url(%23n)\" opacity=\"1\"/></svg>');pointer-events:none;"></div>`;
  const coordLabel = `<div class="coord-label" style="position:absolute;top:20px;right:24px;font-size:14px;font-family:monospace;color:${s.sub};opacity:0.4;">0:00</div>`;
  const regMark1 = `<div class="reg-mark" style="position:absolute;top:16px;left:16px;width:12px;height:12px;border-top:2px solid ${s.border};border-left:2px solid ${s.border};opacity:0.3;"></div>`;
  const regMark2 = `<div class="reg-mark" style="position:absolute;bottom:16px;right:16px;width:12px;height:12px;border-bottom:2px solid ${s.border};border-right:2px solid ${s.border};opacity:0.3;"></div>`;

  return `
      <div id="${id}" class="clip scene" data-start="${scene.start.toFixed(1)}" data-duration="${scene.duration.toFixed(1)}" data-track-index="1">
        ${glow}
        ${ghostText}
        ${grain}
        ${regMark1}
        ${regMark2}
        ${coordLabel}
        <div class="headline" style="font-size:80px;font-weight:800;color:${s.text};letter-spacing:-0.03em;line-height:1.1;text-align:left;max-width:75%;position:relative;z-index:2;">${escapeHtml(scene.text)}</div>
        ${accentLine}
      </div>`;
}

function generateStatsScene(scene, s, sceneIndex) {
  const id = `scene${sceneIndex}`;
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
    // Staggered entrance: scale-pop from 0.5
    const enterT = scene.start + 0.3 + i * 0.4;
    tlCode += `
      tl.fromTo("#${sid}", { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(1.7)" }, ${enterT.toFixed(2)});`;
  }

  const glow = `<div class="radial-glow" style="position:absolute;bottom:30%;right:30%;width:500px;height:500px;background:radial-gradient(circle,${s.glowColor},transparent 70%);pointer-events:none;"></div>`;
  const divider = `<div class="divider-line" style="position:absolute;left:40px;top:50%;width:2px;height:60%;background:${s.border};transform:translateY(-50%);opacity:0.3;"></div>`;

  return `
      <div id="${id}" class="clip scene stats-scene" data-start="${scene.start.toFixed(1)}" data-duration="${scene.duration.toFixed(1)}" data-track-index="1">
        ${glow}
        ${divider}
        <div class="stats-row" style="display:flex;gap:24px;align-items:center;justify-content:center;position:relative;z-index:2;">
          ${statsHtml}
        </div>
      </div>`;
}

function generateChecklistScene(scene, s, sceneIndex) {
  const id = `scene${sceneIndex}`;
  const items = scene.items;
  let itemsHtml = '';
  let tlCode = '';

  for (let i = 0; i < items.length; i++) {
    const iid = `item${sceneIndex}_${i}`;
    itemsHtml += `
        <div id="${iid}" class="checklist-item" style="display:flex;align-items:center;gap:16px;padding:12px 0;opacity:0;">
          <span class="check-num" style="width:36px;height:36px;border-radius:50%;background:${s.accent};display:flex;align-items:center;justify-content:center;font-size:18px;color:${s.bg};font-weight:800;flex-shrink:0;">${escapeHtml(typeof items[i] === 'string' ? String(i+1) : items[i].num)}</span>
          <span class="check-text" style="font-size:30px;font-weight:600;color:${s.text};">${escapeHtml(typeof items[i] === "string" ? items[i] : items[i].text)}</span>
        </div>`;
    // Fly in from right with bouncy ease
    const enterT = scene.start + 0.2 + i * 0.6;
    tlCode += `
      tl.fromTo("#${iid}", { opacity: 0, x: 80 }, { opacity: 1, x: 0, duration: 0.4, ease: "back.out(1.4)" }, ${enterT.toFixed(2)});`;
  }

  const glow = `<div class="radial-glow" style="position:absolute;top:30%;left:60%;width:400px;height:400px;background:radial-gradient(circle,${s.glowColor},transparent 70%);pointer-events:none;"></div>`;
  const ghostWord = `<div class="ghost-text" style="position:absolute;bottom:10%;right:5%;font-size:120px;font-weight:900;color:${s.text};opacity:0.03;pointer-events:none;">CHECKLIST</div>`;

  return `
      <div id="${id}" class="clip scene checklist-scene" data-start="${scene.start.toFixed(1)}" data-duration="${scene.duration.toFixed(1)}" data-track-index="1">
        ${glow}
        ${ghostWord}
        <div class="checklist-container" style="position:relative;z-index:2;max-width:70%;">
          ${itemsHtml}
        </div>
      </div>`;
}

function generateBodyScene(scene, s, sceneIndex) {
  const id = `scene${sceneIndex}`;
  const isLong = scene.text.length > 120;
  const fontSize = isLong ? '32px' : '44px';

  const glow = `<div class="radial-glow" style="position:absolute;top:60%;left:30%;width:500px;height:500px;background:radial-gradient(circle,${s.glowColor},transparent 70%);pointer-events:none;"></div>`;
  const accentLine = `<div class="accent-line" style="position:absolute;left:40px;top:50%;width:3px;height:40%;background:${s.accent};transform:translateY(-50%);opacity:0.4;border-radius:2px;"></div>`;
  const coordLabel = `<div class="coord-label" style="position:absolute;bottom:20px;left:24px;font-size:14px;font-family:monospace;color:${s.sub};opacity:0.3;">0:${String(Math.floor(scene.start)).padStart(2,'0')}</div>`;
  const dataBar = `<div class="data-bar" style="position:absolute;bottom:0;left:0;width:${Math.random() * 30 + 20}%;height:3px;background:${s.accent};opacity:0.2;"></div>`;

  return `
      <div id="${id}" class="clip scene body-scene" data-start="${scene.start.toFixed(1)}" data-duration="${scene.duration.toFixed(1)}" data-track-index="1">
        ${glow}
        ${accentLine}
        ${coordLabel}
        ${dataBar}
        <div class="body-text" style="font-size:${fontSize};font-weight:400;color:${s.text};line-height:1.5;max-width:70%;position:relative;z-index:2;text-align:left;opacity:0;">
          ${escapeHtml(scene.text)}
        </div>
      </div>`;
}

function generateQuoteScene(scene, s, sceneIndex) {
  const id = `scene${sceneIndex}`;

  const glow = `<div class="radial-glow" style="position:absolute;top:50%;left:50%;width:400px;height:400px;background:radial-gradient(circle,${s.glowColor},transparent 70%);transform:translate(-50%,-50%);pointer-events:none;"></div>`;
  const grain = `<div class="grain" style="position:absolute;inset:0;opacity:0.04;background-image:url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\"><filter id=\"n\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.9\" numOctaves=\"4\" stitchTiles=\"stitch\"/></filter><rect width=\"100%\" height=\"100%\" filter=\"url(%23n)\" opacity=\"1\"/></svg>');pointer-events:none;"></div>`;

  return `
      <div id="${id}" class="clip scene quote-scene" data-start="${scene.start.toFixed(1)}" data-duration="${scene.duration.toFixed(1)}" data-track-index="1">
        ${glow}
        ${grain}
        <div class="quote-mark" style="font-size:120px;color:${s.accent};opacity:0.3;line-height:0.8;position:relative;z-index:2;">"</div>
        <div class="quote-text" style="font-size:36px;font-weight:300;color:${s.text};line-height:1.4;max-width:65%;font-style:italic;position:relative;z-index:2;opacity:0;">
          ${escapeHtml(scene.text.replace(/^["'""']/, '').replace(/["'""']$/, ''))}
        </div>
      </div>`;
}

function generateClosingScene(scene, s, sceneIndex) {
  const id = `scene${sceneIndex}`;

  const glow = `<div class="radial-glow" style="position:absolute;top:50%;left:50%;width:600px;height:600px;background:radial-gradient(circle,${s.glowColor},transparent 70%);transform:translate(-50%,-50%);pointer-events:none;"></div>`;
  const accentLine = `<div class="accent-line" style="width:0;height:3px;background:${s.accent};margin-top:24px;border-radius:2px;"></div>`;

  return `
      <div id="${id}" class="clip scene closing-scene" data-start="${scene.start.toFixed(1)}" data-duration="${scene.duration.toFixed(1)}" data-track-index="1">
        ${glow}
        <div class="headline" style="font-size:72px;font-weight:800;color:${s.text};letter-spacing:-0.03em;line-height:1.1;text-align:center;max-width:80%;position:relative;z-index:2;opacity:0;">
          ${escapeHtml(scene.text)}
        </div>
        ${accentLine}
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
        // Headline slides up, accent line expands, glow breathes
        tlCode += `
      // Title scene entrance
      tl.fromTo("#scene${i} .headline", { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 0.7, ease: "expo.out" }, ${(t + 0.15).toFixed(2)});
      tl.fromTo("#scene${i} .accent-line", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power4.out" }, ${(t + 0.6).toFixed(2)});
      tl.to("#scene${i} .radial-glow", { scale: 1.1, duration: ${scene.duration.toFixed(1)}, ease: "sine.inOut", repeat: -1, yoyo: true }, ${t.toFixed(2)});
      tl.to("#scene${i} .coord-label", { opacity: 0.4, duration: 0.5 }, ${(t + 0.8).toFixed(2)});`;
        // Exit
        if (i < scenes.length - 1) {
          const exitT = t + scene.duration - 0.6;
          tlCode += `
      tl.to("#scene${i} .headline", { opacity: 0, y: -30, duration: 0.4, ease: "power2.in" }, ${exitT.toFixed(2)});
      tl.to("#scene${i} .accent-line", { opacity: 0, duration: 0.3 }, ${(exitT + 0.1).toFixed(2)});`;
        }
        break;
      }

      case 'stats': {
        // Stats already have their own entrance tweens from generateStatsScene
        // Add ambient motion + exit
        tlCode += `
      tl.to("#scene${i} .radial-glow", { scale: 1.05, duration: ${scene.duration.toFixed(1)}, ease: "sine.inOut", repeat: -1, yoyo: true }, ${t.toFixed(2)});`;
        if (i < scenes.length - 1) {
          const exitT = t + scene.duration - 0.5;
          tlCode += `
      tl.to("#scene${i} .stat-card", { opacity: 0, scale: 0.9, duration: 0.3, stagger: 0.05, ease: "power2.in" }, ${exitT.toFixed(2)});`;
        }
        break;
      }

      case 'checklist': {
        // Items already have their own entrance tweens
        // Add ambient + exit
        tlCode += `
      tl.to("#scene${i} .radial-glow", { x: 10, duration: ${scene.duration.toFixed(1)}, ease: "sine.inOut", repeat: -1, yoyo: true }, ${t.toFixed(2)});`;
        if (i < scenes.length - 1) {
          const exitT = t + scene.duration - 0.5;
          tlCode += `
      tl.to("#scene${i} .checklist-item", { opacity: 0, x: -40, duration: 0.3, stagger: 0.04, ease: "power2.in" }, ${exitT.toFixed(2)});`;
        }
        break;
      }

      case 'body': {
        // Body text slides in from left
        tlCode += `
      tl.fromTo("#scene${i} .body-text", { opacity: 0, x: 60 }, { opacity: 1, x: 0, duration: 0.6, ease: "power3.out" }, ${(t + 0.2).toFixed(2)});
      tl.fromTo("#scene${i} .accent-line", { scaleY: 0 }, { scaleY: 1, duration: 0.4, ease: "power2.out" }, ${(t + 0.3).toFixed(2)});
      tl.to("#scene${i} .radial-glow", { scale: 1.08, duration: ${scene.duration.toFixed(1)}, ease: "sine.inOut", repeat: -1, yoyo: true }, ${t.toFixed(2)});
      tl.fromTo("#scene${i} .data-bar", { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "none" }, ${t.toFixed(2)});`;
        if (i < scenes.length - 1) {
          const exitT = t + scene.duration - 0.4;
          tlCode += `
      tl.to("#scene${i} .body-text", { opacity: 0, duration: 0.3, ease: "power2.in" }, ${exitT.toFixed(2)});`;
        }
        break;
      }

      case 'quote': {
        // Quote mark scales in, text fades up
        tlCode += `
      tl.fromTo("#scene${i} .quote-mark", { opacity: 0, scale: 0.3 }, { opacity: 0.3, scale: 1, duration: 0.5, ease: "back.out(2)" }, ${(t + 0.1).toFixed(2)});
      tl.fromTo("#scene${i} .quote-text", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, ${(t + 0.4).toFixed(2)});
      tl.to("#scene${i} .radial-glow", { scale: 1.1, duration: ${scene.duration.toFixed(1)}, ease: "sine.inOut", repeat: -1, yoyo: true }, ${t.toFixed(2)});`;
        if (i < scenes.length - 1) {
          const exitT = t + scene.duration - 0.5;
          tlCode += `
      tl.to("#scene${i} .quote-text", { opacity: 0, duration: 0.4, ease: "power2.in" }, ${exitT.toFixed(2)});
      tl.to("#scene${i} .quote-mark", { opacity: 0, scale: 0.5, duration: 0.3 }, ${(exitT + 0.1).toFixed(2)});`;
        }
        break;
      }

      case 'closing': {
        // Big scale-up reveal
        tlCode += `
      tl.fromTo("#scene${i} .headline", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.8, ease: "expo.out" }, ${(t + 0.2).toFixed(2)});
      tl.fromTo("#scene${i} .accent-line", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power4.out" }, ${(t + 0.8).toFixed(2)});
      tl.to("#scene${i} .radial-glow", { scale: 1.15, duration: ${scene.duration.toFixed(1)}, ease: "sine.inOut", repeat: -1, yoyo: true }, ${t.toFixed(2)});`;
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
  const isVertical = height > width;

  // Parse the prompt into structured content
  const parsed = parsePrompt(prompt);

  // Plan scenes across the timeline
  const scenes = planScenes(parsed, duration);

  // Generate HTML for each scene
  let scenesHtml = '';
  for (let i = 0; i < scenes.length; i++) {
    switch (scenes[i].type) {
      case 'title':
        scenesHtml += generateTitleScene(scenes[i], s, width, height, i);
        break;
      case 'stats':
        scenesHtml += generateStatsScene(scenes[i], s, i);
        break;
      case 'checklist':
        scenesHtml += generateChecklistScene(scenes[i], s, i);
        break;
      case 'body':
        scenesHtml += generateBodyScene(scenes[i], s, i);
        break;
      case 'quote':
        scenesHtml += generateQuoteScene(scenes[i], s, i);
        break;
      case 'closing':
        scenesHtml += generateClosingScene(scenes[i], s, i);
        break;
    }
  }

  // Build the full GSAP timeline
  const timelineCode = buildTimeline(scenes, s);

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
    @media (max-width: 800px) {
      .scene { padding: 40px; }
      .headline { font-size: 48px !important; }
      .stat-value { font-size: 40px !important; }
      .check-text { font-size: 22px !important; }
      .body-text { font-size: 24px !important; }
    }
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