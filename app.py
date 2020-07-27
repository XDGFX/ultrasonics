#!/usr/bin/env python3

from ultrasonics import webapp
from ultrasonics import plugins
from ultrasonics import database

plugins.gather_plugins()
database.connect()
webapp.start_server()
