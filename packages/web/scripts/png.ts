import { deflateSync } from "node:zlib";

const CRC = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function crc32(bytes: Uint8Array) {
	let c = 0xffffffff;
	for (const b of bytes) c = (CRC[(c ^ b) & 0xff] as number) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(new TextEncoder().encode(type), 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** An opaque 8-bit RGB PNG, from a `#rrggbb` colour per pixel. */
export function encodePng(
	width: number,
	height: number,
	colourAt: (x: number, y: number) => string,
) {
	const rowBytes = width * 3 + 1;
	const raw = new Uint8Array(height * rowBytes);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const hex = colourAt(x, y);
			raw.set(
				[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)),
				y * rowBytes + 1 + x * 3,
			);
		}
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header.set([8, 2, 0, 0, 0], 8);
	return Buffer.concat([
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", new Uint8Array()),
	]);
}
