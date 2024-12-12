#!/usr/bin/env python3

import json

from ultrasonics import logs

log = logs.create_log(__name__)

handshake = {
    "name": "log tracks",
    "description": "output all tracks in the songs_dict to the ultrasonics logs",
    "type": ["outputs"],
    "mode": ["playlists"],
    "version": "0.1",
    "settings": [],
}


def run(settings_dict, **kwargs):
    songs_dict = kwargs["songs_dict"]

    log.info(f"Below is the songs_dict passed to this plugin:")
    try:
        log.info("\n\n" + json.dumps(songs_dict, indent=4) + "\n\n")
    except TypeError:
        log.info("\n\n" + str(songs_dict) + "\n\n")

def builder(**kwargs):
    return []
