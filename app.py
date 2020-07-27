#!/usr/bin/env python3

from ultrasonics import webapp
from ultrasonics import plugins
# from ultrasonics import database

# database.connect()
plugins.gather_plugins()
webapp.start_server()
