#!/usr/bin/env python3

from flask import Flask, render_template
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


@app.route('/')
def html_index():
    return render_template('index.html')


@app.route('/new')
def html_new():
    return render_template('new.html')

# --- WEBSOCKET ROUTES ---


@sio.on('connect')
def connect():
    log.info("Client connected over websocket")


@sio.on('get_handshakes')
def get_handshakes():
    """
    Gets list of all handshakes from installed plugins and returns them in JSON format.
    """
    from ultrasonics.plugins import handshakes
    log.debug("Sending plugin handshakes to frontend")
    emit('get_handshakes', dumps(handshakes))


@sio.on('plugins_builder')
def plugins_builder(data):
    """
    Receives the request to add a plugin to an applet, and returns the required settings to build the plugin config page.
    """
    from ultrasonics import plugins

    data = json.loads(data)
    name = data["name"]
    version = data["version"]

    settings_dict = plugins.plugins_builder(name, version)
    settings_dict = json.dumps(settings_dict)

    emit('plugins_builder', {'name': name, 'settings_dict': settings_dict})
