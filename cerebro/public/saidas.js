// Gráficos (Chart.js), PDF (jsPDF) e Excel (.xlsx montado com JSZip). Tudo acontece NO NAVEGADOR, com os dados que a tela já recebeu:
// nada é enviado de volta ao servidor e nenhum arquivo fica guardado nele.
(function () {
  const PALETA = ["#193C8E", "#2563EB", "#F97316", "#16A34A", "#0EA5E9", "#A855F7", "#EAB308", "#DC2626", "#64748B", "#14B8A6", "#EC4899", "#84CC16"];
  const brNum = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  const semAnim = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const nomeSeguro = (t) => String(t || "sira").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "sira";
  const carimbo = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };
  const agoraBR = () => new Date().toLocaleString("pt-BR");
  function baixar(blob, nome) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

  // ---------- gráfico ----------
  // g = { tipo: barras|linhas|pizza, ix, iy }; dados = linhas com os valores reais (sem grupos suprimidos)
  function grafico(canvas, g, dados, colunas) {
    if (!window.Chart || !g || !dados || !dados.length) return null;
    const labels = dados.map((r) => String(r[g.ix])), valores = dados.map((r) => Number(r[g.iy]));
    const rot = (colunas && colunas[g.iy] && colunas[g.iy].rotulo) || "Total";
    const eixo = { grid: { color: "#E2E8F0" }, ticks: { color: "#475569" } };
    const base = { responsive: true, maintainAspectRatio: false, animation: semAnim() ? false : { duration: 350 }, plugins: { legend: { display: g.tipo === "pizza", position: "right", labels: { color: "#334155", boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${brNum.format(c.parsed.y ?? c.parsed.x ?? c.parsed)}` } } } };
    let cfg;
    if (g.tipo === "pizza") cfg = { type: "doughnut", data: { labels, datasets: [{ data: valores, backgroundColor: labels.map((_, i) => PALETA[i % PALETA.length]), borderColor: "#fff", borderWidth: 2 }] }, options: base };
    else if (g.tipo === "linhas") cfg = { type: "line", data: { labels, datasets: [{ label: rot, data: valores, borderColor: PALETA[1], backgroundColor: "rgba(37,99,235,.12)", fill: true, tension: 0.25, pointRadius: 3, pointBackgroundColor: PALETA[0] }] }, options: { ...base, scales: { x: { ...eixo, grid: { display: false } }, y: { ...eixo, beginAtZero: true } } } };
    else { const horiz = labels.length > 6 || labels.some((l) => l.length > 14); cfg = { type: "bar", data: { labels, datasets: [{ label: rot, data: valores, backgroundColor: PALETA[1], borderRadius: 4, maxBarThickness: 38 }] }, options: { ...base, indexAxis: horiz ? "y" : "x", scales: horiz ? { x: { ...eixo, beginAtZero: true }, y: { ...eixo, grid: { display: false } } } : { x: { ...eixo, grid: { display: false } }, y: { ...eixo, beginAtZero: true } } } }; }
    return new window.Chart(canvas, cfg);
  }
  // Altura sugerida do gráfico conforme o tipo e a quantidade de categorias.
  const altura = (g, n) => (g.tipo === "pizza" ? 280 : g.tipo === "barras" && (n > 6) ? Math.min(560, 70 + n * 30) : 300);

  // ---------- Excel ----------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const letra = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const numBR = (v) => (typeof v === "string" && /^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(v) ? Number(v.replace(/\./g, "").replace(",", ".")) : null);
  async function excel({ titulo, colunas, linhas, info = [] }) {
    if (!window.JSZip) throw new Error("Biblioteca de Excel não carregada.");
    const z = new window.JSZip(), ncol = colunas.length;
    const larg = colunas.map((c, j) => Math.min(60, Math.max(10, String(c.rotulo).length + 2, ...linhas.slice(0, 500).map((l) => String(l[j] ?? "").length + 2))));
    const cel = (r, c, v, est) => { const ref = letra(c) + r, n = colunas[c] && colunas[c].numerica ? numBR(v) : null; return n !== null && r > 1 ? `<c r="${ref}"${est ? ` s="${est}"` : ""}><v>${n}</v></c>` : `<c r="${ref}" t="inlineStr"${est ? ` s="${est}"` : ""}><is><t xml:space="preserve">${esc(v ?? "")}</t></is></c>`; };
    let dados = `<row r="1">${colunas.map((c, j) => cel(1, j, c.rotulo, 1)).join("")}</row>`;
    linhas.forEach((l, i) => { dados += `<row r="${i + 2}">${l.map((v, j) => cel(i + 2, j, v, colunas[j].numerica ? 2 : 0)).join("")}</row>`; });
    const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${larg.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${dados}</sheetData><autoFilter ref="A1:${letra(ncol - 1)}${Math.max(1, linhas.length + 1)}"/></worksheet>`;
    const infoLinhas = [["Relatório", titulo], ["Gerado em", agoraBR()], ...info, ["Origem", "SIRA — Desenvolvido por BeMo Sistemas"]];
    const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="2" width="110" customWidth="1"/></cols><sheetData>${infoLinhas.map((p, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr" s="1"><is><t>${esc(p[0])}</t></is></c><c r="B${i + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(p[1])}</t></is></c></row>`).join("")}</sheetData></worksheet>`;
    z.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
    z.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    z.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dados" sheetId="1" r:id="rId1"/><sheet name="Informações" sheetId="2" r:id="rId2"/></sheets></workbook>`);
    z.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    z.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF193C8E"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
    z.file("xl/worksheets/sheet1.xml", sheet1); z.file("xl/worksheets/sheet2.xml", sheet2);
    const blob = await z.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE" });
    const nome = `SIRA_${nomeSeguro(titulo)}_${carimbo()}.xlsx`; baixar(blob, nome); return nome;
  }

  // ---------- PDF ----------
  function novoPdf(paisagem) { const { jsPDF } = window.jspdf || {}; if (!jsPDF) throw new Error("Biblioteca de PDF não carregada."); return new jsPDF({ unit: "pt", format: "a4", orientation: paisagem ? "landscape" : "portrait" }); }
  function cabecalho(doc, titulo, quem) {
    const w = doc.internal.pageSize.getWidth();
    doc.setFillColor(25, 60, 142); doc.rect(0, 0, w, 46, "F"); doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text("SIRA", 40, 30);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(String(quem.cliente || ""), w - 40, 22, { align: "right" }); doc.text(agoraBR(), w - 40, 36, { align: "right" });
    doc.setTextColor(10, 30, 57); doc.setFont("helvetica", "bold"); doc.setFontSize(15); const linhas = doc.splitTextToSize(titulo, w - 80); doc.text(linhas, 40, 78); return 78 + linhas.length * 18;
  }
  function rodapes(doc, quem) {
    const n = doc.internal.getNumberOfPages(), w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100, 116, 139); doc.text(`SIRA — Desenvolvido por BeMo Sistemas${quem.usuario ? " · Gerado por " + quem.usuario : ""}`, 40, h - 22); doc.text(`Página ${i} de ${n}`, w - 40, h - 22, { align: "right" }); }
  }
  function bloco(doc, y, titulo, texto, cor) {
    const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight(); const linhas = doc.splitTextToSize(String(texto), w - 80);
    if (y + 30 + linhas.length * 11 > h - 50) { doc.addPage(); y = 50; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...(cor || [25, 60, 142])); doc.text(titulo, 40, y); doc.setFont("helvetica", "normal"); doc.setTextColor(51, 65, 85); doc.text(linhas, 40, y + 13); return y + 18 + linhas.length * 11;
  }
  // r = { titulo, texto, colunas, linhas, canvas, criterio, premissas[], aviso, quem:{usuario,cliente} }
  function pdf(r) {
    const doc = novoPdf(r.colunas && r.colunas.length > 5), w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight(); const quem = r.quem || {};
    let y = cabecalho(doc, r.titulo, quem);
    if (r.texto && r.texto !== r.titulo) { doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(51, 65, 85); const t = doc.splitTextToSize(r.texto, w - 80); doc.text(t, 40, y + 4); y += 10 + t.length * 14; }
    if (r.canvas && r.canvas.width) { const iw = Math.min(w - 80, 520), ih = iw * (r.canvas.height / r.canvas.width); if (y + ih > h - 60) { doc.addPage(); y = 50; } doc.addImage(r.canvas.toDataURL("image/png"), "PNG", 40, y + 6, iw, ih); y += ih + 18; }
    if (r.colunas && r.linhas && r.linhas.length) {
      doc.autoTable({ startY: y + 6, head: [r.colunas.map((c) => c.rotulo)], body: r.linhas.map((l) => l.map((v) => String(v ?? ""))), margin: { left: 40, right: 40, bottom: 50 }, styles: { font: "helvetica", fontSize: 9, cellPadding: 4, textColor: [30, 41, 59] }, headStyles: { fillColor: [25, 60, 142], textColor: 255, fontStyle: "bold" }, alternateRowStyles: { fillColor: [244, 247, 252] },
        columnStyles: Object.fromEntries(r.colunas.map((c, i) => [i, c.numerica ? { halign: "right" } : {}])) });
      y = doc.lastAutoTable.finalY + 16;
    }
    if (r.aviso) y = bloco(doc, y, "Aviso", r.aviso, [154, 52, 18]);
    if (r.criterio) y = bloco(doc, y, "Como foi calculado", r.criterio);
    if (r.premissas && r.premissas.length) y = bloco(doc, y, "Como a pergunta foi interpretada", r.premissas.map((p) => "• " + p).join("\n"));
    rodapes(doc, quem); const nome = `SIRA_${nomeSeguro(r.titulo)}_${carimbo()}.pdf`; doc.save(nome); return nome;
  }
  // Painel inteiro: um bloco por item (título, número ou gráfico, tabela curta).
  function pdfPainel(itens, quem) {
    const doc = novoPdf(false), w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight(); let y = cabecalho(doc, "Meu painel", quem) + 6;
    for (const it of itens) {
      const alt = it.canvas && it.canvas.width ? 250 : it.valorUnico ? 70 : 40; if (y + alt > h - 60) { doc.addPage(); y = 50; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(10, 30, 57); doc.text(doc.splitTextToSize(it.titulo, w - 80), 40, y); y += 18;
      if (it.erro) { doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(153, 27, 27); doc.text(it.erro, 40, y); y += 24; continue; }
      if (it.valorUnico) { doc.setFont("helvetica", "bold"); doc.setFontSize(28); doc.setTextColor(25, 60, 142); doc.text(String(it.valorUnico), 40, y + 26); y += 50; continue; }
      if (it.canvas && it.canvas.width) { const iw = Math.min(w - 80, 480), ih = iw * (it.canvas.height / it.canvas.width); if (y + ih > h - 60) { doc.addPage(); y = 50; } doc.addImage(it.canvas.toDataURL("image/png"), "PNG", 40, y, iw, ih); y += ih + 16; }
      else if (it.colunas && it.linhas) { doc.autoTable({ startY: y, head: [it.colunas.map((c) => c.rotulo)], body: it.linhas.slice(0, 30).map((l) => l.map(String)), margin: { left: 40, right: 40, bottom: 50 }, styles: { fontSize: 9, cellPadding: 3 }, headStyles: { fillColor: [25, 60, 142] } }); y = doc.lastAutoTable.finalY + 16; }
    }
    rodapes(doc, quem); const nome = `SIRA_painel_${carimbo()}.pdf`; doc.save(nome); return nome;
  }
  window.SIRA_SAIDAS = { grafico, altura, excel, pdf, pdfPainel, PALETA };
})();
