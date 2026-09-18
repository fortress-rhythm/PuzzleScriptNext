'use strict';

// A very small, dependency-free XLSX reader/writer.
//
// Why not a library? Because the only thing this project needs from XLSX is
// "a grid of short strings, with per-cell fill colours, that Excel will not
// mangle". That is a tiny subset, and owning it keeps the tool installable
// with zero npm dependencies.
//
// The critical detail is that every cell is written as an *inline string*
// (t="inlineStr"). PuzzleScript legend characters include '=', '+', '-' and
// '@', all of which Excel would otherwise interpret as the start of a formula.
// Inline strings are never parsed as formulas, so a level made of '@' and '='
// survives a round trip intact.

const zlib = require('zlib');

// ---------------------------------------------------------------------------
// Minimal ZIP container (store + deflate), enough for the XLSX OPC package.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    let c = 0 ^ -1;
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
    return (c ^ -1) >>> 0;
}

function zipWrite(entries) {
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
        const deflated = zlib.deflateRawSync(raw, { level: 9 });
        const useDeflate = deflated.length < raw.length;
        const body = useDeflate ? deflated : raw;
        const method = useDeflate ? 8 : 0;
        const crc = crc32(raw);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);       // version needed
        local.writeUInt16LE(0x0800, 6);   // UTF-8 filename flag
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(0, 10);       // mod time
        local.writeUInt16LE(0x21, 12);    // mod date (1980-01-01)
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);

        chunks.push(local, nameBuf, body);

        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(20, 4);
        cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(0x0800, 8);
        cd.writeUInt16LE(method, 10);
        cd.writeUInt16LE(0, 12);
        cd.writeUInt16LE(0x21, 14);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(body.length, 20);
        cd.writeUInt32LE(raw.length, 24);
        cd.writeUInt16LE(nameBuf.length, 28);
        cd.writeUInt32LE(0, 38);          // external attrs
        cd.writeUInt32LE(offset, 42);
        central.push(cd, nameBuf);

        offset += local.length + nameBuf.length + body.length;
    }

    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([...chunks, centralBuf, end]);
}

function zipRead(buf) {
    // Locate the end-of-central-directory record, then walk the central directory.
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record)');

    const count = buf.readUInt16LE(eocd + 10);
    let pos = buf.readUInt32LE(eocd + 16);
    const files = {};

    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('Corrupt zip central directory');
        const method = buf.readUInt16LE(pos + 10);
        const compSize = buf.readUInt32LE(pos + 20);
        const nameLen = buf.readUInt16LE(pos + 28);
        const extraLen = buf.readUInt16LE(pos + 30);
        const commentLen = buf.readUInt16LE(pos + 32);
        const localOffset = buf.readUInt32LE(pos + 42);
        const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);

        const lNameLen = buf.readUInt16LE(localOffset + 26);
        const lExtraLen = buf.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + lNameLen + lExtraLen;
        const body = buf.subarray(dataStart, dataStart + compSize);

        files[name] = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
        pos += 46 + nameLen + extraLen + commentLen;
    }
    return files;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function unesc(s) {
    return String(s)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&amp;/g, '&');
}

