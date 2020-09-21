#!/usr/bin/env python3

"""
local_tags
Fetches tags from local music files.

Given an input path, the metadata tags will be returned in standard ultrasonics songlist format.
This is done either by reading directly from the song file, or by reading from a cache if the song has not been modified since last read.
The currently supported audio formats are shown in supported_audio_extensions.

XDGFX, 2020
"""

import hashlib
import os
# import sqlite3

from mutagen.easyid3 import EasyID3
from mutagen.mp4 import MP4
from mutagen.flac import FLAC

from ultrasonics import logs

log = logs.create_log(__name__)

supported_audio_extensions = [
    ".mp3",
    ".m4a",
    ".flac"    
]

# db_file = os.path.join(os.path.dirname(__file__), "local_tags.db")

# log.debug("Loaded local_tags tool. Initialising database...")

# with sqlite3.connect(db_file) as conn:
#     cursor = conn.cursor()

#     try:
#         # Create tracks table if needed
#         query = "CREATE TABLE IF NOT EXISTS tracks (path TEXT PRIMARY KEY, checksum TEXT, tags TEXT)"
#         cursor.execute(query)

#         conn.commit()

#     except sqlite3.Error as e:
#         log.info("Error while initialising local_tags database", e)


def tags(song_path):
    """
    Given an input path accessible by ultrasonics, metadata for the song will be read and returned in standard ultrasonics song_dict format.
    """
    # Skip music files which are not supported
    _, ext = os.path.splitext(song_path)
    if ext.lower() not in supported_audio_extensions:
        raise NotImplementedError(song_path)

    # song_mtime = os.stat(song_path).st_mtime

    # # First try to load tags from the database for speed
    # with sqlite3.connect(db_file) as conn:
    #     try:
    #         cursor = conn.cursor()

    #         query = "SELECT tags FROM tracks WHERE path = ? AND checksum = ?"
    #         cursor.execute(query, (song_path, song_mtime))
    #         rows = cursor.fetchall()

    #         if rows != []:
    #             import ast
    #             song_dict = rows[0][0]
    #             song_dict = ast.literal_eval(song_dict)

    #             return song_dict

    #     except sqlite3.Error as e:
    #         log.info("Error while accessing local_tags database", e)

    song_dict = {}

    if ext == ".mp3":
        tags = EasyID3(song_path)

        # Fetch the ID3 tag data from the music file, and save in a dictionary
        for field in ["title", "album", "date", "isrc", "tracknumber"]:
            try:
                song_dict[field] = tags[field][0]
            except KeyError:
                pass

        try:
            song_dict["artists"] = tags["artist"]
        except KeyError:
            pass

        # Let's use the below two for the local files matcher
        # acoustid_id = tags["acoustid_id"]
        # acoustid_fingerprint = tags["acoustid_fingerprint"]

    elif ext == ".m4a":
        tags = MP4(song_path)

        # Fetch the m4a tag data from the music file, and save in a dictionary
        for field, ident in {"title": "\xa9nam", "album": "\xa9alb", "date": "\xa9day"}.items():
            try:
                song_dict[field] = tags[ident][0]
            except KeyError:
                pass

        try:
            song_dict["artists"] = tags["\xa9ART"]
        except KeyError:
            pass

        # # Correct date format
        # if song_dict["date"]:

    elif ext == ".flac":
        tags = FLAC(song_path)

        # Fetch the flac tag data from the music file, and save in a dictionary
        for field in ["title", "album", "date", "isrc", "tracknumber"]:
            try:
                song_dict[field] = tags[field][0]
            except KeyError:
                pass

        try:
            song_dict["artists"] = tags["artists"]
        except KeyError:
            pass

    # Add location of music file to dictionary
    song_dict["location"] = song_path

    # with sqlite3.connect(db_file) as conn:
    #     cursor = conn.cursor()
    #     try:
    #         query = "REPLACE INTO tracks (tags, checksum, path) VALUES(?, ?, ?)"
    #         cursor.execute(
    #             query, (str(song_dict), song_mtime, song_path))
    #         conn.commit()

    #     except sqlite3.Error as e:
    #         log.info("Error while updating local_tags database", e)

    return song_dict
