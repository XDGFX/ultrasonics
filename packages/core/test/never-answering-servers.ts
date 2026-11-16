// Two HTTP servers for the worker soak: one accepts and never answers, one streams a response that
// never ends. A stats endpoint counts their open sockets. The soak runs this as a child process, so
// these sockets never show in the host's descriptor count. Prints its URLs as one JSON line.
let hangOpen = 0;
let streamOpen = 0;

const hang = Bun.listen({
	hostname: "127.0.0.1",
	port: 0,
	socket: {
		open() {
			hangOpen++;
		},
		data() {},
		close() {
			hangOpen--;
		},
		error() {},
	},
});

const timers = new WeakMap<object, ReturnType<typeof setInterval>>();
const chunk = `400\r\n${"x".repeat(1024)}\r\n`;
const stream = Bun.listen({
	hostname: "127.0.0.1",
	port: 0,
	socket: {
		open(socket) {
			streamOpen++;
			socket.write(
				`HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\n\r\n${chunk}`,
			);
			timers.set(
				socket,
				setInterval(() => socket.write(chunk), 10),
			);
		},
		data() {},
		close(socket) {
			streamOpen--;
			clearInterval(timers.get(socket));
		},
		error() {},
	},
});

const stats = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: () => Response.json({ open: hangOpen + streamOpen }),
});

console.log(
	JSON.stringify({
		hang: `http://127.0.0.1:${hang.port}/`,
		stream: `http://127.0.0.1:${stream.port}/`,
		stats: stats.url.href,
	}),
);
