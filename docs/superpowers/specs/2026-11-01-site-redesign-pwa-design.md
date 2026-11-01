# 전시 사이트 개편과 PWA (1부)

작성 2026-11-01 · 브랜치 `site-redesign`

## 목표

1. 공개 사이트를 실제 사진 갤러리 사이트들을 참고해 **정갈하고 세련되게** 다시 짠다. 어두운 전시실 콘셉트는 그대로 두고, 바이브코딩 사이트 특유의 패턴(DE-SLOP)은 모두 없앤다.
2. 사이트를 **PWA**로 만든다: 폰 홈 화면에 설치되고, 한 번 연 뒤에는 오프라인에서도 전시를 볼 수 있다.

전체 작업은 두 부분이다. 1부(이 문서)는 전시 사이트(새 디자인 언어 + 설치 + 오프라인)이고, 2부는 관리 페이지(재설계 + 설치 + "공유 → Nocturne"으로 올리기)로 따로 설계한다.

## 왜

레퍼런스로 열 곳을 실제로 열어 보았다: 杉本博司, 川内倫子, Awoiska van der Molen, Nadav Kander, Bryan Schutmaat, Fraenkel Gallery, 국제갤러리, Chose Commune, Glass(반례), 森山大道. 공통점은 다음과 같다.

- 글꼴은 한 가족만 쓰고 크기도 거의 하나다. 크기 차이는 사진이 만든다.
- 강조색이 없다. 강약은 진한 글자와 흐린 글자로 준다.
- 캡션은 제목과 날짜 정도다.
- 크게 보기는 조용하다. 글자 링크를 쓰고 숫자를 평범하게 센다.

지금 사이트에서 "AI가 만든 고급 다크 템플릿"처럼 읽히는 부분은 다음과 같다.

- 글꼴 세 가지에 이탤릭 세리프 워드마크(Cormorant)를 더했다.
- 에스프레소색 바탕에 금색 강조색을 썼다.
- 로마 숫자, 자간 벌린 영문 대문자 방 이름, 셋씩 늘어놓는 시적인 방 설명을 넣었다.
- 큰 대표 사진 아래 소개 문단이 오는 랜딩 구조다.
- 카메라·조리개·셔터 정보를 붙였다.
- 크게 보기에 동그란 아이콘 버튼과 "01 / 22"를 썼다.
- "사진을 누르면 크게 볼 수 있어요" 같은 안내 문구가 있다.

사용자는 시안 셋(A 물건 라벨, B 회색 방, C 한 장씩) 중 **B를 고르고 바탕을 완전한 검정으로, 방들 위에 대표 사진을 하나** 두라고 했다. 시안은 `tests/browser/out/design/b2.html`이다(git에 올리지 않는다).

## 하지 않는 것

- 관리 페이지 손대기(2부). 1부 동안 관리 페이지는 지금 모습 그대로다.
- 관리 페이지의 서비스 워커와 "공유로 올리기"(2부).
- 설치 버튼이나 설치 안내 배너. 설치는 브라우저 메뉴로 한다.
- 원본 사진을 오프라인용으로 미리 전부 받아 두기. 크게 본 것만 저장한다.
- 사이트 이름, 방 구성과 순서, 사진 순서 바꾸기. 글꼴을 직접 호스팅하기.

## 지켜야 할 규칙 (그대로)

- 사진은 자르지 않는다. 정렬 배치(동적 계획법)는 그대로 두고 목표 높이만 바꾼다.
- 외부 스크립트는 쓰지 않는다. Google Fonts 스타일시트만 쓴다.
- 375px 폭에서 쓸 수 있어야 한다. 사이트 어디에도 실명을 넣지 않는다.
- 접근성은 지금 수준을 지킨다.
  - 사진 버튼 이름은 "제목 크게 보기"이고, alt가 설명으로 붙는다.
  - 키보드로 크게 보기를 쓸 수 있고, 포커스가 그 안에 갇힌다.
  - 움직임을 줄이는 설정을 지킨다.
  - 대비 기준은 `--ink` 7:1, `--ink-dim` 4.5:1 이상이다.
- 문구는 한국어로 짧고 평이하게 쓴다.

## 1. 화면

### 색 (어두운 테마 하나만)

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `--ground` | `#000` | 페이지 바탕, 위 줄, 크게 보기 |
| `--wall` | `#111` | 사진이 오기 전 자리 (사진마다 평균색 `--c`가 우선) |
| `--ink` | `#ebe9e4` | 글자, 키보드 포커스 테두리(2px) |
| `--ink-dim` | `#8f8c86` | 날짜, 점수, 기간, 작은 글씨, 지금 아닌 방 (대비 6.3:1) |
| `--rule` | `#262624` | 구분선 (필요한 곳만) |

