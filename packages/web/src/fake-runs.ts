// Scripted runs for the fake, as the runner would emit them; the fake parses each with `RunEvent`.

const t0 = Date.UTC(2026, 10, 2, 7, 0, 2);
const at = (seconds: number) => t0 + seconds * 1000;
const song = (title: string, ...artists: string[]) => ({ title, artists, id: {} });

const spotifyIn = { component: "inputs", index: 0, plugin: "spotify" };
const dedupe = { component: "modifiers", index: 0, plugin: "deduplicate" };
const plexOut = { component: "outputs", index: 0, plugin: "plex" };

const numbered = (events: object[]) =>
	events.map((event, position) => ({ seq: position + 1, ...event }));

/** Two playlists from spotify, deduplicated, written to plex with three songs unmatched. */
export const succeededRun: unknown[] = numbered([
	{ at: at(0), type: "log", level: "info", source: "runner", text: "run started" },
	{ at: at(0), type: "stage", ...spotifyIn, state: "started" },
	{ at: at(1), type: "log", level: "info", source: "spotify", text: "fetched discover weekly" },
	{
		at: at(2),
		type: "stage",
		...spotifyIn,
		state: "finished",
		songs: 60,
		playlists: 2,
		rejected: 0,
	},
	{ at: at(2), type: "stage", ...dedupe, state: "started" },
	{ at: at(2), type: "stage", ...dedupe, state: "finished", songs: 57, playlists: 2, rejected: 0 },
	{ at: at(3), type: "stage", ...plexOut, state: "started" },
	{ at: at(20), type: "log", level: "warn", source: "plex", text: "no match for lake effect" },
	{
		at: at(40),
		type: "result",
		index: 0,
		plugin: "plex",
		outcome: {
			ok: true,
			playlists: [
				{
					status: "written",
					playlist: 0,
					unmatched: [3, 9],
					unmatchedSongs: [song("lake effect", "hania rani"), song("doppelgänger", "kiasmos")],
				},
				{
					status: "written",
					playlist: 1,
					unmatched: [4],
					unmatchedSongs: [song("hand over", "peggy gou", "someone")],
				},
			],
		},
	},
	{
		at: at(41),
		type: "stage",
		...plexOut,
		state: "finished",
		songs: 57,
		playlists: 2,
		rejected: 0,
	},
	{ at: at(41), type: "end", status: "succeeded" },
]);

const reconnect = "spotify refused the stored grant; reconnect it";

/** Spotify's grant was revoked, so the input failed and nothing was written. */
export const authFailedRun: unknown[] = numbered([
	{ at: at(0), type: "stage", ...spotifyIn, state: "started" },
	{ at: at(1), type: "log", level: "error", source: "runner", text: reconnect },
	{
		at: at(1),
		type: "stage",
		...spotifyIn,
		state: "finished",
		songs: 0,
		playlists: 0,
		rejected: 0,
		error: {
			code: "reconnect",
			message: reconnect,
			auth: { service: "spotify", code: "reconnect", message: reconnect },
		},
	},
	{ at: at(1), type: "end", status: "failed" },
]);

/** Spotify returned three bad songs, of which two were emitted; plex skipped and failed one each. */
export const partialRun: unknown[] = numbered([
	{ at: at(0), type: "stage", ...spotifyIn, state: "started" },
	{
		at: at(1),
		type: "rejection",
		...spotifyIn,
		playlist: 0,
		playlistName: "discover weekly",
		song: 4,
		issues: [{ path: ["title"], message: "Too small: expected string to have >=1 characters" }],
	},
	{
		at: at(1),
		type: "rejection",
		...spotifyIn,
		playlist: 1,
		issues: [{ path: ["name"], message: "Invalid input: expected string" }],
	},
	{
		at: at(2),
		type: "stage",
		...spotifyIn,
		state: "finished",
		songs: 40,
		playlists: 3,
		rejected: 3,
	},
	{ at: at(3), type: "stage", ...plexOut, state: "started" },
	{
		at: at(9),
		type: "result",
		index: 0,
		plugin: "plex",
		outcome: {
			ok: true,
			playlists: [
				{ status: "written", playlist: 0, unmatched: [], unmatchedSongs: [] },
				{ status: "skipped", playlist: 1, code: "empty", message: "no songs to write" },
				{ status: "failed", playlist: 2, code: "timeout", message: "plex took too long" },
			],
		},
	},
	{ at: at(9), type: "stage", ...plexOut, state: "finished", songs: 40, playlists: 3, rejected: 0 },
	{ at: at(9), type: "end", status: "partial" },
]);
