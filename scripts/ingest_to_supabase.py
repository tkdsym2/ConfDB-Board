#!/usr/bin/env python3
"""
Confidence Database Platform — Supabase データ投入スクリプト

使い方:
    pip install supabase python-dotenv
    python scripts/ingest_to_supabase.py \
        --catalog datasheet/dataset_catalog.csv \
        --tags datasheet/dataset_tags.csv \
        --tag-defs datasheet/tag_definitions.csv \
        --csv-dir "conf_db_data/Confidence Database/"
"""

import argparse
import csv
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client


# ============================================================
# 設定
# ============================================================

STORAGE_BUCKET = "csv-files"
BATCH_SIZE = 50  # upsertのバッチサイズ


def get_supabase_client() -> Client:
    """環境変数からSupabaseクライアントを生成"""
    load_dotenv()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を .env に設定してください")
        sys.exit(1)
    return create_client(url, key)


# ============================================================
# 1. タグ定義の投入
# ============================================================

def ingest_tags(sb: Client, tag_defs_path: str):
    """tag_definitions.csv → tags テーブル"""
    print("\n=== タグ定義の投入 ===")
    rows = []
    with open(tag_defs_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({
                "id": row["tag_id"],
                "name": row["name"],
                "category": row["category"],
                "sort_order": int(row.get("sort_order", 0)),
            })

    sb.table("tags").upsert(rows).execute()
    print(f"  → {len(rows)} タグを投入しました")


# ============================================================
# 2. データセットメタデータの投入
# ============================================================

def safe_int(val):
    """空文字・None→None, それ以外→int"""
    if val is None or val == "":
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def safe_float(val):
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def safe_bool(val):
    if val is None or val == "":
        return False
    if isinstance(val, bool):
        return val
    return str(val).strip().lower() in ("true", "1", "yes")


def _has_condition(val):
    """n_tasks_conditions が2以上なら True"""
    n = safe_int(val)
    return n is not None and n > 1


def ingest_datasets(sb: Client, catalog_path: str):
    """dataset_catalog.csv → datasets テーブル"""
    print("\n=== データセットメタデータの投入 ===")
    rows = []
    with open(catalog_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        print(f"  カタログのカラム数: {len(fieldnames)}")

        for row in reader:
            name = row.get("name_in_database", "").strip()
            if not name:
                continue

            # CSVファイル名を構築
            csv_filename = f"data_{name}.csv"

            record = {
                "id": name,
                "paper_author": row.get("authors", ""),
                "paper_year": safe_int(row.get("year", "")),
                "paper_title": None,  # カタログにtitleカラムなし
                "paper_doi": None,    # カタログにDOIカラムなし
                "paper_journal": row.get("journal", ""),
                "domain": row.get("domain", "").strip(),
                "task_type": row.get("task_type", "binary_classification").strip(),
                "task_description": row.get("stimuli", ""),
                "n_participants": safe_int(row.get("csv_n_subjects", "")),
                "n_trials_total": safe_int(row.get("csv_n_rows", "")),
                "confidence_scale": row.get("confidence_scale_raw", ""),
                "confidence_min": safe_float(row.get("conf_min_actual", "")),
                "confidence_max": safe_float(row.get("conf_max_actual", "")),
                "conf_is_discrete": safe_bool(row.get("conf_is_discrete_actual", "")),
                "conf_n_levels": safe_int(row.get("conf_n_levels_actual", "")),
                "has_rt": safe_bool(row.get("has_any_rt", "")),
                "has_confidence_rt": safe_bool(row.get("has_separate_conf_rt", "")),
                "rt_type": row.get("rt_type", ""),
                "is_multi_task": safe_bool(row.get("is_multi_task", "")),
                "has_condition": _has_condition(row.get("n_tasks_conditions", "")),
                "csv_filename": csv_filename,
                "csv_size_bytes": safe_int(row.get("csv_file_size_bytes", "")),
                "storage_path": f"{csv_filename}",
            }

            # 空文字列を None に統一
            for k, v in record.items():
                if isinstance(v, str) and v.strip() == "":
                    record[k] = None

            # 必須フィールドの最低保証
            if not record["domain"]:
                record["domain"] = "Perception"
            if not record["paper_author"]:
                record["paper_author"] = name.split("_")[0]
            if not record["csv_filename"]:
                record["csv_filename"] = csv_filename

            rows.append(record)

    # バッチ upsert
    total = len(rows)
    for i in range(0, total, BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        sb.table("datasets").upsert(batch).execute()
        print(f"  → datasets {i + 1}~{min(i + BATCH_SIZE, total)} / {total}")

    print(f"  → 合計 {total} データセットを投入しました")


# ============================================================
# 3. データセット×タグの投入
# ============================================================

def ingest_dataset_tags(sb: Client, tags_path: str):
    """dataset_tags.csv → dataset_tags テーブル"""
    print("\n=== データセット×タグの投入 ===")
    rows = []
    with open(tags_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            record = {
                "dataset_id": row["dataset_id"].strip(),
                "tag_id": row["tag_id"].strip(),
                "note": None,  # CSVにはnoteカラムなし
            }
            rows.append(record)

    total = len(rows)
    for i in range(0, total, BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        sb.table("dataset_tags").upsert(batch).execute()
        print(f"  → dataset_tags {i + 1}~{min(i + BATCH_SIZE, total)} / {total}")

    print(f"  → 合計 {total} タグ関連を投入しました")


# ============================================================
# 4. CSVファイルのStorage投入
# ============================================================

def resolve_csv_path(csv_dir: str, name: str) -> Path | None:
    """
    Name_in_database からCSVファイルパスを解決。
    data_ プレフィックス問題に対応（4件: data_で始まるname）。
    """
    csv_dir = Path(csv_dir)

    # パターン1: 標準形 data_{name}.csv
    path1 = csv_dir / f"data_{name}.csv"
    if path1.exists():
        return path1

    # パターン2: name自体がdata_で始まる場合、nameがそのままファイル名
    path2 = csv_dir / f"{name}.csv"
    if path2.exists():
        return path2

    # パターン3: ディレクトリ内を部分一致で検索
    for f in csv_dir.glob("*.csv"):
        if name in f.stem:
            return f

    return None


def ingest_csv_files(sb: Client, catalog_path: str, csv_dir: str):
    """CSVファイルをSupabase Storageにアップロード"""
    print("\n=== CSVファイルのアップロード ===")

    # カタログからデータセット名一覧を取得
    names = []
    with open(catalog_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("name_in_database", "").strip()
            if name:
                names.append(name)

    uploaded = 0
    skipped = 0
    failed = 0

    for i, name in enumerate(names):
        csv_path = resolve_csv_path(csv_dir, name)
        if csv_path is None:
            print(f"  [SKIP] {name}: CSVファイルが見つかりません")
            skipped += 1
            continue

        storage_name = f"data_{name}.csv"

        try:
            with open(csv_path, "rb") as f:
                data = f.read()

            # アップロード（既存は上書き）
            sb.storage.from_(STORAGE_BUCKET).upload(
                path=storage_name,
                file=data,
                file_options={"content-type": "text/csv", "upsert": "true"},
            )
            uploaded += 1

            if (i + 1) % 10 == 0:
                print(f"  → {i + 1}/{len(names)} ファイルアップロード済み")

            # レート制限回避
            time.sleep(0.1)

        except Exception as e:
            error_msg = str(e)
            if "already exists" in error_msg.lower() or "Duplicate" in error_msg:
                # 既に存在する場合はスキップ
                skipped += 1
            else:
                print(f"  [ERROR] {name}: {e}")
                failed += 1

    print(f"\n  → アップロード完了: {uploaded}, スキップ: {skipped}, 失敗: {failed}")


# ============================================================
# 5. 投入後の検証
# ============================================================

def verify(sb: Client):
    """投入結果の件数を確認"""
    print("\n=== 投入結果の検証 ===")

    tags_count = sb.table("tags").select("id", count="exact").execute()
    print(f"  tags: {tags_count.count} 行 (期待: 14)")

    datasets_count = sb.table("datasets").select("id", count="exact").execute()
    print(f"  datasets: {datasets_count.count} 行 (期待: 180)")

    dt_count = sb.table("dataset_tags").select("dataset_id", count="exact").execute()
    print(f"  dataset_tags: {dt_count.count} 行 (期待: 2,040)")

    # ドメイン分布
    print("\n  ドメイン分布:")
    for domain in ["Perception", "Memory", "Cognitive", "Mixed", "Motor"]:
        result = sb.table("datasets").select("id", count="exact").eq("domain", domain).execute()
        print(f"    {domain}: {result.count}")

    # タスクタイプ分布
    print("\n  タスクタイプ分布:")
    for tt in ["binary_classification", "binary_response_graded_stimulus",
               "ambiguous_binary", "multi_class", "continuous_estimation"]:
        result = sb.table("datasets").select("id", count="exact").eq("task_type", tt).execute()
        print(f"    {tt}: {result.count}")


# ============================================================
# メイン
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Supabase データ投入")
    parser.add_argument("--catalog", required=True, help="dataset_catalog.csv のパス")
    parser.add_argument("--tags", required=True, help="dataset_tags.csv のパス")
    parser.add_argument("--tag-defs", required=True, help="tag_definitions.csv のパス")
    parser.add_argument("--csv-dir", required=True, help="CSVファイルが格納されたディレクトリ")
    parser.add_argument("--skip-csv-upload", action="store_true", help="CSVアップロードをスキップ")
    parser.add_argument("--verify-only", action="store_true", help="検証のみ実行")
    args = parser.parse_args()

    sb = get_supabase_client()

    if args.verify_only:
        verify(sb)
        return

    # 投入順序: tags → datasets → dataset_tags → CSV files
    ingest_tags(sb, args.tag_defs)
    ingest_datasets(sb, args.catalog)
    ingest_dataset_tags(sb, args.tags)

    if not args.skip_csv_upload:
        ingest_csv_files(sb, args.catalog, args.csv_dir)
    else:
        print("\n  (CSVアップロードはスキップされました)")

    verify(sb)
    print("\n✅ 全投入処理が完了しました")


if __name__ == "__main__":
    main()