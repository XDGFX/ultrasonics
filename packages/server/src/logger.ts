/** Where the server writes its operator-facing log. */
export interface Logger {
	info(message: string): void;
	warn(message: string): void;
	/** `error` carries the stack; it is logged, never returned to a client. */
	error(message: string, error?: unknown): void;
}

export const consoleLogger: Logger = {
	info: (message) => console.info(message),
	warn: (message) => console.warn(message),
	error: (message, error) =>
		error === undefined ? console.error(message) : console.error(message, error),
};
