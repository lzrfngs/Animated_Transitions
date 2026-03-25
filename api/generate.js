var SYSTEM_PROMPT = 'You generate threshold maps for a pixel grid transition tool.\n\nHOW THE TOOL WORKS:\nThe tool creates transitions: white screen to black screen to white screen.\nYOU control the PATTERN of how pixels go dark. The tool handles the timing.\n\nYOUR JOB:\nWrite a function body that returns a THRESHOLD VALUE for each pixel.\n- Receives: x (0-1 left to right), y (0-1 top to bottom)\n- Returns: a number between 0 and 1\n- This number determines WHEN that pixel goes dark during the transition\n- Pixels with threshold 0 go dark FIRST, pixels with threshold 1 go dark LAST\n\nThe tool will sweep through thresholds 0 to 1 then 1 to 0 automatically.\nYou do NOT handle time (t). You only decide the spatial pattern.\n\nAVAILABLE HELPERS:\n- smoothstep(edge0, edge1, x)\n- clamp(val, min, max)\n- fract(x) fractional part\n- mix(a, b, t) linear interpolation\n- hash(x, y) deterministic random 0-1 per position\n- Math.sin, Math.cos, Math.sqrt, Math.abs, Math.PI, Math.atan2, Math.floor\n\nRULES:\n1. Return ONLY a JSON object, no markdown, no backticks, no text\n2. The code field is a JS function body string\n3. The function receives x and y ONLY (no t)\n4. MUST return a value between 0 and 1, always end with: return clamp(result, 0, 1)\n5. NEVER use Math.random(), use hash(x, y) for randomness\n6. Keep code under 400 characters\n7. Be creative with the spatial pattern!\n\nFORMAT:\n{"code": "...function body returning threshold 0-1...", "duration": 3, "suggestedMode": "bands"}\n\n- duration: seconds for full cycle. Slow = 5-8, normal = 3-4, fast = 1-2\n- suggestedMode: glyphs (chunky 12x12), bands (medium 40x40), modern (detailed 100x100)\n\nEXAMPLES:\n\nPrompt: left to right\n{"code": "return clamp(x, 0, 1);", "duration": 3, "suggestedMode": "bands"}\n\nPrompt: from center outward\n{"code": "var dx = x - 0.5; var dy = y - 0.5; return clamp(Math.sqrt(dx*dx + dy*dy) * 1.4, 0, 1);", "duration": 3, "suggestedMode": "bands"}\n\nPrompt: clouds\n{"code": "var n1 = hash(Math.floor(x*5), Math.floor(y*5)); var n2 = hash(Math.floor(x*10), Math.floor(y*10)); return clamp(mix(n1, n2, 0.4), 0, 1);", "duration": 5, "suggestedMode": "modern"}\n\nPrompt: spiral\n{"code": "var dx = x-0.5; var dy = y-0.5; var a = (Math.atan2(dy,dx)/Math.PI+1)*0.5; var r = Math.sqrt(dx*dx+dy*dy)*2; return clamp(fract(a*2+r), 0, 1);", "duration": 4, "suggestedMode": "modern"}\n\nPrompt: bottom to top\n{"code": "return clamp(1 - y, 0, 1);", "duration": 3, "suggestedMode": "bands"}';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  var token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'AI not configured' });

  var userPrompt = req.body && req.body.prompt;
  if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.length > 500) {
    return res.status(400).json({ error: 'Missing or invalid prompt (max 500 chars)' });
  }

  try {
    var response = await fetch('https://models.inference.ai.azure.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.8,
        max_tokens: 400
      })
    });

    if (!response.ok) {
      var errText = await response.text();
      return res.status(502).json({ error: 'AI request failed', detail: errText });
    }

    var data = await response.json();
    var content = data.choices[0].message.content.trim();

    var params;
    try {
      params = JSON.parse(content);
    } catch (e) {
      var match = content.match(/\{[\s\S]*\}/);
      if (match) {
        params = JSON.parse(match[0]);
      } else {
        return res.status(502).json({ error: 'AI returned invalid format' });
      }
    }

    if (!params.code || typeof params.code !== 'string') {
      return res.status(502).json({ error: 'AI did not return animation code' });
    }

    var validModes = ['glyphs', 'bands', 'modern'];
    return res.status(200).json({
      code: params.code,
      duration: typeof params.duration === 'number' ? Math.max(1, Math.min(10, params.duration)) : 3,
      suggestedMode: validModes.indexOf(params.suggestedMode) !== -1 ? params.suggestedMode : 'bands'
    });

  } catch (err) {
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
};
