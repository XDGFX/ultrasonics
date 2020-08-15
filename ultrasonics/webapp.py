#!/usr/bin/env python3

from flask import Flask, render_template, request
from flask_socketio import SocketIO, send, emit
from json import dumps, loads
from ultrasonics import logs
import json

log = logs.create_log(__name__)

app = Flask(__name__)

sio = SocketIO(app, async_mode='eventlet')


# --- GENERAL ---


def server_start():
    log.debug("Starting webserver")
    sio.run(app, host="0.0.0.0", debug=True)


def send(event, data):
    sio.emit(str(event), {'data': data})

# --- WEBSERVER ROUTES ---


# Homepage
@app.route('/')
def html_index():
    return render_template('index.html')


class Applet:

    current_applet = {
        "applet_id": "",
        
    }

    # Create Applet Page
    @app.route('/new_applet')
    def html_new_applet(self):

        if not request.args.get('action'):
            # If opening the page for the first time, generate a new applet
            import uuid
            from ultrasonics import plugins

            applet_id = uuid.uuid4()

            # TODO Implement check for UUID already in database, and create a new one if so
            # applets = plugins.applet_gather()

            return render_template('new_applet.html', applet_id=applet_id)
        elif request.args.get('action') == 'add':
            log.info("Argument passed")
            return render_template('new_applet.html')


# Select Plugin Page
@app.route('/select_plugin')
def html_select_plugin():
    component = request.args['component']

    if not component:
        log.error("Component not supplied as argument")
        raise RuntimeError

    import ultrasonics.plugins

    handshakes = ultrasonics.plugins.handshakes
    selected_handshakes = list()

    # Determine text colour
    for handshake in handshakes:

        if handshake["type"] != component:
            # Plugin is not the requested type
            continue
        else:
            hexcolour = handshake["colour"]

            # If a leading '#' is provided, remove it
            if hexcolour[0] == '#':
                hexcolour = hexcolour[1:]

            # If a three-character hexcode, make six-character
            if len(hexcolour) == 3:
                hexcolour = hexcolour[0] * 2 + \
                    hexcolour[1] * 2 + hexcolour[2] * 2

            # Convert to RGB value
            r = int(hexcolour[0:2], 16)
            g = int(hexcolour[2:4], 16)
            b = int(hexcolour[4:6], 16)

            # Get YIQ ratio
            yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000

            # Check contrast
            if yiq >= 128:
                handshake["textColour"] = "#333333"
            else:
                handshake["textColour"] = "#ffffff"

            selected_handshakes.append(handshake)

    return render_template('select_plugin.html', handshakes=selected_handshakes)


# Configure Plugin page
@app.route('/configure_plugin')
def html_configure_plugin():
    import ultrasonics.plugins

    plugin = request.args.get('plugin')
    version = request.args.get('version')

    if not plugin:
        log.error("Plugin not supplied as argument")

    settings = ultrasonics.plugins.plugins_builder(plugin, version)

    return render_template('configure_plugin.html', settings=settings, plugin=plugin, version=version)

# --- WEBSOCKET ROUTES ---


@sio.on('connect')
def connect():
    log.info("Client connected over websocket")


# @sio.on('get_handshakes')
# def get_handshakes():
#     """
#     Gets list of all handshakes from installed plugins and returns them in JSON format.
#     """
#     from ultrasonics.plugins import handshakes
#     log.debug("Sending plugin handshakes to frontend")
#     emit('get_handshakes', dumps(handshakes))


# @sio.on('plugins_builder')
# def plugins_builder(data):
#     """
#     Receives the request to add a plugin to an applet, and returns the required settings to build the plugin config page.
#     """
#     from ultrasonics import plugins

#     data = json.loads(data)
#     name = data["name"]
#     version = data["version"]

#     settings_dict = plugins.plugins_builder(name, version)
#     settings_dict = json.dumps(settings_dict)

#     emit('plugins_builder', {'name': name, 'settings_dict': settings_dict})
