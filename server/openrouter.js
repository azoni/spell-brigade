// ===========================================
// OPENROUTER API - Shared LLM utility
// ===========================================

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = 'openai/gpt-4o-mini'; // Cheapest option

export function isLLMEnabled() {
  return !!OPENROUTER_API_KEY;
}

/**
 * Call OpenRouter with a system + user prompt, expect JSON back.
 * Returns parsed JSON or null on failure.
 */
export async function llmGenerate(systemPrompt, userPrompt, maxTokens = 1000) {
  if (!OPENROUTER_API_KEY) {
    console.warn('⚠️ OPENROUTER_API_KEY not set, LLM features disabled');
    return null;
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://spell-brigade.onrender.com',
        'X-Title': 'Spell Brigade',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        temperature: 0.8,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`OpenRouter API error ${res.status}: ${errText}`);
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    // Parse JSON (strip markdown fences if present)
    const cleaned = content.replace(/```json\s*|```\s*/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('OpenRouter call failed:', err.message);
    return null;
  }
}
