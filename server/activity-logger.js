const MCP_URL = process.env.MCP_URL || 'https://azoni-mcp.onrender.com';
const MCP_KEY = process.env.MCP_ADMIN_KEY;
const PORTFOLIO_URL = 'https://azoni.netlify.app/.netlify/functions/log-agent-activity';
const PORTFOLIO_SECRET = process.env.AGENT_WEBHOOK_SECRET;

/**
 * Fire-and-forget activity logger — logs to portfolio Firestore and MCP.
 */
export function logActivity({ type, title, description, model, tokens, cost, metadata }) {
  // Write to portfolio Firestore (primary — what the dashboard reads)
  if (PORTFOLIO_SECRET) {
    fetch(PORTFOLIO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type, title, source: 'spell-brigade',
        description: description || '', model, tokens, cost, metadata,
        secret: PORTFOLIO_SECRET,
      }),
    }).catch(e => console.error('[activity-log] Portfolio write failed:', e.message));
  }

  // Also forward to MCP
  if (MCP_KEY) {
    fetch(`${MCP_URL}/activity/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MCP_KEY}` },
      body: JSON.stringify({
        type, title, source: 'spell-brigade',
        description: description || '', model, tokens, cost, metadata,
      }),
    }).catch(e => console.error('[activity-log] MCP write failed:', e.message));
  }
}
