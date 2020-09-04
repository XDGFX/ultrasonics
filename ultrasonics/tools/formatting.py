#!/usr/bin/env python3

"""
formatting
Provides formatting helper functions to ensure consistency when logging data.

XDGFX, 2020
"""


def format_list(items):
    """
    Takes a list of items and returns them as a single string with each item on it's own line.
    """
    beginning = "    \n"
    nl = "\n"
    formatted = beginning + f'{nl}    '.join(items)
    return formatted
