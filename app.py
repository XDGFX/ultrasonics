#!/usr/bin/env python3

from ultrasonics import webapp, plugins

plugins.gather_plugins()
webapp.start_server()
