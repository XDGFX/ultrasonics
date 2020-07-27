#!/usr/bin/env python3

import sqlite3

db_file = "ultrasonics/ultrasonics.db"
conn = None
cursor = None


def connect():
    global conn, cursor
    try:
        conn = sqlite3.connect(db_file)
        cursor = conn.cursor()
        print("Database connection successful")

        # Create persistent settings table if needed
        if not table_exists("persistent_settings"):
            try:
                query = "CREATE TABLE persistent_settings (plugin text, settings text)"
                cursor.execute(query)
                conn.commit()
                print("Table created")

            except sqlite3.Error as e:
                print("Error while creating table", e)

    except Error as e:
        print(e)
    finally:
        if conn:
            conn.close()


def create_plugin_entry(plugin, settings):
    try:
        query = "INSERT INTO persistent_settings VALUES(?,?)"
        cursor.execute(query, (str(plugin), str(settings)))
        conn.commit()
        print("Plugin database entry created")

    except sqlite3.Error as e:
        print("Error while creating database entry", e)


def update_plugin_entry(plugin, settings):
    try:
        query = "UPDATE persistent_settings SET settings = ? WHERE plugin = ?"
        cursor.execute(query, (str(settings), str(plugin)))
        conn.commit()
        print("Plugin database entry updated")

    except sqlite3.Error as e:
        print("Error while updating database entry", e)


def table_exists(plugin):
    try:
        query = """
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_name = '{0}'
        """ .format(plugin.replace('\'', '\'\''))

        cursor.execute(query)
        if cursor.fetchone()[0] == 1:
            return True

        return False

    except sqlite3.Error as e:
        print("Error while searching for table", e)
