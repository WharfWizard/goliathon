import mammoth from 'mammoth';
import MsgReader from 'msgreader';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { filename, mediaType, data } = req.body;
  if (!filename || !data) return res.status(400).json({ error: 'filename and data required' });

  try {
    const buffer = Buffer.from(data, 'base64');
    const ext = filename.split('.').pop().toLowerCase();
    let text = '';

    if (ext === 'html' || ext === 'htm') {
      // Strip HTML tags to readable text
      const html = buffer.toString('utf8');
      text = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<\/td>/gi, '\t')
        .replace(/<\/th>/gi, '\t')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\t{2,}/g, '\t')
        .replace(/ {2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    else if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value.trim();
    }

    else if (ext === 'doc') {
      // DOC files - try mammoth first, fall back to buffer text extraction
      try {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value.trim();
      } catch {
        // Extract readable text from DOC binary
        text = buffer.toString('latin1')
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ')
          .replace(/ {3,}/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
          .substring(0, 10000);
      }
    }

    else if (ext === 'msg') {
      const msgReader = new MsgReader(buffer);
      const fileData = msgReader.getFileData();
      const parts = [];
      if (fileData.subject) parts.push(`Subject: ${fileData.subject}`);
      if (fileData.senderName) parts.push(`From: ${fileData.senderName}`);
      if (fileData.senderEmail) parts.push(`Email: ${fileData.senderEmail}`);
      if (fileData.recipients?.length) {
        const to = fileData.recipients.map(r => r.name || r.email || '').filter(Boolean).join(', ');
        if (to) parts.push(`To: ${to}`);
      }
      if (fileData.creationTime) parts.push(`Date: ${fileData.creationTime}`);
      parts.push('');
      if (fileData.body) parts.push(fileData.body.trim());
      else if (fileData.bodyHTML) {
        const bodyText = fileData.bodyHTML
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        parts.push(bodyText);
      }
      if (fileData.attachments?.length) {
        parts.push('');
        parts.push(`Attachments (${fileData.attachments.length}): ${fileData.attachments.map(a => a.fileName || 'unnamed').join(', ')}`);
      }
      text = parts.join('\n').trim();
    }

    else {
      return res.status(400).json({ error: `Unsupported file type: .${ext}` });
    }

    if (!text || text.length < 10) {
      return res.status(422).json({ error: 'Could not extract readable text from this file' });
    }

    return res.status(200).json({ text, filename, ext });

  } catch (e) {
    return res.status(500).json({ error: `Conversion failed: ${e.message}` });
  }
}