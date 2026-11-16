// A worker caught in the middle of a fetch that never completes.
declare const self: Worker;

self.onmessage = async (event: MessageEvent<{ url: string; mode: "hang" | "stream" }>) => {
	const { url, mode } = event.data;
	if (mode === "hang") {
		postMessage("in-flight");
		await fetch(url);
		return;
	}
	const response = await fetch(url);
	const reader = response.body?.getReader();
	if (!reader) return;
	let first = true;
	for (;;) {
		const { done } = await reader.read();
		if (done) return;
		if (first) postMessage("in-flight");
		first = false;
	}
};
