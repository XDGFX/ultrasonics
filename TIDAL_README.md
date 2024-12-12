# Tidal Plugin
## Setup
The Tidal plugin requires [tidalapi](https://github.com/tamland/python-tidal/tree/0.7.x) version 0.7.x, which isn't on PyPI on the time of writing.
To install run:
```bash
git clone -b 0.7.x https://github.com/tamland/python-tidal.git
cd python-tidal/
python3 setup.py install
```
## Logging in
I couldn't work out a good way of logging in from ultrasonic's web UI, so for now run `python3 tidal_login.py` and go to the link.
When logged in, the session ids and keys will show in your terminal, copy them onto ultrasonic's tidal persistant settings page.