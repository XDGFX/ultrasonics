#!/usr/bin/env python3

"""
database
Handles all connections with the ultrasonics sqlite database.

XDGFX, 2020
"""

import sqlite3
import uuid

from ultrasonics import logs

log = logs.create_log(__name__)

db_file = "config/ultrasonics.db"
conn = None
cursor = None


# --- GENERAL ---
def connect():
    """
    Initial connection to database to create tables.
    """
    with sqlite3.connect(db_file) as conn:
        from app import _ultrasonics

        cursor = conn.cursor()
        log.info("Database connection successful")

        try:
            if new_install() == None:

                _ultrasonics["new_install"] = True

                # Create persistent settings table if needed
                query = "CREATE TABLE IF NOT EXISTS ultrasonics (key TEXT, value TEXT)"
                cursor.execute(query)

                query = "INSERT INTO ultrasonics (key, value) VALUES(?, ?)"
                cursor.executemany(query, list(_ultrasonics.items()))

            # Create persistent settings table if needed
            query = "CREATE TABLE IF NOT EXISTS plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT)"
            cursor.execute(query)

            # Create applet table if needed
            query = "CREATE TABLE IF NOT EXISTS applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT)"
            cursor.execute(query)

            conn.commit()

            # Version check
            query = "SELECT value FROM ultrasonics WHERE key = 'version'"
            cursor.execute(query)
            rows = cursor.fetchall()
            version = rows[0][0]

            if version != _ultrasonics["version"]:
                log.warning(
                    "Installed ultrasonics version does not match database version! Proceed with caution.")

        except sqlite3.Error as e:
            log.info("Error while creating tables", e)


def new_install(update=False):
    """
    Check if this is a new installation of ultrasonics.
    """
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        if update:
            try:
                query = "UPDATE ultrasonics SET value = 0 WHERE key = 'new_install'"
                cursor.execute(query)
                conn.commit()
                log.info("Welcome to ultrasonics!")

            except sqlite3.Error as e:
                log.info("Error while updating database entry", e)
        else:
            try:
                # Check if database exists
                query = "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'ultrasonics'"
                cursor.execute(query)
                rows = cursor.fetchall()

                result = rows[0][0]

                # Table does not exist
                if not result:
                    return None

                query = "SELECT value FROM ultrasonics WHERE key = 'new_install'"
                cursor.execute(query)
                rows = cursor.fetchall()

                result = rows[0][0]

                return result == '1'

            except sqlite3.Error as e:
                log.info("Error while loading database entry", e)


# --- PLUGINS ---
def plugin_create_entry(name, version):
    """
    Create a database entry for a given plugin.
    """
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        try:
            query = "INSERT INTO plugins(plugin, version) VALUES(?,?)"
            cursor.execute(query, (str(name), str(version)))
            conn.commit()
            log.info("Plugin database entry created")

        except sqlite3.Error as e:
            log.info("Error while creating database entry", e)


def plugin_update_entry(name, version, settings):
    """
    Update an existing plugin entry in the database.
    """
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        try:
            query = "UPDATE plugins SET settings = ? WHERE plugin = ? AND version = ?"
            cursor.execute(query, (str(settings), name, version))
            conn.commit()
            log.info("Plugin database entry updated")

        except sqlite3.Error as e:
            log.info("Error while updating database entry", e)


def plugin_entry_exists(name):
    """
    Find plugins with a given name, and return the versions of plugins configured for the database.
    """
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        try:
            query = "SELECT version FROM plugins WHERE plugin = ?"
            cursor.execute(query, (name,))
            rows = cursor.fetchall()

            if len(rows) > 0:
                versions = list()
                for item in rows:
                    versions.append(str(item[0]))
                return versions
            else:
                return [False]

        except sqlite3.Error as e:
            log.info("Error while checking for plugin entry", e)


def plugin_load_entry(name, version):
    """
    Load the settings from a specific plugin in the database.
    """
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        try:
            query = "SELECT settings FROM plugins WHERE plugin = ? AND version = ?"
            cursor.execute(query, (name, version))
            rows = cursor.fetchall()

            settings = rows[0][0]

            if settings != None:
                import ast
                settings = ast.literal_eval(settings)

            return settings

        except sqlite3.Error as e:
            log.info("Error while loading plugin database entry", e)


def applet_gather():
    """
    Return all the applets stored in the database.
    """
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        try:
            import ast
            query = "SELECT id, lastrun, data FROM applets"
            cursor.execute(query)
            rows = cursor.fetchall()

            if rows == None:
                return []

            data = []

            for applet_id, applet_lastrun, applet_plans in rows:
                if applet_lastrun == None:
                    data.append(
                        {
                            "applet_id": applet_id,
                            "applet_plans": ast.literal_eval(applet_plans)
                        }
                    )
                else:
                    data.append(
                        {
                            "applet_id": applet_id,
                            "applet_plans": ast.literal_eval(applet_plans),
                            "applet_lastrun": ast.literal_eval(applet_lastrun)
                        }
                    )
            return data

        except sqlite3.Error as e:
            log.info("Error while loading applets from database", e)


def applet_create_entry(applet_id, data):
    """
    Create a new applet.
    """
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        try:
            query = "REPLACE INTO applets(id, data) VALUES(?,?)"
            cursor.execute(
                query, (str(applet_id), str(data)))
            conn.commit()
            log.info("Applet database entry created")

        except sqlite3.Error as e:
            log.info("Error while creating database entry", e)


# def applet_update_entry(applet_id, data):
#     """
#     Update an existing applet.
#     """
#     with sqlite3.connect(db_file) as conn:
#         cursor = conn.cursor()
#         try:
#             query = "UPDATE applets SET data = ? WHERE id = ?"
#             cursor.execute(query, (str(data), str(applet_id)))
#             conn.commit()
#             log.info("Applet database entry updated")

#         except sqlite3.Error as e:
#             log.info("Error while updating database entry", e)


def applet_load_entry(applet_id):
    """
    Load an applet plans from it's unique id.
    """
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        try:
            import ast
            query = "SELECT data FROM applets WHERE id = ?"
            cursor.execute(query, (applet_id, ))
            rows = cursor.fetchall()

            if rows == []:
                return None
            else:
                # Convert from string to dict
                applet_plans = ast.literal_eval(rows[0][0])
                return applet_plans

        except sqlite3.Error as e:
            log.info("Error while loading applet database entry", e)


def applet_delete_entry(applet_id):
    """
    Delete an applet from the database.
    """
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        try:
            query = "DELETE FROM applets WHERE id = ?"
            cursor.execute(query, (applet_id,))
            conn.commit()
            log.info("Applet database entry deleted")

        except sqlite3.Error as e:
            log.info("Error while attempting to delete applet database entry", e)


def applet_update_lastrun(applet_id, data):
    """
    Update the lastrun column for an applet with the supplied data.
    """
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        try:
            query = "UPDATE applets SET lastrun = ? WHERE id = ?"
            cursor.execute(
                query, (str(data), str(applet_id)))
            conn.commit()
            log.info("Applet lastrun updated")

        except sqlite3.Error as e:
            log.info("Error while updating database entry", e)
