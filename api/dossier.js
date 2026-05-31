import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Missing Supabase environment variables' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  if (req.method === 'GET') {
    const { share_id } = req.query;
    if (!share_id) return res.status(400).json({ error: 'share_id required' });
    const { data, error } = await supabase
      .from('dossiers')
      .select('*')
      .eq('share_id', share_id)
      .single();
    if (error) return res.status(404).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const { share_id, case_title, overview, timeline, witness_statement, next_steps, evidence } = req.body;
    // Upsert — insert or update if share_id already exists
    const { data, error } = await supabase
      .from('dossiers')
      .upsert(
        { share_id, case_title, overview, timeline, witness_statement, next_steps, evidence, updated_at: new Date().toISOString() },
        { onConflict: 'share_id' }
      )
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'PUT') {
    const { share_id, ...updates } = req.body;
    if (!share_id) return res.status(400).json({ error: 'share_id required' });
    // Upsert on PUT as well for reliability
    const { data, error } = await supabase
      .from('dossiers')
      .upsert(
        { share_id, ...updates, updated_at: new Date().toISOString() },
        { onConflict: 'share_id' }
      )
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  return res.status(405).end();
}