#!/usr/bin/env python3

import time
from concurrent import futures

from ultrasonics import database, logs, plugins

log = logs.create_log(__name__)

# Each applet has it's own key, where the value is True if applet should be running, or False if it needs to restart.
applets_running = {}
pool = futures.ThreadPoolExecutor(max_workers=256)


def scheduler_start():
    """
    Sets up task scheduling for all applets currently in the database.
    """
    applets = plugins.applet_gather()
    for applet in applets:
        applet_id = applet["applet_id"]
        applet_submit(applet_id)


def applet_submit(applet_id):
    """
    Submits an applet to the pool if it doesn't already exist.
    """
    if applet_id in applets_running.keys():
        # Signal that trigger should exit
        applets_running[applet_id] = False
        time.sleep(60)

    pool.submit(scheduler_applet_loop, applet_id)
    applets_running[applet_id] = True


def scheduler_applet_loop(applet_id):
    """
    Creates the main applet scheduler run loop.
    """
    log.debug(f"Submitted applet '{applet_id}' to thread pool")

    def ExecThread(applet_id):
        try:
            plugins.applet_trigger_run(applet_id)
        except Exception as e:
            # An error has occured
            log.error(e)
            return True
        else:
            # No error, trigger finished
            return False

    while True:
        # Create new thread for timer plugin
        trigger_thread = pool.submit(
            ExecThread, applet_id)

        # Wait for trigger to complete
        while not trigger_thread.done():
            time.sleep(60)

            # Check if trigger has been removed
            if applets_running[applet_id] == False:
                return

        # If an error has occurred, future == True
        if trigger_thread.result():
            return

        # Check if applet still exists in the database
        if database.Applet().get(applet_id) != None:
            plugins.applet_run(applet_id)
        else:
            break
