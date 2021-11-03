#!/usr/bin/env python3

"""
up_plex
Plex Media Server plugin for ultrasonics.

Allows syncing playlists to or from Plex Media Server.
If used as an output plugin, songs must have local directory paths.
Can be used even if Plex is not running on the same machine as ultrasonics.

XDGFX, 2021
"""

import io
import os
import re
import shutil
from collections import OrderedDict
from urllib.parse import urlencode
from xml.etree import ElementTree

import requests
import plexapi.server
import plexapi.exceptions
import plexapi.playlist
from tqdm import tqdm
from ultrasonics import logs
from ultrasonics.tools import local_tags, fuzzymatch

log = logs.create_log(__name__)

handshake = {
    "name": "plex beta",
    "description": "Sync playlists to and from Plex Media Server.",
    "type": ["inputs", "outputs"],
    "mode": ["playlists"],
    "version": "1.0",
    "settings": [
        {
            "type": "string",
            "value": "You have to let ultrasonics know where to find your Plex server... what's it's IP and port?",
        },
        {
            "type": "text",
            "label": "Server URL",
            "name": "server_url",
            "value": "http://192.168.1.100:32400",
        },
        {
            "type": "string",
            "value": "Last up, what's your Plex Token? Without it, Plex won't answer when ultrasonics knocks 🚧.",
        },
        {
            "type": "text",
            "label": "Plex Token",
            "name": "plex_token",
            "value": "A1B3c4bdHA3s8COTaE3l",
        },
    ],
}


def run(settings_dict, **kwargs):
    """
    Iteracts with playlists on Plex.
    Songs must have a local path in order to be added.
    Songs in existing playlists will be overwritten in Plex.
    """

    def plexapi_to_ultrasonics(track) -> dict:
        """
        Converts a song object returned by PlexAPI to a song dict format used by ultrasonics.
        """
        track_dict = {}

        # Title, artist, id, and location are required
        track_dict["title"] = track.title
        track_dict["artists"] = [track.artist().title]
        track_dict["id"] = {"plex": track.key}
        track_dict["location"] = track.locations[0]
        track_dict["duration"] = track.duration

        # Only add album stuff if it exists
        if album := track.album():
            track_dict["album"] = album.title

            if date := album.originallyAvailableAt:
                track_dict["date"] = date.strftime("%Y-%m-%d")

        return track_dict

    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]
    applet_id = kwargs["applet_id"]
    songs_dict = kwargs["songs_dict"]

    plex = plexapi.server.PlexServer(database["server_url"], database["plex_token"])

    if component == "inputs":
        songs_dict = []

        # Get a list of playlists which already exist on Plex, filtering by
        # regex if necessary#
        log.info("Getting list of playlists from Plex...")
        plex_playlists = [
            playlist
            for playlist in plex.playlists()
            if re.search(settings_dict["filter"], playlist.title, re.IGNORECASE)
            and playlist.playlistType == "audio"
        ]

        log.debug(f"Found {len(plex_playlists)} playlists.")

        # Generate the songs dict
        for playlist in tqdm(plex_playlists):
            log.info(f"Processing playlist: {playlist.title}")
            playlist_dict = {
                "title": playlist.title,
                "id": {
                    "plex": playlist.key,
                },
                "songs": [],
            }

            # Get the songs in the playlist
            for track in tqdm(playlist.items(), desc="Getting songs"):
                log.debug(f"Processing track: {track.title}")
                playlist_dict["songs"].append(plexapi_to_ultrasonics(track))

            songs_dict.append(playlist_dict)

        return songs_dict

    elif component == "outputs":

        # Get a list of all music libraries on the server, with the preferred
        # library first if available
        try:
            preferred_library_id = re.search(
                r"\[([\d]+)\]$", settings_dict["section_id"]
            ).group(1)

            preferred_library = plex.library.sectionByID(int(preferred_library_id))
        except (IndexError, AttributeError):
            log.error(
                f"The preferred library: {settings_dict['section_id']}, doesn't seem to exist anymore... Falling back to all libraries"
            )
            preferred_library = None

        libraries = [
            library
            for library in plex.library.sections()
            if library.type == "artist"
            and (preferred_library is None or library.key != preferred_library.key)
        ]

        if preferred_library:
            libraries.insert(0, preferred_library)

        # Loop over supplied songs_dict and check for pre-existing playlists on Plex
        # If a playlist exists, add songs to it. If not, create it.
        for playlist in tqdm(songs_dict, desc="Processing playlists"):

            log.info(f"Processing playlist: {playlist['name']}")

            # Check if playlist exists on Plex
            try:
                plex_playlist = plex.playlist(playlist["name"])
            except plexapi.exceptions.NotFound:
                plex_playlist = None

            # Loop over songs in playlist and search for them in Plex, appending
            # to the playlist if found.
            songs_to_add = []
            for song in tqdm(playlist["songs"], desc="Adding songs"):

                # Check if song exists on Plex
                plex_songs = preferred_library.search(
                    title=song["title"], libtype="track", maxresults=10
                )

                # If no match is found, check other libraries
                if not plex_songs:
                    for library in libraries:
                        plex_songs.extend(
                            library.search(title=song["title"], libtype="track")
                        )

                # If still no match is found, log it and skip it
                if not plex_songs:
                    log.warning(f"Song {song['title']} not found on Plex. Skipping...")
                    continue

                # Convert songs to ultrasonics format
                plex_songs_ultrasonics = [
                    plexapi_to_ultrasonics(song) for song in plex_songs
                ]

                # Compare similarity of songs to find the best match
                scores = [
                    fuzzymatch.similarity(song, plex_song)
                    for plex_song in plex_songs_ultrasonics
                ]

                # If there's a match, add it to the playlist
                if max(scores) >= float(settings_dict["fuzzy_ratio"]):
                    songs_to_add.append(plex_songs[scores.index(max(scores))])
                else:
                    log.warning(f"Song {song['title']} not found on Plex. Skipping...")

            log.info(
                f"Found {len(songs_to_add)} songs in Plex out of {len(playlist['songs'])} songs supplied"
            )

            # If the playlist doesn't exist, create it and add all songs
            if not plex_playlist:
                log.info(f"Creating playlist: {playlist['name']}")
                plex_playlist = plexapi.playlist.Playlist.create(
                    server=plex, title=playlist["name"], items=songs_to_add
                )
                log.info(f"Successfully created playlist: {playlist['name']}")

            # If the playlist exists, either add or overwrite songs depending on
            # supplied option in settings_dict
            else:
                if settings_dict["existing_playlists"] == "Append":
                    log.info(f"Appending songs to playlist: {playlist['name']}")
                    plex_playlist.addItems(items=songs_to_add)

                    log.info(
                        f"Successfully appended songs to playlist: {playlist['name']}"
                    )

                elif settings_dict["existing_playlists"] == "Update":
                    log.info(f"Updating playlist: {playlist['name']}")

                    # Remove items from the existing playlist which do not exist
                    # in the new one
                    existing_songs = plex_playlist.items()
                    plex_playlist.removeItems(
                        items=[
                            song for song in existing_songs if song not in songs_to_add
                        ]
                    )

                    # Add the new songs to the playlist, skipping any that
                    # were already there
                    plex_playlist.addItems(
                        items=[
                            song for song in songs_to_add if song not in existing_songs
                        ]
                    )

                    log.info(f"Successfully updated playlist: {playlist['name']}")


