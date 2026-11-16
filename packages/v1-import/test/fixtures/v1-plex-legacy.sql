-- A v1 1.2 install whose only Plex server is the renamed `plex legacy` 0.1's, used by a `plex` 1.0
-- output. `fixture source` stands in for an input the importer maps.
CREATE TABLE ultrasonics (key TEXT, value TEXT);
INSERT INTO ultrasonics (key, value) VALUES ('version', '1.2.0');

CREATE TABLE plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT);
INSERT INTO plugins (plugin, version, settings) VALUES
	('plex legacy', '0.1', '{''plex_prepend'': ''/media/uluru/music'', ''ultrasonics_prepend'': '''', ''server_url'': ''https://plex.lan:32400'', ''check_ssl'': ''No'', ''plex_token'': ''PLEX-LEGACY-TOKEN-0c19''}');

CREATE TABLE applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT);
INSERT INTO applets (id, lastrun, data) VALUES
	('l1', 'False', '{''applet_name'': ''Legacy library'', ''applet_id'': ''l1'', ''inputs'': [{''plugin'': ''fixture source'', ''version'': ''1.0'', ''data'': {''playlist'': ''Mix'', ''filter'': ''''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''plex legacy'', ''version'': ''0.1'', ''data'': {''section_id'': ''Music [7]''}}, {''plugin'': ''plex'', ''version'': ''1.0'', ''data'': {''section_id'': ''Music'', ''existing_playlists'': ''Append''}}], ''triggers'': []}');
