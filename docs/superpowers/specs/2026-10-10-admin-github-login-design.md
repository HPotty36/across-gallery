# 관리 페이지 GitHub 로그인, 사이트와 관리 페이지 오가기

작성 2026-10-10 · 브랜치 `admin-login`

## 목표

1. 관리 페이지에 들어갈 때 토큰을 넣지 않는다. **GitHub로 로그인** 버튼으로 들어가고, 한 번 로그인한 기기에서는 열 때 저절로 로그인된다.
2. 잠금 비밀번호와 기기에 저장한 토큰을 없앤다. 토큰은 열려 있는 페이지의 메모리에만 있고 8시간 뒤 만료된다.
3. 사이트에서 관리 페이지로, 관리 페이지에서 사이트로 쉽게 오간다.

## 왜 바꾸나 (사용자가 겪은 불편)

- 기기마다 토큰을 넣어야 하는데 GitHub는 토큰을 만들 때 한 번만 보여 준다. 새 기기에서 넣을 토큰이 없다.
- 관리 페이지의 "Nocturne"을 누르면 같은 탭에서 사이트로 넘어가는데, 사이트에는 관리 페이지로 가는 길이 없고, 돌아가도 잠금 비밀번호를 다시 넣어야 한다.

## 검토하고 버린 안

- **암호화한 토큰을 저장소에 두기**: 어느 기기에서나 비밀번호만 넣으면 되지만, 암호화된 토큰이 공개되어 누구나 시간 제한 없이 비밀번호를 맞혀 볼 수 있다. git 기록에 영원히 남는다.
- **브라우저 비밀번호 관리자에 맡기기**: 공개되는 것은 없지만 같은 브라우저·계정끼리만 편하다.
- **QR로 기기 넘겨주기**: 새 기기를 더할 때마다 설정된 기기가 옆에 있어야 한다.

사용자는 GitHub 로그인을 골랐다. GitHub 계정은 이미 2단계 인증을 쓰고 있다.

## 하지 않는 것

- PC 도우미의 인증. 지금처럼 fine-grained 토큰(`%APPDATA%\nocturne\helper.json`)을 쓴다.
- 갱신 토큰(refresh token)으로 8시간 넘게 이어 쓰기. 만료되면 다시 로그인한다.
- 로그아웃할 때 GitHub에 토큰 폐기 요청. 토큰은 저장되지 않고 8시간 뒤 스스로 만료된다.
- 사진 이름에 `_edited`가 남는 문제 (따로 고친다).

## 지켜야 할 규칙 (그대로)

- 실명을 어디에도 넣지 않는다. Cloudflare의 `<하위주소>.workers.dev`는 관리 페이지 설정과 CSP에 공개로 들어가므로 실명이 아닌 이름으로 정한다.
- 토큰을 평문으로 저장하지 않는다. 이제는 아예 저장하지 않는다.
- 사이트는 정적 그대로다. 새 서버는 로그인 코드 교환만 하는 Worker 하나뿐이고, 무료 플랜으로 충분하다 (하루 10만 요청).

## 1. 구성

```
브라우저(관리 페이지) ──① 로그인 화면으로──▶ github.com/login/oauth/authorize
        ▲                                         │ ② 허용(처음 한 번)
        └──────── ③ ?code=…&state=… ◀─────────────┘
        │
        ├── ④ POST {code, code_verifier, redirect_uri} ──▶ Cloudflare Worker ──▶ github.com/login/oauth/access_token
        │◀────────────── ⑤ {access_token, expires_in} ◀──────┘        (client_secret은 Worker에만)
        │
        └── ⑥ api.github.com (지금과 같은 호출, 토큰만 ghu_… 로 바뀜)
```

### GitHub App (사용자가 만든다)

| 항목 | 값 |
|---|---|
| 이름 | 전역에서 겹치지 않는 이름. 실명 금지 (예: `nocturne-admin-hpotty36`). 허용 화면에 보인다 |
| Homepage URL | `https://hpotty36.github.io/nocturne/` |
| Callback URL | `https://hpotty36.github.io/nocturne/admin/` |
| Expire user authorization tokens | 켬 (8시간) |
| Request user authorization during installation | 끔 |
| Enable Device Flow | 끔 |
| Webhook Active | 끔 |
| Repository permissions | Contents: Read and write, Actions: Read-only (Metadata: Read-only는 자동) |
| 설치할 수 있는 곳 | Only on this account |
| 설치 | Only select repositories → `nocturne` |

