/**
 * A ZIP archive built in memory, for the import tests: what an uploaded
 * export is. Deflated by default, stored when asked; names are UTF-8.
 */

import { deflateRawSync } from 'node:zlib';

export function zipOf(
  files: Record<string, string | Uint8Array>,
  options: { store?: boolean; claim?: Record<string, number> } = {},
): Uint8Array<ArrayBuffer> {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const entries = Object.entries(files);
  for (const [name, data] of entries) {
    const raw = Buffer.from(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
    const method = options.store ? 0 : 8;
    const body = options.store ? raw : deflateRawSync(raw);
    // A size the archive claims, when a test wants it to lie.
    const size = options.claim?.[name] ?? raw.length;
    const nameBytes = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, body);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(size, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, directory, end]));
}
