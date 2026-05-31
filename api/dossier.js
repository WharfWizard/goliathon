export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  
  return res.status(200).json({
    hasUrl: !!url,
    hasKey: !!key,
    urlStart: url ? url.substring(0, 20) : 'MISSING',
    keyStart: key ? key.substring(0, 10) : 'MISSING',
  });
}