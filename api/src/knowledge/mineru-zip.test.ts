import { describe, expect, it } from 'vitest';
import { readMarkdownFromZip } from './mineru-zip';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer: Buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/** Minimal stored-entry zip writer so the extractor is tested without fixtures. */
function makeZip(entries: Array<{ name: string; content: string }>) {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const { name, content } of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    chunks.push(local, nameBuffer, data);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBuffer.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBuffer);

    offset += 30 + nameBuffer.length + data.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

describe('readMarkdownFromZip', () => {
  it('extracts full.md from a MinerU style archive', async () => {
    const zip = makeZip([
      { name: 'layout.json', content: '{"pages":1}' },
      { name: 'full.md', content: '# 解析结果\n\n正文内容' },
      { name: 'images/1.jpg', content: 'fake-image' },
    ]);

    expect(await readMarkdownFromZip(zip)).toBe('# 解析结果\n\n正文内容');
  });

  it('falls back to the first markdown entry when full.md is absent', async () => {
    const zip = makeZip([
      { name: 'a.json', content: '{}' },
      { name: 'nested/output.md', content: '内容' },
    ]);

    expect(await readMarkdownFromZip(zip)).toBe('内容');
  });

  it('rejects archives without markdown instead of hanging', async () => {
    const zip = makeZip([{ name: 'layout.json', content: '{}' }]);

    await expect(readMarkdownFromZip(zip)).rejects.toThrow(/没有找到 Markdown/);
  });
});
