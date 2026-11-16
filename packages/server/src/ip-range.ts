import { isIP } from "node:net";

/** A CIDR block, held as a bigint network and prefix so IPv4 and IPv6 share one comparison. */
export interface IpRange {
	family: 4 | 6;
	network: bigint;
	prefix: number;
}

interface Address {
	family: 4 | 6;
	value: bigint;
}

const bits = (family: 4 | 6) => (family === 4 ? 32 : 128);

function ipv4Value(address: string): bigint {
	return address
		.split(".")
		.reduce((value, octet) => (value << 8n) | BigInt(Number.parseInt(octet, 10)), 0n);
}

function ipv6Value(address: string): bigint {
	// An embedded IPv4 tail (`::ffff:1.2.3.4`) becomes its two hextets.
	const tail = address.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
	let text = address;
	if (tail) {
		const v4 = ipv4Value(tail);
		text = `${address.slice(0, -tail.length)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
	}
	const [head = "", rest] = text.split("::");
	const left = head === "" ? [] : head.split(":");
	const right = rest === undefined || rest === "" ? [] : rest.split(":");
	const zeros = rest === undefined ? [] : Array(8 - left.length - right.length).fill("0");
	return [...left, ...zeros, ...right].reduce(
		(value, hextet) => (value << 16n) | BigInt(Number.parseInt(hextet, 16)),
		0n,
	);
}

const MAPPED_V4 = { network: 0xffffn << 32n, mask: ((1n << 96n) - 1n) << 32n };

/**
 * Parses an address, unwrapping an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`), which is how a
 * dual-stack listener reports an IPv4 client. Returns `undefined` for anything else.
 */
function parseAddress(text: string): Address | undefined {
	const address = text.trim().replace(/%.*$/, "");
	const family = isIP(address);
	if (family === 4) return { family: 4, value: ipv4Value(address) };
	if (family !== 6) return undefined;
	const value = ipv6Value(address);
	if ((value & MAPPED_V4.mask) === MAPPED_V4.network) {
		return { family: 4, value: value & 0xffffffffn };
	}
	return { family: 6, value };
}

/** An address as a person reads it: an IPv4-mapped IPv6 address as its IPv4 address. */
export function displayAddress(text: string): string {
	const address = parseAddress(text);
	if (address?.family !== 4) return text.trim();
	return [24n, 16n, 8n, 0n].map((shift) => (address.value >> shift) & 0xffn).join(".");
}

function maskOf(family: 4 | 6, prefix: number): bigint {
	const width = BigInt(bits(family));
	return ((1n << BigInt(prefix)) - 1n) << (width - BigInt(prefix));
}

/** Parses `a.b.c.d/n`, `x::y/n`, or a bare address as a single-host range. */
export function parseIpRange(text: string): IpRange | undefined {
	const [addressText = "", prefixText, extra] = text.trim().split("/");
	if (extra !== undefined) return undefined;
	const address = parseAddress(addressText);
	if (!address) return undefined;
	const prefix = prefixText === undefined ? bits(address.family) : Number(prefixText);
	if (!/^\d+$/.test(prefixText ?? "0") || prefix > bits(address.family)) return undefined;
	return {
		family: address.family,
		network: address.value & maskOf(address.family, prefix),
		prefix,
	};
}

export function inRanges(address: string | undefined, ranges: readonly IpRange[]): boolean {
	const parsed = address === undefined ? undefined : parseAddress(address);
	if (!parsed) return false;
	return ranges.some(
		(range) =>
			range.family === parsed.family &&
			(parsed.value & maskOf(range.family, range.prefix)) === range.network,
	);
}

/**
 * Loopback, RFC 1918, link-local, IPv6 ULA and CGNAT (`100.64.0.0/10`, Tailscale's range): the
 * addresses ADR-0015 §6 does not warn about.
 */
const PRIVATE_RANGES = [
	"127.0.0.0/8",
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"169.254.0.0/16",
	"100.64.0.0/10",
	"::1/128",
	"fe80::/10",
	"fc00::/7",
].map((text) => parseIpRange(text) as IpRange);

export function isPrivateAddress(address: string): boolean {
	return inRanges(address, PRIVATE_RANGES);
}
