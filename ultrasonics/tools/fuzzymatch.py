#!/usr/bin/env python3

"""
fuzzymatch
Fuzzy-string song matching tool for ultrasonics.

Given an input song, input playlist data, and a threshold, the song is checked for duplicates,
returning True if one is found. The weighting for each song field is:

    1. 'location'               Overrides all following fields
    2. 'isrc', 'id'             Overrides all following fields
    3. 'title'                  Weighted equally important at 35%   (uses Simple Ratio)
    3. 'artist'                 Weighted equally important at 35%   (uses Partial Ratio)
    4. 'album'                  Weighted less important at 20%      (uses Simple Ratio)
    5. 'date'                   Weighted least important at 10%     (uses Token Set Ratio)

It goes without saying that inaccurate music tags (such as from local files) may produce inaccurate results.

XDGFX, 2020
"""

import re

from fuzzywuzzy import fuzz, process

from ultrasonics import logs

log = logs.create_log(__name__)

# List of words and patterns to ignore when testing similarity
cutoff_regex = [
    "[([](feat|ft|featuring|original|prod).+?[)\]]",
    "[ (\- )\-]+(feat|ft|featuring|original|prod).+?(?=[(\n])"
]


def duplicate(song, song_list, threshold):
    """
    Determines if `song` is present in `song_list`, with a supplied fuzziness threshold.
    Uses standard ultrasonics style song dictionaries.
    """
    # Check exact location or isrc match
    for key in ["location", "isrc"]:
        if key in song.keys():
            test_array = [item[key].strip()
                          for item in song_list if (key in item)]

            if song[key].strip() in test_array:
                return True

    # Check exact ID match
    if "id" in song:
        for key in song["id"]:
            test_array = []

            for item in song_list:
                if "id" in item.keys() and key in item.get("id"):
                    test_array.append(item["id"][key].strip())

            if song["id"][key].strip() in test_array:
                return True

    # Check fuzzy matches
    results = {}
    artist_string = " ".join(song["artists"]).lower()

    for item in song_list:
        # Name and album scores
        for key in ["title", "album"]:

            try:
                a = re.sub(cutoff_regex[0], "", song[key],
                           flags=re.IGNORECASE) + "\n"
                a = re.sub(cutoff_regex[1], " ", a,
                           flags=re.IGNORECASE).strip()

                b = re.sub(cutoff_regex[0], "", item[key],
                           flags=re.IGNORECASE) + "\n"
                b = re.sub(cutoff_regex[1], " ", b,
                           flags=re.IGNORECASE).strip()

                results[key] = fuzz.ratio(a, b)

            except KeyError:
                pass

        # Date score
        try:
            results["date"] = fuzz.token_set_ratio(song["date"], item["date"])
        except KeyError:
            pass

        # Artist score can be a partial match; allowing missing artists
        try:
            results["artist"] = fuzz.partial_token_sort_ratio(
                artist_string, " ".join(item["artists"]).lower())
        except KeyError:
            pass

        weight = {
            "title": 8,
            "artist": 8,
            "album": 2,
            "date": 1
        }

        # Fix weightings if values are missing
        corrector = 0
        for key in weight.keys():
            if key in results.keys():
                corrector += weight[key]

        if corrector == 0:
            return False

        # Weighted average all scores
        total_score = sum([results[key] / 100 * weight[key]
                           for key in results.keys()])
        total_score = total_score * 100 / corrector

        # If threshold is surpassed, no need to keep testing
        if total_score > float(threshold):
            return True

    # No match was found
    return False


def similarity(a, b):
    """
    Compares song a and song b for similarity

    @return: a number between 0 and 100 representing the similarity rating, where 100 is the same song.
    """
    # Check exact location match
    try:
        if a["location"] == b["location"]:
            return 100
    except KeyError:
        pass

    # Check exact ID match
    if "id" in a and "id" in b:
        for key in a["id"]:
            try:
                if a["id"][key].strip() == b["id"][key].strip():
                    return 100
            except KeyError:
                # Missing key in one of the songs
                pass

    # Check fuzzy matches
    results = {}

    # ISRC score
    try:
        results["isrc"] = int(a["isrc"].strip().lower() ==
                              b["isrc"].strip().lower()) * 100
        isrc_match = results["isrc"] == 100
    except KeyError:
        isrc_match = False
        pass

    # Name and album scores
    for key in ["title", "album"]:
        if key == "title" and isrc_match:
            # Don't bother matching title, only album
            continue
        try:
            cleaned_a = re.sub(
                cutoff_regex[0], "", a[key], flags=re.IGNORECASE) + "\n"
            cleaned_a = re.sub(
                cutoff_regex[1], " ", cleaned_a, flags=re.IGNORECASE).strip().lower()

            cleaned_b = re.sub(
                cutoff_regex[0], "", b[key], flags=re.IGNORECASE) + "\n"
            cleaned_b = re.sub(
                cutoff_regex[1], " ", cleaned_b, flags=re.IGNORECASE).strip().lower()

            results[key] = fuzz.ratio(cleaned_a, cleaned_b)

        except KeyError:
            pass

    if not isrc_match:
        # Date score
        try:
            results["date"] = fuzz.token_set_ratio(a["date"], b["date"])
        except KeyError:
            pass

        # Artist score can be a partial match; allowing missing artists
        try:
            artists_a = " ".join(a["artists"]).lower()
            artists_b = " ".join(b["artists"]).lower()

            results["artist"] = fuzz.partial_token_sort_ratio(
                artists_a, artists_b)
        except KeyError:
            pass

    weight = {
        "isrc": 10,
        "title": 8,
        "artist": 8,
        "album": 2,
        "date": 1
    }

    # Fix weightings if values are missing
    corrector = 0
    for key in weight.keys():
        if key in results.keys():
            corrector += weight[key]

    if corrector == 0:
        return False

    # Weighted average all scores
    total_score = sum([results[key] / 100 * weight[key]
                       for key in results.keys()])
    total_score = total_score * 100 / corrector

    return total_score
