#!/usr/bin/env python3

"""
logs
The default logging module for ultrasonics, which should be used for logging consistency.

XDGFX, 2020
"""

import logging
import logging.handlers
import os

buffer = {}
handler = {}

try:
    os.mkdir("logs")
except FileExistsError:
    # Folder already exists
    pass


class CustomFormatter(logging.Formatter):
    """Logging Formatter to add colors and count warning / errors"""

    grey = "\x1b[38m"
    blue = "\x1b[96m"
    yellow = "\x1b[33m"
    red = "\x1b[31m"
    bold_red = "\x1b[31;7mm"
    reset = "\x1b[0m"
    format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s (%(filename)s:%(lineno)d)"

    FORMATS = {
        logging.DEBUG: grey + format + reset,
        logging.INFO: blue + format + reset,
        logging.WARNING: yellow + format + reset,
        logging.ERROR: red + format + reset,
        logging.CRITICAL: bold_red + format + reset
    }

    def format(self, record):
        log_fmt = self.FORMATS.get(record.levelno)
        formatter = logging.Formatter(log_fmt)
        return formatter.format(record)


def create_log(name):
    # Create logger
    log = logging.getLogger(name
                            .replace("ultrasonics.", "")
                            .replace("official_plugins.up_", "🎧 ")
                            .replace("plugins.up_", "🎤 "))

    log.setLevel(logging.DEBUG)

    # Add streamhandler to logger
    ch = logging.StreamHandler()
    ch.setLevel(logging.DEBUG)

    # Add filehandler to logger
    fh = logging.handlers.RotatingFileHandler(
        f"logs/{name}.log",  maxBytes=1048576, backupCount=2)
    fh.setLevel(logging.DEBUG)

    # Apply log formatting
    ch.setFormatter(CustomFormatter())

    formatter = logging.Formatter(
        '%(asctime)s: %(levelname)-7s - %(message)s (%(filename)s:%(lineno)d)')
    fh.setFormatter(formatter)

    log.addHandler(ch)
    log.addHandler(fh)

    log.debug("LOG CREATED")

    return log


def start_capture(name):
    """
    Start capturing logs for a given module.

    @return: Logger for the selected plugin, should this be needed.
    """
    from io import StringIO

    buffer[name] = StringIO()
    log = logging.getLogger(name)

    handler[name] = logging.StreamHandler(buffer[name])

    formatter = logging.Formatter(
        '%(levelname)-7s - %(message)s')
    handler[name].setFormatter(formatter)

    log.addHandler(handler[name])

    return log


def stop_capture(name):
    """
    Stop capturing logs for a given module.

    @return: Collected logs as string
    """
    log = logging.getLogger(name)
    log.removeHandler(handler[name])

    handler[name].flush()
    buffer[name].flush()

    return buffer[name].getvalue()