- `color-scheme: dark`만 둔다.
- `prefers-color-scheme: light`와 `data-theme="light"` 규칙, `--lamp`, `--lb-*` 토큰은 없앤다. 크게 보기도 `--ground`를 쓴다.
- `<meta name="theme-color" content="#000">`를 넣는다.

### 글꼴

- Noto Serif KR 400 하나만 쓴다(Google Fonts, `crossorigin` 붙인 스타일시트). 영문 "Nocturne"도 같은 글꼴이다.
- 크기
  - 14px: 본문, 워드마크, 방 이름, 목록
  - 13px: 사진 라벨, 크게 보기 캡션
  - 12px: 기간, 작은 글씨
- 숫자는 `tabular-nums`, 한글은 `word-break: keep-all`.
- 이탤릭, 자간 벌리기, 대문자 변환, 굵게는 쓰지 않는다.

### 배치

**넓은 화면(960px 이상)**

- 두 열이다.
  - 왼쪽 180px 열은 `position: sticky; top: 0; height: 100svh`로 따라온다.
  - 오른쪽 열과의 간격은 `clamp(32px, 4vw, 64px)`, 전체 바깥 여백은 `clamp(16px, 3vw, 40px)`이다.
- 왼쪽 열에는 위에서부터 다음이 온다.
  - "Nocturne"(맨 위로 가는 링크)
  - 28px 띄우고 방 목록. 지금 보는 방은 `--ink`에 앞에 "•"(글자 밖으로 내어 씀)가 붙고, 나머지는 `--ink-dim`이다.
  - 맨 아래 작은 글씨 세 줄: "사진 23점", "© 2026 Nocturne", "관리"
- 현재 방은 지금처럼 화면 가운데를 지난 마지막 방이고, `aria-current="true"`를 붙인다.

**폰과 좁은 화면(960px 미만)**

- 위 한 줄이 따라온다(`sticky`, `--ground` 바탕): 왼쪽 "Nocturne", 오른쪽 "목록".
- "목록"을 누르면 오른쪽 아래로 방 목록이 펼쳐진다(`--ground` 바탕, `--rule` 테두리, 현재 방은 `--ink`).
  - 방을 고르거나, Esc를 누르거나, 목록 바깥을 누르면 접힌다.
  - `<details>`/`<summary>`로 만들고 접고 펴기만 JS가 돕는다.
- 맨 아래 작은 글씨 한 줄: "사진 23점 · © 2026 Nocturne · 관리"
- 방으로 건너뛸 때 위 줄에 가리지 않게 `scroll-margin-top`을 둔다.

### 대표 사진 (`photos.json`의 `cover`)

- 오른쪽 열(폰은 본문 폭) 맨 위에 둔다.
- 너비는 열에 꽉 차되, 높이가 첫 화면을 넘지 않게 한다(지금의 `min(100cqi, (100svh - 여백) × 비율)` 방식).
- 아래 라벨은 "제목, 날짜"이고 날짜가 없으면 제목만 쓴다. 카메라 정보는 쓰지 않는다.
- 누르면 그 사진으로 크게 보기가 열린다.
- 대표 사진 아래부터 첫 방까지 `clamp(72px, 9vw, 120px)`를 띄운다.

### 방

- 제목 줄은 한 줄이다: 방 이름(`--ink`), 한 칸 띄우고 "7점"(`--ink-dim`), 오른쪽 끝에 찍은 기간(`--ink-dim`, 12px).
- 기간은 그 방 사진들의 `date`에서 가장 이른 달과 가장 늦은 달이다: "2026.09 – 2026.10".
  - 두 달이 같으면 "2026.09" 하나만 쓴다.
  - 날짜 있는 사진이 없으면 기간을 쓰지 않는다.
- 방과 방 사이는 `clamp(64px, 8vw, 104px)`를 띄운다.

### 사진 배치와 라벨

- 정렬 배치는 그대로다. 목표 높이는 걸리는 폭 기준으로 1100px 이상 300, 720px 이상 240, 그 아래 180으로 바꾼다. 1.6배 넘는 줄은 지금처럼 목표 높이로 둔다. 사진 사이 간격은 `clamp(10px, 1.3vw, 16px)`이다.
- 라벨은 사진 아래 7px에 한 줄로, "제목, 날짜"를 쓴다. 제목은 `--ink`, ", 날짜"는 `--ink-dim`이다.
- 사진이 오기 전에는 평균색 자리가 보이고, 받아지면 부드럽게 나타난다(지금 그대로, 움직임 줄이기 설정 존중).

