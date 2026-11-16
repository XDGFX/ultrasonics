import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, appendFile, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Log, OutputResult, PlaylistResult, SongDict } from "@ultrasonics/plugin-sdk";
import { FileNamePattern } from "./file-name.ts";
import type { OutputSettings } from "./output-settings.ts";
import { songLine } from "./song-line.ts";
import { parseTemplate } from "./template.ts";

/** The playlists going into one file, in order, with each one's lines. */
interface FileGroup {
	file: string;
	playlists: { position: number; lines: string[]; unmatched: number[] }[];
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function assertFolder(dir: string): Promise<void> {
	let isFolder: boolean;
	try {
		isFolder = (await stat(dir)).isDirectory();
	} catch (error) {
		throw new Error(`The folder ${dir} can't be read: ${describe(error)}`);
	}
	if (!isFolder) throw new Error(`${dir} is not a folder`);
}

/** Whether the file ends in anything but a newline, so appended lines would join its last line. */
async function lacksFinalNewline(path: string): Promise<boolean> {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, "r");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
	try {
		const { size } = await handle.stat();
		if (size === 0) return false;
		const last = Buffer.alloc(1);
		await handle.read(last, 0, 1, size - 1);
		return last[0] !== 0x0a;
	} finally {
		await handle.close();
	}
}

/** Replaces the file through a temporary one beside it, so a failed write leaves the old file whole. */
async function overwrite(path: string, dir: string, content: string): Promise<void> {
	// A read-only file stays unchanged, though the rename alone would replace it.
	await access(path, constants.W_OK).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOENT") throw error;
	});
	const temporary = join(dir, `.ultrasonics-${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, content, { flag: "wx" });
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

async function append(path: string, content: string): Promise<void> {
	const separator = (await lacksFinalNewline(path)) ? "\n" : "";
	await appendFile(path, separator + content);
}

/**
 * Writes each playlist's lines to its file (spec #180, "Writing"): files in order of first
 * appearance, every playlist reported once, by position.
 */
export async function writePlaylists(
	songs: SongDict,
	settings: OutputSettings,
	log: Log,
): Promise<OutputResult> {
	await assertFolder(settings.dir);
	const pattern = parseTemplate(settings.pattern);
	if (!pattern.ok) throw new Error(pattern.problem);
	const fileName = new FileNamePattern(settings.fileName);

	const results = new Map<number, PlaylistResult>();
	const groups = new Map<string, FileGroup>();
	for (const [position, playlist] of songs.playlists.entries()) {
		if (playlist.songs.length === 0) {
			results.set(position, {
				status: "skipped",
				playlist: position,
				code: "empty",
				message: `${playlist.name} has no songs`,
			});
			continue;
		}
		const file = fileName.fileFor(playlist.name);
		if (file === undefined) {
			results.set(position, {
				status: "skipped",
				playlist: position,
				code: "invalid-name",
				message: `${playlist.name} leaves no file name once the characters a file name can't hold are removed`,
			});
			continue;
		}
		const lines: string[] = [];
		const unmatched: number[] = [];
		for (const [index, song] of playlist.songs.entries()) {
			const line = songLine(pattern.parts, song);
			if (line === undefined) unmatched.push(index);
			else lines.push(line);
		}
		if (lines.length === 0) {
			const message = `No song in ${playlist.name} has every field the pattern ${settings.pattern} uses, so nothing was written`;
			log.warn(message);
			results.set(position, { status: "skipped", playlist: position, code: "no-lines", message });
			continue;
		}
		const group = groups.get(file) ?? { file, playlists: [] };
		group.playlists.push({ position, lines, unmatched });
		groups.set(file, group);
	}

	for (const group of groups.values()) {
		const path = join(settings.dir, group.file);
		const content = `${group.playlists.flatMap((playlist) => playlist.lines).join("\n")}\n`;
		try {
			if (settings.existing === "append") await append(path, content);
			else await overwrite(path, settings.dir, content);
			for (const { position, unmatched } of group.playlists) {
				results.set(position, { status: "written", playlist: position, unmatched });
			}
		} catch (error) {
			const message = `${group.file} couldn't be written: ${describe(error)}`;
			log.error(message);
			for (const { position } of group.playlists) {
				results.set(position, {
					status: "failed",
					playlist: position,
					code: "write-error",
					message,
				});
			}
		}
	}

	return {
		playlists: [...results.values()].sort((a, b) => a.playlist - b.playlist),
	};
}
