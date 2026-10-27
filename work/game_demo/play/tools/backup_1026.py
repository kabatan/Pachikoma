"""変更前のファイルを同じ場所の *_pre1026.* へ一度だけ保存する。削除しない。"""
from pathlib import Path
import hashlib
import json
import shutil
import sys

ROOT = Path(__file__).resolve().parents[4]
RECORD = ROOT / 'work/game_demo/play/integration1026_backups.json'

def backup(path):
    path = Path(path).resolve()
    if not path.is_file():
        raise FileNotFoundError(path)
    saved = path.with_name(path.stem + '_pre1026' + path.suffix)
    records = json.loads(RECORD.read_text()) if RECORD.exists() else {}
    relative = str(path.relative_to(ROOT))
    if not saved.exists():
        shutil.copy2(path, saved)
        records[relative] = {'backup': str(saved.relative_to(ROOT)),
                             'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        RECORD.write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
    elif relative not in records:
        raise RuntimeError(f'Unrecorded backup exists: {saved}')
    if hashlib.sha256(saved.read_bytes()).hexdigest() != records[relative]['sha256']:
        raise RuntimeError(f'Backup was changed: {saved}')
    return saved

if __name__ == '__main__':
    for arg in sys.argv[1:]:
        print(backup(ROOT / arg))
