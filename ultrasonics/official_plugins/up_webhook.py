#!/usr/bin/env python3

from flask import Flask, request

from ultrasonics import logs

log = logs.create_log(__name__)

handshake = {
    "name": "webhook",
    "description": "trigger the applet with a http 'get' request.",
    "type": [
        "triggers"
    ],
    "mode": [
        "playlists",
        "songs"
    ],
    "version": "0.1",
    "settings": []
}


def run(settings_dict, **kwargs):
    """
    Creates a simple flask webserver which just waits for a single request before exiting.
    """

    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]
    applet_id = kwargs["applet_id"]
    songs_dict = kwargs["songs_dict"]

    if not settings_dict['path'].startswith("/"):
        settings_dict['path'] = "/" + settings_dict['path']

    url = "http://0.0.0.0:" + settings_dict['port'] + settings_dict['path']

    log.info(f"Creating webserver trigger for applet: {applet_id}")
    log.info(f"The endpoint will be accessible at: {url}")

    app = Flask(applet_id)

    @app.route(settings_dict["path"])
    def endpoint():
        func = request.environ.get('werkzeug.server.shutdown')
        if func is None:
            raise RuntimeError('Not running with the Werkzeug Server')
        func()
        log.info(f"Applet triggered: {applet_id}")
        return f"Applet triggered: {applet_id}"

    app.run(host="0.0.0.0", port=int(settings_dict["port"]))


def builder(**kwargs):
    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]

    settings_dict = [
        {
            "type": "string",
            "value": "This plugin works by spinning up a small webserver, which waits for a single GET request at the specified hostname and port. ☁️"
        },
        {
            "type": "string",
            "value": "You should make sure whatever is performing this web request has access to the url. You can define a port and root path below, the port cannot be the same as ultrasonics (5000) or any other instance of the webhook trigger."
        },
        {
            "type": "text",
            "label": "Port",
            "name": "port",
            "value": "5001",
            "required": True
        },
        {
            "type": "text",
            "label": "Root Path",
            "name": "path",
            "value": "/",
            "required": True
        },
    ]

    return settings_dict
