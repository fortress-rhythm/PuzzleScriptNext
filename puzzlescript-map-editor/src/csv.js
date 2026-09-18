'use strict';

// RFC 4180 CSV / TSV, with the quoting rules PuzzleScript actually needs.
//
// Legend characters legitimately include ',', '"', ';' and whitespace-adjacent
// oddities, so naive splitting corrupts real games. Everything here quotes and
// unquotes properly.

function formatDelimited(rows, delimiter) {
    const needsQuote = (s) =>
        s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')
        || s !== s.trim();

    return rows.map(row =>
        row.map(cell => {
            const s = cell === null || cell === undefined ? '' : String(cell);
            return needsQuote(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(delimiter)
    ).join('\n') + '\n';
}

function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    let fieldStarted = false;

    // Strip a UTF-8 BOM; Excel writes one and it would otherwise become part of
    // the first cell.
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    while (i < text.length) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                inQuotes = false; i++; continue;
            }
            field += ch; i++; continue;
        }

        if (ch === '"' && !fieldStarted) { inQuotes = true; fieldStarted = true; i++; continue; }
        if (ch === delimiter) { row.push(field); field = ''; fieldStarted = false; i++; continue; }
        if (ch === '\r') { i++; continue; }
        if (ch === '\n') {
            row.push(field); rows.push(row);
            row = []; field = ''; fieldStarted = false; i++; continue;
        }
        field += ch; fieldStarted = true; i++;
    }

    if (field !== '' || fieldStarted || row.length) { row.push(field); rows.push(row); }
    return rows;
}

const toCsv = rows => formatDelimited(rows, ',');
const toTsv = rows => formatDelimited(rows, '\t');
const fromCsv = text => parseDelimited(text, ',');
const fromTsv = text => parseDelimited(text, '\t');

module.exports = { toCsv, toTsv, fromCsv, fromTsv, formatDelimited, parseDelimited };
