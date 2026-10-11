#!/usr/bin/env python3

import tidalapi

session = tidalapi.Session()
session.login_oauth_simple()

print('-'*16)
print("Token Type:", session.token_type)
print('-'*16)
print("Access Token:", session.access_token)
print('-'*16)
print("Refresh Token:", session.refresh_token)
print('-'*16)
print("Expiry Time:", session.expiry_time.isoformat())
print('-'*16)