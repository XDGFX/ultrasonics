#!/usr/bin/env python3

from ultrasonics import logs

log = logs.create_log(__name__)

handshake = {
    "name": "skeleton",
    "description": "the default ultrasonics plugin",
    "type": [
        "inputs"
    ],
    "mode": [
        "songs"
    ],
    "version": 0.1,
    "settings": [
        {
            "type": "text",
            "label": "Persistent Setting 1",
            "name": "persistent_setting_1",
            "value": "Setting Value"
        },
        {
            "type": "radio",
            "label": "Radio Settings",
            "name": "radio_settings",
            "id": "radio_settings",
            "options": [
                "User",
                "Email",
                "Token"
            ]
        },
    ]
}


def run(settings_dict, database=None, component=None, applet_id=None, songs_dict=None):
    """
    The function called when the applet runs.

    Inputs:
    settings_dict      Settings specific to this plugin instance
    database           Global persistent settings for this plugin
    component          Either "inputs", "modifiers", "outputs", or "trigger"
    applet_id          The unique identifier for this specific applet
    songs_dict         If a modifier or output, the songs dictionary to be used

    @return:
    If an input or modifier, the new songs_dict must be returned.
    """
    pass


def test(settings_dict):
    """
    An optional test function. Used to validate persistent settings supplied in settings_dict.
    Any errors raised will be caught and displayed to the user for debugging.
    If this function is present, test failure will prevent the plugin being added.
    """
    pass


def builder(database=None, component=None):
    """
    This function is run when the plugin is selected within a flow. It may query names of playlists or how many recent songs to include in the list.
    It returns a dictionary containing the settings the user must input in this case

    Inputs: 
    database           Persistent database settings for this plugin
    component          Either "inputs", "modifiers", "outputs", or "trigger"

    @return:
    settings_dict      Used to build the settings page for this plugin instance

    """

    settings_dict = [
        {
            "type": "string",
            "value": "Welcome to Ultrasonics. This is a basic sample plugin to help with development of future plugins."
        },
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
            "type": "hidden",
            "name": "random_id",
            "value": "some_value"
        },
        {
            "type": "link",
            "value": "http://auth.spotify.com"
        }
    ]

    return settings_dict
