import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET /api/dossier?share_id=xxx — load a dossier by share link
  if (req.method === 'GET') {
    const { share_id } = req.query;
    if (!share_id) return res.status(400).json({ error: 'share_id required' });
    const { data, error } = await supabase
      .from('dossiers')
      .select('*')
      .eq('share_id', share_id)
      .single();
    if (error) return res.status(404).json({ error: 'Dossier not found' });
    return res.status(200).json(data);
  }

  // POST /api/dossier — create a new dossier
  if (req.method === 'POST') {
    const { share_id, case_title, overview, timeline, witness_statement, next_steps, evidence } = req.body;
    const { data, error } = await supabase
      .from('dossiers')
      .insert([{ share_id, case_title, overview, timeline, witness_statement, next_steps, evidence }])
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // PUT /api/dossier — update existing dossier
  if (req.method === 'PUT') {
    const { share_id, ...updates } = req.body;
    if (!share_id) return res.status(400).json({ error: 'share_id required' });
    const { data, error } = await supabase
      .from('dossiers')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('share_id', share_id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  return res.status(405).end();
}