// Minimal pure-node ZIP writer/reader (no dependencies besides node:zlib), used by tools/pack-yandex-v161.mjs and its test.
//   writeZip([{ name, data }], { date })  -> Buffer   deflate (level 9), fixed DOS timestamp => byte-reproducible archives
//   readZip(buffer)                       -> [{ name, size, csize, crc, method, data }]  reads via the central directory, verifies CRC32
import zlib from 'node:zlib';

const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
const dosTime = (d) => ((d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1)) & 0xffff;
const dosDate = (d) => (((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()) & 0xffff;

export function writeZip(entries, { date = new Date(Date.UTC(2026, 0, 1, 0, 0, 0)) } = {}) {
  const parts = [], central = []; let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8'), crc = crc32(data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length; // keep incompressible data as is
    const body = stored ? data : deflated, method = stored ? 0 : 8;
    const flags = 0x0800; // UTF-8 names
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime(date), 10); local.writeUInt16LE(dosDate(date), 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(flags, 8); cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(dosTime(date), 12); cd.writeUInt16LE(dosDate(date), 14); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42); // external attrs 0, local header offset
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

export function readZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('zip: end of central directory not found');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = [];
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory entry');
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error('zip: bad local header for ' + name);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error('zip: unsupported method ' + method);
    if (data.length !== size || crc32(data) !== crc) throw new Error('zip: CRC/size mismatch for ' + name);
    out.push({ name, size, csize, crc, method, data });
    p += 46 + nl + xl + cl;
  }
  return out;
}
