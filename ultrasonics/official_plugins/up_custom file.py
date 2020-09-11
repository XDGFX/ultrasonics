#!/usr/bin/env python3

from ultrasonics import logs

log = logs.create_log(__name__)

handshake = {
    "name": "custom file",
    "description": "save playlists to a file with custom content",
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
    For each playlist:
    1. Creates a file with the specified name.
    2. Saves each track according to the specified pattern.
    """

    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]
    applet_id = kwargs["applet_id"]
    songs_dict = kwargs["songs_dict"]

    pass


def builder(**kwargs):
    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]

    settings_dict = [
        {
            "type": "string",
            "value": "This plugin allows you to output playlists to a file, using a custom pattern for each song."
        },
        {
            "type": "string",
            "value": "First, what directory do you want to save these files into?"
        },
        {
            "type": "text",
            "label": "Directory",
            "name": "dir",
            "value": "/mnt/playlists"
        },
        {
            "type": "string",
            "value": "Do you want to overwrite any files already in the directory with matching names, or append to them?"
        },
        {
            "type": "radio",
            "label": "Existing Files",
            "name": "existing_files",
            "id": "existing_files",
            "options": [
                "Overwrite",
                "Append"
            ]
        },
        {
            "type": "string",
            "value": "What do you want each file to be called? You can use the wildcard '{name}' for the playlist name."
        },
        {
            "type": "text",
            "label": "Playlist Name",
            "name": "playlist_name",
            "value": "{name}.txt"
        },
        {
            "type": "string",
            "value": "Finally, what is the pattern which you want to write for each song? The available fields are: {title}, {artist}, {album}, {isrc}, {location}, and {id.service} where 'service' is the id which you want to save, e.g. {id.spotify}."
        },
        {
            "type": "string",
            "value": "Any songs with missing fields will be skipped. All songs are saved on a new line."
        },
        {
            "type": "text",
            "label": "Song Pattern",
            "name": "pattern",
            "value": "{artist} - {title} (ISRC: {isrc})"
        }
    ]

    return settings_dict
