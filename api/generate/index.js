/**
 * Azure Function: /api/generate
 * Receives a user prompt, sends it to GitHub Models (GPT-4o-mini),
 * and returns structured animation parameters.
 *
 * The GitHub token is stored as an application setting (GITHUB_TOKEN)
 * in the Azure Static Web App — never in code.
 */

// System prompt tells the AI exactly what JSON to return
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

module.exports = async function (context, req) {
  // CORS headers for the frontend
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // Handle preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers };
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    context.res = {
      status: 500,
      headers,
      body: { error: 'AI not configured — GITHUB_TOKEN missing' }
    };
    return;
  }

  const userPrompt = req.body && req.body.prompt;
  if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.length > 500) {
    context.res = {
      status: 400,
      headers,
      body: { error: 'Missing or invalid prompt (max 500 chars)' }
    };
    return;
  }

  try {
    // Call GitHub Models API (OpenAI-compatible endpoint)
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
      context.res = {
        status: 502,
        headers,
        body: { error: 'AI request failed', detail: errText }
      };
      return;
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim();

    // Parse the JSON response from the AI
    let params;
    try {
      params = JSON.parse(content);
    } catch (e) {
      // If AI returned non-JSON, try to extract JSON from the response
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        params = JSON.parse(match[0]);
      } else {
        context.res = {
          status: 502,
          headers,
          body: { error: 'AI returned invalid format', raw: content }
        };
        return;
      }
    }

    // Validate and sanitize the response
    const validAnimations = ['edges-to-center', 'sweep-right', 'radial-pulse', 'diagonal-wipe', 'noise-fade'];
    const validModes = ['glyphs', 'bands', 'modern'];
    const validEasings = ['power1.inOut', 'power2.inOut', 'power3.inOut', 'power4.inOut', 'none.none', 'circ.inOut'];

    const result = {
      animation: validAnimations.includes(params.animation) ? params.animation : 'edges-to-center',
      duration: typeof params.duration === 'number' ? Math.max(1, Math.min(10, params.duration)) : 3,
      easing: validEasings.includes(params.easing) ? params.easing : 'power2.inOut',
      yoyo: typeof params.yoyo === 'boolean' ? params.yoyo : true,
      suggestedMode: validModes.includes(params.suggestedMode) ? params.suggestedMode : 'bands'
    };

    context.res = {
      status: 200,
      headers,
      body: result
    };

  } catch (err) {
    context.res = {
      status: 500,
      headers,
      body: { error: 'Internal error', detail: err.message }
    };
  }
};
