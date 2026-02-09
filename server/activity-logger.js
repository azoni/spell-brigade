/**
 * Activity logger - fire-and-forget POST to azoni.ai activity feed.
 * 
 * Usage:
 *   import { logActivity } from './activity-logger.js';
 *   
 *   logActivity({
 *     type: 'wizard_created',
 *     title: 'AI Wizard: Pepperoni Mage',
 *     description: 'Custom wizard class via Claude Sonnet',
 *     model: 'claude-sonnet-4',
 *     tokens: { prompt: 800, completion: 1200, total: 2000 },
 *     cost: 0.0144,
 *     metadata: { wizardName: 'Pepperoni Mage', prompt: 'pizza wizard' }
 *   });
 */

const ACTIVITY_WEBHOOK_URL = 'https://azoni.ai/.netlify/functions/log-agent-activity';
const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET || '';

export function logActivity({ type, title, description, reasoning, model, tokens, cost, metadata }) {
  if (!WEBHOOK_SECRET) return;

  fetch(ACTIVITY_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      title,
      description: description || '',
      reasoning: reasoning || '',
      source: 'spell-brigade',
      model,
      tokens,
      cost,
      metadata: metadata || {},
      secret: WEBHOOK_SECRET,
    }),
  }).catch((e) => console.error('[activity-log] Failed:', e.message));
}
