#!/usr/bin/env python3

"""
up_local music database

Allows for compatibility between non-local services (Spotify, Deezer), and local services (.m3u playlists, Plex).
Creates a database of all your music, and uses fuzzy tags matching to match a song from songs_dics with a physical file.
The file path will be added to the songs_dict entry if it is found locally.
Existing locations are left untouched.

XDGFX, 2020
"""

import json
import math
import os
import sqlite3

from tqdm import tqdm

from app import _ultrasonics
from ultrasonics import logs
from ultrasonics.tools import fuzzymatch, local_tags

log = logs.create_log(__name__)

# For storing library information
db_file = os.path.join(_ultrasonics["config_dir"],
                       "up_local music database", "library.db")
log.debug(f"Database file location: {db_file}")

# Create the containing folder if it doesn't already exist
try:
    os.mkdir(os.path.dirname(db_file))
    log.debug("Successfully created database folder.")
except FileExistsError:
    # Folder already exists
    pass

# Get supported files from local_tags library
supported_audio_extensions = local_tags.supported_audio_extensions
log.debug(
    f"Supported extensions for this plugin include: {supported_audio_extensions}")

# Known not-audio files to skip silently
extension_skiplist = [".jpg", ".png", ".bak", ".dat", ".lrc",
                      ".lyrics", ".m3u", ".sfk", ".snap", ".temp", ".tmp", ".txt"]
log.debug(
    f"This plugin will automatically skip any files matching the following extensions: {extension_skiplist}")

handshake = {
    "name": "local music database",
    "description": "allow connections between your online and offline (local music) services.",
    "type": [
        "modifiers"
    ],
    "mode": [
        "playlists"
    ],
    "version": "0.1",
    "settings": [
        {
            "type": "string",
            "value": "Please enter the location of all your local music. It is highly recommended to use absolute file paths (e.g. /mnt/media/music not ./music)"
        },
        {
            "type": "string",
            "value": f"Supported audio extensions are: {', '.join(supported_audio_extensions)}."
        },
        {
            "type": "text",
            "label": "Your Music Directory",
            "name": "music_dir",
            "value": "/mnt/media/music"
        },
        {
            "type": "string",
            "value": "Songs will always attempt to be matched using fixed values like ISRC, however if you're trying to sync music without these tags, fuzzy matching will be used instead."
        },
        {
            "type": "string",
            "value": "This means that the titles 'You & Me - Flume Remix', and 'You & Me (Flume Remix)' will probably qualify as the same song [with a fuzzy score of 96.85 if all other fields are identical]. However, 'You, Me, & the Log Flume Ride' probably won't 🎢 [the score was 88.45 assuming *all* other fields are identical]. The fuzzyness of this matching is determined with the below setting. A value of 100 means all song fields must be identical to pass as duplicates. A value of 0 means any song will quality as a match, even if they are completely different. 👽"
        },
        {
            "type": "text",
            "label": "Fuzzy Ratio",
            "name": "fuzzy_ratio",
            "value": "Recommended: 90"
        },
    ]
}


class Database:
    def __init__(self):
        """
        Create the database for storing music tags.
        """
        self.database_fields = "location,title,artists,album,date,isrc,modified"

        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            log.info("Database connection successful")
            query = """
            CREATE TABLE IF NOT EXISTS songs
            (
                location TEXT PRIMARY KEY,
                title TEXT,
                artists TEXT,
                album TEXT,
                date TEXT,
                isrc TEXT,
                modified INTEGER
            )
            """
            cursor.execute(query)
            conn.commit()

    def item_exists(self, location):
        """
        Checks if an item already exists in the database. If true, returns the `modified` time.
        """
        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = "SELECT modified FROM songs WHERE location=?"
            cursor.execute(query, (location,))
            return cursor.fetchone()

    def update_songs(self, songs_dict, mtimes):
        """
        Save songs in a standard songs_dict to the database, with accompanying modified times.
        """
        log.debug(f"Updating the database with {len(songs_dict)} new song(s)")
        fields = self.database_fields.split(",")
        sql_data = []

        for song, mtime in zip(songs_dict, mtimes):
            # Serialise all fields
            data = []
            for item in fields:
                try:
                    if item == "modified":
                        data.append(mtime)

                    elif item == "location":
                        data.append(song[item])

                    elif isinstance(song[item], str):
                        data.append(song[item].strip().lower())

                    else:
                        data.append(json.dumps(song[item]).strip().lower())

                except KeyError:
                    data.append(None)

            sql_data.append(data)

        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = f"REPLACE INTO songs ({self.database_fields}) VALUES (?,?,?,?,?,?,?)"
            cursor.executemany(query, tuple(sql_data))
            conn.commit()
            log.info("Database is up to date!")

    def get_song(self, field, value):
        """
        Return a songs_dict style list of songs which match the requested field:value.
        """
        with sqlite3.connect(db_file) as conn:
            cursor = conn.cursor()
            query = f"SELECT * FROM songs WHERE instr({field}, ?) > 0"
            cursor.execute(query, (value.lower(),))
            rows = cursor.fetchall()

            if rows == []:
                return

            found_songs = []

            for song in rows:
                # Convert to songs_dict format
                item = {
                    "title": song[1],
                    "artists": json.loads(song[2]),
                    "album": song[3],
                    "date": song[4],
                    "isrc": song[5],
                    "location": song[0]
                }

                # Remove any empty fields
                item = {k: v for k, v in item.items() if v}

                found_songs.append(item)

            return found_songs


