// ===========================================
// LLM API - Supports Anthropic direct + OpenRouter fallback
// ===========================================

const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY || '';

function isAnthropicKey() {
  return API_KEY.startsWith('sk-ant-');
}

export function isLLMEnabled() {
  return !!API_KEY;
}

/**
 * Call LLM with a system + user prompt, expect JSON back.
 * Auto-detects Anthropic vs OpenRouter from key format.
 * quality: 'standard' = Haiku (fast), 'premium' = Sonnet (higher quality)
 */
export async function llmGenerate(systemPrompt, userPrompt, maxTokens = 1500, quality = 'premium') {
  if (!API_KEY) {
    console.warn('⚠️ No API key set (ANTHROPIC_API_KEY or OPENROUTER_API_KEY), LLM disabled');
    return null;
  }

  try {
    if (isAnthropicKey()) {
      return await callAnthropic(systemPrompt, userPrompt, maxTokens, quality);
    } else {
      return await callOpenRouter(systemPrompt, userPrompt, maxTokens, quality);
    }
  } catch (err) {
    console.error('LLM call failed:', err.message);
    return null;
  }
}

async function callAnthropic(systemPrompt, userPrompt, maxTokens, quality = 'premium') {
  const model = quality === 'standard' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-20250514';
  console.log(`🤖 Calling Anthropic API (${quality === 'standard' ? 'Haiku - Standard' : 'Sonnet - Premium'})...`);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
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

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

async function callOpenRouter(systemPrompt, userPrompt, maxTokens, quality = 'premium') {
  // OpenRouter uses different model identifiers than Anthropic direct API
  // Allow env override: OPENROUTER_MODEL_STANDARD / OPENROUTER_MODEL_PREMIUM
  const model = quality === 'standard'
    ? (process.env.OPENROUTER_MODEL_STANDARD || 'anthropic/claude-3.5-haiku')
    : (process.env.OPENROUTER_MODEL_PREMIUM || 'anthropic/claude-sonnet-4');
  console.log(`🤖 Calling OpenRouter API (${model})...`);
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://spell-brigade.onrender.com',
      'X-Title': 'Spell Brigade',
    },
    body: JSON.stringify({
      model,
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
