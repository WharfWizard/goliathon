import { createClient } from '@supabase/supabase-js';

// Chat-with-case endpoint. Loads the case's dossier + evidence + timeline from
// Supabase fresh on every call, layers on the conversation history, and streams
// the response back via Server-Sent Events so long answers (e.g. drafted letters)
// render progressively instead of blocking on Vercel's 60s function timeout.
//
// Uses raw fetch() against the Anthropic API directly, matching the pattern
// already used in api/claude.js — no @anthropic-ai/sdk dependency needed.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { caseId, message } = req.body || {};
  if (!caseId || !message) {
    return res.status(400).json({ error: 'caseId and message are required' });
  }

  // NOTE: the Anthropic key is stored in Vercel as VITE_ANTHROPIC_API_KEY
  // (not ANTHROPIC_API_KEY) — matching whatever name api/claude.js expects,
  // confirmed against the project's actual Environment Variables settings.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.VITE_ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Missing required environment variables' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

  // 1. Load the case's dossier + evidence + timeline.
  // Field names confirmed against the actual dossiers schema on 8 Aug 2026:
  // id, share_id (text), created_at, updated_at, case_title, overview,
  // timeline (jsonb), witness_statement, next_steps, evidence (jsonb),
  // decision_summary, key_questions, institution_response.
  const { data: caseData, error: caseError } = await supabase
    .from('dossiers')
    .select('*')
    .eq('share_id', caseId)
    .single();

  if (caseError || !caseData) {
    return res.status(404).json({ error: 'Case not found' });
  }

  // 2. Load prior chat history for this case
  const { data: history, error: historyError } = await supabase
    .from('case_chat_messages')
    .select('role, content')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true });

  if (historyError) {
    return res.status(500).json({ error: 'Failed to load chat history' });
  }

  // 3. Save the incoming user message before generating a response, so it's
  // persisted even if the model call fails partway through.
  const { error: insertUserError } = await supabase.from('case_chat_messages').insert({
    case_id: caseId,
    role: 'user',
    content: message,
  });

  if (insertUserError) {
    return res.status(500).json({ error: 'Failed to save message' });
  }

  // 4. Build the system prompt from case context
  const systemPrompt = buildCaseContextPrompt(caseData);

  // 5. Call Anthropic's API directly with stream: true
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
        system: systemPrompt,
        stream: true,
        messages: [
          ...history.map((h) => ({ role: h.role, content: h.content })),
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

  // 6. Stream the response back to our own client as SSE, parsing Anthropic's
  // SSE format (event: content_block_delta, data: {"delta":{"text":"..."}})
  // as we go, and re-emitting just the text in a simpler shape.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

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
      buffer = lines.pop(); // keep any incomplete line for the next chunk

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue; // skip malformed chunk
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

    // 7. Save the assistant's full response once streaming completes
    await supabase.from('case_chat_messages').insert({
      case_id: caseId,
      role: 'assistant',
      content: fullResponse,
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    // If we already streamed partial content, save what we have so it's not lost.
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
