/**
 * Vercel Serverless Function: /api/generate
 * Receives a user prompt, sends it to GitHub Models (GPT-4o-mini),
 * and returns a custom JavaScript brightness function.
 *
 * The AI generates a function body that computes per-pixel brightness.
 * Contract: function(x, y, t) → number 0–1
 *   x = horizontal position 0–1 (left to right)
 *   y = vertical position 0–1 (top to bottom)
 *   t = time 0–1 (one animation cycle)
 *   returns brightness 0 (black) to 1 (white)
 */

const SYSTEM_PROMPT = `You generate transition animations for a pixel grid tool.

WHAT THIS TOOL DOES:
Every animation is a TRANSITION: the screen starts pure white, transitions to pure black, then back to pure white. The user's prompt describes the STYLE of that transition — how the black spreads across the screen and recedes.

THE CONTRACT:
- You write a JavaScript function body receiving: x, y, t
  - x: position 0 (left) to 1 (right)
  - y: position 0 (top) to 1 (bottom)  
  - t: transition progress 0 to 1 (0 = all white, ~0.5 = peak black, 1 = all white again)
- Return a number 0 to 1 (0 = black, 1 = white)
- At t=0: EVERY pixel must return 1 (pure white)
- At t=1: EVERY pixel must return 1 (pure white)
- Between t=0 and t=1: pixels go dark in a pattern shaped by the user's prompt

THE KEY TECHNIQUE — threshold-based reveal:
Assign each pixel a "threshold" value based on its position. Pixels whose threshold is close to the current time t go dark. This naturally creates a wave of darkness that sweeps through then recedes.

Basic pattern:
  const threshold = [some value 0–1 based on x, y, and the prompt's shape];
  const dist = Math.abs(threshold - t);
  return smoothstep(0, width, dist);

Where "width" controls how sharp the transition edge is (0.05 = sharp, 0.2 = soft).

AVAILABLE HELPERS (already defined):
- smoothstep(edge0, edge1, x)
- clamp(val, min, max)
- fract(x)
- mix(a, b, t)
- hash(x, y) — deterministic random 0–1 per position

ABSOLUTE RULES:
1. ONLY return a JSON object — no markdown, no backticks, no explanation
2. The "code" must be a valid JS function body string
3. ALWAYS clamp your return value: return clamp(result, 0, 1)
4. NEVER use Math.random() — use hash(x, y) for randomness
5. Keep code under 600 characters
6. NO flickering — output must be smooth and stable
7. The transition must be SMOOTH — no sudden jumps
8. yoyo MUST be false (the function handles its own white→black→white cycle)

RESPONSE FORMAT:
{
  "code": "...function body...",
  "duration": 3,
  "yoyo": false,
  "suggestedMode": "bands"
}

EXAMPLES:

Prompt: "clouds"
{
  "code": "const n1 = hash(Math.floor(x*6), Math.floor(y*6)); const n2 = hash(Math.floor(x*3+0.5), Math.floor(y*3+0.5)); const cloud = mix(n1, n2, 0.5); const threshold = cloud * 0.8 + 0.1; const dist = Math.abs(threshold - t); return clamp(smoothstep(0, 0.15, dist), 0, 1);",
  "duration": 5,
  "yoyo": false,
  "suggestedMode": "modern"
}

Prompt: "left to right"
{
  "code": "const threshold = x; const dist = Math.abs(threshold - t); return clamp(smoothstep(0, 0.08, dist), 0, 1);",
  "duration": 3,
  "yoyo": false,
  "suggestedMode": "bands"
}

Prompt: "spiral"
{
  "code": "const dx = x - 0.5; const dy = y - 0.5; const angle = (Math.atan2(dy, dx) / Math.PI + 1) * 0.5; const dist2 = Math.sqrt(dx*dx + dy*dy) * 2; const threshold = fract(angle + dist2 * 0.5); const d = Math.abs(threshold - t); return clamp(smoothstep(0, 0.1, d), 0, 1);",
  "duration": 4,
  "yoyo": false,
  "suggestedMode": "modern"
}

Prompt: "the letter M"
{
  "code": "const gx = x * 10 - 1; const gy = y * 10 - 1; const w = 0.7; const leg1 = Math.abs(gx - 2) < w; const leg2 = Math.abs(gx - 8) < w; const d1 = Math.abs(gx - 3.5 - (gy - 1) * 0.5) < w * 0.6; const d2 = Math.abs(gx - 6.5 + (gy - 1) * 0.5) < w * 0.6; const inShape = (leg1 || leg2 || (d1 && gy < 5) || (d2 && gy < 5)) && gy > 1 && gy < 9; const threshold = inShape ? y * 0.6 + 0.2 : hash(x, y) * 0.3; const d = Math.abs(threshold - t); return clamp(smoothstep(0, 0.1, d), 0, 1);",
  "duration": 4,
  "yoyo": false,
  "suggestedMode": "modern"
}

Prompt: "rain"
{
  "code": "const col = Math.floor(x * 30); const speed = 0.5 + hash(col * 0.1, 0.5) * 0.5; const threshold = fract(y * 0.3 + hash(col * 0.1, 0.3) + t * speed * 0.5); const d = Math.abs(threshold - 0.5); return clamp(smoothstep(0, 0.12, d), 0, 1);",
  "duration": 4,
  "yoyo": false,
  "suggestedMode": "modern"
}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'AI not configured' });

  const userPrompt = req.body && req.body.prompt;
  if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.length > 500) {
    return res.status(400).json({ error: 'Missing or invalid prompt (max 500 chars)' });
  }

  try {
    const response = await fetch('https://models.inference.ai.azure.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.8,
        max_tokens: 600
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: 'AI request failed', detail: errText });
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim();

    let params;
    try {
      params = JSON.parse(content);
    } catch (e) {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        params = JSON.parse(match[0]);
      } else {
        return res.status(502).json({ error: 'AI returned invalid format' });
      }
    }

    // Validate required fields
    if (!params.code || typeof params.code !== 'string') {
      return res.status(502).json({ error: 'AI did not return animation code' });
    }

    const validModes = ['glyphs', 'bands', 'modern'];

    return res.status(200).json({
      code: params.code,
      duration: typeof params.duration === 'number' ? Math.max(1, Math.min(10, params.duration)) : 3,
      yoyo: typeof params.yoyo === 'boolean' ? params.yoyo : true,
      suggestedMode: validModes.includes(params.suggestedMode) ? params.suggestedMode : 'bands'
    });

  } catch (err) {
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}
