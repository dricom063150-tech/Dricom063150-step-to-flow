/* =====================================================================
   GÉNÉRATEUR XLSX MINIMAL (archive ZIP non compressée + SpreadsheetML)
   Aucune dépendance. Gère : styles par cellule, en-têtes figés, largeurs,
   filtres automatiques, listes déroulantes (dataValidation), lignes de titre.
   Feuille = { name, cols:[largeur], rows:[[cell]], freeze:n, header:n°ligne, filter:bool, lists:[{col, from, to, items}] }
   Cellule = valeur simple ou { v, s:'hdr'|'STEP'|'CALC'|'DEF'|'USER'|'TODO'|'NA'|'txt'|'title'|'sub'|'wrap' }
   ===================================================================== */
const XLSX_STYLE = { '': 0, hdr: 1, STEP: 2, CALC: 3, DEF: 4, USER: 5, TODO: 6, NA: 7, txt: 8, title: 9, sub: 10, wrap: 11, INFO: 8 };
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) { // files : [{name, data:Uint8Array}]
  const enc = new TextEncoder(); const chunks = []; const central = []; let off = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const nm = enc.encode(f.name); const crc = crc32(f.data); const sz = f.data.length;
    const lh = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0)]);
    chunks.push(lh, nm, f.data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm);
    off += lh.length + nm.length + sz;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), ...u16(0)]);
  return new Blob([...chunks, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xesc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function sheetXml(sh) {
  const rows = sh.rows; let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
  x += '<sheetViews><sheetView workbookViewId="0">';
  if (sh.freeze) x += `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>`;
  x += '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>';
  if (sh.cols && sh.cols.length) x += '<cols>' + sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
  x += '<sheetData>';
  rows.forEach((r, ri) => {
    x += `<row r="${ri + 1}"${sh.header === ri + 1 ? ' ht="45" customHeight="1"' : ''}>`;
    r.forEach((c, ci) => {
      if (c === undefined || c === null || c === '') { return; }
      const cell = (typeof c === 'object' && !(c instanceof Date)) ? c : { v: c };
      const st = XLSX_STYLE[cell.s || ''] || 0; const ref = colName(ci) + (ri + 1);
      const v = cell.v;
      if (v === null || v === undefined || v === '') { if (st) x += `<c r="${ref}" s="${st}"/>`; return; }
      if (typeof v === 'number' && isFinite(v)) x += `<c r="${ref}" s="${st}"><v>${v}</v></c>`;
      else x += `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
    });
    x += '</row>';
  });
  x += '</sheetData>';
  if (sh.filter && sh.header && rows[sh.header - 1]) x += `<autoFilter ref="A${sh.header}:${colName(rows[sh.header - 1].length - 1)}${Math.max(sh.header, rows.length)}"/>`;
  const dv = (sh.lists || []).filter(l => l.to >= l.from);
  if (dv.length) {
    x += `<dataValidations count="${dv.length}">`;
    for (const l of dv) { const f = l.ref ? l.ref : '"' + l.items.join(',').replace(/"/g, '') + '"'; x += `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${colName(l.col)}${l.from}:${colName(l.col)}${l.to}"><formula1>${xesc(f.slice(0, 255))}</formula1></dataValidation>`; }
    x += '</dataValidations>';
  }
  return x + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>';
}
function buildXlsx(sheets) {
  const enc = new TextEncoder(); const files = [];
  const add = (n, s) => files.push({ name: n, data: enc.encode(s) });
  add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>');
  add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>' + sheets.map((s, i) => `<sheet name="${xesc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>');
  add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  const fill = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const b = '<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>';
  const xf = (font, fillId, border, wrap, bold) => `<xf numFmtId="0" fontId="${font}" fillId="${fillId}" borderId="${border}" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"${wrap ? ' wrapText="1"' : ''}/></xf>`;
  add('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="5"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF1F4E78"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF1F4E78"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF7F7F7F"/><name val="Calibri"/></font></fonts>' +
    '<fills count="10"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' + fill('1F4E78') + fill('C6EFCE') + fill('DDEBF7') + fill('FFEB9C') + fill('E4DFEC') + fill('FFC7CE') + fill('EDEDED') + fill('FFFFFF') + '</fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' + b + '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="12">' + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' + xf(1, 2, 1, true) + xf(0, 3, 1) + xf(0, 4, 1) + xf(0, 5, 1) + xf(0, 6, 1) + xf(0, 7, 1) + xf(4, 8, 1) + xf(0, 9, 1) + xf(2, 0, 0) + xf(3, 0, 0) + xf(0, 9, 1, true) + '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zipStore(files);
}
