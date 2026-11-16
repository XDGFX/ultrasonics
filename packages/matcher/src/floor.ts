import type { Floor } from "./harness.ts";

/**
 * The held-out figures the rebuilt matcher reached (#132), as successes over n. CI fails when a
 * change falls below any of them, or rises above the lookalike ceiling. Raise a value in the
 * change that earns it; lowering one needs Cal's sign-off.
 */
export const floor: Floor = {
	recall: 506 / 637,
	"recall: plain": 490 / 613,
	"recall: remaster": 14 / 22,
	"recall: clean-explicit": 2 / 2,
	"recall: latin": 351 / 405,
	"recall: same-non-latin": 140 / 181,
	"recall: cross-script": 15 / 51,
	"rejection: cover": 72 / 72,
	"rejection: live": 71 / 76,
	"rejection: edit": 80 / 82,
	"rejection: remix": 61 / 85,
	"rejection: re-recording": 62 / 83,
	"rejection: same-title": 72 / 72,
	precision: 506 / 558,
	"bestMatch: picks the original": 185 / 223,
	"bestMatch: picks the lookalike": 2 / 223,
	"bestMatch, lookalike only: picks nothing": 183 / 223,
};
