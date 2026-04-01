"""
SQLite adapter that mimics Motor's async MongoDB API.

Drop-in replacement for Motor — same interface, SQLite backend.
Each "collection" is a SQLite table with columns: _id TEXT PK, data JSON.
All documents stored as JSON blobs; queries use json_extract().

Supports: find_one, find, insert_one, insert_many, update_one, update_many,
delete_one, delete_many, count_documents, create_index, aggregate (basic).
"""
import aiosqlite
import asyncio
import json
import uuid
import logging
import os
from pathlib import Path
from copy import deepcopy

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent / "cthulhu.db"

# ── Singleton connection with WAL mode + busy timeout ──
_conn = None
_conn_lock = asyncio.Lock()


async def get_conn():
    """Return the shared aiosqlite connection (created once, reused globally).
    
    WAL mode allows concurrent reads while one writer proceeds.
    busy_timeout makes SQLite wait up to 10s instead of raising 'database is locked'.
    """
    global _conn
    if _conn is None:
        async with _conn_lock:
            if _conn is None:
                _conn = await aiosqlite.connect(str(DB_PATH))
                await _conn.execute("PRAGMA journal_mode=WAL")
                await _conn.execute("PRAGMA busy_timeout=10000")
                await _conn.execute("PRAGMA synchronous=NORMAL")
                logger.info("SQLite: shared connection opened with WAL mode")
    return _conn


def _gen_id():
    return uuid.uuid4().hex


def _json_val(v):
    """Convert Python value to JSON-safe value for SQLite."""
    if isinstance(v, bool):
        return 1 if v else 0
    return v


def _build_where(filter_dict: dict) -> tuple:
    """Build a WHERE clause from a MongoDB-style filter dict.

    Returns (clause_str, params_list).
    Supports: exact match, $gt, $gte, $lt, $lte, $ne, $in, $exists, $regex.
    """
    if not filter_dict:
        return "1=1", []

    clauses = []
    params = []

    for key, val in filter_dict.items():
        if key == "$or":
            or_parts = []
            for sub in val:
                sub_clause, sub_params = _build_where(sub)
                or_parts.append(f"({sub_clause})")
                params.extend(sub_params)
            clauses.append(f"({' OR '.join(or_parts)})")
            continue

        if key == "$and":
            for sub in val:
                sub_clause, sub_params = _build_where(sub)
                clauses.append(f"({sub_clause})")
                params.extend(sub_params)
            continue

        col = f"json_extract(data, '$.{key}')" if key != "_id" else "_id"

        if isinstance(val, dict):
            for op, opval in val.items():
                if op == "$gt":
                    clauses.append(f"{col} > ?")
                    params.append(_json_val(opval))
                elif op == "$gte":
                    clauses.append(f"{col} >= ?")
                    params.append(_json_val(opval))
                elif op == "$lt":
                    clauses.append(f"{col} < ?")
                    params.append(_json_val(opval))
                elif op == "$lte":
                    clauses.append(f"{col} <= ?")
                    params.append(_json_val(opval))
                elif op == "$ne":
                    if opval is None:
                        clauses.append(f"{col} IS NOT NULL")
                    else:
                        clauses.append(f"({col} IS NULL OR {col} != ?)")
                        params.append(_json_val(opval))
                elif op == "$in":
                    if opval:
                        placeholders = ",".join(["?"] * len(opval))
                        clauses.append(f"{col} IN ({placeholders})")
                        params.extend([_json_val(v) for v in opval])
                    else:
                        clauses.append("0")  # empty $in = no match
                elif op == "$exists":
                    if opval:
                        clauses.append(f"{col} IS NOT NULL")
                    else:
                        clauses.append(f"{col} IS NULL")
                elif op == "$regex":
                    clauses.append(f"{col} LIKE ?")
                    # Convert basic regex to LIKE pattern
                    pattern = opval.replace(".*", "%").replace(".", "_")
                    if not pattern.startswith("%"):
                        pattern = "%" + pattern
                    if not pattern.endswith("%"):
                        pattern = pattern + "%"
                    params.append(pattern)
                elif op == "$nin":
                    if opval:
                        placeholders = ",".join(["?"] * len(opval))
                        clauses.append(f"({col} IS NULL OR {col} NOT IN ({placeholders}))")
                        params.extend([_json_val(v) for v in opval])
        else:
            if val is None:
                clauses.append(f"{col} IS NULL")
            else:
                clauses.append(f"{col} = ?")
                params.append(_json_val(val))

    return (" AND ".join(clauses) if clauses else "1=1"), params


