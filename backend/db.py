"""
Database layer — SQLite backend (MongoDB-compatible API).

All existing imports (`from db import db, users_col, ...`) continue to work
unchanged. The SQLiteDatabase class provides the same async interface as Motor.
"""
from db_sqlite import SQLiteDatabase

db = SQLiteDatabase()

# Named collection aliases — exact same names as before
known_users_col = db['known_users']
conversation_cache_col = db['conversation_cache']
users_col = db['users']
object_cache_col = db['object_cache']
object_index_col = db['object_index']
first_seen_col = db['first_seen']
api_cache_col = db['api_cache']
poll_registry_col = db['poll_registry']
admin_col = db['admin_settings']
bug_reports_col = db['bug_reports']
error_logs_col = db['error_logs']
audience_messages_col = db['audience_messages']
dm_clear_col = db['dm_clears']
ipfs_blacklist_col = db['ipfs_blacklist']
treasury_ledger_col = db['treasury_ledger']
chat_unread_col = db['chat_unread']