### 크게 보기

- 화면 전체가 `--ground`(검정)이다.
- 위쪽에는 사진이 들어갈 수 있는 만큼 크게(`contain`) 보인다.
- 아래 한 줄
  - 왼쪽: "제목, 날짜"(날짜는 `--ink-dim`)
  - 오른쪽: "3 / 23"(`--ink-dim`, 0을 채우지 않음), 그리고 글자 버튼 "이전 · 다음 · 닫기"
  - 폰에서 좁으면 두 줄로 내려간다.
- 글자 버튼
  - 평소 `--ink-dim`, 마우스를 올리거나 포커스하면 `--ink`다.
  - 누르는 영역은 위아래 여백으로 높이 24px 이상, 폰에서는 40px 이상이다.
  - 버튼 글자가 이름이라 `aria-label`은 쓰지 않는다.
- 그대로 두는 것
  - 썸네일을 먼저 보여 주고 원본이 받아지면 바꾸기, 앞뒤 원본 미리 받기
  - 방향키, Esc, 스와이프, 사진 바깥을 누르면 닫기
  - 열 때 "닫기"에 포커스, Tab이 세 버튼 안에서 돌기, 닫으면 원래 자리로 포커스

### 없애는 것

- Cormorant Garamond와 IBM Plex Sans KR
- 호박색 `--lamp`, 밝은 테마
- 로마 숫자(`roman()`), 영문 방 이름, 방 설명, 소개 문단
- 카메라·조리개·셔터와 비율 표시(`ratio_label()`). 데이터에는 남는다.
- "사진을 누르면 크게 볼 수 있어요"
- 동그란 아이콘 버튼과 SVG, 0 채운 숫자, 폰 목차의 가로 스크롤과 흐림 가장자리

## 2. 데이터와 빌드

### `src/photos.json`

- `site.lede`와 각 방의 `name_en`을 지운다.
- `note`는 남기되 **AI 전용**이다. `curator.py`가 방을 고를 때 읽고, 사이트에는 나오지 않는다.
- `site.description`(검색·공유 미리보기, `{total}` 치환)과 `site.copyright`, `cover`는 그대로 둔다.
- 새 방의 필수 칸은 `id`, `name`, `note`, `photos`다.
- `photolib.dumps_data`와 관리 페이지 `lib/gallery.js`의 정규 형식은 칸 순서를 그대로 지키는지 확인한다. 없어진 칸 때문에 두 쪽 출력이 달라지면 안 된다.

### `scripts/build.py`

- 새 마크업을 만든다(위 1절). 각 사진 `figure`의 데이터 속성은 `data-thumb`, `data-full`, `data-title`, `data-date`(없으면 빈 값)이고, 지금의 `data-meta`는 없앤다.
- **사진 주소에 내용 해시**를 붙인다: `photos/thumb/<name>.jpg?v=<sha256 앞 8자리>`(원본도 같은 방식, 각 파일 바이트의 해시).
  - 같은 이름으로 다른 사진이 다시 올라와도 브라우저와 서비스 워커가 옛 사진을 내주지 않게 하려는 것이다.
- 방 기간 계산은 함수 하나(`room_span(photos) -> str`)로 둔다.
- 같은 폴더(루트 빌드면 저장소 루트, `--out`이면 그 폴더)에 `index.html`과 함께 다음을 쓴다.
  - `manifest.webmanifest`(3절)
  - `sw.js`: `src/sw.js`에서 `__VERSION__`과 `__PHOTOS__`를 채운 것
- `--out`일 때 `photos/`, `admin/`과 함께 `icons/`도 복사한다.
- 저장소 루트에 생기는 `sw.js`와 `manifest.webmanifest`는 `index.html`처럼 `.gitignore`에 넣는다(루트만).
- `site.yml`의 `paths`에 `icons/**`를 더한다. `src/**`는 이미 들어 있다.

## 3. PWA

### 설치 정보

`manifest.webmanifest`(빌드가 쓴다):

```json
{"name":"Nocturne","short_name":"Nocturne","id":"./","start_url":"./","scope":"./","display":"standalone",
 "background_color":"#000000","theme_color":"#000000","lang":"ko","description":"<site.description, {total} 채움>",
 "icons":[{"src":"icons/icon-192.png","sizes":"192x192","type":"image/png"},
          {"src":"icons/icon-512.png","sizes":"512x512","type":"image/png"},
          {"src":"icons/icon-maskable-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]}
```

