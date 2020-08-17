#!/usr/bin/env python3

from ultrasonics import scheduler, webapp, plugins, logs

log = logs.create_log(__name__)

plugins.plugin_gather()
scheduler.scheduler_start()
webapp.server_start()
