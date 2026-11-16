-- A v1 install with two Plex servers: `plex beta` 1.0's and the legacy `plex` 0.1's, as v1's
-- `ultrasonics/database.py` writes them. `fixture source` stands in for an input the importer maps,
-- and `spotify` for the Spotify input, whose mapping arrives with its own ticket.
CREATE TABLE ultrasonics (key TEXT, value TEXT);
INSERT INTO ultrasonics (key, value) VALUES ('version', '1.0.0-rc.1');

CREATE TABLE plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT);
INSERT INTO plugins (plugin, version, settings) VALUES
	('plex', '0.1', '{''plex_prepend'': ''/media/uluru/music'', ''ultrasonics_prepend'': ''/mnt/music library/music'', ''server_url'': ''https://old-plex.lan:32400'', ''check_ssl'': ''No'', ''plex_token'': ''PLEX-OLD-TOKEN-3e77''}'),
	('plex beta', '1.0', '{''server_url'': ''http://plex.lan:32400'', ''plex_token'': ''PLEX-NEW-TOKEN-5a8b''}'),
	('spotify', '0.6', '{''auth'': ''{"refresh_token": "SPOTIFY-TOKEN-9d03"}''}');

CREATE TABLE applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT);
INSERT INTO applets (id, lastrun, data) VALUES
	('p1', 'False', '{''applet_name'': ''Chill to Plex'', ''applet_id'': ''p1'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Chill'', ''filter'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''plex beta'', ''version'': ''1.0'', ''data'': {''section_id'': ''Music [3]'', ''fuzzy_ratio'': ''Recommended: 90'', ''existing_playlists'': ''Update''}}], ''triggers'': []}'),
	('p2', 'False', '{''applet_name'': ''Old Plex'', ''applet_id'': ''p2'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''plex'', ''version'': ''0.1'', ''data'': {''section_id'': ''Music''}}], ''triggers'': []}'),
	('p3', 'False', '{''applet_name'': ''Spotify to Plex'', ''applet_id'': ''p3'', ''inputs'': [{''plugin'': ''spotify'', ''version'': ''0.6'', ''data'': {''filter'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''plex beta'', ''version'': ''1.0'', ''data'': {''section_id'': ''Music [3]'', ''fuzzy_ratio'': ''90'', ''existing_playlists'': ''Append''}}], ''triggers'': []}'),
	('p4', 'False', '{''applet_name'': ''From Plex'', ''applet_id'': ''p4'', ''inputs'': [{''plugin'': ''plex beta'', ''version'': ''1.0'', ''data'': {''section_id'': ''Music [3]'', ''filter'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''fixture sink'', ''version'': ''1.0'', ''data'': {''library'': ''Music''}}], ''triggers'': []}');