- 페이지 `<head>`에는 다음을 넣는다.
  - `<link rel="manifest" href="manifest.webmanifest">`
  - `<link rel="icon" href="icons/icon-192.png">`
  - `<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">`
  - `theme-color`
- **아이콘**(`icons/`, 저장소에 손으로 만들어 둔다. README 그림처럼 자동으로 다시 만들지 않는다)
  - 검은 바탕(`#000`)에 Noto Serif KR "N" 한 글자를 `--ink`로 둔다. 글자 높이는 아이콘의 약 56%다.
  - 파일은 `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`(글자를 가운데 80% 안전 영역 안에), `apple-touch-icon.png`(180px, 투명 없음)다.
  - 만든 뒤 사용자에게 보여 주고 확정한다.
- 설치하는 법(CLAUDE.md에 적는다)
  - 안드로이드 Chrome: ⋮ 메뉴 → "앱 설치"(또는 "홈 화면에 추가")
  - 아이폰 Safari: 공유 → "홈 화면에 추가"

### 서비스 워커 등록

페이지 스크립트 끝에서, `'serviceWorker' in navigator`이고 `location.protocol`이 `http:`나 `https:`일 때만 `navigator.serviceWorker.register('sw.js')`를 부른다. 그래서 `index.html`을 파일로 바로 열면 지금처럼 서비스 워커 없이 동작한다.

### `sw.js` (`src/sw.js` 틀, 빌드가 값을 채움)

- `VERSION`: `index.html`과 `manifest.webmanifest`와 `src/sw.js` 틀 내용의 해시(앞 12자리). 사이트가 바뀔 때마다 `sw.js`가 달라져 브라우저가 새 서비스 워커를 받는다.
- `PHOTOS`: 지금 전시 중인 사진마다 `{thumb, full}` 주소(해시 붙은, scope 기준 상대 주소).
- 캐시 넷:

| 캐시 | 담는 것 | 언제 넣나 |
|---|---|---|
| `nocturne-page` | `./`, `manifest.webmanifest`, `icons/` 네 개 | 설치(install) 때 모두 새로. 페이지는 온라인으로 받을 때마다 갱신 |
| `nocturne-thumbs` | `PHOTOS`의 thumb 전부 | 설치 때 **아직 없는 것만** 받는다(새 사진만 받음) |
| `nocturne-full` | 크게 본 원본 | 처음 받을 때 |
| `nocturne-fonts` | `fonts.googleapis.com` 스타일시트, `fonts.gstatic.com` 글꼴 | 처음 받을 때 |

- 설치 때 `skipWaiting()`, 활성(activate) 때 `clients.claim()`을 부른다. 활성 때는 다음을 정리한다.
  - `nocturne-thumbs`와 `nocturne-full`에서 지금 `PHOTOS`에 없는 주소를 지운다(전시에서 빠졌거나 바뀐 사진).
  - 이름이 위 넷이 아닌 캐시를 지운다.
- 요청 처리(`fetch`). 순서대로 첫 번째 맞는 규칙을 쓴다.
  1. GET이 아니면 건드리지 않는다.
  2. 같은 출처에서 scope 아래 `admin/`으로 시작하는 주소는 **건드리지 않는다**. `respondWith`를 부르지 않으니 로그인과 업로드는 지금 그대로다.
  3. 페이지 이동(`request.mode === 'navigate'`)이고 주소가 scope 자체나 `index.html`이면 네트워크를 먼저 본다.
     - 4초 안에 답이 오면 그것을 쓰고 `nocturne-page`의 `./`를 갱신한다(성공 응답만).
     - 4초가 지나거나 실패하면 캐시된 `./`를 쓴다. 캐시도 없으면 네트워크를 계속 기다린다.
  4. `manifest.webmanifest`와 `icons/`는 캐시를 먼저, 없으면 네트워크에서 받는다.
  5. `photos/thumb/`와 `photos/full/`은 캐시를 먼저 본다.
     - 없으면 네트워크에서 받아 해당 캐시에 넣는다. 성공 응답만, 그리고 지금 `PHOTOS`에 있는 주소만 넣는다.
     - 네트워크도 안 되면 실패를 돌려준다. 그러면 크게 보기는 지금처럼 썸네일에 머문다.
  6. `fonts.googleapis.com`은 캐시가 있으면 바로 쓰고 뒤에서 갱신한다. `fonts.gstatic.com`은 캐시를 먼저 쓰고, 없으면 받아 넣는다.
  7. 그 밖은 건드리지 않는다.