def run(settings_dict, **kwargs):
    """
    1. Update local music database.
    2. Loop over each song without a local path.
    3. Attempt to match that song with a local file.
    4. Update the songs_dict if possible.
    """

    database = kwargs["database"]
    global_settings = kwargs["global_settings"]
    component = kwargs["component"]
    applet_id = kwargs["applet_id"]
    songs_dict = kwargs["songs_dict"]

    db = Database()

    def update_database():
        """
        Checks for modified directories since last scan.
        Walks over all modified music files in the supplied directory and extracts their tags where supported.
        Saves all tags to the database.
        """
        # Create list of all found music files
        songs = []
        mtimes = []
        songs_length = 0
        log.info("Searching your local music directory for music files...")
        for root, _, files in tqdm(os.walk(database["music_dir"]), desc="Searching for new songs"):
            for item in files:
                # Check extension is supported
                _, ext = os.path.splitext(item)
                ext = ext.lower()
                if ext in extension_skiplist:
                    # Silently skip the file
                    continue

                if ext not in supported_audio_extensions:
                    # Skip the file
                    log.debug(item)
                    log.debug(
                        f"Unsupported extension for local music file: {ext}")
                    continue

                location = os.path.join(root, item)

                # Check if file is already in database
                mtime = db.item_exists(location)
                new_mtime = math.floor(
                    os.path.getmtime(location)
                )

                if mtime == (new_mtime,):
                    # File already exists in database
                    continue

                try:
                    song = local_tags.tags(location)
                except NotImplementedError as e:
                    # Skip the file
                    log.debug(e)
                    log.debug(
                        f"Unsupported extension for local music file: {ext}")
                    continue

                songs.append(song)
                mtimes.append(new_mtime)

                current_songs_length = len(mtimes)
                if current_songs_length >= 100 + songs_length:
                    log.info(
                        f"Found {current_songs_length} songs not in the database.")
                    songs_length += 100

        db.update_songs(songs, mtimes)

    # 1. Update the database with any new songs added.
    update_database()

    preferred_order = ["isrc", "title", "artists", "album"]

    total_count = 0
    matched_count = 0

    for i, playlist in enumerate(songs_dict):
        for j, song in enumerate(playlist["songs"]):
            if "location" in song.keys():
                # Location already exists
                continue

            checked_songs = []
            found = False

            # Loop over available keys in order of preference
            for key in [key for key in preferred_order if key in song]:
                if key == "id":
                    continue
                elif key == "artists":
                    resp = [db.get_song(key, value) for value in song[key]]

                    # Remove None from items
                    resp = [item for item in resp if item != None]

                    if resp:
                        # Flatten list response
                        resp = [item for sublist in resp for item in sublist]
                else:
                    resp = db.get_song(key, song[key])

                if resp:
                    for item in resp:
                        if item in checked_songs:
                            continue

                        score = fuzzymatch.similarity(song, item)
                        if score > float(database.get("fuzzy_ratio") or 90):
                            # Match found
                            songs_dict[i]["songs"][j]["location"] = item["location"]
                            found = True
                            break

                    checked_songs.extend(resp)

                if found:
                    matched_count += 1
                    total_count += 1
                    break

            if not found:
                log.info(f"No local match was found for {song}")
                total_count += 1

    log.info(f"{matched_count} songs out of a total of {total_count} were matched with your local library, or already had a local path.")

    return songs_dict


def test(database, **kwargs):
    """
    Checks that the supplied music directory is a valid path.
    """

    if not os.path.isdir(database["music_dir"]):
        log.error(
            f"Could not find the directory specified: {database['music_dir']}")
        log.error(
            "Check you have appropriate permissions, and are using absolute paths.")
        raise Exception

    log.info("The supplied music directory is valid.")


def builder(**kwargs):
    # No plugin instance specific settings
    return ""
