#!/usr/bin/env python3
from flask import Flask, render_template
from flask_socketio import SocketIO, send, emit
from json import dumps, loads

app = Flask(__name__)

sio = SocketIO(app, async_mode='eventlet')

# --- INITIALISATION ---


def start_server():
    sio.run(app, host="0.0.0.0", use_reloader=True)

# --- SEND COMMANDS ---


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


@sio.on('get_handshakes')
def get_handshakes():
    from ultrasonics.plugins import handshakes
    emit('get_handshakes', dumps(handshakes))
