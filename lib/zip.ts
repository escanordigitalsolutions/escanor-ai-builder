/**
 * A minimal ZIP writer.
 *
 * Written rather than installed on purpose. The one thing this has to do is
 * produce an archive every operating system opens by double-clicking, and the
 * stored (uncompressed) ZIP format is small enough to implement exactly and
 * test properly. A dependency for it would be a dependency that cannot be
 * verified from inside this project's own tooling, for markup that is already
 * a few hundred kilobytes.
 *
 * Stored entries only — no deflate. The trade is a larger file for code that
 * is easy to be certain about; a design pack is HTML and CSS that the user
 * downloads once.
 */

const encoder = new TextEncoder();

/** CRC-32, table built once on first use. */
let crcTable: Uint32Array | null = null;

function crc32Table(): Uint32Array {
  if (crcTable) return crcTable;

  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i++) {
    let c = i;

    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[i] = c >>> 0;
  }

  crcTable = table;

  return table;
}

export function crc32(data: Uint8Array): number {
  const table = crc32Table();
  let c = 0xffffffff;

  for (let i = 0; i < data.length; i++) {
    c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }

  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = {
  /** Path inside the archive, forward slashes, no leading slash. */
  name: string;
  data: string | Uint8Array;
};

/** DOS date/time, which is what a ZIP header carries. */
function dosDateTime(when: Date): { date: number; time: number } {
  const year = Math.max(1980, when.getFullYear());

  return {
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
  };
}

export function createZip(entries: ZipEntry[], when: Date = new Date()): Uint8Array {
  const { date, time } = dosDateTime(when);

  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name.replace(/^\/+/, "").replace(/\\/g, "/"));
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const sum = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, sum, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // no extra field

    parts.push(new Uint8Array(local.buffer), name, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); // central directory header
    dir.setUint16(4, 20, true); // version made by
    dir.setUint16(6, 20, true); // version needed
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true); // stored
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, sum, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint16(30, 0, true); // extra
    dir.setUint16(32, 0, true); // comment
    dir.setUint16(34, 0, true); // disk
    dir.setUint16(36, 0, true); // internal attrs
    dir.setUint32(38, 0, true); // external attrs
    dir.setUint32(42, offset, true);

    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true); // no comment

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const total = all.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);

  let at = 0;

  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }

  return out;
}
