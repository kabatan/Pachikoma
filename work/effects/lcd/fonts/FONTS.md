# 液晶の書体(10/18 監督「もっとパチンコらしいフォントに」)

| 用途 | 書体 | ファイル | 規約 |
|---|---|---|---|
| 見出し・数字(60px以上)、3層文字素材(`assets/t_*`)、ルーレット枠の札 | Dela Gothic One(Regular 1種) | `DelaGothicOne-Regular.ttf` | SIL OFL 1.1(`DelaGothicOne-OFL.txt`) © 2020 The Dela Gothic Project Authors (https://github.com/syakuzen/DelaGothic) |
| 本文・小さな字(60px未満) | M PLUS 1p ExtraBold | `MPLUS1p-ExtraBold.ttf` | SIL OFL 1.1(`MPLUS1p-OFL.txt`) © 2016 The M+ Project Authors |

- 出所: どちらも `work/game_demo/assets/fonts/`(10/16 に別の担当が Google Fonts 由来として置いたもの)の複製。今回は新しく取得していない(ダウンロードなし)。ファイルのSHA-256は下記。
  - DelaGothicOne-Regular.ttf 4ff87a0965f1b0505e5a2c58424bc6ad3cff27e56a82f21c2fc9d6b0e3857ee2
  - MPLUS1p-ExtraBold.ttf d17f745712668b0dcd95e42b3634a90a76195228d4abf88a0be8e98ddbc441b2
- 字の収録: 液晶の場面とランタイムのソースにある日本語の記号・かな・漢字(145字)を調べ、M PLUS 1p は全て収録、Dela は `▶` だけ未収録(読み込み順の次の候補 Noto Sans CJK JP に落ちる)。
- 使い方: `LCD.text` が大きさで自動選択(`LCD.HEAD_MIN`=60 以上は見出し、未満は本文)。`font:'head'|'body'` で明示できる。測る時は `LCD.fontFor(size, o)`。読み込みは `LCD.init` の中の `LCD.loadFonts`(失敗したら Noto Sans CJK JP)。
- 3層文字素材(`t_*`、47キー・141枚)は `tools/gen_titles.py` の書体を Dela にして全部作り直した。従来の書体に戻すときは `TITLE_FONT=/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc python3 tools/gen_titles.py`。
- 未対応: `anim/upa_swim/index.html`(ルーレットの iframe 内の札「−1」「−2」の字と、`rl_t_*` の大きな「−1灯」)は従来の書体のまま。
