#!/usr/bin/env python3

from ultrasonics import logs

log = logs.create_log(__name__)

handshake = {
    "name": "skeleton",
    "description": "the default ultrasonics plugin",
    "type": "input",
    "auth": True,
    "version": 0.1,
    "colour": "#333333",
    "settings": {
        "persistent1": "text",
        "persistent2": "text",
        "options1": [
            "option1",
            "option2",
        ]
    }
}


def run(database, settings_dict, songs_dict):
    """
    if songs_dict is not supplied, this is an input plugin. it must return a songs_dict
    if songs_dict is supplied, it can be a modifier (and also returns songs_dict) or an output (and does not return anything)
    """

    # if handshake["type"] != "output":
    #     return songs_dict


def builder(database):
    """
    This function is run when the plugin is selected within a flow. It may query names of playlists or how many recent songs to include in the list.
    It returns a dictionary containing the settings the user must input in this case

    Inputs: Persistent database settings for this plugin
    """

    settings_dict = [
        {
            "type": "text",
            "label": "Search Term",
            "name": "searchterm",
            "value": "Flume"
        },
        {
            "type": "radio",
            "label": "Category",
            "name": "category",
            "id": "category",
            "options": [
                "Track",
                "Artist",
                "Album"
            ]
        },
        {
            "type": "select",
            "label": "Number of Plays",
            "name": "plays",
            "options": [
                "<1000",
                "1000-10,000",
                "10,000-100,000",
                "100,000+"
            ]
        },
        {
            "type": "checkbox",
            "label": "Include Non-English Results",
            "name": "nonenglish",
            "value": "nonenglish",
            "id": "nonenglish"
        }
    ]

    return settings_dict


def auth():
    """
    Used to return a dedicated /auth page to authorise applications which need it. Only run if handshake.auth = True.
    """
    return auth_html
