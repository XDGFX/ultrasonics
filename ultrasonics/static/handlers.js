var sio = io();

sio.on('connect', function () {
    `
    Initial data requests.
    `
    console.log("Connected to backend with websocket!")
});


sio.on('plugins_builder', data => {
    `
    Receive a specific plugins settings_dict and return the required HTML to build the form.
    `
    settings_dict = JSON.parse(data["settings_dict"])

    html = html_plugin_builder(settings_dict)

    document.getElementById("plugin_builder_form").innerHTML = html

});