def _apply_update(doc: dict, update: dict) -> dict:
    """Apply MongoDB-style update operators to a document in Python."""
    result = deepcopy(doc)

    for op, fields in update.items():
        if op == "$set":
            for k, v in fields.items():
                _nested_set(result, k, v)
        elif op == "$unset":
            for k in fields:
                _nested_del(result, k)
        elif op == "$inc":
            for k, v in fields.items():
                cur = _nested_get(result, k, 0)
                _nested_set(result, k, (cur or 0) + v)
        elif op == "$push":
            for k, v in fields.items():
                cur = _nested_get(result, k, [])
                if not isinstance(cur, list):
                    cur = []
                if isinstance(v, dict) and "$each" in v:
                    cur.extend(v["$each"])
                else:
                    cur.append(v)
                _nested_set(result, k, cur)
        elif op == "$pull":
            for k, v in fields.items():
                cur = _nested_get(result, k, [])
                if isinstance(cur, list):
                    _nested_set(result, k, [x for x in cur if x != v])
        elif op == "$addToSet":
            for k, v in fields.items():
                cur = _nested_get(result, k, [])
                if not isinstance(cur, list):
                    cur = []
                if isinstance(v, dict) and "$each" in v:
                    for item in v["$each"]:
                        if item not in cur:
                            cur.append(item)
                elif v not in cur:
                    cur.append(v)
                _nested_set(result, k, cur)
        elif op == "$setOnInsert":
            # Only applies during upsert insert — handled in update_one
            pass

    return result


def _nested_get(d, key, default=None):
    parts = key.split(".")
    for p in parts:
        if isinstance(d, dict):
            d = d.get(p, default)
        else:
            return default
    return d


def _nested_set(d, key, value):
    parts = key.split(".")
    for p in parts[:-1]:
        if p not in d or not isinstance(d[p], dict):
            d[p] = {}
        d = d[p]
    d[parts[-1]] = value


def _nested_del(d, key):
    parts = key.split(".")
    for p in parts[:-1]:
        if isinstance(d, dict) and p in d:
            d = d[p]
        else:
            return
    if isinstance(d, dict):
        d.pop(parts[-1], None)


def _apply_projection(doc: dict, projection: dict) -> dict:
    """Apply MongoDB-style projection to a document."""
    if not projection:
        return doc

    # Check if it's inclusion or exclusion
    has_include = any(v for k, v in projection.items() if k != "_id")
    has_exclude = any(not v for k, v in projection.items() if k != "_id")

    result = {}
    if has_include:
        # Inclusion mode: only return specified fields
        for k, v in projection.items():
            if v and k in doc:
                result[k] = doc[k]
        # _id included by default unless explicitly excluded
        if projection.get("_id", 1) and "_id" in doc:
            result["_id"] = doc["_id"]
    elif has_exclude:
        # Exclusion mode: return all except specified
        result = deepcopy(doc)
        for k, v in projection.items():
            if not v and k in result:
                del result[k]
    else:
        # Neither include nor exclude on non-_id fields
        # But _id might be explicitly excluded
        result = deepcopy(doc)
        if "_id" in projection and not projection["_id"]:
            result.pop("_id", None)

    return result


