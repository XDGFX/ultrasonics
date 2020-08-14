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