만든 뒤 **Client ID**(공개 값, 관리 페이지 설정에 들어감)와 **client secret**(비밀, Worker에만)을 얻는다. 로그인으로 받는 토큰(`ghu_…`)은 이 앱 권한과 사용자 권한이 겹치는 만큼만, 앱이 설치된 `nocturne`에서만 쓸 수 있다.

### Worker (`auth/worker.js`, Cloudflare에 올린다)

하는 일은 코드 교환 하나다. Cloudflare 대시보드에서 Worker를 만들고 이 파일 내용을 붙여 넣는다 (명령줄 도구 설치 없음).

- 변수: `CLIENT_ID` (일반 변수), `CLIENT_SECRET` (Secret). 둘 다 대시보드에서 사용자가 넣는다.
- 받는 출처는 `https://hpotty36.github.io` 하나 (코드에 상수로).
- `OPTIONS /token`: 출처가 맞으면 CORS 사전 요청 허락 (`POST`, `Content-Type`).
- `POST /token`, 본문 JSON `{code, code_verifier, redirect_uri}`:
  - 출처가 다르면 403. 본문이 JSON이 아니거나 값이 문자열이 아니거나 너무 길면(각 512자 넘음) 400.
  - GitHub `POST https://github.com/login/oauth/access_token`에 `client_id`, `client_secret`, `code`, `code_verifier`, `redirect_uri`를 JSON으로 보내고 `Accept: application/json`으로 받는다.
  - GitHub가 `access_token`을 주면 `200 {access_token, expires_in}`만 돌려준다. `refresh_token`과 나머지는 버린다.
  - GitHub가 `{error}`를 주면 `400 {error}`. GitHub에 닿지 못하거나 이상한 답이면 `502 {error: "github_unreachable"}`.
- 그 밖의 경로·메서드는 404 / 405.
- 토큰과 코드를 로그에 남기지 않는다.

### 관리 페이지 설정 (`admin/config.js`)

`CONFIG`에 더한다.

| 키 | 값 |
|---|---|
| `clientId` | GitHub App의 Client ID |
| `authorize` | `https://github.com/login/oauth/authorize` |
| `exchange` | `https://nocturne-auth.<하위주소>.workers.dev/token` |

`?api=http://127.0.0.1:<포트>` 시험 모드(지금 규칙 그대로, localhost 페이지에서만)에서는 `authorize`가 `<api>/login/oauth/authorize`, `exchange`가 `<api>/_auth/token`이 된다. 가짜 GitHub가 둘 다 흉내 낸다.

`admin/index.html`의 CSP `connect-src`에 Worker 출처를 더한다. GitHub 로그인 화면으로 가는 것은 페이지 이동이라 CSP와 상관없다.

## 2. 로그인 흐름 (`admin/lib/auth.js` + `admin/app.js`)

### 브라우저에 두는 값

| 어디 | 키 | 내용 | 언제 지움 |
|---|---|---|---|
| localStorage | `nocturne.signedIn` | `"1"`: 이 기기에서 로그인한 적 있음 (비밀 아님) | 로그아웃 |
| sessionStorage | `nocturne.login` | `{state, verifier, at}`: 다녀오는 동안의 위조 방지 값과 PKCE 원문 | 돌아오자마자 |
| sessionStorage | `nocturne.auto` | `"1"`: 이 탭에서 자동 로그인을 이미 한 번 시도함 | 로그인 성공 |
| 메모리 | — | 토큰과 만료 시각 | 로그아웃, 페이지 닫기 |

옛 값 `localStorage["nocturne.token"]`(잠금 비밀번호로 암호화한 토큰)은 페이지를 열 때 지운다.

### 로그인 보내기

1. `state` = 무작위 16바이트, `verifier` = 무작위 32바이트 (둘 다 base64url). `challenge` = base64url(SHA-256(verifier)).
2. `nocturne.login`에 `{state, verifier, at: 지금}` 저장.
3. `redirect_uri` = 지금 페이지 주소에서 `code`·`state`·`error` 등을 뺀 것. 실제로는 `https://hpotty36.github.io/nocturne/admin/`, 시험 모드에서는 `?api=`가 붙은 localhost 주소.
4. `location.assign(authorize?client_id&redirect_uri&state&code_challenge&code_challenge_method=S256)`.

### 페이지를 열 때

1. 주소에 `code` 또는 `error`가 있으면 → **돌아옴 처리**.
2. 아니면 `nocturne.signedIn`이 있고 `nocturne.auto`가 없으면 → `nocturne.auto` 표시 후 **로그인 보내기** (자동, 화면에는 "로그인하는 중…").
3. 아니면 → 로그인 화면 (버튼).

