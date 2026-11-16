-- A v1 install with one applet whose filter uses `.+`, which converts with a note.
CREATE TABLE ultrasonics (key TEXT, value TEXT);
INSERT INTO ultrasonics (key, value) VALUES ('version', '1.2.0');
CREATE TABLE plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT);
CREATE TABLE applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT);
INSERT INTO applets (id, lastrun, data) VALUES
	('p1', 'False', '{''applet_name'': ''Plus'', ''applet_id'': ''p1'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''^a.+z$''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}');
