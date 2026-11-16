-- A v1 install using `local playlists` 0.3 (v1's `up_local playlists.py`): a path mapping, three
-- input filters (plain, convertible regex, regex that doesn't convert), and a recursive output.
CREATE TABLE ultrasonics (key TEXT, value TEXT);
INSERT INTO ultrasonics (key, value) VALUES ('version', '1.0.0');

CREATE TABLE plugins (id INTEGER PRIMARY KEY, plugin TEXT, version FLOAT, settings TEXT);
INSERT INTO plugins (plugin, version, settings) VALUES
	('local playlists', '0.3', '{''local_prepend'': ''D:/Music'', ''ultrasonics_prepend'': ''/mnt/music library/music''}');

CREATE TABLE applets (id TEXT PRIMARY KEY, lastrun TEXT, data TEXT);
INSERT INTO applets (id, lastrun, data) VALUES
	('l1', 'False', '{''applet_name'': ''Disco copy'', ''applet_id'': ''l1'', ''inputs'': [{''plugin'': ''local playlists'', ''version'': ''0.3'', ''data'': {''dir'': ''/mnt/music library/playlists'', ''recursive'': ''Yes'', ''filter'': ''disco''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''local playlists'', ''version'': ''0.3'', ''data'': {''dir'': ''/mnt/music library/synced'', ''recursive'': ''Yes'', ''retention'': ''5 Backups''}}], ''triggers'': []}'),
	('l2', 'False', '{''applet_name'': ''Rock or pop'', ''applet_id'': ''l2'', ''inputs'': [{''plugin'': ''local playlists'', ''version'': ''0.3'', ''data'': {''dir'': ''/mnt/music library/playlists'', ''recursive'': ''No'', ''filter'': ''rock.*|pop''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''local playlists'', ''version'': ''0.3'', ''data'': {''dir'': ''/mnt/music library/synced'', ''recursive'': ''No'', ''retention'': ''No Backups''}}], ''triggers'': []}'),
	('l3', 'False', '{''applet_name'': ''Years'', ''applet_id'': ''l3'', ''inputs'': [{''plugin'': ''local playlists'', ''version'': ''0.3'', ''data'': {''dir'': ''/mnt/music library/playlists'', ''recursive'': ''No'', ''filter'': ''\\d{4}$''}}], ''modifiers'': [], ''outputs'': [{''plugin'': ''local playlists'', ''version'': ''0.3'', ''data'': {''dir'': ''/mnt/music library/synced'', ''recursive'': ''No'', ''retention'': ''3 Backups''}}], ''triggers'': []}');
