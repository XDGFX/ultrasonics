-- A v1 install using `local music database` 0.1 between a Spotify input and a local playlists
-- output. Its `plugins` row holds both of v1's keys, with `fuzzy_ratio` as the free text v1 stored.
CREATE TABLE ultrasonics (key TEXT, value TEXT);
INSERT INTO ultrasonics (key, value) VALUES ('version', '1.2.0');
CREATE TABLE plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT);
INSERT INTO plugins (plugin, version, settings) VALUES
	('local music database', '0.1', '{''music_dir'': ''/music'', ''fuzzy_ratio'': ''90''}');
CREATE TABLE applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT);
INSERT INTO applets (id, lastrun, data) VALUES
	('m1', 'False', '{''applet_name'': ''Spotify to m3u'', ''applet_id'': ''m1'', ''inputs'': [{''plugin'': ''spotify'', ''version'': ''0.6'', ''data'': {''playlists'': ''Chill''}}], ''modifiers'': [{''plugin'': ''local music database'', ''version'': ''0.1'', ''data'': {}}], ''outputs'': [{''plugin'': ''local playlists'', ''version'': ''0.1'', ''data'': {''dir'': ''/playlists''}}], ''triggers'': []}');
