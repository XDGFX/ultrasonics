var sio = io();
sio.on('connect', function () {
    sio.emit('my event', { data: 'I\'m connected!' });
});

sio.on('my response', data => {
    console.log(data);
});