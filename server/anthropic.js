// ===========================================
// ANTHROPIC API - Claude-powered LLM utility
// ===========================================

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY || '';
const MODEL = 'claude-sonnet-4-20250514';

// Detect which API to use based on key format
function isAnthropicKey() {
  return ANTHROPIC_API_KEY.startsWith('sk-ant-');
}

export function isLLMEnabled() {
  return !!ANTHROPIC_API_KEY;
}

/**
 * Call Claude with a system + user prompt, expect JSON back.
 * Returns parsed JSON or null on failure.
 * Supports both Anthropic direct and OpenRouter as fallback.
 */
export async function llmGenerate(systemPrompt, userPrompt, maxTokens = 1500) {
  if (!ANTHROPIC_API_KEY) {
    console.warn('⚠️ No API key set, LLM features disabled');
    return null;
  }

  try {
    if (isAnthropicKey()) {
      return await callAnthropic(systemPrompt, userPrompt, maxTokens);
    } else {
      return await callOpenRouter(systemPrompt, userPrompt, maxTokens);
    }
  } catch (err) {
    console.error('LLM call failed:', err.message);
    return null;
  }
}

async function callAnthropic(systemPrompt, userPrompt, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Anthropic API error ${res.status}: ${errText}`);
    return null;
  }

  const data = await res.json();
  const content = data.content?.[0]?.text;
  if (!content) return null;

  // Extract JSON from response (may be wrapped in markdown fences)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

async function callOpenRouter(systemPrompt, userPrompt, maxTokens) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ANTHROPIC_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://spell-brigade.onrender.com',
      'X-Title': 'Spell Brigade',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-20250514',
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

  const cleaned = content.replace(/```json\s*|```\s*/g, '').trim();
  return JSON.parse(cleaned);
}
