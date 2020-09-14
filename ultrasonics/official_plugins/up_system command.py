#!/usr/bin/env python3

import os

from ultrasonics import logs

log = logs.create_log(__name__)

handshake = {
    "name": "system command",
    "description": "execute a system command with the python `os` module",
    "type": [
        "outputs"
    ],
    "mode": [
        "songs",
        "playlists"
    ],
    "version": "0.1",
    "settings": []
}


def run(settings_dict, **kwargs):
    """
    Executes the requested command.
    """

    log.info(f"Executing command: {settings_dict['command']}")
    exit_code = os.system(settings_dict["command"])

    if exit_code != 0:
        log.error(
            f"Command was not successful. Failed with error code: {exit_code}")


def builder(**kwargs):
    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]

    settings_dict = [
        {
            "type": "string",
            "value": "Enter the system command you want to execute in the input below. Command is executed in the form `os.system({command})`, and so may need to be tailored for some operating systems. 💻"
        },
        {
            "type": "text",
            "label": "Command",
            "name": "command",
            "value": "",
            "required": True
        }
    ]

    return settings_dict
