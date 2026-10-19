import { fileURLToPath, pathToFileURL } from "node:url";

/** A drive path (`C:\…` or `C:/…`) or a UNC path (`\\server\share\…`). */
const windowsPath = /^(?:[A-Za-z]:[\\/]|\\\\[^\\])/;

/** A bare root (`/`, `/C:/`, or `/C://` from `C:\`) names no file. */
const rootPathname = /^\/(?:[A-Za-z]:)?\/*$/;

/**
 * The `file://` URI a song's `location` holds for an absolute local path. Windows paths are
 * recognised by shape, not by the platform this runs on (v1 #22).
 */
export function toFileUri(path: string): string | undefined {
	const windows = windowsPath.test(path);
	if (!windows && !path.startsWith("/")) return undefined;
	try {
		const url = pathToFileURL(path, { windows });
		return rootPathname.test(url.pathname) ? undefined : url.href;
	} catch {
		return undefined;
	}
}

/** A URI pathname that starts with a drive letter, as in `file:///C:/…`. */
const windowsDrivePathname = /^\/[A-Za-z]:\//;

/**
 * The local path a `file://` URI names. A drive or UNC URI gives a Windows path whatever platform
 * this runs on (v1 #22).
 */
export function fromFileUri(uri: string): string | undefined {
	const url = URL.parse(uri);
	if (url?.protocol !== "file:") return undefined;
	const windows = url.host !== "" || windowsDrivePathname.test(url.pathname);
	try {
		return fileURLToPath(url, { windows });
	} catch {
		// An encoded separator (`%2F`, or `%5C` on Windows) names no path.
		return undefined;
	}
}
