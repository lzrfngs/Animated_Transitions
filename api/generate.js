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

const SYSTEM_PROMPT = `You are a creative coder who generates pixel animation functions.

You will receive a text description of an animation. Your job is to write a JavaScript function body that computes the brightness of each pixel at each moment in time.

THE CONTRACT:
- Your function receives three arguments: x, y, t
  - x: horizontal position, 0 (left) to 1 (right)
  - y: vertical position, 0 (top) to 1 (bottom)
  - t: time through the animation cycle, 0 to 1
- Your function must return a number between 0 and 1
  - 0 = black, 1 = white
- The animation is ALWAYS greyscale — no exceptions

AVAILABLE HELPER FUNCTIONS (already defined, just call them):
- smoothstep(edge0, edge1, x) — smooth interpolation
- clamp(val, min, max) — clamp a value
- fract(x) — fractional part of x
- mix(a, b, t) — linear interpolation between a and b
- hash(x, y) — pseudo-random value 0–1 based on position

RULES:
1. Respond with ONLY a JSON object — no markdown, no explanation, no backticks
2. The "code" field contains the function body as a string
3. The function body must be valid JavaScript
4. Use Math.sin, Math.cos, Math.sqrt, Math.abs, Math.PI, Math.atan2 freely
5. Keep the code under 800 characters
6. Make it visually interesting — not just a simple threshold
7. The animation should loop smoothly (t=0 and t=1 should connect)
8. Be creative! Match the mood and feeling of the prompt

RESPONSE FORMAT:
{
  "code": "const dx = x - 0.5; const dy = y - 0.5; const dist = Math.sqrt(dx*dx + dy*dy); return smoothstep(0.1, 0, Math.abs(dist - t * 0.7));",
  "duration": 3,
  "yoyo": true,
  "suggestedMode": "bands"
}

- duration: 1–10 seconds per cycle. Slow/gentle = longer, fast/energetic = shorter
- yoyo: true = animation reverses, false = loops from start
- suggestedMode: "glyphs" (bold, 12x12), "bands" (medium, 40x40), "modern" (detailed, 100x100)

EXAMPLES:

Prompt: "ripple from center"
{
  "code": "const dx = x - 0.5; const dy = y - 0.5; const dist = Math.sqrt(dx*dx + dy*dy); const wave = Math.sin(dist * 20 - t * Math.PI * 2); return clamp(wave * 0.5 + 0.5, 0, 1);",
  "duration": 2,
  "yoyo": false,
  "suggestedMode": "modern"
}

Prompt: "the letter A"
{
  "code": "const cx = (x - 0.5) * 2; const cy = (y - 0.2) * 1.5; const leg1 = Math.abs(cx + cy * 0.4) < 0.08; const leg2 = Math.abs(cx - cy * 0.4) < 0.08; const bar = Math.abs(cy - 0.35) < 0.05 && Math.abs(cx) < cy * 0.4; const shape = (leg1 || leg2 || bar) && cy > 0 && cy < 1; const reveal = smoothstep(t - 0.1, t + 0.1, 1 - y); return shape ? reveal : 0;",
  "duration": 3,
  "yoyo": true,
  "suggestedMode": "modern"
}

Prompt: "slow snow falling"
{
  "code": "let b = 0; for (let i = 0; i < 8; i++) { const sx = hash(i * 0.1, 0.5) ; const sy = fract(hash(0.5, i * 0.1) + t * (0.3 + hash(i*0.2, 0.3) * 0.4)); const d = Math.sqrt((x-sx)*(x-sx) + (y-sy)*(y-sy)); b += smoothstep(0.03, 0, d); } return clamp(b, 0, 1);",
  "duration": 6,
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