function colName(index) {
    // 0 -> A, 25 -> Z, 26 -> AA
    let n = index + 1;
    let s = '';
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

function colIndex(name) {
    let n = 0;
    for (const ch of name) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Write a workbook.
 *
 * sheets: [{
 *   name,
 *   rows: [[cell, ...], ...]        cell = string | { v, fill, bold, note }
 *   colWidth: number                uniform column width (characters)
 *   rowHeight: number               uniform row height (points)
 *   freeze: { rows, cols }
 * }]
 */
function writeWorkbook(sheets) {
    // Collect the distinct fills used, so we can build the styles table.
    const fills = ['none', 'gray125']; // indices 0 and 1 are reserved by the spec
    const fillIndex = new Map();
    const styles = [];                 // each entry: { fill, bold }
    const styleIndex = new Map();

    const getStyle = (fill, bold) => {
        const key = `${fill || ''}|${bold ? 1 : 0}`;
        if (styleIndex.has(key)) return styleIndex.get(key);
        let fi = 0;
        if (fill) {
            if (!fillIndex.has(fill)) {
                fillIndex.set(fill, fills.length);
                fills.push(fill);
            }
            fi = fillIndex.get(fill);
        }
        const idx = styles.length + 1; // 0 is the default style
        styles.push({ fill: fi, bold: !!bold });
        styleIndex.set(key, idx);
        return idx;
    };

    const sheetXmls = sheets.map((sheet) => {
        const rowsXml = sheet.rows.map((row, r) => {
            const cellsXml = row.map((cell, c) => {
                if (cell === null || cell === undefined || cell === '') return '';
                const obj = typeof cell === 'object' ? cell : { v: cell };
                const text = obj.v === null || obj.v === undefined ? '' : String(obj.v);
                // A cell with no text but a fill is still worth writing - that is
                // how colour swatches work.
                if (!text && !obj.fill) return '';
                const s = (obj.fill || obj.bold) ? getStyle(obj.fill, obj.bold) : 0;
                const ref = `${colName(c)}${r + 1}`;
                const attrs = `r="${ref}"${s ? ` s="${s}"` : ''}`;
                if (!text) return `<c ${attrs}/>`;
                // Inline strings only: Excel never treats these as formulas.
                return `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
            }).join('');
            const attrs = sheet.rowHeight ? ` ht="${sheet.rowHeight}" customHeight="1"` : '';
            return `<row r="${r + 1}"${attrs}>${cellsXml}</row>`;
        }).join('');

        const maxCols = Math.max(1, ...sheet.rows.map(r => r.length));
        const cols = sheet.colWidth
            ? `<cols><col min="1" max="${maxCols}" width="${sheet.colWidth}" customWidth="1"/></cols>`
            : '';

        let paneXml = '';
        if (sheet.freeze && (sheet.freeze.rows || sheet.freeze.cols)) {
            const x = sheet.freeze.cols || 0;
            const y = sheet.freeze.rows || 0;
            const top = `${colName(x)}${y + 1}`;
            paneXml = `<pane xSplit="${x}" ySplit="${y}" topLeftCell="${top}" activePane="bottomRight" state="frozen"/>`;
        }

        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${sheet.showGridLines === false ? ' showGridLines="0"' : ''}>${paneXml}</sheetView></sheetViews>${cols}<sheetData>${rowsXml}</sheetData></worksheet>`;
    });

    const fillsXml = fills.map((f) => {
        if (f === 'none') return '<fill><patternFill patternType="none"/></fill>';
        if (f === 'gray125') return '<fill><patternFill patternType="gray125"/></fill>';
        const rgb = f.replace('#', '').toUpperCase();
        return `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
    }).join('');

    const cellXfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']
        .concat(styles.map(s =>
            `<xf numFmtId="0" fontId="${s.bold ? 1 : 0}" fillId="${s.fill}" borderId="0" xfId="0"`
            + ` applyFill="${s.fill ? 1 : 0}" applyFont="${s.bold ? 1 : 0}" applyAlignment="1">`
            + '<alignment horizontal="center" vertical="center"/></xf>'))
        .join('');

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Consolas"/></font><font><b/><sz val="11"/><name val="Consolas"/></font></fonts><fills count="${fills.length}">${fillsXml}</fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${styles.length + 1}">${cellXfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

    const sheetEntries = sheets.map((s, i) =>
        `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets></workbook>`;

    const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

    const entries = [
        { name: '[Content_Types].xml', data: contentTypes },
        { name: '_rels/.rels', data: rootRels },
        { name: 'xl/workbook.xml', data: workbookXml },
        { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
        { name: 'xl/styles.xml', data: stylesXml },
        ...sheetXmls.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x })),
    ];

    return zipWrite(entries);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Read a workbook back into { name -> rows[][] } of plain strings.
 * Handles inline strings, shared strings and numeric cells, which covers
 * anything Excel or Google Sheets will produce from a file we wrote.
 */
function readWorkbook(buf) {
    const files = zipRead(buf);

    const sharedStrings = [];
    const ssFile = files['xl/sharedStrings.xml'];
    if (ssFile) {
        const xml = ssFile.toString('utf8');
        for (const si of xml.match(/<si>[\s\S]*?<\/si>|<si\/>/g) || []) {
            // A shared string may be split across several <t> runs.
            const parts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unesc(m[1]));
            sharedStrings.push(parts.join(''));
        }
    }

    // Sheet name -> file, via workbook.xml + its rels.
    const wb = files['xl/workbook.xml'].toString('utf8');
    const rels = (files['xl/_rels/workbook.xml.rels'] || Buffer.from('')).toString('utf8');
    const relMap = {};
    for (const m of rels.matchAll(/<Relationship\s+[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
        relMap[m[1]] = m[2].replace(/^\/?xl\//, '');
    }

    const result = {};
    const sheetTags = [...wb.matchAll(/<sheet\s+[^>]*\/?>/g)].map(m => m[0]);
    let fallbackIndex = 0;

    for (const tag of sheetTags) {
        const name = unesc((tag.match(/name="([^"]*)"/) || [])[1] || `Sheet${fallbackIndex + 1}`);
        const rid = (tag.match(/r:id="([^"]*)"/) || [])[1];
        fallbackIndex++;
        const target = (rid && relMap[rid]) || `worksheets/sheet${fallbackIndex}.xml`;
        const data = files[`xl/${target}`];
        if (!data) continue;
        result[name] = readSheet(data.toString('utf8'), sharedStrings);
    }
    return result;
}

function readSheet(xml, sharedStrings) {
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
        const rowIndex = Number(rowMatch[1]) - 1;
        const cells = [];
        for (const cm of rowMatch[2].matchAll(/<c\s+([^>]*?)\/>|<c\s+([^>]*?)>([\s\S]*?)<\/c>/g)) {
            const attrs = cm[1] || cm[2] || '';
            const inner = cm[3] || '';
            const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
            const type = (attrs.match(/t="([^"]*)"/) || [])[1] || 'n';
            const ci = ref ? colIndex(ref) : cells.length;

            let value = '';
            if (type === 'inlineStr') {
                const parts = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unesc(m[1]));
                value = parts.join('');
            } else if (type === 's') {
                const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
                value = v !== undefined ? (sharedStrings[Number(v)] ?? '') : '';
            } else if (type === 'str') {
                const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
                value = v !== undefined ? unesc(v) : '';
            } else {
                const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
                value = v !== undefined ? unesc(v) : '';
            }
            while (cells.length < ci) cells.push('');
            cells[ci] = value;
        }
        while (rows.length < rowIndex) rows.push([]);
        rows[rowIndex] = cells;
    }
    return rows;
}

module.exports = { writeWorkbook, readWorkbook, zipRead, zipWrite, colName, colIndex };