class SQLiteCursor:
    """Mimics Motor's cursor with sort/limit/to_list chaining + async iteration."""

    def __init__(self, collection, filter_dict, projection=None):
        self._collection = collection
        self._filter = filter_dict or {}
        self._projection = projection
        self._sort_key = None
        self._sort_dir = 1
        self._limit_n = 0
        self._skip_n = 0
        self._results = None
        self._iter_idx = 0

    def sort(self, key_or_list, direction=None):
        if isinstance(key_or_list, list):
            # [(key, direction), ...]
            if key_or_list:
                self._sort_key = key_or_list[0][0]
                self._sort_dir = key_or_list[0][1]
        elif isinstance(key_or_list, str):
            self._sort_key = key_or_list
            self._sort_dir = direction if direction else 1
        return self

    def limit(self, n):
        self._limit_n = n
        return self

    def skip(self, n):
        self._skip_n = n
        return self

    async def _fetch(self):
        """Execute the query and cache results."""
        if self._results is not None:
            return

        await self._collection._ensure_table()
        where, params = _build_where(self._filter)
        sql = f"SELECT data FROM [{self._collection._name}] WHERE {where}"

        if self._sort_key:
            sort_col = f"json_extract(data, '$.{self._sort_key}')"
            direction = "ASC" if self._sort_dir == 1 else "DESC"
            sql += f" ORDER BY {sort_col} {direction}"

        if self._limit_n:
            sql += f" LIMIT {self._limit_n}"

        if self._skip_n:
            sql += f" OFFSET {self._skip_n}"

        self._results = []
        conn = await get_conn()
        async with conn.execute(sql, params) as cursor:
            async for row in cursor:
                doc = json.loads(row[0])
                if self._projection:
                    doc = _apply_projection(doc, self._projection)
                self._results.append(doc)

    async def to_list(self, length=None):
        if length and not self._limit_n:
            self._limit_n = length
        await self._fetch()
        return self._results

    def __aiter__(self):
        self._iter_idx = 0
        self._results = None  # reset for fresh iteration
        return self

    async def __anext__(self):
        await self._fetch()
        if self._iter_idx >= len(self._results):
            raise StopAsyncIteration
        doc = self._results[self._iter_idx]
        self._iter_idx += 1
        return doc



class AggregationCursor:
    """Mimics Motor's aggregation cursor with to_list() support."""

    def __init__(self, collection, pipeline):
        self._collection = collection
        self._pipeline = pipeline
        self._results = None

    async def _execute(self):
        """Execute the aggregation pipeline."""
        if self._results is not None:
            return
        
        await self._collection._ensure_table()
        # Start with all docs
        docs = await self._collection.find({}).to_list(100000)

        for stage in self._pipeline:
            if "$match" in stage:
                match = stage["$match"]
                docs = [d for d in docs if _doc_matches(d, match)]
            elif "$group" in stage:
                docs = _group_docs(docs, stage["$group"])
            elif "$sort" in stage:
                for key, direction in reversed(list(stage["$sort"].items())):
                    docs.sort(key=lambda d: d.get(key, ""), reverse=(direction == -1))
            elif "$limit" in stage:
                docs = docs[:stage["$limit"]]
            elif "$skip" in stage:
                docs = docs[stage["$skip"]:]
            elif "$project" in stage:
                docs = [_apply_projection(d, stage["$project"]) for d in docs]
            elif "$unwind" in stage:
                field = stage["$unwind"]
                if isinstance(field, str):
                    field = field.lstrip("$")
                unwound = []
                for d in docs:
                    arr = d.get(field, [])
                    if isinstance(arr, list):
                        for item in arr:
                            new_doc = deepcopy(d)
                            new_doc[field] = item
                            unwound.append(new_doc)
                    else:
                        unwound.append(d)
                docs = unwound

        self._results = docs

    async def to_list(self, length=None):
        """Return aggregation results as a list."""
        await self._execute()
        if length:
            return self._results[:length]
        return self._results

    def __aiter__(self):
        self._iter_idx = 0
        self._results = None
        return self

    async def __anext__(self):
        await self._execute()
        if self._iter_idx >= len(self._results):
            raise StopAsyncIteration
        doc = self._results[self._iter_idx]
        self._iter_idx += 1
        return doc


