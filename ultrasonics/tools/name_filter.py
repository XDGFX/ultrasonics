#!/usr/bin/env python3

"""
name_filter
Filters a playlist list using regex on playlist titles.

Takes a list of input playlists, and a standard regex string.
Returns all playlists where the names match the supplied regex.

XDGFX, 2020
"""

import re
import os


def filter_list(playlists, regex):
    """
    Takes a list input of *playlist names* to filter.
    """
    new_playlists = []

    for playlist in playlists:
        if re.match(regex, playlist, re.IGNORECASE):
            new_playlists.append(playlist)

    return new_playlists


def filter_path(playlists, regex):
    """
    Takes a list input of *playlist directory paths* to filter.
    """
    new_playlists = []

    for path in playlists:
        base_name = os.path.basename(path)
        playlist = os.path.splitext(base_name)[0]

        if re.match(regex, playlist, re.IGNORECASE):
            new_playlists.append(path)

    return new_playlists


def filter(songs_dict, regex):
    """
    Takes a standard songs_dict to filter.
    """
    new_playlists = []

    for playlist in songs_dict:
        if re.match(regex, playlist["name"], re.IGNORECASE):
            new_playlists.append(playlist)

    return new_playlists
