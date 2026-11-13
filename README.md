# 체스 오답노트 ♞

> 내가 진 판이 제일 좋은 퍼즐이야.

Chess.com 아이디만 넣으면 최근에 **진 판**을 엔진으로 분석해서, 승부가 갈린 바로 그 순간을 퍼즐로 만들어 주는 웹앱이야. 남이 만든 퍼즐이 아니라 **내가 실제로 틀렸던 장면**을 다시 푸는 오답노트.

## 기능

- **진 판마다 결정적인 한 수만 퍼즐로**: 엔진 평가가 처음으로 폰 2개 이상 떨어진 내 수 직전 장면에서 시작해. 상대 응수가 이어지는 2~3수짜리 퍼즐도 있어.
- **손버릇 감지**: 그때 졌던 수를 또 두면 "그 수야, 그때 둔 수"라고 알려 주고 따로 모아 둬.
- **분류**: 기물 흘림 · 오프닝 · 잡을 수 있었음 · 이기던 판 놓침 · 메이트 있음 · 안 푼 것 · 손버릇
- **리포트**: 연패 뒤 패배율(틸트), 초반 붕괴 비율, 기물 흘림 횟수와 맞춤 조언
- 드래그 앤 드롭 / 탭 두 번으로 두기, 합법수 표시, 승진 선택, 모바일 지원
- PGN 파일 업로드도 지원 (Lichess 등 다른 사이트 기록도 가능)

## 어떻게 돌아가나

- 서버 없이 **브라우저 안에서** 다 돌아가. 엔진은 [Stockfish.js](https://github.com/nmrugg/stockfish.js) lite 단일 스레드 WASM 빌드를 써.
- 게임 기록은 [Chess.com 공개 API](https://www.chess.com/news/view/published-data-api)로 가져와. 브라우저가 직접 못 가져올 때는 `api/chesscom.js`(Vercel 서버리스 함수)가 대신 받아 줘. 이 함수는 플레이어 게임 기록 경로만 허용해.
- 분석 결과와 푼 기록은 그 기기의 `localStorage`에만 저장돼. 다시 들어오면 이미 분석한 판은 건너뛰어.

## 실행

빌드 과정이 없는 정적 사이트야.

```bash
# 로컬 실행
python3 -m http.server 8000
# → http://localhost:8000
```

(로컬에서는 `api/` 프록시가 없으니, Chess.com이 막히면 PGN 업로드로 테스트해.)

### Vercel 배포

1. Vercel에서 **Add New → Project → 이 저장소 Import**
2. Framework Preset은 **Other**, 빌드 설정은 비워 두고 Deploy

끝. `api/chesscom.js`는 자동으로 서버리스 함수가 돼.

## 구조

```
index.html          화면
style.css           스타일
src/app.js          화면 흐름, 보드, 퍼즐 풀이
src/analyze.js      결정적 실수 찾기, 퍼즐·리포트 만들기
src/engine.js       Stockfish 워커 래퍼
src/data.js         Chess.com API / PGN 읽기
src/pieces.js       기물 SVG
api/chesscom.js     Chess.com API 프록시 (Vercel)
vendor/             chess.js, Stockfish WASM
```

## 라이선스

Copyright (C) 2026 Katherine Nahm

이 프로젝트는 **GPL-3.0-or-later**야 (`LICENSE`). Stockfish가 GPLv3라서 같이 따라가. 상업적으로 써도 되지만, 배포할 때는 소스 코드도 같은 조건으로 공개해야 해.

포함된 서드파티:

- [Stockfish](https://stockfishchess.org/) / [Stockfish.js](https://github.com/nmrugg/stockfish.js) — GPLv3
- [chess.js](https://github.com/jhlywa/chess.js) — BSD-2-Clause
- 기물 그림 cburnett by Colin M.L. Burnett ([lichess-org/chessground](https://github.com/lichess-org/chessground) 경유) — CC BY-SA 3.0

Chess.com과는 관계없는 개인 프로젝트야.
