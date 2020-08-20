#!/usr/bin/env python3

"""
up_plex
Plex Media Server plugin for ultrasonics.

Allows syncing playlists to or from Plex Media Server.
If used as an output plugin, songs must have local directory paths.
Can be used even if Plex is not running on the same machine as ultrasonics.

XDGFX, 2020
"""

import urllib.request
from xml.etree import ElementTree

from ultrasonics import logs

log = logs.create_log(__name__)

handshake = {
    "name": "plex",
    "description": "Sync playlists to and from Plex Media Server.",
    "type": [
        "inputs",
        "outputs"
    ],
    "mode": [
        "playlists"
    ],
    "version": 0.1,
    "settings": [
        {
            "type": "string",
            "value": "Plex needs to have access to the local music files 📡, in order to add it to a playlist. To sync properly, ultrasonics must also have access to this same directory, so enter the respective paths below! 😎 All music to be added must be somewhere inside this folder."
        },
        {
            "type": "text",
            "label": "Music Directory (from Plex)",
            "name": "plex_prepend",
            "value": "/media/uluru/music"
        },
        {
            "type": "text",
            "label": "Music Directory (from ultrasonics)",
            "name": "ultrasonics_prepend",
            "value": "/mnt/music library/music"
        },
        {
            "type": "string",
            "value": "You have to let ultrasonics know where to find your Plex server... what's it's IP and port?"
        },
        {
            "type": "text",
            "label": "Server URL",
            "name": "server_url",
            "value": "http://192.168.1.100:32400"
        },
        {
            "type": "string",
            "value": "Do you want to check SSL when connecting? If in doubt, just leave it unchecked."
        },
        {
            "type": "checkbox",
            "label": "Check SSL",
            "name": "check_ssl",
            "value": "check_ssl",
            "id": "check_ssl"
        },
        {
            "type": "string",
            "value": "Last up, what's your Plex Token? Without it, Plex won't answer when ultrasonics knocks 🚧."
        },
        {
            "type": "text",
            "label": "Plex Token",
            "name": "plex_token",
            "value": "A1B3c4bdHA3s8COTaE3l"
        }
    ]
}


def run(settings_dict, database=None, songs_dict=None):

    pass


def builder(database):
    plex_libraries = urllib.request.urlopen(
        f"{database['server_url']}/library/sections/?X-Plex-Token={database['plex_token']}")

    plex_libraries = ElementTree.parse(plex_libraries).getroot()

    sections = []

    for child in plex_libraries:
        title = child.attrib["title"].strip()
        section_id = child.attrib["key"]
        section_type = child.attrib["type"]

        if section_type == "artist":
            sections.append(f"{title} [{section_id}]")

    settings_dict = [
        {
            "type": "string",
            "value": "Please select the music library which contains all your music (due to api limitations 🌱, all music to be synced must be in one library)"
        },
        {
            "type": "select",
            "label": "Music Library",
            "name": "section_id",
            "options": sections
        }
    ]

    return settings_dict
