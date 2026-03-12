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

// Use the shared activity logger
import { logActivity } from './activity-logger.js';

/**
 * Call LLM with a system + user prompt, expect JSON back.
 * Auto-detects Anthropic vs OpenRouter from key format.
 * quality: 'standard' = Haiku (fast), 'premium' = Sonnet (higher quality)
 * context: { type, promptSnippet } - optional, for activity logging
 */
export async function llmGenerate(systemPrompt, userPrompt, maxTokens = 1500, quality = 'premium', context = {}) {
  if (!API_KEY) {
    console.warn('⚠️ No API key set (ANTHROPIC_API_KEY or OPENROUTER_API_KEY), LLM disabled');
    return null;
  }

  try {
    if (isAnthropicKey()) {
      return await callAnthropic(systemPrompt, userPrompt, maxTokens, quality, context);
    } else {
      return await callOpenRouter(systemPrompt, userPrompt, maxTokens, quality, context);
    }
  } catch (err) {
    console.error('LLM call failed:', err.message);
    return null;
  }
}

async function callAnthropic(systemPrompt, userPrompt, maxTokens, quality = 'premium', context = {}) {
  const model = quality === 'standard' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-5-20250929';
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

  // Strip markdown fences if present
  let cleaned = content.replace(/```json\s*|```\s*/g, '').trim();
  
  // Extract outermost JSON object
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  
  try {
    const parsed = JSON.parse(cleaned);

    // Activity logging
    const usage = data.usage || {};
    const isHaiku = quality === 'standard';
    const inputCost = (usage.input_tokens || 0) / 1e6 * (isHaiku ? 0.80 : 3.00);
    const outputCost = (usage.output_tokens || 0) / 1e6 * (isHaiku ? 4.00 : 15.00);

    const activityType = context.type || (systemPrompt.includes('wizard') ? 'wizard_created' : systemPrompt.includes('dungeon') ? 'dungeon_created' : 'spell_brigade_ai');
    const activityTitle = context.type === 'dungeon_created'
      ? `Dungeon: ${parsed.name || 'Unknown'}`
      : `Wizard: ${parsed.name || 'Unknown'}`;

    logActivity({
      type: activityType,
      title: activityTitle,
      description: parsed.description || '',
      model,
      tokens: {
        prompt: usage.input_tokens || 0,
        completion: usage.output_tokens || 0,
        total: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      },
      cost: inputCost + outputCost,
      metadata: { quality, name: parsed.name || null },
    });

    return parsed;
  } catch (e) {
    console.error('Anthropic JSON parse error:', e.message, 'Content start:', cleaned.slice(0, 100));
    return null;
  }
}

async function callOpenRouter(systemPrompt, userPrompt, maxTokens, quality = 'premium', context = {}) {
  // OpenRouter uses different model identifiers than Anthropic direct API
  // Allow env override: OPENROUTER_MODEL_STANDARD / OPENROUTER_MODEL_PREMIUM
  const model = quality === 'standard'
    ? (process.env.OPENROUTER_MODEL_STANDARD || 'anthropic/claude-3.5-haiku')
    : (process.env.OPENROUTER_MODEL_PREMIUM || 'anthropic/claude-sonnet-4-5');
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
  const parsed = JSON.parse(cleaned);

  // Activity logging (OpenRouter usage is in data.usage)
  const usage = data.usage || {};

  const activityType = context.type || (systemPrompt.includes('wizard') ? 'wizard_created' : systemPrompt.includes('dungeon') ? 'dungeon_created' : 'spell_brigade_ai');
  const activityTitle = context.type === 'dungeon_created'
    ? `Dungeon: ${parsed.name || 'Unknown'}`
    : `Wizard: ${parsed.name || 'Unknown'}`;

  logActivity({
    type: activityType,
    title: activityTitle,
    description: parsed.description || '',
    model,
    tokens: {
      prompt: usage.prompt_tokens || 0,
      completion: usage.completion_tokens || 0,
      total: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    },
    cost: usage.total_cost || 0,
    metadata: { quality, name: parsed.name || null },
  });

  return parsed;
}
