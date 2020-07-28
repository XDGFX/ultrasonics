var sio = io();

sio.on('connect', function () {

    // Initial data requests
    sio.emit('get_handshakes');
});


sio.on('get_handshakes', data => {
    document.getElementById("handshakes").innerHTML = data
});