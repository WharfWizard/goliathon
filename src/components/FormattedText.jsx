// Turns AI-written text into clean, readable blocks.
//
// Claude often writes light markdown: headings, **bold**, *italics*,
// numbered and bulleted lists, tables and rules. Shown raw, those symbols
// make replies hard to read. This renders the common ones properly and
// quietly removes any leftover symbols, so asterisks, hashes and pipes
// never reach the screen. No dependency: it handles only what Goliathon
// actually receives.

const YELLOW = "#ffc72c", BORDER = "#003a6e";

// Removes symbols we don't render: inline code ticks, link syntax,
// stray emphasis markers left unpaired.
function tidy(s) {
  return String(s)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\\([*_#|`])/g, "$1");
}

// Bold and italics inside one line. Anything unmatched is stripped of
// its markers rather than shown.
export function InlineText({ text }) {
  const s = tidy(text);
  const parts = s.split(/(\*\*[^*\n]+?\*\*|__[^_\n]+?__)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part) || /^__[^_]+__$/.test(part)) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    const sub = part.split(/(\*[^*\s][^*\n]*?\*)/g);
    return sub.map((p, j) =>
      /^\*[^*\s][^*\n]*\*$/.test(p) ? (
        <em key={`${i}-${j}`}>{p.slice(1, -1)}</em>
      ) : (
        p.replace(/\*\*/g, "")
      )
    );
  });
}

function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export default function FormattedText({ text, color, fontSize = 13, lineHeight = 1.7 }) {
  if (text == null || text === "") return null;
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let para = [];   // consecutive plain lines
  let list = [];   // {marker, text, indent}
  let table = [];  // rows of cells

  const flushPara = (k) => {
    if (!para.length) return;
    blocks.push(
      <p key={`p${k}`} style={{ margin: "0 0 8px" }}>
        {para.map((l, i) => (
          <span key={i}>
            {i > 0 && <br />}
            <InlineText text={l} />
          </span>
        ))}
      </p>
    );
    para = [];
  };
  const flushList = (k) => {
    if (!list.length) return;
    blocks.push(
      <div key={`l${k}`} style={{ margin: "0 0 8px" }}>
        {list.map((it, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4, paddingLeft: it.indent ? 18 : 0 }}>
            <span style={{ flexShrink: 0, minWidth: it.marker === "•" ? 10 : 18, color: YELLOW, fontWeight: 600 }}>{it.marker}</span>
            <span style={{ flex: 1 }}><InlineText text={it.text} /></span>
          </div>
        ))}
      </div>
    );
    list = [];
  };
  const flushTable = (k) => {
    if (!table.length) return;
    const [head, ...body] = table;
    blocks.push(
      <div key={`t${k}`} style={{ overflowX: "auto", margin: "0 0 10px" }}>
        <table style={{ borderCollapse: "collapse", fontSize: fontSize - 1, width: "100%" }}>
          <thead>
            <tr>{head.map((c, i) => <th key={i} style={{ textAlign: "left", padding: "4px 8px", borderBottom: `1px solid ${BORDER}`, color: YELLOW }}><InlineText text={c} /></th>)}</tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>{r.map((c, i) => <td key={i} style={{ padding: "4px 8px", borderBottom: `1px solid ${BORDER}`, verticalAlign: "top" }}><InlineText text={c} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    table = [];
  };
  const flushAll = (k) => { flushPara(k); flushList(k); flushTable(k); };

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara(i); flushList(i);
      if (/^\s*\|?\s*:?-{2,}/.test(line)) return; // separator row
      table.push(splitRow(line));
      return;
    }
    if (table.length) flushTable(i);

    const heading = line.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*$/);
    if (heading) {
      flushAll(i);
      blocks.push(
        <div key={`h${i}`} style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: fontSize + 1, color: YELLOW, margin: "10px 0 4px" }}>
          <InlineText text={heading[1].replace(/\*\*/g, "")} />
        </div>
      );
      return;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll(i);
      blocks.push(<div key={`r${i}`} style={{ borderTop: `1px solid ${BORDER}`, margin: "8px 0" }} />);
      return;
    }
    const bullet = line.match(/^(\s*)[-*+•]\s+(.*)$/);
    const numbered = line.match(/^(\s*)(\d{1,2})[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushPara(i);
      list.push(
        bullet
          ? { marker: "•", text: bullet[2], indent: bullet[1].length >= 2 }
          : { marker: `${numbered[2]}.`, text: numbered[3], indent: numbered[1].length >= 2 }
      );
      return;
    }
    if (line.trim() === "") { flushAll(i); return; }
    // Indented text straight after a list item continues that item.
    if (list.length && /^\s{2,}\S/.test(raw)) {
      list[list.length - 1].text += " " + line.trim();
      return;
    }
    flushList(i);
    para.push(line.replace(/^\s*>\s?/, ""));
  });
  flushAll("end");

  return <div style={{ color, fontSize, lineHeight }}>{blocks}</div>;
}
