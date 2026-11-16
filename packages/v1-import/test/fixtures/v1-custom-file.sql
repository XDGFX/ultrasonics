-- A v1 install with three `custom file` applets: each `existing_files` value, an `{id.spotify}`
-- pattern, and a `.db` file name that v2 refuses. Each reads from the importer tests' `fixture source`,
-- since an applet with no input is skipped.
CREATE TABLE ultrasonics (key TEXT, value TEXT);
INSERT INTO ultrasonics (key, value) VALUES ('version', '1.2.0');
CREATE TABLE plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT);
CREATE TABLE applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT);
INSERT INTO applets (id, lastrun, data) VALUES
	('c1', 'False', '{''applet_name'': ''Overwrite'', ''applet_id'': ''c1'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''custom file'', ''version'': 0.1, ''data'': {''dir'': ''/mnt/playlists'', ''existing_files'': ''Overwrite'', ''playlist_name'': ''{name}.txt'', ''pattern'': ''{artist} - {title} (ISRC: {isrc})''}}], ''triggers'': []}'),
	('c2', 'False', '{''applet_name'': ''Append'', ''applet_id'': ''c2'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''custom file'', ''version'': 0.1, ''data'': {''dir'': ''/mnt/lists'', ''existing_files'': ''Append'', ''playlist_name'': ''songs.csv'', ''pattern'': ''{title},{id.spotify}''}}], ''triggers'': []}'),
	('c3', 'False', '{''applet_name'': ''Database'', ''applet_id'': ''c3'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''custom file'', ''version'': 0.1, ''data'': {''dir'': ''/config'', ''existing_files'': ''Overwrite'', ''playlist_name'': ''ultrasonics.db'', ''pattern'': ''{title}''}}], ''triggers'': []}');
