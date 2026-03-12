const MCP_URL = process.env.MCP_URL || 'https://azoni-mcp.onrender.com';
const MCP_KEY = process.env.MCP_ADMIN_KEY;

/**
 * Fire-and-forget activity logger — logs to MCP ecosystem feed.
 */
export function logActivity({ type, title, description, model, tokens, cost, metadata }) {
  if (!MCP_KEY) return;
  fetch(`${MCP_URL}/activity/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MCP_KEY}` },
    body: JSON.stringify({
      type, title, source: 'spell-brigade',
      description: description || '', model, tokens, cost, metadata,
    }),
  }).catch(e => console.error('[activity-log] Failed:', e.message));
}
