import { createClient } from '@supabase/supabase-js';

// How many prior messages (user + assistant combined) to resend as context
// on each turn. Without a cap, every message in a long session resends the
// FULL history plus the full case context every single time — so a 30-turn
// conversation makes message 30 cost roughly 30x what message 1 cost, in
// input tokens alone. Full history is still saved to and loaded from the
// database for the UI and for edit/delete — this cap only limits what's
// actually sent to Claude as context on each new turn.
const MAX_HISTORY_MESSAGES = 20;

// Maximum number of user messages a single case can send within a rolling
// 24-hour window. This exists so one case's sustained chat use can never,
// on its own, consume the whole organisation's monthly Anthropic budget —
// which is what happened before this was added. 30/day is a starting
// point, not a carefully measured figure — worth tuning against real usage
// data once you can see actual per-message cost in the Anthropic console.
const MAX_MESSAGES_PER_CASE_PER_DAY = 30;

// Chat-with-case endpoint. Handles three operations:
//   GET    ?caseId=...              — load existing chat history for a case
//   POST   {caseId, message}        — send a message, stream back the reply
//   DELETE {caseId, messageId}      — remove one message (user or assistant)
//
// Uses raw fetch() against the Anthropic API directly, matching the pattern
// already used in api/claude.js — no @anthropic-ai/sdk dependency needed.
export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Missing required environment variables' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

  // --- GET: load existing chat history for a case, so the chat panel can
  // show past messages again after a refresh or reopen. ---
  if (req.method === 'GET') {
    const { caseId } = req.query;
    if (!caseId) return res.status(400).json({ error: 'caseId is required' });

    const { data, error } = await supabase
      .from('case_chat_messages')
      .select('id, role, content, created_at')
      .eq('case_id', caseId)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ messages: data || [] });
  }

  // --- DELETE: remove one specific message. Requires both id and caseId to
  // match, so a message can't be deleted by guessing an id alone. ---
  if (req.method === 'DELETE') {
    const { caseId, messageId } = req.body || {};
    if (!caseId || !messageId) {
      return res.status(400).json({ error: 'caseId and messageId are required' });
    }

    const { error } = await supabase
      .from('case_chat_messages')
      .delete()
      .eq('id', messageId)
      .eq('case_id', caseId);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deleted: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- POST: send a message, stream back Claude's reply. ---
  const { caseId, message } = req.body || {};
  if (!caseId || !message) {
    return res.status(400).json({ error: 'caseId and message are required' });
  }

  if (!process.env.VITE_ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Missing required environment variables' });
  }

  // 1. Check the per-case daily limit before doing anything expensive.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount, error: countError } = await supabase
    .from('case_chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .eq('role', 'user')
    .gte('created_at', oneDayAgo);

  if (countError) {
    return res.status(500).json({ error: 'Failed to check usage limit' });
  }

  if (recentCount !== null && recentCount >= MAX_MESSAGES_PER_CASE_PER_DAY) {
    return res.status(429).json({
      error: `You've reached today's chat limit for this case (${MAX_MESSAGES_PER_CASE_PER_DAY} messages). This resets automatically as earlier messages age past 24 hours — please try again later today or tomorrow.`,
    });
  }

  // 2. Load the case's dossier + evidence + timeline
  const { data: caseData, error: caseError } = await supabase
    .from('dossiers')
    .select('*')
    .eq('share_id', caseId)
    .single();

  if (caseError || !caseData) {
    return res.status(404).json({ error: 'Case not found' });
  }

  // 3. Load prior chat history for this case (full history — used for the
  // UI/edit/delete elsewhere; only trimmed at the point we build the
  // request to Claude, below).
  const { data: history, error: historyError } = await supabase
    .from('case_chat_messages')
    .select('role, content')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true });

  if (historyError) {
    return res.status(500).json({ error: 'Failed to load chat history' });
  }

  // 4. Save the incoming user message and capture its id, so we can send it
  // back to the client for future edit/delete.
  const { data: insertedUser, error: insertUserError } = await supabase
    .from('case_chat_messages')
    .insert({ case_id: caseId, role: 'user', content: message })
    .select('id')
    .single();

  if (insertUserError) {
    return res.status(500).json({ error: 'Failed to save message' });
  }

  // 5. Build the system prompt from case context, marked as cacheable.
  // Anthropic caches everything up to and including the block carrying
  // cache_control — since the case context is identical on every turn of a
  // session, this means only the FIRST message in a session pays full
  // price for it; every message within the following 5 minutes (the cache
  // lifetime, refreshed on each use) reads it back at a large discount
  // instead of reprocessing it. Minimum cacheable size is ~1024 tokens,
  // which this prompt comfortably exceeds once evidence and timeline data
  // are included.
  const systemPrompt = buildCaseContextPrompt(caseData);

  // 6. Trim history to the most recent MAX_HISTORY_MESSAGES entries before
  // sending — see that constant's comment above for why.
  const trimmedHistory = history.slice(-MAX_HISTORY_MESSAGES);

  // 7. Call Anthropic's API directly with stream: true
  let anthropicResponse;
  try {
    anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.VITE_ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
        ],
        stream: true,
        messages: [
          ...trimmedHistory.map((h) => ({ role: h.role, content: h.content })),
          { role: 'user', content: message },
        ],
      }),
    });
  } catch (e) {
    return res.status(502).json({ error: 'Failed to reach Anthropic API' });
  }

  if (!anthropicResponse.ok || !anthropicResponse.body) {
    const errText = await anthropicResponse.text().catch(() => 'Unknown error');
    return res.status(anthropicResponse.status).json({ error: errText });
  }

  // 8. Stream the response back to our own client as SSE.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Tell the client the user message's id right away, so it can attach it
  // to the message it already rendered optimistically.
  res.write(`data: ${JSON.stringify({ userMessageId: insertedUser.id })}\n\n`);

  const reader = anthropicResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          fullResponse += parsed.delta.text;
          res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`);
        }

        if (parsed.type === 'error') {
          res.write(`data: ${JSON.stringify({ error: parsed.error?.message || 'Anthropic API error' })}\n\n`);
        }
      }
    }

    // 9. Save the assistant's full response and send its id back too.
    const { data: insertedAssistant } = await supabase
      .from('case_chat_messages')
      .insert({ case_id: caseId, role: 'assistant', content: fullResponse })
      .select('id')
      .single();

    if (insertedAssistant) {
      res.write(`data: ${JSON.stringify({ assistantMessageId: insertedAssistant.id })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    if (fullResponse) {
      await supabase.from('case_chat_messages').insert({
        case_id: caseId,
        role: 'assistant',
        content: fullResponse,
      });
    }
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
}