- 판단 부분(주소가 어느 규칙에 해당하는지)은 순수 함수 `route(url, scope)`로 둔다. 돌려주는 값은 `'pass' | 'page' | 'shell' | 'thumb' | 'full' | 'font-css' | 'font-file'`이고, 노드 시험이 이 함수를 직접 부른다.
- 오프라인에서 처음 여는 경우(한 번도 열지 않은 기기)는 다루지 않는다.

## 4. 시험

- **Python (`tests/test_build.py`)**
  - 마크업에 로마 숫자, `room-en`, `room-note`, 소개 문단, 카메라 문구, `lb-btn`이 없는지 본다.
  - 방 제목 줄의 점수와 기간을 본다. 기간은 한 달, 여러 달, 날짜 없음을 나눠 본다.
  - 대표 사진 라벨이 "제목, 날짜"인지 본다.
  - 사진 주소의 `?v=` 해시가 파일 내용으로 바뀌는지 본다.
  - manifest의 필수 칸과 아이콘 파일이 있는지 본다.
  - `sw.js`의 `VERSION`(내용이 바뀌면 바뀜)과 `PHOTOS` 목록을 본다.
  - `--out`에 `icons/`, `manifest.webmanifest`, `sw.js`가 있는지 본다.
  - 대비 시험은 새 토큰으로 바꾼다. `--ink`/`--ground`는 7 이상, `--ink-dim`/`--ground`는 4.5 이상이다.
- **`tests/test_admin_static.py`의 `test_tokens_match_site`**: 사이트와 관리 페이지 토큰이 같은지 보는 시험이다. 1부에서는 관리 페이지가 옛 토큰을 쓰므로 빼고, 2부에서 새 토큰으로 다시 건다(2부 설계에 적는다).
- **JS (`tests/js/sw.test.js`)**
  - `route()`가 다음을 맞게 가르는지 본다: 관리 페이지 주소(로그인 `?code=` 포함), 페이지, `index.html`, 썸네일, 원본, 글꼴 두 종류, 다른 출처, scope 밖.
  - 정리 함수(`stale(cachedUrls, photos) -> urls`)를 본다.
  - 노드 시험은 `src/sw.js` 틀을 `node:vm`으로 그대로 실행해 판단 함수(`function` 선언)를 꺼내 쓴다. 그래서 서비스 워커 이벤트 등록은 `typeof ServiceWorkerGlobalScope !== 'undefined'`일 때만 하고, 틀의 자리표시(`'__VERSION__'`, `[/*__PHOTOS__*/]`)는 채우기 전에도 올바른 JS다.
- **브라우저 (내장 브라우저, `serve.py`)**
  - 데스크톱과 375px에서 화면을 본다.
  - 크게 보기를 키보드와 스와이프로 써 본다.
  - 서비스 워커가 등록되는지 본다.
  - 서버를 끈 뒤 다시 열어 페이지와 썸네일이 보이는지 본다.
  - 관리 페이지(`admin/?api=…`)를 열어 로그인이 지금처럼 되는지 본다(서비스 워커가 건드리지 않는지).
- **배포 뒤**: 폰에서 설치되는지, 비행기 모드에서 열리는지 사용자와 함께 본다.

## 5. 문서와 README

- **CLAUDE.md**
  - 구조: `icons/`, `src/sw.js`, 빌드가 만드는 `manifest.webmanifest`와 `sw.js`
  - 디자인 메모: 새 색 표, 글꼴 하나, 밝은 테마 없음, 강조색 없음, 라벨, 크게 보기
  - `photos.json` 형식: `note`는 AI 전용, `lede`·`name_en` 없음
  - PWA: 설치하는 법, 오프라인에서 무엇이 보이는지, 새 버전이 들어오는 때, 관리 페이지는 통과
  - 관리 페이지는 2부 전까지 옛 모습이라는 것
- **README.md / README.ko.md와 `.github/assets/`**
  - 새 사이트로 화면 그림을 다시 찍는다.
  - 워드마크를 Noto Serif KR로 다시 만든다.
  - 소셜 미리보기를 검은 바탕으로 다시 만든다.
  - 기능 목록에 "설치와 오프라인 보기"를 더하고, 밝은 테마 문구를 뺀다. 소셜 미리보기는 사용자가 Settings에 다시 올린다.

## 내보내는 순서

1. 브랜치 `site-redesign`에서 만들고, 작업마다 검토한 뒤 마지막에 전체를 검토한다.
2. 시험이 통과하면 main에 합쳐 push한다. `site.yml`이 배포한다.
3. 배포된 사이트로 README 그림을 다시 찍어 push한다.
4. 사용자가 폰에서 설치하고 오프라인으로 확인한다.
