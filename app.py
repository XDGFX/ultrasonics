#!/usr/bin/env python3

"""
app
Main ultrasonics entrypoint. Run this to start ultrasonics.

XDGFX, 2020
"""

import os

from ultrasonics import database, plugins, scheduler, webapp

_ultrasonics = {
    "version": "1.2.0",
    "config_dir": os.path.join(os.path.dirname(__file__), "config"),
}

database.Core().connect()
plugins.plugin_gather()
scheduler.scheduler_start()
webapp.server_start()