### 돌아옴 처리

1. 주소에서 `code`, `state`, `error`를 읽고 `history.replaceState`로 주소에서 지운다 (`?api=`는 남김).
2. `nocturne.login`을 읽고 바로 지운다. 없거나, `state`가 다르거나, 10분이 넘었으면 → 코드를 버리고 로그인 화면.
3. `error=access_denied` → 로그인 화면 + "로그인을 취소했어요". 다른 `error` → "로그인하지 못했어요. 잠시 뒤 다시 해 주세요".
4. `exchange`에 `{code, code_verifier, redirect_uri}` POST. 실패(네트워크, 4xx, 5xx, 이상한 답) → 로그인 화면 + "로그인하지 못했어요. 잠시 뒤 다시 해 주세요".
5. 받은 토큰으로 GitHub 클라이언트를 만들고 지금처럼 `canPush(repo)`를 확인. 쓸 권한이 없으면 토큰을 버리고 → 로그인 화면 + "이 GitHub 계정으로는 관리할 수 없어요".
6. 성공 → `nocturne.signedIn` 저장, `nocturne.auto` 지움, 관리 화면.

`nocturne.auto`는 실패하면 남는다. 그래서 같은 탭에서 다시 열어도 자동으로 다녀오지 않고 버튼이 나온다 (GitHub와 페이지 사이를 끝없이 오가지 않는다). 버튼은 언제나 누를 수 있다.

### 만료와 로그아웃

- 토큰 만료 시각 = 받은 시각 + `expires_in` (없으면 8시간).
- 탭으로 돌아왔을 때(`visibilitychange`) 만료됐거나 15분 안에 만료되면 → 로그인 화면 + "로그인이 끝났어요. 다시 로그인해 주세요". 밤새 열어 둔 탭에서 쓰기 시작하기 전에 다시 로그인하게 한다.
- 쓰는 도중에 GitHub가 토큰을 거절하면(`AuthError`, 지금 setup으로 보내는 자리) → 401이면 같은 화면, 403이면 "이 GitHub 계정으로는 관리할 수 없어요" (로그인은 됐는데 쓰기가 막힘: 대개 App이 `nocturne`에 설치되지 않은 경우라, "다시 로그인"을 띄우면 같은 일이 되풀이된다). 그때 저장하지 못한 입력은 잃는다 (드문 경우로 받아들인다).
- 로그아웃 → 메모리의 클라이언트를 버리고 `nocturne.signedIn`을 지우고 로그인 화면. GitHub 자체 로그아웃은 github.com에서 한다.

## 3. 화면

### 관리 페이지

- `setup`, `unlock` 화면과 `admin/lib/vault.js`를 없앤다.
- 새 `login` 화면: 제목 "로그인", 안내 "GitHub 계정으로 들어가요. 이 저장소에 쓸 수 있는 계정만 관리할 수 있어요.", 버튼 "GitHub로 로그인", 메시지 줄 (`role="status"`).
- 자동 로그인과 돌아옴 처리 중에는 지금의 `boot` 줄에 "로그인하는 중…".
- 위쪽 `Nocturne`은 `href="../" target="_blank" rel="noopener"`로 사이트를 새 탭에 연다. 관리 탭은 열린 채로 남는다.
- 375px 폭, 인라인 스크립트·스타일 금지(CSP) 규칙 그대로.

### 사이트

- `src/template.html` 바닥글 마지막 줄 끝에 ` · <a href="admin/">관리</a>`. 누구에게나 보인다. 색은 `--ink-dim`, 포커스는 `--lamp` (지금 토큰 규칙).

## 4. 가짜 GitHub (`tests/fake_github.py`)

- `GET /login/oauth/authorize`: `redirect_uri`로 302. 쿼리에 `code`(무작위, 한 번만 씀)와 받은 `state`를 붙인다. `code_challenge`를 그 코드와 함께 기억한다.
- `POST /_auth/token` (Worker 역할, `http://localhost:<포트>` 출처에 CORS 허락): `code`가 있고 아직 안 썼고 base64url(SHA-256(`code_verifier`))가 기억한 challenge와 같으면 `{access_token: <가짜 토큰>, expires_in: 28800}`. 아니면 `400 {error: "bad_verification_code"}`.
- 제어 `PUT /_fake/login` `{mode}`: `ok`(기본), `deny`(authorize가 `error=access_denied`로 돌려보냄), `down`(token이 502), `reader`(토큰은 주지만 저장소 `permissions.push`가 false).
- 이것으로 시험 모드에서 토큰 없이 버튼만 눌러 들어간다.

