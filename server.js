/**
 * Local dev server for Animated Transitions
 * Serves the frontend + proxies AI requests to GitHub Models
 * Run: npm start
 */
const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Serve static files (index.html, etc.) from the project root
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// ------------------------------------------------------------------
// System prompt — tells the AI what JSON to return
// ------------------------------------------------------------------
const SYSTEM_PROMPT = `You are an animation parameter generator for a pixel grid animation tool.
The tool renders greyscale animations on a grid. Given a user's text description,
return a JSON object with animation parameters.

Available animation types and what they do:
- "edges-to-center": brightness fades in from outer edges toward the center
- "sweep-right": horizontal wipe from left to right
- "radial-pulse": a ring of brightness expands outward from center
- "diagonal-wipe": brightness sweeps from top-left to bottom-right
- "noise-fade": organic, random-looking fade in based on noise pattern

You MUST respond with ONLY a valid JSON object (no markdown, no explanation) in this exact format:
{
  "animation": "one of the types listed above",
  "duration": number between 1 and 10 (seconds for one cycle),
  "easing": "power1.inOut" or "power2.inOut" or "power3.inOut" or "power4.inOut" or "none.none" or "circ.inOut",
  "yoyo": true or false (whether animation reverses),
  "suggestedMode": "glyphs" or "bands" or "modern" (which pixel mode fits best)
}

Pick the animation type that best matches the user's description.
If the description is ambiguous, make your best creative choice.
Adjust duration based on words like "slowly" (longer) or "quickly" (shorter).
Pick easing that matches the mood: power1 is gentle, power4 is dramatic, circ is mechanical.
Suggest a pixel mode: glyphs for bold/simple, bands for medium, modern for detailed/subtle.`;

// ------------------------------------------------------------------
// API endpoint: POST /api/generate
// ------------------------------------------------------------------
app.post('/api/generate', async (req, res) => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({
      error: 'GITHUB_TOKEN not set. Run: set GITHUB_TOKEN=your_token_here'
    });
  }

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
        temperature: 0.7,
        max_tokens: 200
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: 'AI request failed', detail: errText });
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim();

    // Parse JSON from AI response
    let params;
    try {
      params = JSON.parse(content);
    } catch (e) {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        params = JSON.parse(match[0]);
      } else {
        return res.status(502).json({ error: 'AI returned invalid format', raw: content });
      }
    }

    // Validate
    const validAnimations = ['edges-to-center', 'sweep-right', 'radial-pulse', 'diagonal-wipe', 'noise-fade'];
    const validModes = ['glyphs', 'bands', 'modern'];
    const validEasings = ['power1.inOut', 'power2.inOut', 'power3.inOut', 'power4.inOut', 'none.none', 'circ.inOut'];

    res.json({
      animation: validAnimations.includes(params.animation) ? params.animation : 'edges-to-center',
      duration: typeof params.duration === 'number' ? Math.max(1, Math.min(10, params.duration)) : 3,
      easing: validEasings.includes(params.easing) ? params.easing : 'power2.inOut',
      yoyo: typeof params.yoyo === 'boolean' ? params.yoyo : true,
      suggestedMode: validModes.includes(params.suggestedMode) ? params.suggestedMode : 'bands'
    });

  } catch (err) {
    res.status(500).json({ error: 'Internal error', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Animated Transitions is running at:\n`);
  console.log(`  → http://localhost:${PORT}\n`);
  if (!process.env.GITHUB_TOKEN) {
    console.log(`  ⚠ AI is disabled — set GITHUB_TOKEN to enable it`);
    console.log(`  Run: set GITHUB_TOKEN=ghp_your_token_here\n`);
  } else {
    console.log(`  ✓ AI is connected\n`);
  }
});
