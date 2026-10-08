import type { Entry, ZipFile } from 'yauzl';
import { fromBufferPromise } from 'yauzl';
import { selectMarkdownEntry } from './mineru-payloads';

function listEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    // yauzl's promise/buffer helpers force `lazyEntries`, so the next entry
    // must be requested from inside the 'entry' handler.
    zip.on('entry', (entry: Entry) => {
      entries.push(entry);
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.on('error', reject);
    zip.readEntry();
  });
}

async function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  const stream = await zip.openReadStreamPromise(entry);
  const parts: Buffer[] = [];
  for await (const chunk of stream) {
    parts.push(chunk as Buffer);
  }
  return Buffer.concat(parts);
}

/** Extract the markdown document from a MinerU `full_zip_url` archive. */
export async function readMarkdownFromZip(zipBuffer: Buffer): Promise<string> {
  const zip = await fromBufferPromise(zipBuffer, { validateEntrySizes: false });
  try {
    const entries = await listEntries(zip);
    const files = entries.filter((entry) => !/\/$/.test(entry.fileName));
    const selectedName = selectMarkdownEntry(files.map((entry) => entry.fileName));
    if (!selectedName) {
      throw new Error('MinerU 返回的压缩包中没有找到 Markdown 文件');
    }
    const entry = files.find((item) => item.fileName === selectedName);
    if (!entry) {
      throw new Error('MinerU 返回的压缩包中没有找到 Markdown 文件');
    }
    return (await readEntry(zip, entry)).toString('utf8');
  } finally {
    zip.close();
  }
}
