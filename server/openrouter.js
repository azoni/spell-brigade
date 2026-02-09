// ===========================================
// LLM API - Supports Anthropic direct + OpenRouter fallback
// Returns { result, usage } where usage has token/cost info
// ===========================================

const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY || '';

// Cost per 1M tokens (input/output)
const MODEL_COSTS = {
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
  'anthropic/claude-sonnet-4': { input: 3.00, output: 15.00 },
  'anthropic/claude-3.5-haiku': { input: 1.00, output: 5.00 },
};

function isAnthropicKey() {
  return API_KEY.startsWith('sk-ant-');
}

export function isLLMEnabled() {
  return !!API_KEY;
}

function estimateCost(model, inputTokens, outputTokens) {
  const rates = MODEL_COSTS[model] || { input: 3.00, output: 15.00 };
  return (inputTokens / 1e6) * rates.input + (outputTokens / 1e6) * rates.output;
}

/**
 * Call LLM with a system + user prompt, expect JSON back.
 * Auto-detects Anthropic vs OpenRouter from key format.
 * quality: 'standard' = Haiku (fast), 'premium' = Sonnet (higher quality)
 * 
 * Returns { result, usage } or { result: null, usage: null } on failure.
 *   result = parsed JSON object
 *   usage = { model, promptTokens, completionTokens, totalTokens, cost }
 */
export async function llmGenerate(systemPrompt, userPrompt, maxTokens = 1500, quality = 'premium') {
  if (!API_KEY) {
    console.warn('⚠️ No API key set (ANTHROPIC_API_KEY or OPENROUTER_API_KEY), LLM disabled');
    return { result: null, usage: null };
  }

  try {
    if (isAnthropicKey()) {
      return await callAnthropic(systemPrompt, userPrompt, maxTokens, quality);
    } else {
      return await callOpenRouter(systemPrompt, userPrompt, maxTokens, quality);
    }
  } catch (err) {
    console.error('LLM call failed:', err.message);
    return { result: null, usage: null };
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
    return { result: null, usage: null };
  }

  const data = await res.json();
  const content = data.content?.[0]?.text;
  if (!content) return { result: null, usage: null };

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { result: null, usage: null };

  const result = JSON.parse(jsonMatch[0]);

  // Anthropic returns usage as input_tokens / output_tokens
  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;

  return {
    result,
    usage: {
      model,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
      cost: estimateCost(model, inputTokens, outputTokens),
    },
  };
}

async function callOpenRouter(systemPrompt, userPrompt, maxTokens, quality = 'premium') {
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
    return { result: null, usage: null };
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return { result: null, usage: null };

  const cleaned = content.replace(/```json\s*|```\s*/g, '').trim();
  const result = JSON.parse(cleaned);

  // OpenRouter returns usage as prompt_tokens / completion_tokens
  const inputTokens = data.usage?.prompt_tokens || 0;
  const outputTokens = data.usage?.completion_tokens || 0;

  return {
    result,
    usage: {
      model,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
      cost: estimateCost(model, inputTokens, outputTokens),
    },
  };
}
