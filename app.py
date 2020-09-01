#!/usr/bin/env python3

"""
app
Main ultrasonics entrypoint. Run this to start ultrasonics.

XDGFX, 2020
"""

from ultrasonics import scheduler, webapp, plugins, database

_ultrasonics = {
    "version": 0.1
}

database.Core().connect()
plugins.plugin_gather()
scheduler.scheduler_start()
webapp.server_start()
