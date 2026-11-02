// opentype.js 2 ships no types; this declares only what the logo generator uses.
declare module "opentype.js" {
	export interface PathCommand {
		type: "M" | "L" | "Q" | "C" | "Z";
		x?: number;
		y?: number;
		x1?: number;
		y1?: number;
		x2?: number;
		y2?: number;
	}
	export interface Font {
		unitsPerEm: number;
		ascender: number;
		descender: number;
		getAdvanceWidth(text: string, fontSize: number): number;
		getPath(text: string, x: number, y: number, fontSize: number): { commands: PathCommand[] };
	}
	export function parse(buffer: ArrayBuffer): Font;
}
