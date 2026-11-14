// Turn an AI answer (markdown) into a downloadable PDF or Word (.docx) file.
import JSZip from "jszip";

function parseBlocks(markdown) {
  const blocks = [];
  let inCode = false;
  for (const raw of String(markdown || "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (/^```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) { blocks.push({ type: "code", text: line }); continue; }
    if (!line.trim()) { blocks.push({ type: "gap" }); continue; }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) blocks.push({ type: "h", level: m[1].length, text: clean(m[2]) });
    else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) blocks.push({ type: "li", text: clean(m[1]) });
    else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) blocks.push({ type: "li", text: `${m[1]}. ${clean(m[2])}` });
    else if (/^\s*\|/.test(line)) { if (!/^\s*\|[\s:|-]+\|?\s*$/.test(line)) blocks.push({ type: "p", text: clean(line.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => c.trim()).join("   |   ")) }); }
    else blocks.push({ type: "p", text: clean(line) });
  }
  return blocks;
}

function clean(text) {
  return String(text)
    .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\$\$?([^$]+)\$\$?/g, "$1").replace(/[^\x09\x0A\x20-\x7E -ɏ–—‘’“”•]/g, "");
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const safeName = (t) => (String(t).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 50) || "Global-AI");

export async function downloadPdf(title, markdown) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56;
  let y = M;
  const write = (text, { size = 11, bold = false, mono = false, indent = 0, gap = 6 } = {}) => {
    doc.setFont(mono ? "courier" : "helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, W - M * 2 - indent);
    for (const l of lines) {
      if (y + size > H - M) { doc.addPage(); y = M; }
      doc.text(l, M + indent, y);
      y += size * 1.35;
    }
    y += gap;
  };
  write(title || "Global AI", { size: 20, bold: true, gap: 4 });
  doc.setDrawColor(26, 134, 255); doc.line(M, y - 2, W - M, y - 2); y += 12;
  for (const b of parseBlocks(markdown)) {
    if (b.type === "gap") y += 4;
    else if (b.type === "h") write(b.text, { size: b.level === 1 ? 16 : b.level === 2 ? 14 : 12, bold: true, gap: 4 });
    else if (b.type === "li") write(`•  ${b.text}`, { indent: 12, gap: 2 });
    else if (b.type === "code") write(b.text || " ", { size: 9.5, mono: true, indent: 10, gap: 0 });
    else write(b.text);
  }
  doc.save(`${safeName(title)}.pdf`);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function downloadDocx(title, markdown) {
  const run = (t, extra = "") => `<w:r><w:rPr>${extra}</w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  const para = (inner, ppr = "") => `<w:p><w:pPr>${ppr}</w:pPr>${inner}</w:p>`;
  const body = [para(run(title || "Global AI", '<w:b/><w:sz w:val="40"/>'))];
  for (const b of parseBlocks(markdown)) {
    if (b.type === "gap") continue;
    if (b.type === "h") body.push(para(run(b.text, `<w:b/><w:sz w:val="${b.level === 1 ? 32 : b.level === 2 ? 28 : 24}"/>`), '<w:spacing w:before="200" w:after="80"/>'));
    else if (b.type === "li") body.push(para(run(`•  ${b.text}`), '<w:ind w:left="360"/><w:spacing w:after="40"/>'));
    else if (b.type === "code") body.push(para(run(b.text || " ", '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="19"/>'), '<w:ind w:left="240"/><w:spacing w:after="0"/>'));
    else body.push(para(run(b.text), '<w:spacing w:after="120"/>'));
  }
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  save(blob, `${safeName(title)}.docx`);
}
