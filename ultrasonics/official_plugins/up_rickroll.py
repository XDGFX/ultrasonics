#!/usr/bin/env python3

from ultrasonics import logs

log = logs.create_log(__name__)

handshake = {
    "name": "rickroll",
    "description": "everything becomes the 1987 rick astley song \"never gonna give you up\".",
    "type": [
        "modifiers"
    ],
    "mode": [
        "playlists"
    ],
    "version": "0.1",
    "settings": []
}


def run(settings_dict, **kwargs):
    """
    Replaces all songs inside all playlists with Rick Astley - Never Gonna Give You Up. What year is it again? Still 2007? Oh, good.
    """

    songs_dict = kwargs["songs_dict"]
    template = {
        "title": "Never Gonna Give You Up",
        "artists": [
            "Rick Astley"
        ],
        "album": "Whenever You Need Somebody",
        "date": "1987-11-12",
        "isrc": "GBARL9300135",
        "id": {
                "spotify": "4uLU6hMCjMI75M1A2tKUQC",
                "deezer": "1131885",
                "tidal": "503141"
        }
    }

    for i, playlist in enumerate(songs_dict):
        length = len(playlist["songs"])
        songs_dict[i]["songs"] = [template] * length

    return songs_dict


def builder(**kwargs):
    return ""