class _UpdateResult:
    def __init__(self, matched, modified, upserted_id=None):
        self.matched_count = matched
        self.modified_count = modified
        self.upserted_id = upserted_id


class _InsertResult:
    def __init__(self, inserted_id):
        self.inserted_id = inserted_id


class _InsertManyResult:
    def __init__(self, inserted_ids):
        self.inserted_ids = inserted_ids


class SQLiteCollection:
    """Mimics Motor's AsyncIOMotorCollection interface."""

    def __init__(self, name: str):
        self._name = name
        self._ensured = False

    async def _ensure_table(self):
        if self._ensured:
            return
        conn = await get_conn()
        await conn.execute(f"""
            CREATE TABLE IF NOT EXISTS [{self._name}] (
                _id TEXT PRIMARY KEY,
                data TEXT NOT NULL
            )
        """)
        await conn.commit()
        self._ensured = True

    async def find_one(self, filter_dict=None, projection=None, sort=None, **kwargs):
        await self._ensure_table()
        filter_dict = filter_dict or {}
        where, params = _build_where(filter_dict)
        sql = f"SELECT data FROM [{self._name}] WHERE {where}"

        if sort:
            if isinstance(sort, list) and sort:
                sk, sd = sort[0]
                direction = "ASC" if sd == 1 else "DESC"
                sql += f" ORDER BY json_extract(data, '$.{sk}') {direction}"

        sql += " LIMIT 1"

        conn = await get_conn()
        async with conn.execute(sql, params) as cursor:
            row = await cursor.fetchone()
            if row:
                doc = json.loads(row[0])
                if projection:
                    doc = _apply_projection(doc, projection)
                return doc
        return None

    def find(self, filter_dict=None, projection=None, **kwargs):
        # Returns a cursor (synchronous object, awaited via to_list)
        cursor = SQLiteCursor(self, filter_dict or {}, projection)
        return cursor

    async def insert_one(self, document: dict):
        await self._ensure_table()
        doc = deepcopy(document)
        if "_id" not in doc:
            doc["_id"] = _gen_id()
        doc_id = str(doc["_id"])

        conn = await get_conn()
        await conn.execute(
            f"INSERT OR REPLACE INTO [{self._name}] (_id, data) VALUES (?, ?)",
            (doc_id, json.dumps(doc, default=str))
        )
        await conn.commit()
        return _InsertResult(doc_id)

    async def insert_many(self, documents: list):
        await self._ensure_table()
        ids = []
        conn = await get_conn()
        for document in documents:
            doc = deepcopy(document)
            if "_id" not in doc:
                doc["_id"] = _gen_id()
            doc_id = str(doc["_id"])
            ids.append(doc_id)
            await conn.execute(
                f"INSERT OR REPLACE INTO [{self._name}] (_id, data) VALUES (?, ?)",
                (doc_id, json.dumps(doc, default=str))
            )
        await conn.commit()
        return _InsertManyResult(ids)

    async def update_one(self, filter_dict: dict, update: dict, upsert=False, **kwargs):
        await self._ensure_table()
        where, params = _build_where(filter_dict)

        conn = await get_conn()
        async with conn.execute(
            f"SELECT _id, data FROM [{self._name}] WHERE {where} LIMIT 1", params
        ) as cursor:
            row = await cursor.fetchone()

        if row:
            doc_id = row[0]
            doc = json.loads(row[1])
            updated = _apply_update(doc, update)
            await conn.execute(
                f"UPDATE [{self._name}] SET data = ? WHERE _id = ?",
                (json.dumps(updated, default=str), doc_id)
            )
            await conn.commit()
            return _UpdateResult(1, 1)
        elif upsert:
            doc = {}
            for k, v in filter_dict.items():
                if not isinstance(v, dict):
                    doc[k] = v
            if "$setOnInsert" in update:
                doc.update(update["$setOnInsert"])
            doc = _apply_update(doc, update)
            if "_id" not in doc:
                doc["_id"] = _gen_id()
            doc_id = str(doc["_id"])
            await conn.execute(
                f"INSERT INTO [{self._name}] (_id, data) VALUES (?, ?)",
                (doc_id, json.dumps(doc, default=str))
            )
            await conn.commit()
            return _UpdateResult(0, 0, doc_id)
        else:
            return _UpdateResult(0, 0)

    async def update_many(self, filter_dict: dict, update: dict, **kwargs):
        await self._ensure_table()
        where, params = _build_where(filter_dict)

        conn = await get_conn()
        rows = []
        async with conn.execute(
            f"SELECT _id, data FROM [{self._name}] WHERE {where}", params
        ) as cursor:
            async for row in cursor:
                rows.append((row[0], json.loads(row[1])))

        for doc_id, doc in rows:
            updated = _apply_update(doc, update)
            await conn.execute(
                f"UPDATE [{self._name}] SET data = ? WHERE _id = ?",
                (json.dumps(updated, default=str), doc_id)
            )
        await conn.commit()
        return _UpdateResult(len(rows), len(rows))

    async def delete_one(self, filter_dict: dict):
        await self._ensure_table()
        where, params = _build_where(filter_dict)
        conn = await get_conn()
        result = await conn.execute(
            f"DELETE FROM [{self._name}] WHERE _id IN "
            f"(SELECT _id FROM [{self._name}] WHERE {where} LIMIT 1)", params
        )
        await conn.commit()
        return _UpdateResult(result.rowcount, result.rowcount)

    async def delete_many(self, filter_dict: dict):
        await self._ensure_table()
        where, params = _build_where(filter_dict)
        conn = await get_conn()
        result = await conn.execute(
            f"DELETE FROM [{self._name}] WHERE {where}", params
        )
        await conn.commit()
        return _UpdateResult(result.rowcount, result.rowcount)

    async def count_documents(self, filter_dict=None):
        await self._ensure_table()
        filter_dict = filter_dict or {}
        where, params = _build_where(filter_dict)
        conn = await get_conn()
        async with conn.execute(
            f"SELECT COUNT(*) FROM [{self._name}] WHERE {where}", params
        ) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else 0

    async def create_index(self, keys, **kwargs):
        """Create an index — best-effort for JSON fields."""
        await self._ensure_table()
        try:
            conn = await get_conn()
            if isinstance(keys, list):
                for key, _ in keys:
                    idx_name = f"idx_{self._name}_{key}".replace(".", "_")
                    col_expr = f"json_extract(data, '$.{key}')"
                    await conn.execute(
                        f"CREATE INDEX IF NOT EXISTS [{idx_name}] ON [{self._name}] ({col_expr})"
                    )
                await conn.commit()
            elif isinstance(keys, str):
                idx_name = f"idx_{self._name}_{keys}".replace(".", "_")
                col_expr = f"json_extract(data, '$.{keys}')"
                await conn.execute(
                    f"CREATE INDEX IF NOT EXISTS [{idx_name}] ON [{self._name}] ({col_expr})"
                )
                await conn.commit()
        except Exception as e:
            logger.debug(f"Index creation skipped for {self._name}: {e}")

    async def find_one_and_update(self, filter_dict, update, upsert=False, return_document=False, **kwargs):
        await self._ensure_table()
        result = await self.update_one(filter_dict, update, upsert=upsert)
        if result.matched_count or result.upserted_id:
            return await self.find_one(filter_dict)
        return None

    def aggregate(self, pipeline: list):
        """Basic aggregation — handles $match, $group, $sort, $limit.
        
        Returns an AggregationCursor for Motor API compatibility.
        """
        return AggregationCursor(self, pipeline)