function buildCaseContextPrompt(caseData) {
  return `You are Goliathon, an evidence-organisation assistant helping a self-representing litigant understand and work with their own case. You are not a solicitor and do not give legal advice or state legal conclusions as fact.

CASE TITLE:
${caseData.case_title || 'Not available'}

OVERVIEW:
${caseData.overview || 'Not available'}

TIMELINE:
${JSON.stringify(caseData.timeline || [], null, 2)}

EVIDENCE LIBRARY:
${JSON.stringify(caseData.evidence || [], null, 2)}

WITNESS STATEMENT:
${caseData.witness_statement || 'Not available'}

DECISION-MAKER SUMMARY:
${caseData.decision_summary || 'Not available'}

KEY QUESTIONS:
${caseData.key_questions || 'Not available'}

INSTITUTION'S LIKELY RESPONSE:
${caseData.institution_response || 'Not available'}

NEXT STEPS ALREADY IDENTIFIED:
${caseData.next_steps || 'Not available'}

RULES:
- Answer only from the case context above and the conversation history. If something isn't in the evidence, say so plainly rather than filling the gap.
- Keep the same fact/interpretation discipline as the dossier: clearly separate what the evidence shows from what you think it may indicate.
- If asked to draft an email, letter, or formal response, draft it, but end with a short reminder to review it carefully before sending, since it's based on Goliathon's reading of the case, not a legal opinion.
- If a question strays into asking you to predict a court's decision or guarantee an outcome, decline and explain why, then help with what's actually knowable from the evidence.`;
}
