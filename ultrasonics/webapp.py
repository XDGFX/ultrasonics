#!/usr/bin/env python3
from flask import Flask, render_template
from flask_socketio import SocketIO, send, emit

app = Flask(__name__)

sio = SocketIO(app, async_mode='eventlet')

# --- INITIALISATION ---


def serve():
    pass


def start_server():
    sio.run(app, host="0.0.0.0", use_reloader=True)
    # thread = Thread(target=serve)
    # thread.start()
    print("Webserver started")

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


@sio.on('my event')
def test_message(message):
    emit('my response', {'data': 'got it!'})
