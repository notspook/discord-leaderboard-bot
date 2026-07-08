import sqlite3, os

# Edge cookie path
cookie_path = os.path.expanduser('~') + r'\AppData\Local\Microsoft\Edge\User Data\Default\Network\Cookies'
if not os.path.exists(cookie_path):
    print('Edge cookie file not found at:', cookie_path)
    cookie_path = os.path.expanduser('~') + r'\AppData\Local\Microsoft\Edge\User Data\Default\Cookies'
    if not os.path.exists(cookie_path):
        print('Alternative path also not found')
        exit(1)

print('Found cookie file:', cookie_path)
try:
    conn = sqlite3.connect(cookie_path)
    cursor = conn.cursor()
    cursor.execute("SELECT host_key, name, path, value, expires_utc, secure, httponly FROM cookies WHERE host_key LIKE '%.youtube.com' OR host_key LIKE '%.google.com'")
    rows = cursor.fetchall()
    print(f'Found {len(rows)} cookies')
    for row in rows[:10]:
        print(row[0], row[1], row[3][:30] if len(row[3])>30 else row[3])
    conn.close()
except Exception as e:
    print('Error:', e)
