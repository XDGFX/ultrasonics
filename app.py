#!/usr/bin/env python3

from ultrasonics import scheduler, webapp, plugins, database, logs

log = logs.create_log(__name__)

_ultrasonics = {
    "version": 0.1
}

database.connect()
plugins.plugin_gather()
scheduler.scheduler_start()
webapp.server_start()
