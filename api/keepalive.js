import { createClient } from '@supabase/supabase-js';

// Lightweight keep-alive endpoint, triggered daily by Vercel Cron (see vercel.json).
// Supabase free-tier projects pause automatically after ~7 days with no activity.
// This endpoint performs a trivial read so the project always shows recent activity
// and never silently goes offline between user sessions.
export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return res.status(500).json({ ok: false, error: 'Missing Supabase environment variables' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    // Cheapest possible real query — just count rows, don't fetch data.
    const { error, count } = await supabase
      .from('dossiers')
      .select('share_id', { count: 'exact', head: true });

    if (error) {
      return res.status(500).json({ ok: false, error: error.message, time: new Date().toISOString() });
    }

    return res.status(200).json({ ok: true, dossier_count: count, time: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, time: new Date().toISOString() });
  }
}
