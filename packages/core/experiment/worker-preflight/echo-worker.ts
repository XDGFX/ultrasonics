declare const self: Worker;
self.onmessage = () => postMessage("pong");
