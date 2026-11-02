// The SDK's root export reaches `node:url` for plugins' file URIs, which the browser never calls.
const unavailable = (name: string) => () => {
	throw new Error(`${name} is not available in the browser`);
};

export const fileURLToPath = unavailable("fileURLToPath");
export const pathToFileURL = unavailable("pathToFileURL");
