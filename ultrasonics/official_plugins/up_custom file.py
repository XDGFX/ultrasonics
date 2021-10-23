#!/usr/bin/env python3

import io
import os
import re

from ultrasonics import logs

log = logs.create_log(__name__)

handshake = {
    "name": "custom file",
    "description": "save playlists to a file with custom content",
    "type": ["outputs"],
    "mode": ["songs", "playlists"],
    "version": "0.1",
    "settings": [],
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

    for playlist in songs_dict:
        filename = settings_dict["playlist_name"].replace("{name}", playlist["name"])
        filepath = os.path.join(settings_dict["dir"], filename)

        write_lines = []

        for song in playlist["songs"]:

            key_dict = {
                "title": song.get("title"),
                "artist": song.get("artists", [None])[0],
                "album": song.get("album"),
                "isrc": song.get("isrc"),
                "location": song.get("location"),
            }

            output = settings_dict["pattern"]

            try:
                keys = re.findall(r"{id\.(\w+)}", output)

                for item in keys:
                    value = song["id"][item]
                    output = re.sub(r"{id\.(\w+)}", value, output, 1)

                keys = re.findall(r"{(\w+)}", output)

                for item in keys:
                    value = key_dict[item]
                    output = re.sub(r"{(\w+)}", value, output, 1)

                write_lines.append(output)
            except TypeError:
                log.warning(
                    f"Song {song['title']} contains an invalid field in pattern {settings_dict['pattern']}"
                )
                continue

        mode = "a" if settings_dict["existing_files"] == "Append" else "w"
        with io.open(filepath, mode, encoding="utf8") as f:
            f.write("\n".join(write_lines))


def builder(**kwargs):
    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]

    settings_dict = [
        {
            "type": "string",
            "value": "This plugin allows you to output playlists to a file, using a custom pattern for each song.",
        },
        {
            "type": "string",
            "value": "First, what directory do you want to save these files into?",
        },
        {
            "type": "text",
            "label": "Directory",
            "name": "dir",
            "value": "/mnt/playlists",
            "required": True,
        },
        {
            "type": "string",
            "value": "Do you want to overwrite any files already in the directory with matching names, or append to them?",
        },
        {
            "type": "radio",
            "label": "Existing Files",
            "name": "existing_files",
            "id": "existing_files",
            "options": ["Overwrite", "Append"],
            "required": True,
        },
        {
            "type": "string",
            "value": "What do you want each file to be called? You can use the wildcard '{name}' for the playlist name.",
        },
        {
            "type": "text",
            "label": "Playlist Name",
            "name": "playlist_name",
            "value": "{name}.txt",
            "required": True,
        },
        {
            "type": "string",
            "value": "Finally, what is the pattern which you want to write for each song? The available fields are: {title}, {artist}, {album}, {isrc}, {location}, and {id.service} where 'service' is the id which you want to save, e.g. {id.spotify}.",
        },
        {
            "type": "string",
            "value": "Any songs with missing fields will be skipped. All songs are saved on a new line.",
        },
        {
            "type": "text",
            "label": "Song Pattern",
            "name": "pattern",
            "value": "{artist} - {title} (ISRC: {isrc})",
            "required": True,
        },
    ]

    return settings_dict
