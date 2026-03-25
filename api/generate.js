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

const SYSTEM_PROMPT = `You generate threshold maps for a pixel grid transition tool.

HOW THE TOOL WORKS:
The tool creates transitions: white screen → black screen → white screen.
YOU control the PATTERN of how pixels go dark. The tool handles the timing.

YOUR JOB:
Write a function body that returns a THRESHOLD VALUE for each pixel.
- Receives: x (0–1 left to right), y (0–1 top to bottom)
- Returns: a number between 0 and 1
- This number determines WHEN that pixel goes dark during the transition
- Pixels with threshold 0 go dark FIRST, pixels with threshold 1 go dark LAST

The tool will sweep through thresholds 0→1 then 1→0 automatically.
You do NOT handle time (t). You only decide the spatial pattern.

AVAILABLE HELPERS:
- smoothstep(edge0, edge1, x)
- clamp(val, min, max)  
- fract(x) — fractional part
- mix(a, b, t) — linear interpolation
- hash(x, y) — deterministic random 0–1 per position
- Math.sin, Math.cos, Math.sqrt, Math.abs, Math.PI, Math.atan2, Math.floor

RULES:
1. Return ONLY a JSON object — no markdown, no backticks, no text
2. The "code" field is a JS function body string
3. The function receives x and y ONLY (no t)
4. MUST return a value between 0 and 1 — always end with: return clamp(result, 0, 1)
5. NEVER use Math.random() — use hash(x, y) for randomness
6. Keep code under 400 characters
7. Be creative with the spatial pattern!

FORMAT:
{
  "code": "...function body returning threshold 0-1...",
  "duration": 3,
  "suggestedMode": "bands"
}

- duration: seconds for full white→black→white cycle. Slow = 5–8, normal = 3–4, fast = 1–2
- suggestedMode: "glyphs" (chunky 12×12), "bands" (medium 40×40), "modern" (detailed 100×100)

EXAMPLES:

Prompt: "left to right"
{"code": "return clamp(x, 0, 1);", "duration": 3, "suggestedMode": "bands"}

Prompt: "from center outward"
{"code": "const dx = x - 0.5; const dy = y - 0.5; return clamp(Math.sqrt(dx*dx + dy*dy) * 1.4, 0, 1);", "duration": 3, "suggestedMode": "bands"}

Prompt: "clouds"
{"code": "const n1 = hash(Math.floor(x*5), Math.floor(y*5)); const n2 = hash(Math.floor(x*10), Math.floor(y*10)); return clamp(mix(n1, n2, 0.4), 0, 1);", "duration": 5, "suggestedMode": "modern"}

Prompt: "spiral"
{"code": "const dx = x-0.5; const dy = y-0.5; const a = (Math.atan2(dy,dx)/Math.PI+1)*0.5; const r = Math.sqrt(dx*dx+dy*dy)*2; return clamp(fract(a*2+r), 0, 1);", "duration": 4, "suggestedMode": "modern"}

Prompt: "diagonal"
{"code": "return clamp((x + y) / 2, 0, 1);", "duration": 3, "suggestedMode": "bands"}

Prompt: "random noise"
{"code": "return clamp(hash(x * 50, y * 50), 0, 1);", "duration": 4, "suggestedMode": "modern"}

Prompt: "bottom to top"  
{"code": "return clamp(1 - y, 0, 1);", "duration": 3, "suggestedMode": "bands"}

Prompt: "the letter X"
{"code": "const cx = Math.abs(x-0.5); const cy = Math.abs(y-0.5); const d1 = Math.abs(cx-cy); const d2 = Math.abs(cx+cy-0.5); const shape = Math.min(d1,d2); const inLetter = shape < 0.06; return clamp(inLetter ? y*0.5+0.25 : hash(x*20,y*20)*0.3, 0, 1);", "duration": 4, "suggestedMode": "modern"}`;
{
  "code": "const gx = x * 10 - 1; const gy = y * 10 - 1; const w = 0.7; const leg1 = Math.abs(gx - 2) < w; const leg2 = Math.abs(gx - 8) < w; const d1 = Math.abs(gx - 3.5 - (gy - 1) * 0.5) < w * 0.6; const d2 = Math.abs(gx - 6.5 + (gy - 1) * 0.5) < w * 0.6; const inShape = (leg1 || leg2 || (d1 && gy < 5) || (d2 && gy < 5)) && gy > 1 && gy < 9; const threshold = inShape ? y * 0.6 + 0.2 : hash(x, y) * 0.3; const d = Math.abs(threshold - t); return clamp(smoothstep(0, 0.1, d), 0, 1);",
  "duration": 4,
  "suggestedMode": "modern"}`;

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
