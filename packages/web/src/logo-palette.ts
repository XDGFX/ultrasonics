/** The logo's colours (ADR-0027 §1): the chroma pair, and the face per background. */
export type Theme = "dark" | "light";

export const TEAL = "#1ce5b5";
export const MAGENTA = "#e234ce";

export const THEMES: Record<Theme, { background: string; word: string; katakana: string }> = {
	dark: { background: "#111111", word: "#ffffff", katakana: MAGENTA },
	light: { background: "#ffffff", word: "#111111", katakana: "#b5179e" },
};
