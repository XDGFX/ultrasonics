#!/usr/bin/env python3

from ultrasonics import webapp, plugins, logs

log = logs.create_log(__name__)

plugins.plugins_gather()
webapp.server_start()
