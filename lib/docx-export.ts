const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16(out: number[], value: number) {
  out.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeU32(out: number[], value: number) {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraphXml(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return '<w:p/>';
  const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
  const bullet = trimmed.match(/^[-*]\s+(.+)$/);
  const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
  const content = xmlEscape((heading?.[2] || bullet?.[1] || numbered?.[1] || trimmed).replace(/\*\*/g, ''));
  const style = heading ? `<w:pStyle w:val="Heading${heading[1].length}"/>` : '';
  const bulletPrefix = bullet ? '• ' : numbered ? '• ' : '';
  return `<w:p><w:pPr>${style}</w:pPr><w:r><w:t xml:space="preserve">${bulletPrefix}${content}</w:t></w:r></w:p>`;
}

function markdownToDocumentXml(markdown: string) {
  const body = markdown
    .split(/\r?\n/)
    .map(line => paragraphXml(line))
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
}

function zipStore(files: { name: string; content: string }[]) {
  const encoder = new TextEncoder();
  const output: number[] = [];
  const central: number[] = [];

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const offset = output.length;
    const crc = crc32(data);

    writeU32(output, 0x04034b50);
    writeU16(output, 20);
    writeU16(output, 0);
    writeU16(output, 0);
    writeU16(output, 0);
    writeU16(output, 0);
    writeU32(output, crc);
    writeU32(output, data.length);
    writeU32(output, data.length);
    writeU16(output, nameBytes.length);
    writeU16(output, 0);
    output.push(...nameBytes, ...data);

    writeU32(central, 0x02014b50);
    writeU16(central, 20);
    writeU16(central, 20);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU32(central, crc);
    writeU32(central, data.length);
    writeU32(central, data.length);
    writeU16(central, nameBytes.length);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU32(central, 0);
    writeU32(central, offset);
    central.push(...nameBytes);
  }

  const centralOffset = output.length;
  output.push(...central);
  writeU32(output, 0x06054b50);
  writeU16(output, 0);
  writeU16(output, 0);
  writeU16(output, files.length);
  writeU16(output, files.length);
  writeU32(output, central.length);
  writeU32(output, centralOffset);
  writeU16(output, 0);

  return new Uint8Array(output);
}

export function markdownToDocx(markdown: string) {
  return zipStore([
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    { name: 'word/document.xml', content: markdownToDocumentXml(markdown) },
  ]);
}