def _doc_matches(doc, match):
    """Check if a document matches a simple filter."""
    for k, v in match.items():
        if k == "$or":
            if not any(_doc_matches(doc, sub) for sub in v):
                return False
            continue
        val = _nested_get(doc, k)
        if isinstance(v, dict):
            for op, opval in v.items():
                if op == "$gt" and not (val is not None and val > opval):
                    return False
                elif op == "$gte" and not (val is not None and val >= opval):
                    return False
                elif op == "$lt" and not (val is not None and val < opval):
                    return False
                elif op == "$lte" and not (val is not None and val <= opval):
                    return False
                elif op == "$ne" and val == opval:
                    return False
                elif op == "$in" and val not in opval:
                    return False
                elif op == "$exists" and (opval and val is None) or (not opval and val is not None):
                    return False
        elif val != v:
            return False
    return True


def _group_docs(docs, group_spec):
    """Basic $group implementation."""
    group_id = group_spec.get("_id")
    groups = {}

    for doc in docs:
        if isinstance(group_id, str) and group_id.startswith("$"):
            key = _nested_get(doc, group_id[1:])
        elif group_id is None:
            key = None
        else:
            key = str(group_id)

        key_str = json.dumps(key, default=str)
        if key_str not in groups:
            groups[key_str] = {"_id": key, "_docs": []}
        groups[key_str]["_docs"].append(doc)

    result = []
    for key_str, group in groups.items():
        out = {"_id": group["_id"]}
        for field, spec in group_spec.items():
            if field == "_id":
                continue
            if isinstance(spec, dict):
                if "$sum" in spec:
                    val = spec["$sum"]
                    if val == 1:
                        out[field] = len(group["_docs"])
                    elif isinstance(val, str) and val.startswith("$"):
                        out[field] = sum(_nested_get(d, val[1:], 0) or 0 for d in group["_docs"])
                elif "$first" in spec:
                    val = spec["$first"]
                    if isinstance(val, str) and val.startswith("$"):
                        out[field] = _nested_get(group["_docs"][0], val[1:]) if group["_docs"] else None
                elif "$last" in spec:
                    val = spec["$last"]
                    if isinstance(val, str) and val.startswith("$"):
                        out[field] = _nested_get(group["_docs"][-1], val[1:]) if group["_docs"] else None
                elif "$max" in spec:
                    val = spec["$max"]
                    if isinstance(val, str) and val.startswith("$"):
                        vals = [_nested_get(d, val[1:]) for d in group["_docs"]]
                        vals = [v for v in vals if v is not None]
                        out[field] = max(vals) if vals else None
                elif "$push" in spec:
                    val = spec["$push"]
                    if isinstance(val, str) and val.startswith("$"):
                        out[field] = [_nested_get(d, val[1:]) for d in group["_docs"]]
        result.append(out)

    return result


class SQLiteDatabase:
    """Mimics Motor's AsyncIOMotorDatabase interface."""

    def __init__(self):
        self._collections = {}

    def __getitem__(self, name: str) -> SQLiteCollection:
        if name not in self._collections:
            self._collections[name] = SQLiteCollection(name)
        return self._collections[name]

    def __getattr__(self, name: str) -> SQLiteCollection:
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    async def list_collection_names(self):
        conn = await get_conn()
        async with conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ) as cursor:
            return [row[0] async for row in cursor]

    async def command(self, cmd):
        """Stub for MongoDB commands like dbstats."""
        if isinstance(cmd, str) and cmd == "dbstats":
            size = os.path.getsize(str(DB_PATH)) if DB_PATH.exists() else 0
            return {"dataSize": size, "storageSize": size, "ok": 1}
        return {"ok": 1}