## 5. 시험

- `tests/js/auth.test.js`: PKCE challenge가 RFC 7636 예시 값과 같음, 로그인 주소의 매개변수, `redirect_uri`가 `code`·`state`는 빼고 `?api=`는 남김, 돌아옴 처리(맞는 state / 다른 state / 오래된 값 / 값 없음 / `access_denied` / 다른 error), 교환 실패 종류별 메시지, 페이지를 열 때 무엇을 할지 고르는 규칙(돌아옴 / 자동 / 버튼, `nocturne.auto`가 있으면 자동 안 함), 만료 판단(15분 경계).
- `tests/js/auth-worker.test.js`: `auth/worker.js`를 Node의 `Request`/`Response`와 가짜 `fetch`로 돌린다. 출처가 다르면 403, 사전 요청, 잘못된 본문 400, GitHub에 넘기는 값(client_secret 포함), 성공 시 `refresh_token`이 빠짐, GitHub `{error}` → 400, GitHub에 못 닿음 → 502, 다른 경로 404.
- `tests/js/config.test.js`: 시험 모드에서 `authorize`·`exchange`가 가짜 서버로 바뀜, 다른 주소에서는 안 바뀜.
- Python: 가짜 GitHub의 authorize·token·`/_fake/login` 동작.
- 브라우저 점검: 가짜 GitHub + `serve.py`로 버튼 → 관리 화면, 새로고침하면 자동 로그인, 로그아웃하면 버튼, `deny`·`down`·`reader` 각각의 메시지, 자동 로그인 실패 뒤 되풀이 없음.
- `vault.js`의 시험은 파일과 함께 지운다.
- 실제 확인 (배포 뒤): PC와 안드로이드 폰에서 로그인. 이미 허용한 앱이면 GitHub가 다시 묻지 않고 바로 돌려보내는지, 폰의 GitHub 앱이 로그인 주소를 가로채지 않는지 본다.

## 6. 문서

- CLAUDE.md
  - 구조: `auth/worker.js`, `admin/lib/auth.js` 추가, `vault` 삭제.
  - "관리 페이지를 컴퓨터에서만 시험하기": 토큰·잠금 비밀번호 대신 "GitHub로 로그인"을 누르면 가짜 서버가 바로 들여보낸다.
  - "토큰 만들기" → 두 갈래: **관리 페이지 로그인 준비**(GitHub App 만들기, Worker 올리기, 값 넣는 곳)와 **PC 도우미 토큰**(지금 내용 중 PC 부분).
  - "문제가 생기면": 로그인이 안 될 때 (Worker가 응답하는지, App이 `nocturne`에 설치됐는지, client secret을 새로 만들었으면 Worker에도 바꿔 넣기, 폰 브라우저가 github.com에 로그인돼 있는지). 관리 페이지의 "토큰이 만료되면" 항목은 PC 도우미만 남긴다.
  - "알아둘 것": 관리 페이지 토큰은 저장하지 않고 8시간짜리라는 것, `hpotty36.github.io` 출처 이야기는 이제 Worker CORS와 `nocturne.signedIn`에만 해당.
- README의 관리 페이지 설명.

## 7. 내보내는 순서

지금 관리 페이지가 중간에 끊기지 않게, Worker가 먼저 살아 있어야 새 관리 페이지를 올린다.

1. 코드와 시험 (브랜치 `admin-login`). 가짜 GitHub로 이 컴퓨터에서 끝까지 확인.
2. 사용자: Cloudflare 무료 계정 (실명 아닌 `workers.dev` 하위 주소) → GitHub App 만들기·설치 → Worker 만들고 `auth/worker.js` 붙여 넣기 → `CLIENT_ID`, `CLIENT_SECRET` 넣기. 비밀 값은 사용자가 직접 넣는다.
3. Worker 확인: 다른 출처 요청이 403, 사이트 출처의 엉터리 코드가 400인지 본다.
4. Client ID와 Worker 주소를 `admin/config.js`·CSP에 넣고 main에 합친 뒤 push (사용자 확인 후). `site.yml`이 관리 페이지를 다시 올린다.
5. PC와 폰에서 로그인 확인 → 사용자가 관리 페이지용 옛 fine-grained 토큰을 GitHub에서 **Delete**.
