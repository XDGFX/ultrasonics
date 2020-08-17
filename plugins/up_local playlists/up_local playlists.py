#!/usr/bin/env python3

from ultrasonics import logs

log = logs.create_log(__name__)

handshake = {
    "name": "local playlists",
    "description": "interface with all local .m3u playlists in a directory",
    "type": [
        "inputs",
        "outputs"
    ],
    "mode": [
        "playlists"
    ],
    "version": 0.1,
    "settings": False
}


def run(settings_dict, database=None, songs_dict=None):
    """
    if songs_dict is not supplied, this is an input plugin. it must return a songs_dict
    if songs_dict is supplied, it can be a modifier (and also returns songs_dict) or an output (and does not return anything)
    """
    if not songs_dict:
        "Input mode"
        print(settings_dict)

    else:
        "Output mode"
        print(settings_dict)


def builder(database=None):
    """
    This function is run when the plugin is selected within a flow. It may query names of playlists or how many recent songs to include in the list.
    It returns a dictionary containing the settings the user must input in this case

    Inputs: Persistent database settings for this plugin
    """

    settings_dict = [
        {
            "type": "text",
            "label": "Directory",
            "name": "dir",
            "value": "/mnt/music library/playlists"
        },
        {
            "type": "checkbox",
            "label": "Recursive",
            "name": "recursive",
            "value": "recursive",
            "id": "recursive"
        },
        {
            "type": "string",
            "value": "Enabling recursive mode will search all subfolders for more playlists."
        }
    ]

    return settings_dict
