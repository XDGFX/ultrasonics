#!/usr/bin/env python3

import threading
from concurrent import futures

from ultrasonics import logs, plugins, database

log = logs.create_log(__name__)

applets_running = []
pool = futures.ThreadPoolExecutor(max_workers=256)


def scheduler_start():
    """
    Sets up task scheduling for all applets currently in the database.
    """
    applets = plugins.applet_gather()
    for applet in applets:
        applet_id = applet[0]
        applet_submit(applet_id)


def applet_submit(applet_id):
    """
    Submits an applet to the pool if it doesn't already exist.
    """
    if applet_id not in applets_running:
        pool.submit(scheduler_applet_loop, applet_id)
        applets_running.append(applet_id)


def scheduler_applet_loop(applet_id):
    """
    Creates the main applet scheduler run loop.
    """
    log.debug(f"Submitted applet '{applet_id}' to thread pool")

    while True:
        # Wait for trigger to complete
        try:
            plugins.applet_trigger_run(applet_id)
        except Exception as e:
            log.error(e)
            break

        # Check if applet still exists in the database
        if database.applet_load_entry(applet_id) != None:
            plugins.applet_run(applet_id)
        else:
            break
