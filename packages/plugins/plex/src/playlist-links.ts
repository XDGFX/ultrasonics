import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Log, Playlist } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** ID space → source playlist id → the Plex playlist's rating key. */
const Links = z.record(z.string(), z.record(z.string(), z.string()));
type Links = z.infer<typeof Links>;

/** Where an applet's links are kept; both come from the run context. */
export interface LinksLocation {
	configDir: string;
	appletId: string;
}

/** The one entry of a source playlist's `id` map that its link is kept under. */
export interface SourceId {
	space: string;
	id: string;
}

/**
 * The id a source playlist is linked by: the entry of its `id` map whose ID space sorts first, so
 * the same playlist picks the same entry every run. `undefined` when it carries no id at all.
 */
export function sourceId(playlist: Playlist): SourceId | undefined {
	const [space] = Object.keys(playlist.id).sort();
	const id = space === undefined ? undefined : playlist.id[space];
	return space === undefined || id === undefined ? undefined : { space, id };
}

/**
 * One applet's links from source playlists to the Plex playlists they are written to. Kept
 * in the plugin's config directory, one file per applet, so concurrent runs of two applets never
 * overwrite each other's links.
 */
export class PlaylistLinks {
	readonly #file: string;
	readonly #links: Links;
	readonly #log: Log;

	private constructor(file: string, links: Links, log: Log) {
		this.#file = file;
		this.#links = links;
		this.#log = log;
	}

	/** A file that can't be read or parsed starts the applet afresh, with a warning. */
	static async load(location: LinksLocation, log: Log): Promise<PlaylistLinks> {
		const { configDir, appletId } = location;
		// The prefix stops an id such as `..` naming a directory.
		const file = join(configDir, "playlist-links", `applet-${encodeURIComponent(appletId)}.json`);
		let links: Links = {};
		try {
			const parsed = Links.safeParse(JSON.parse(await readFile(file, "utf8")));
			if (!parsed.success) throw new Error("not a links file");
			links = parsed.data;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				log.warn("The Plex playlist links could not be read, so every playlist is found by name");
			}
		}
		return new PlaylistLinks(file, links, log);
	}

	get(source: SourceId): string | undefined {
		return this.#links[source.space]?.[source.id];
	}

	/** Every Plex playlist a source playlist of this applet is linked to. */
	linked(): Set<string> {
		return new Set(Object.values(this.#links).flatMap((ids) => Object.values(ids)));
	}

	async set(source: SourceId, ratingKey: string): Promise<void> {
		if (this.get(source) === ratingKey) return;
		this.#links[source.space] = { ...this.#links[source.space], [source.id]: ratingKey };
		await this.#save();
	}

	async drop(source: SourceId): Promise<void> {
		const ids = this.#links[source.space];
		if (ids?.[source.id] === undefined) return;
		delete ids[source.id];
		if (Object.keys(ids).length === 0) delete this.#links[source.space];
		await this.#save();
	}

	/**
	 * Writes beside the file and renames over it, so a crash never leaves half a file. A failed save
	 * costs only the link, never the playlist already written, so it warns rather than throws.
	 */
	async #save(): Promise<void> {
		const temporary = `${this.#file}.${randomUUID()}.tmp`;
		try {
			await mkdir(dirname(this.#file), { recursive: true });
			await writeFile(temporary, `${JSON.stringify(this.#links, null, "\t")}\n`);
			await rename(temporary, this.#file);
		} catch (error) {
			await rm(temporary, { force: true }).catch(() => {});
			const reason = error instanceof Error ? error.message : String(error);
			this.#log.warn(`Could not save the Plex playlist links: ${reason}`);
		}
	}
}
