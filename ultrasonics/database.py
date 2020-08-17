#!/usr/bin/env python3

import sqlite3
import uuid

from ultrasonics import logs

log = logs.create_log(__name__)

db_file = "ultrasonics/ultrasonics.db"
conn = None
cursor = None


# --- GENERAL ---
def connect():
    """
    Initial connection to database to create tables.
    """
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        log.info("Database connection successful")

        try:
            # Create persistent settings table if needed
            query = "CREATE TABLE IF NOT EXISTS plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT)"
            cursor.execute(query)

            # Create applet table if needed
            query = "CREATE TABLE IF NOT EXISTS applets (id TEXT PRIMARY KEY, name TEXT, data TEXT)"
            cursor.execute(query)

            conn.commit()

        except sqlite3.Error as e:
            log.info("Error while creating tables", e)


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
                    versions.append(item[0])
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
            import ast
            query = "SELECT settings FROM plugins WHERE plugin = ? AND version = ?"
            cursor.execute(query, (name, version))
            rows = cursor.fetchall()

            settings = rows[0][0]

            if settings != None:
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
            query = "SELECT id, data FROM applets"
            cursor.execute(query)
            rows = cursor.fetchall()

            # Convert applet_plans from string to dict
            rows = [[applet_id, ast.literal_eval(
                applet_plans)] for applet_id, applet_plans in rows]

            if rows == None:
                return []
            else:
                return rows

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
    Load an applet to be edited at the UI.
    """
    with sqlite3.connect(db_file) as conn:
        cursor = conn.cursor()
        try:
            import ast
            query = "SELECT data FROM applets WHERE id = ?"
            cursor.execute(query, (applet_id, ))
            rows = cursor.fetchall()

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
