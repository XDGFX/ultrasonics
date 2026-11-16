// Two TCP servers that never finish an HTTP response, plus a stats endpoint counting open sockets.
// Run as a child process so its own sockets never show up in the host's descriptor count.
let hangOpen = 0;
let hangAccepted = 0;
let streamOpen = 0;
let streamAccepted = 0;

const hang = Bun.listen({
	hostname: "127.0.0.1",
	port: 0,
	socket: {
		open() {
			hangOpen++;
			hangAccepted++;
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
			streamAccepted++;
			socket.write(
				"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\n\r\n",
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
	fetch: () => Response.json({ hangOpen, hangAccepted, streamOpen, streamAccepted }),
});

console.log(
	JSON.stringify({
		hang: `http://127.0.0.1:${hang.port}/`,
		stream: `http://127.0.0.1:${stream.port}/`,
		stats: stats.url.href,
	}),
);
