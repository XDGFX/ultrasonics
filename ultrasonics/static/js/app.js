var sio = io();

sio.on('connect', function () {
    `
    Initial data requests.
    `
    console.log("Connected to backend with websocket!")
});

function applet_update_name(applet_name) {
    sio.emit('applet_update_name', applet_name)
}

