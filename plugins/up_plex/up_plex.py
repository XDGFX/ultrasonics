#!/usr/bin/env python3

"""
up_plex
Plex Media Server plugin for ultrasonics.

Allows syncing playlists to or from Plex Media Server.
If used as an output plugin, songs must have local directory paths.
Can be used even if Plex is not running on the same machine as ultrasonics.

XDGFX, 2020
"""

import io
import os
import re
import shutil
from collections import OrderedDict
from urllib.parse import urlencode
from xml.etree import ElementTree

import requests

from ultrasonics import logs
from ultrasonics.tools.local_tags import local_tags

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


def run(settings_dict, database, component, songs_dict=None):

    def fetch_playlists(key):
        url = f"{database['server_url']}{key}?X-Plex-Token={database['plex_token']}"

        resp = requests.get(url, timeout=30, verify=check_ssl)

        if resp.status_code != 200:
            raise Exception(
                f"Unexpected status code received from Plex: {resp.status_code}")

        root = ElementTree.fromstring(resp.text)

        title = root.get("title")

        playlist = []
        for document in root.findall("Track"):
            song = document[0][0].get('file')

            # Convert path to be usable by ultrasonics
            song_path = remove_prepend(song)
            song_path = convert_path(song_path)
            song_path = os.path.join(
                database["ultrasonics_prepend"], song_path)

            try:
                song_dict = local_tags.tags(song_path)
            except Exception as e:
                log.error(f"Could not load tags from song: {song_path}")
                log.error(e)

            playlist.append(song_dict)

        return title, playlist

    def remove_prepend(path, invert=False):
        """
        Remove any prepend from Plex playlist song paths, so only the path relative to the user's music directory is left.
        Default is Plex prepend, invert is ultrasonics prepend.
        """

        if not invert:
            if database["plex_prepend"]:
                return path.replace(database["plex_prepend"], '').lstrip("/").lstrip("\\")

        else:
            if database["ultrasonics_prepend"]:
                return path.replace(database["ultrasonics_prepend"], '').lstrip("/").lstrip("\\")

        # If no database prepends exist, return the same path
        return path

    def convert_path(path, invert=False):
        """
        Converts a path string into the system format.
        """
        if enable_convert_path:
            unix = os.name != "nt"

            if invert:
                unix = not unix

            if unix:
                return path.replace("\\", "/")
            else:
                return path.replace("/", "\\")
        else:
            return path

    url = f"{database['server_url']}/playlists/?X-Plex-Token={database['plex_token']}"
    check_ssl = "check_ssl" in database.keys()

    resp = requests.get(url, timeout=30, verify=check_ssl)

    if resp.status_code != 200:
        raise Exception(
            f"Unexpected status code received from Plex: {resp.status_code}")

    root = ElementTree.fromstring(resp.text)

    keys = []
    for document in root.findall("Playlist"):
        if document.get('smart') == "0" and document.get('playlistType') == "audio":
            keys.append(document.get('key'))

    log.info(f"Found {len(keys)} playlists.")

    enable_convert_path = False
    ultrasonics_unix = database["ultrasonics_prepend"].startswith("/")
    plex_unix = database["plex_prepend"].startswith("/")

    if ultrasonics_unix != plex_unix:
        log.debug(
            "ultrasonics paths and Plex playlist paths do not use the same separators!")
        enable_convert_path = True

    if component == "inputs":
        songs_dict = []

        # Copies Plex playlists to .ultrasonics_tmp folder in music firectory
        for key in keys:
            name, playlist = fetch_playlists(key)

            songs_dict_entry = {
                "name": name,
                "songs": playlist
            }

            songs_dict.append(songs_dict_entry)

        return songs_dict

    elif component == "outputs":
        # Create temp sync folder
        temp_path = os.path.join(
            database["ultrasonics_prepend"], ".ultrasonics_tmp")

        if os.path.isdir(temp_path):
            try:
                shutil.rmtree(temp_path)
            except Exception as e:
                raise Exception(
                    "Could not remove temp folder: {temp_path}. Try deleting manually", e)

        os.makedirs(temp_path)

        for item in songs_dict:

            # Create new playlist
            playlist_path = os.path.join(temp_path, item["name"] + ".m3u")

            f = io.open(playlist_path, "w", encoding="utf8")

            # Get songs list for this playlist
            songs = item["songs"]

            for song in songs:

                # Find location of song, and convert back to local playlists format
                song_path = song["location"]
                song_path = remove_prepend(song_path, invert=True)

                prepend_path_converted = convert_path(
                    database["plex_prepend"])

                song_path = os.path.join(prepend_path_converted, song_path)
                song_path = convert_path(song_path, invert=True)

                # Write song to playlist terminated with newline character
                f.write(song_path + '\n')

            f.close()

            url = f"{database['server_url']}/playlists/upload?"
            headers = {'cache-control': "no-cache"}

            temp_path_plex = os.path.join(
                database["plex_prepend"], ".ultrasonics_tmp")

            playlist_path_plex = os.path.join(
                temp_path_plex, item["name"] + ".m3u")

            playlist_path_plex = convert_path(playlist_path_plex, invert=True)

            section_id = re.findall(
                "\[(\d+)\]$", settings_dict["section_id"])[0]

            querystring = urlencode(OrderedDict(
                [("sectionID", section_id), ("path", playlist_path_plex), ("X-Plex-Token", database["plex_token"])]))

            response = requests.post(
                url, data="", headers=headers, params=querystring, verify=check_ssl)

            # Should return nothing but if there's an issue there may be an error shown
            if not response.text == '':
                log.debug(response.text)

        # Remove the temporary folder
        shutil.rmtree(temp_path)


def test(settings_dict):
    """
    Checks if Plex Media Server responds to API requests.
    """
    url = f"{database['server_url']}{key}?X-Plex-Token={database['plex_token']}"

    resp = requests.get(url, timeout=30, verify=check_ssl)

    if resp.status_code == 200:
        return True
    else:
        return False


def builder(database, component):
    url = f"{database['server_url']}/library/sections/?X-Plex-Token={database['plex_token']}"
    check_ssl = "check_ssl" in database.keys()

    resp = requests.get(url, timeout=30, verify=check_ssl)

    if resp.status_code != 200:
        raise Exception(
            f"Unexpected status code received from Plex: {resp.status_code}")

    root = ElementTree.fromstring(resp.text)

    sections = []

    for child in root:
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
