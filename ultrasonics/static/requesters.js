function request_plugins_builder(name, version) {
    `
    Request the plugins settings_dict from a specific plugin.
    `
    data = {
        "name": name,
        "version": version
    }

    data = JSON.stringify(data)
    sio.emit('plugins_builder', data)
};

function request_handshakes() {
    `
    Get the handshakes from all plugins.
    `
    sio.emit('get_handshakes')
};