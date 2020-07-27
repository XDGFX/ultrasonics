#!/usr/bin/env python3

import sqlite3

db_file = "ultrasonics/ultrasonics.db"
conn = None


def connect():
    try:
        conn = sqlite3.connect(db_file)
        print(sqlite3.version)
    except Error as e:
        print(e)
    finally:
        if conn:
            conn.close()
