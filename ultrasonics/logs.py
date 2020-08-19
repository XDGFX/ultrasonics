#!/usr/bin/env python3

"""
logs
The default logging module for ultrasonics, which should be used for logging consistency.

XDGFX, 2020
"""

import logging


def create_log(name):
    # Create logger
    log = logging.getLogger(name)
    log.setLevel(logging.DEBUG)

    # Add streamhandler to logger
    ch = logging.StreamHandler()
    ch.setLevel(logging.DEBUG)

    # Apply log formatting
    formatter = logging.Formatter(
        '%(asctime)s: %(name)-22s - %(levelname)-7s - %(message)s')
    ch.setFormatter(formatter)

    log.addHandler(ch)

    return log
