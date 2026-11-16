-- Some other application's database, which the importer must refuse without changing.
CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);
INSERT INTO notes (body) VALUES ('Not ultrasonics');
