var sio = io();

sio.on('connect', function () {
    `
    Initial data requests.
    `
    // sio.emit('get_handshakes');
});

sio.on('get_handshakes', data => {
    `
    Receive plugin handshakes from backend.
    `

    handshakes = JSON.parse(data)

    // Sort handshakes alphabetically
    handshakes.sort(function (a, b) {
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });


    for (var i = 0; i < handshakes.length; i++) {

        hexcolour = handshakes[i].colour

        // If a leading # is provided, remove it
        if (hexcolour.slice(0, 1) === '#') {
            hexcolour = hexcolour.slice(1);
        }

        // If a three-character hexcode, make six-character
        if (hexcolour.length === 3) {
            hexcolour = hexcolour.split('').map(function (hex) {
                return hex + hex;
            }).join('');
        }

        // Convert to RGB value
        var r = parseInt(hexcolour.substr(0, 2), 16);
        var g = parseInt(hexcolour.substr(2, 2), 16);
        var b = parseInt(hexcolour.substr(4, 2), 16);

        // Get YIQ ratio
        var yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;

        // Check contrast
        if (yiq >= 128) {
            textColour = "#333333"
        } else {
            textColour = "#ffffff"
        }



        html = `
        <div class="tile has-text-centered notification is-3 height-is-200" style="background-color: ${handshakes[i].colour}">
            <p style="color: ${textColour}">${handshakes[i].name}</p>
        </div>
        `
    }

    document.getElementById("div_service_select").innerHTML = html
});

sio.on('plugins_builder', data => {
    `
    Receive a specific plugins settings_dict and return the required HTML to build the form.
    `
    settings_dict = JSON.parse(data["settings_dict"])
    name = data["name"]

    html = html_plugin_builder(settings_dict)

    document.getElementById("plugin_builder").innerHTML = html
});
