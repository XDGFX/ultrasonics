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
    "version": "0.0",  # Optionally, "0.0.0"
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


def run(settings_dict, **kwargs):
    """
    The function called when the applet runs.

    Inputs:
    settings_dict      Settings specific to this plugin instance
    database           Global persistent settings for this plugin
    global_settings    Global settings for ultrasonics (e.g. api proxy)
    component          Either "inputs", "modifiers", "outputs", or "trigger"
    applet_id          The unique identifier for this specific applet
    songs_dict         If a modifier or output, the songs dictionary to be used

    @return:
    If an input or modifier, the new songs_dict must be returned.
    """

    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]
    applet_id = kwargs["applet_id"]
    songs_dict = kwargs["songs_dict"]

    log.debug("This is a debug message")
    log.info("This is a info message")
    log.warning("This is a warning message")
    log.error("This is a error message")
    log.critical("This is a critical message")

    pass


def test(database, **kwargs):
    """
    An optional test function. Used to validate persistent settings supplied in database.
    Any errors raised will be caught and displayed to the user for debugging.
    If this function is present, test failure will prevent the plugin being added.
    """

    global_settings = kwargs["global_settings"]

    pass


def builder(**kwargs):
    """
    This function is run when the plugin is selected within a flow. It may query names of playlists or how many recent songs to include in the list.
    It returns a dictionary containing the settings the user must input in this case

    Inputs:
    database           Persistent database settings for this plugin
    component          Either "inputs", "modifiers", "outputs", or "trigger"

    @return:
    settings_dict      Used to build the settings page for this plugin instance

    """

    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]

    settings_dict = [
        {
            "type": "string",
            "value": "Welcome to Ultrasonics. This is a basic sample plugin to help with development of future plugins."
        },
        {
            "type": "text",
            "label": "Search Term",
            "name": "searchterm",
            "value": "Flume",
            "required": True
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
            ],
            "required": True
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
            "value": "https://spotify.com"
        },
        {
            "type": "auth",
            "value": "/spotify_auth_request"
        }
    ]

    return settings_dict