def test(database, **kwargs):
    """
    Checks if Plex Media Server responds to API requests.
    """
    global_settings = kwargs["global_settings"]

    try:
        plex = plexapi.server.PlexServer(database["server_url"], database["plex_token"])
    except plexapi.exceptions.Unauthorized:
        raise plexapi.exceptions.Unauthorized(
            "Invalid Plex Token. Please check your settings."
        )
    except requests.exceptions.ConnectionError:
        raise requests.exceptions.ConnectionError(
            "Could not find a Plex server on that IP... check you have typed it correctly."
        )
    except Exception as e:
        raise Exception(f"Error connecting to Plex: {e}")

    log.info(f"Successfully connected to Plex: {plex.friendlyName}")
    log.debug(
        f"Debug info for Plex:\nPlatform: {plex.platform}\nVersion: {plex.version}"
    )


def builder(**kwargs):
    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]

    plex = plexapi.server.PlexServer(database["server_url"], database["plex_token"])

    # Select all audio libraries, and append their corresponding key
    sections = [
        f"{section.title.strip()} [{section.key}]"
        for section in plex.library.sections()
        if section.TYPE == "artist"
    ]

    settings_dict = [
        {
            "type": "string",
            "value": "Please select your preferred music library. If a synced song is not found in this library, it will fall back to scanning all music libraries.",
        },
        {
            "type": "select",
            "label": "Music Library",
            "name": "section_id",
            "options": sections,
        },
    ]

    if component == "inputs":
        settings_dict.extend(
            [
                {
                    "type": "string",
                    "value": "You can use regex style filters to only select certain playlists. For example, 'disco' would sync playlists 'Disco 2010' and 'nu_disco', or '2020$' would only sync playlists which ended with the value '2020'.",
                },
                {"type": "string", "value": "Leave it blank to sync everything 🤓."},
                {"type": "text", "label": "Filter", "name": "filter", "value": ""},
            ]
        )

    elif component == "outputs":
        settings_dict.extend(
            [
                {
                    "type": "string",
                    "value": "Songs will always attempt to be matched using fixed values like ISRC or Plex track ID, however if you're trying to sync music without these tags, fuzzy matching will be used instead.",
                },
                {
                    "type": "string",
                    "value": "This means that the titles 'You & Me - Flume Remix', and 'You & Me (Flume Remix)' will probably qualify as the same song [with a fuzzy score of 96.85 if all other fields are identical]. However, 'You, Me, & the Log Flume Ride' probably won't 🎢 [the score was 88.45 assuming *all* other fields are identical]. The fuzzyness of this matching is determined with the below setting. A value of 100 means all song fields must be identical to pass as duplicates. A value of 0 means any song will quality as a match, even if they are completely different. 👽",
                },
                {
                    "type": "text",
                    "label": "Fuzzy Ratio",
                    "name": "fuzzy_ratio",
                    "value": "Recommended: 90",
                },
                {
                    "type": "string",
                    "value": "Do you want to update any existing playlists with the same name (replace any songs already in the playlist), or append to them?",
                },
                {
                    "type": "radio",
                    "label": "Existing Playlists",
                    "name": "existing_playlists",
                    "id": "existing_playlists",
                    "options": ["Append", "Update"],
                    "required": True,
                },
                {
                    "type": "string",
                    "value": "One last thing... this plugin matches by playlist title. Plex allows multiple playlists with the same name... Try to avoid this unless you want trouble 😉.",
                },
            ]
        )

    return settings_dict
