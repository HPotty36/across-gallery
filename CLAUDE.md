# Nocturne — 사진 전시 사이트

직접 찍은 사진을 "방"(강, 경기장, 밤, 순간)으로 나눠 어두운 전시실처럼 거는 정적 사이트. 폰이나 PC 브라우저의 관리 페이지에서 사진을 올리면 AI가 방을 고르고 제목·설명을 써서 바로 게시하고, 사람은 나중에 관리 페이지에서 고치거나 지운다. 유료 API는 쓰지 않는다 (집 PC의 Ollama, 꺼져 있으면 GitHub Actions의 Ollama). 사이트는 `index.html` 한 장, `photos/`, `admin/`뿐이라 GitHub Pages에 그대로 올라간다.

## 구조

```
src/template.html        페이지 뼈대: CSS(디자인 토큰), 마크업, JS(정렬 레이아웃, 크게 보기)
src/photos.json          사이트 문구, 대표 사진, 방 목록, 사진별 제목·대체 텍스트·날짜·카메라·ai (정규 형식, 아래)
photos/thumb/<name>.jpg  그리드용, 긴 변 1000px
photos/full/<name>.jpg   크게 보기·대표 사진용, 긴 변 2400px
queue/<name>/            대기 중인 업로드: full.jpg, thumb.jpg, item.json. 게시되면 폴더째 지워진다.
                         전시 중 사진의 설명 다시 쓰기는 queue/redraft-<file>/item.json 하나뿐.
admin/                   관리 페이지 (정적, 외부 스크립트 없음)
  index.html admin.css app.js config.js
  views/queue.js         새 사진 탭
  views/exhibit.js       전시 중 탭
  lib/                   names exif jpeg image grayscale auth github gallery queue sitestatus (.js)
auth/worker.js           Cloudflare Worker: 관리 페이지 로그인 코드를 토큰으로 바꿔 준다 (대시보드에 붙여 넣음)
scripts/
  photolib.py            이름 규칙, EXIF 힌트, 흑백 판별, 메타데이터 없는 사본, photos.json 읽기·쓰기, ai 함수
  build.py               template + photos.json -> index.html (--out 이면 _site 조립)
  prepare_photos.py      originals/ 의 원본을 웹용 사본으로 변환 (명령줄 흐름)
  curator.py             Ollama에게 방·제목·설명 초안 요청, 확신도, alt 후처리
  queue_items.py         item.json 형식과 누가 맡을 수 있는지 규칙
  github_api.py          표준 urllib GitHub 클라이언트 (파일 읽기·쓰기, 한 커밋 쓰기)
  worker.py              대기열 항목 맡기 -> 초안 -> 한 커밋 게시, 다듬기; Actions용 --check / --run
  pc_helper.py           집 PC에서 도는 도우미 (20초마다 대기열, 한가하면 30분마다 다듬기)
.github/workflows/
  site.yml               Pages 빌드·배포
  draft.yml              PC가 못 맡은 사진을 GitHub에서 초안 쓰고 게시
.github/assets/          README·소셜 미리보기 그림 (손으로 만든 것, 알아둘 것)
tests/                   Python unittest, tests/js (node), fake_github.py(가짜 GitHub), browser/(브라우저 점검)
docs/superpowers/        설계 문서(specs)와 구현 계획(plans)
originals/               원본 사진. git에 올리지 않음 (.gitignore)
index.html               로컬 빌드 결과. git에 올리지 않음 (.gitignore, 루트만). 직접 고치지 말 것
README.md / README.ko.md 저장소 첫 화면 소개 (영어 기본 / 한국어, 내용 같음)
LICENSE                  코드는 MIT. photos/·queue/의 사진은 MIT가 아님 (모든 권리 보유)
```

## 명령 (Windows, Python 3, Node 24)

```
py -m pip install -r requirements.txt            # 처음 한 번 (Pillow)
py scripts\build.py                              # 로컬 index.html 만들기 (커밋하지 않음)
py scripts\build.py --out _site                  # Pages에 올라가는 모양 그대로 _site 조립 (시험 뒤 지울 것)
py tests\browser\serve.py --port 8000            # http://localhost:8000 미리보기
py -m unittest discover -s tests -v              # Python 시험
node --test "tests/js/*.test.js"                 # JS 시험. npm test 도 같다 (node --test tests/js/ 처럼 폴더만 주면 Node 24에서 안 돈다)
py scripts\prepare_photos.py                     # 명령줄 흐름: originals/ 의 새 사진 변환
py scripts\pc_helper.py --setup                  # PC 도우미 토큰 저장 (처음 한 번)
py scripts\pc_helper.py                          # PC 도우미 실행. 콘솔 창 없이는 pyw
```

- 미리보기에 `py -m http.server`를 쓰지 말 것. 이 PC에서는 연결이 끊긴다. `serve.py`를 쓴다 (127.0.0.1 전용).
- `index.html`을 브라우저로 바로 열어도 동작한다.
- PC 도우미 기록은 `%APPDATA%\nocturne\helper.log`. 로그온 때 자동 실행은 Windows 작업 스케줄러에 "로그온할 때" 작업으로 등록한다.
- 시험은 둘 다 네트워크·Ollama 없이 통과한다.

### 관리 페이지를 컴퓨터에서만 시험하기

가짜 GitHub 서버를 띄우고 관리 페이지를 거기에 연결한다. 진짜 저장소는 건드리지 않는다.

```
py tests\fake_github.py --port 8790 --seed       # --seed: 지금 photos.json과 photos/로 채움
py tests\browser\serve.py --port 8000
```

`http://localhost:8000/admin/?api=http://127.0.0.1:8790` 을 열고 **GitHub로 로그인**을 누르면 가짜 서버가 바로 들여보낸다 (토큰을 넣지 않는다). 그다음부터는 열기만 해도 저절로 로그인된다. `?api=`는 관리 페이지를 `localhost`나 `127.0.0.1`에서 열었을 때만 먹고, 주소는 `http://127.0.0.1:<포트>` 꼴이어야 한다 (`localhost:<포트>` 등 다른 주소는 무시하고 진짜 GitHub에 붙는다). 올린 사진을 가짜 AI(제목 "초안")로 게시해 보려면 `py tests\browser\run_worker.py http://127.0.0.1:8790 --by pc` (또는 `--by github`).

로컬 미리보기에서 사이트 바닥글의 "관리"를 누르면 `?api=` 없는 `admin/`이 열려 진짜 GitHub에 붙는다. 시험할 때는 위 `?api=` 주소를 바로 연다.

로그인 실패는 가짜 서버의 로그인 방식을 바꿔 보고, 버튼을 다시 누른다 (Git Bash나 cmd).

```
curl -X PUT http://127.0.0.1:8790/_fake/login -d "{\"mode\":\"deny\"}"
```

- `deny`: GitHub 화면에서 취소한 것처럼 → "로그인을 취소했어요"
- `down`: Worker가 GitHub에 닿지 못한 것처럼 → "로그인하지 못했어요. 잠시 뒤 다시 해 주세요"
- `reader`: 이 저장소에 쓸 수 없는 계정 → "이 GitHub 계정으로는 관리할 수 없어요"
- `uninstalled`: App이 어디에도 설치되지 않은 것처럼 → "GitHub App이 nocturne 저장소에 설치되어 있지 않아요"
- `ok`: 원래대로 (처음 값)
- `"expires_in": <초>`를 같이 주면 그다음 받는 토큰이 그만큼만 간다. 예를 들어 `{"mode":"ok","expires_in":900}`으로 로그인하면 다른 탭에 갔다 돌아오자마자 "로그인이 끝났어요. 다시 로그인해 주세요".

## 사진 올리는 흐름

1. 관리 페이지(주소는 배포 항목)를 폰이나 PC에서 열고 사진을 고른다. 브라우저 안에서 메타데이터를 지우고(JFIF·ICC 구간만 남김), 긴 변 2400px·1000px로 줄이고, 날짜·카메라(GPS는 읽지 않음)와 흑백 여부를 알아낸다.
2. 사본 두 장과 `item.json`이 `queue/<name>/`에 한 커밋으로 올라간다. 이 순간부터 몇 분간 공개 저장소에서는 보이지만 사이트에는 나오지 않는다. 올린 뒤 페이지를 닫아도 된다.
3. 누가 먼저 맡는다.
   - 집 PC가 켜져 있고 Ollama가 돌면 PC 도우미가 20초 안에 맡아 12B(`gemma4:12b-it-qat`)로 초안을 쓴다.
   - 아니면 올린 지 60초 뒤 GitHub Actions(`draft.yml`)가 맡아 e4b(`gemma4:e4b-it-qat`)로 쓴다.
4. 초안(방, 제목, alt)을 쓰면 사람 확인 없이 바로 게시한다: 사진 두 장 이동 + `photos.json` 추가 + 대기열 삭제가 한 커밋. `site.yml`이 사이트를 다시 만든다 (1~2분).
5. 잘못된 건 관리 페이지의 **전시 중** 탭에서 고친다 (방, 제목, 설명 저장 / AI로 다시 쓰기 / 대표 지정 / 삭제). 방 배정 확신도가 0.8 미만이면 "확인 필요" 배지가 붙는다.
6. PC의 AI가 못 쓰면 그 사진은 다시 대기로 돌아가 GitHub가 이어서 맡는다. GitHub의 AI도 실패한 사진은 **새 사진** 탭에 남는다: 다시 시도 / 직접 입력해서 게시 / 버리기.
7. e4b가 쓴 설명은 PC가 켜져 있고 대기열이 비어 있을 때 PC 도우미가 30분마다 12B로 다시 써서 바꾼다. 사람이 고친 칸과 방은 AI가 절대 바꾸지 않는다.

대기열 항목 `status`: `waiting` → `pc` 또는 `github`(맡아서 처리 중) → 게시되면 폴더 삭제 / `failed`. PC는 `waiting`을 바로, GitHub는 올린 지 60초 지난 것만 맡는다. 10분 넘게 끝나지 않은 맡김은 죽은 것으로 보고 다시 맡을 수 있다 (관리 페이지에서 버릴 수도 있다). 동시에 맡으려 하면 파일 sha 때문에 늦은 쪽이 물러난다.

- PC의 AI가 못 쓰면(Ollama가 도중에 꺼짐, 모델이 답을 못 줌) `failed`로 두지 않고 `waiting`으로 돌려놓는다 (커밋 메시지 `대기열: <name> 다시 시도 (PC AI 실패)`, 이유는 `error`에 남는다). 그러면 `draft.yml`이 GitHub에서 맡고, PC 도우미는 그 항목을 30분 동안 건드리지 않는다.
- `failed`가 되는 경우: GitHub의 AI가 실패, 대기열 사진 파일이 없거나 읽을 수 없음, 같은 이름의 사진이 이미 있음, 맡은 뒤 예상 못 한 오류(`AI 처리 중 문제가 생겼어요`, 자세한 내용은 Actions 기록이나 `helper.log`). `failed`는 사람이 다시 시도를 눌러야 `waiting`이 된다.
- GitHub에 닿지 못한 오류는 기록하지 않는다. 그 항목은 10분 뒤 다른 쪽이 다시 맡는다.

`draft.yml`은 `queue/**` push 중 커밋 메시지에 `올림` 또는 `다시 시도`가 들어 있을 때만 일한다 (30분마다 도는 `schedule`과 수동 실행도 있다). 대기열 커밋 메시지를 바꿀 때 이 말을 지우지 말 것. GitHub가 게시한 뒤에는 `gh workflow run site.yml`로 사이트를 직접 다시 만든다 (`GITHUB_TOKEN`으로 한 push는 다른 워크플로를 시작하지 않는다).

### 명령줄 대안

관리 페이지 없이 PC에서도 넣을 수 있다.

1. 원본을 `originals/`에 넣는다.
2. `py scripts\prepare_photos.py` → `photos/thumb`, `photos/full` 생성, 아직 등록 안 된 사진의 JSON 항목이 출력된다 (EXIF에 날짜·카메라가 있으면 채워져 있음).
3. 그 항목을 `src/photos.json`의 알맞은 방 `photos` 배열에 넣고 `title`, `alt`를 채운다. 이렇게 넣은 사진에는 `ai`가 없다.
4. 커밋하고 push하면 `site.yml`이 사이트를 만든다. 로컬에서 보려면 `py scripts\build.py`.

새 방은 `rooms`에 `id`(영문 소문자, 주소 #앵커로 쓰임), `name`, `name_en`, `note`, `photos`를 갖춘 항목을 추가하면 상단 목차와 본문에 자동으로 생긴다. 방 추가와 사진 순서 바꾸기는 `src/photos.json`을 직접 고친다 (관리 페이지에는 없다).

## photos.json 형식

사진 항목: `{"file":"1234","title":"…","alt":"…","date":"2025.11.30","camera":"…","ai":{…}}` (`date`, `camera`, `ai`는 없을 수 있다). 파일은 정규 형식으로 쓴다: 들여쓰기 2칸, 사진은 한 줄에 하나(공백 없는 구분자), 한글 그대로, 끝 줄바꿈. Python(`photolib.dumps_data`)과 관리 페이지(`lib/gallery.js`)가 글자까지 같게 쓴다. 직접 고칠 때도 이 모양을 지킨다.

`ai`는 AI가 쓴 칸을 기록한다. 사이트에는 표시하지 않는다.

- AI가 게시하면 `{"model": "gemma4:e4b-it-qat", "fields": ["title","alt"], "confidence": 0.61}`. 확신도를 못 구하면 `confidence`가 없다.
- 관리 페이지에서 사람이 저장하면 바뀐 칸은 `fields`에서 빠지고 `confidence`는 지운다 (사람이 봤으니). `fields`가 비면 `ai` 전체를 지운다.
- 다듬기 대상: `ai.fields`가 비어 있지 않고 `ai.model`이 PC 모델이 아닌 사진. 다듬기는 `ai.fields`에 남은 칸만 바꾸고, 방과 확신도는 그대로 둔다.
- "AI로 다시 쓰기"(`redraft`)는 AI가 맡아서 처리를 시작한 때와 글자가 같은 칸만 바꾼다 (그 사이 사람이 고친 칸은 그대로). 바꾼 칸이 `ai.fields`가 되고 `ai.model`은 쓴 모델, 방과 확신도는 그대로.
- `photos.json`에서 AI가 쓴 제목이나 설명을 직접 고쳤다면 그 칸을 `ai.fields`에서도 빼야 한다 (비면 `ai`를 통째로 지운다). 그대로 두면 PC 도우미의 12B 다듬기가 고친 글을 덮어쓸 수 있다. 관리 페이지에서 저장하면 이건 저절로 된다.

## 관리 페이지 로그인 준비

관리 페이지는 **GitHub로 로그인**으로 들어간다. 이 저장소에 쓸 수 있는 GitHub 계정만 관리할 수 있다. 처음 한 번 GitHub App과 Cloudflare Worker를 만들어 둔다.

1. **GitHub App 만들기**: GitHub 로그인 → 오른쪽 위 프로필 → **Settings** → 왼쪽 맨 아래 **Developer settings** → **GitHub Apps** → **New GitHub App**.

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

   **Create GitHub App** → **General** 화면 위쪽 About에 보이는 **Client ID**(`Iv23…`, 숫자인 App ID가 아님)를 적어 둔다 (공개 값). client secret은 General이 아니라 왼쪽 **Credentials** 메뉴에 있다: **Generate a new client secret** → client secret을 복사한다 (비밀 값, 다시 볼 수 없다. Worker에만 넣는다).
2. **App 설치**: App 화면 왼쪽 **Install App** → **Install** → **Only select repositories** → `nocturne`만. 설치하지 않으면 로그인할 때 "GitHub App이 nocturne 저장소에 설치되어 있지 않아요"가 나온다. **만든 App(Developer settings → GitHub Apps)과 설치된 App(Settings → Applications → Installed GitHub Apps)은 다르다**: Installed 목록에 있어야 설치된 것이다.
3. **Worker 올리기**: Cloudflare 무료 계정을 만든다. `<하위주소>.workers.dev`의 하위 주소는 관리 페이지 설정과 CSP에 공개로 들어가므로 실명이 아닌 이름으로 정한다. 대시보드 → **Workers & Pages** → **Create** → **Hello World**, 이름 `nocturne-auth` → **Edit code**에 `auth/worker.js` 내용을 통째로 붙여 넣고 **Deploy**. 그다음 Worker의 **Settings** → **Variables and Secrets**에 넣고 다시 Deploy:
   - `CLIENT_ID` (Text): App의 Client ID
   - `CLIENT_SECRET` (Secret): App의 client secret

   Worker는 `https://hpotty36.github.io`에서 온 `POST /token`만 받는다. `auth/worker.js`를 고치면 대시보드에 다시 붙여 넣는다 (push로는 바뀌지 않는다). 잘 도는지는 아래 "문제가 생기면"의 로그인 항목으로 확인한다.
4. **값 넣는 곳**
   - `admin/config.js`: `clientId`에 Client ID, `exchange`에 `https://nocturne-auth.<하위주소>.workers.dev/token`. `Iv23-not-set`이나 `nocturne-auth.invalid`가 남아 있으면 아직 넣지 않은 것이다.
   - `admin/index.html`: CSP `connect-src`에 Worker 출처 `https://nocturne-auth.<하위주소>.workers.dev`. `config.js`와 다르면 `tests/test_admin_static.py`가 실패한다.
   - 커밋하고 push하면 `site.yml`이 관리 페이지를 다시 올린다.

로그인은 이렇게 된다.

- 처음엔 **GitHub로 로그인** → GitHub 허용 화면(처음 한 번) → 관리 화면.
- 한 번 로그인한 기기에서는 관리 페이지를 열기만 하면 GitHub에 다녀와 저절로 들어간다 (1~2초). 저절로 하다 실패하면 그 탭에서는 다시 하지 않고 버튼을 보여 준다.
- 토큰은 8시간 뒤 끝난다. 끝났거나 15분 안에 끝날 때 탭으로 돌아오면 "로그인이 끝났어요. 다시 로그인해 주세요"가 나온다.
- 로그아웃하면 이 기기에서 저절로 로그인하지 않는다. GitHub 자체 로그아웃은 github.com에서 한다.
- 폰을 잃어버렸다면 GitHub **Settings** → **Sessions**에서 그 폰의 세션을 지운다. 열려 있던 관리 페이지의 토큰까지 바로 끊으려면 **Settings** → **Applications** → **Authorized GitHub Apps**에서 이 App을 **Revoke**한다 (다음 로그인 때 허용 화면이 다시 나온다).

## PC 도우미 토큰

PC 도우미는 따로 GitHub **fine-grained 토큰**을 쓴다.

1. GitHub 로그인 → 오른쪽 위 프로필 → **Settings** → 왼쪽 맨 아래 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. 이름은 알아보기 쉽게 (예: `nocturne-pc`). **Expiration**: 만료일은 Custom으로 오늘부터 1년 뒤 날짜 (366일 이내).
3. **Repository access**: **Only select repositories** → `nocturne`만.
4. **Permissions → Repository permissions**: **Contents** Read and write만. (Metadata Read-only는 자동으로 붙는다.)
5. **Generate token** → 보이는 토큰을 복사한다 (다시 볼 수 없다).
6. `py scripts\pc_helper.py --setup` 에 붙여 넣으면 `%APPDATA%\nocturne\helper.json`에 저장된다.
7. 만료되기 전에 새로 만들어 다시 넣는다. 토큰이 샜다면 같은 화면(Fine-grained tokens)에서 그 토큰을 **Delete**로 지운다.

## 지켜야 할 것

- 사이트 어디에도 소유자의 실명을 넣지 않는다. 사이트 이름은 "Nocturne".
- 저장소와 사이트에 들어가는 사진은 반드시 메타데이터를 지운 사본이다 (관리 페이지의 브라우저 변환 또는 `prepare_photos.py`). 원본에는 GPS 위치가 들어 있을 수 있다. `photos/`나 `queue/`에 원본을 직접 복사하지 말 것.
- 저장소가 공개라서 올린 파일은 누구나 볼 수 있다. 대기 중인 사진은 `queue/`에서 몇 분간 공개 상태로 머물고, 버리거나 전시에서 빼도 git 기록에는 남는다. 원본(`originals/`)은 `.gitignore`로 제외되어 있다.
- `index.html`은 Actions가 만든다. 커밋하지 않는다 (`.gitignore`는 루트의 `index.html`만 막는다).
- 장소 이름은 확인된 것만 쓴다. 사진만 보고 추측한 장소를 제목이나 설명에 넣지 않는다 (AI 프롬프트에도 쓰지 말라고 넣어 두었다. 잘못 들어가면 전시 중 탭에서 고친다).
- `alt`는 화면 낭독기용 설명이다. 무엇이 찍혔는지 한 문장으로, 흑백이면 끝에 "흑백 사진"을 덧붙인다.
- 문구는 한국어, 짧고 평이하게.
- 사람이 고친 제목·설명과 방 배정은 AI가 다시 바꾸지 않는다.
- 사이트와 관리 페이지는 외부 스크립트를 불러오지 않는다. 이 계정의 다른 Pages 사이트에도 믿을 수 없는 내용이나 스크립트를 두지 않는다. 같은 출처라서 거기서 도는 스크립트가 관리 페이지 로그인을 몰래 끝낼 수 있다 (알아둘 것). 이걸 바꿔야 한다면 먼저 관리 페이지를 관리 페이지만 쓰는 출처로 옮긴다.

## 디자인 메모

- 토큰은 `src/template.html`의 `:root`에 있다 (관리 페이지 `admin/admin.css`도 같은 값). 기본은 어두운 테마, 밝은 테마는 `prefers-color-scheme: light`와 `data-theme="light"`에서 같은 토큰만 바꾼다. 색은 반드시 토큰으로 쓴다.

  | 토큰 | 어두운 전시실 | 밝은 테마 | 쓰임 |
  |---|---|---|---|
  | `--ground` | `#141312` | `#f4f2ee` | 페이지 바탕, 상단 바 |
  | `--wall` | `#1c1a18` | `#e8e5df` | 사진이 오기 전 자리 |
  | `--ink` | `#e9e4da` | `#1a1917` | 본문 글자 |
  | `--ink-dim` | `#8f8a82` | `#6b665f` | 설명, 메타 |
  | `--rule` | `#2b2926` | `#d9d5ce` | 구분선 |
  | `--lamp` | `#d9a759` | `#8a5a12` | 포커스, 현재 방, 관리 페이지의 현재 탭 |

- 크게 보기 화면(`--lb-*`)은 두 테마 모두 어둡다. 대비는 설계 때 정한 기준(`--ink` 7:1, `--ink-dim` 4.5:1, `--lamp` 3:1 이상)을 처음 값 그대로 통과했다.
- 강조색 `--lamp`(나트륨 가로등 호박색)는 포커스 표시, 현재 방 표시, 관리 페이지의 현재 탭에만 쓴다.
- 글꼴(Google Fonts): 워드마크·영문 표기 Cormorant Garamond 이탤릭, 한글 제목·사진 제목 Noto Serif KR, 본문·메타 IBM Plex Sans KR (숫자는 `tabular-nums`).
- 사진마다 아래에 늘 보이는 라벨: 제목 왼쪽, 날짜(있으면) 오른쪽. 대표 사진 라벨에는 날짜·카메라.
- 그리드는 JS가 방마다 행을 나눠 모든 행을 가로폭에 꽉 맞춘다 (동적 계획법으로 목표 높이에 가장 가깝게. 목표는 가로폭 1100px 이상 340, 720px 이상 260, 그 아래 200). 사진은 잘리지 않고 원래 비율을 유지한다. 행 높이가 목표의 1.6배를 넘으면 그 행은 목표 높이로 두고 가로를 채우지 않는다 (1~2장인 방).
- 크게 보기: 방향키, 스와이프, Esc, 사진 바깥 클릭으로 닫기. 처음엔 썸네일을 보여주고 원본이 받아지면 바꾼다.
- 관리 페이지는 375px 폭에서 쓸 수 있어야 한다. CSP 때문에 인라인 스크립트·스타일을 쓰지 않는다.
- 사이트 바닥글 끝의 "관리"(`--ink-dim`, 누구에게나 보임)는 관리 페이지로 가고, 관리 페이지 위쪽의 "Nocturne"은 사이트를 새 탭에 연다.

## 배포

- 저장소: https://github.com/HPotty36/nocturne (공개)
- 사이트: https://hpotty36.github.io/nocturne/
- 관리 페이지: https://hpotty36.github.io/nocturne/admin/
- GitHub Pages는 Actions로 배포한다 (`build_type=workflow`). `main`에 `src/**`, `photos/**`, `admin/**`, `scripts/build.py`, `scripts/photolib.py`, `requirements.txt`가 바뀌어 push되면 `site.yml`이 `build.py --out _site`로 `index.html`, `photos/`, `admin/`만 올린다 (1~2분). 문서만 바뀐 push는 다시 만들지 않는다. 수동 실행은 `gh workflow run site.yml`. `queue/`, `src/`, `scripts/`, `tests/`, `auth/`는 사이트로 서빙되지 않는다 (`auth/worker.js`는 Cloudflare에 손으로 붙여 넣는다).
- `.nojekyll`은 Actions 배포에서는 필요 없지만 두어도 해롭지 않다.
- 저장소 이름을 `across-gallery`에서 `nocturne`으로 바꿨기 때문에 옛 주소(`hpotty36.github.io/across-gallery/`)는 열리지 않는다. 이동 안내는 두지 않았다.

## 문제가 생기면

- **Actions 기록**: https://github.com/HPotty36/nocturne/actions 에서 `Draft`(GitHub 대타)와 `Site`(사이트 빌드)의 실행마다 단계별 기록을 본다. 관리 페이지 위쪽의 "반영 실패"도 여기로 이어진다. Draft를 잠시 끄려면 Actions 탭 왼쪽에서 `Draft` → 오른쪽 위 `…` → **Disable workflow** (명령줄은 `gh workflow disable draft.yml`, 다시 켜기는 `gh workflow enable draft.yml`). 꺼 둔 동안 PC가 못 맡은 사진은 대기열에 남는다.
- **PC 도우미 멈추기·다시 켜기**: 콘솔에서 돌렸으면 그 창에서 Ctrl+C. `pyw`로 돌렸으면 작업 관리자의 세부 정보에서 `pythonw.exe`(명령줄에 `pc_helper.py`가 있는 것)를 끝내거나, 작업 스케줄러에 등록했다면 그 작업을 **끝내기**. 다시 켜려면 `pyw scripts\pc_helper.py` (또는 작업 스케줄러에서 **실행**).
- **`helper.log` 읽기** (`%APPDATA%\nocturne\helper.log`, 한 줄에 하나): `시작`·`멈춤`, `published:<name>`(게시), `released:<name>`(PC의 AI가 못 써서 GitHub에 넘김), `upgraded:<file>`(다듬기), `failed:<…>`, `오류 …`(같은 오류가 이어지면 처음 한 번만 적힌다). 맡은 뒤에 난 예상 못 한 오류는 그 아래에 traceback이 여러 줄로 붙는다.
- **로그인이 안 될 때** (관리 페이지)
  - Worker가 응답하는지 본다 (Git Bash). 다른 출처의 요청은 `403`이어야 한다.

    ```
    curl -s -o /dev/null -w "%{http_code}\n" -X POST https://nocturne-auth.<하위주소>.workers.dev/token -H "Origin: https://evil.example"
    ```

    사이트 출처로 엉터리 코드를 보내면 `{"error":"bad_verification_code"}`가 정상이다. `{"error":"Not Found"}`면 `CLIENT_ID`가 틀렸다 (숫자로 된 App ID가 아니라 `Iv23…`으로 시작하는 Client ID를 넣는다). `incorrect_client_credentials`면 `CLIENT_SECRET`(또는 `CLIENT_ID`)이 틀렸고, `not_configured`면 변수가 빠졌고, `github_unreachable`이면 Worker가 GitHub에 닿지 못한 것이다.

    ```
    curl -s -X POST https://nocturne-auth.<하위주소>.workers.dev/token -H "Origin: https://hpotty36.github.io" -H "Content-Type: application/json" -d "{\"code\":\"x\",\"code_verifier\":\"y\",\"redirect_uri\":\"https://hpotty36.github.io/nocturne/admin/\"}"
    ```

  - 로그인 바로 뒤 "GitHub App이 nocturne 저장소에 설치되어 있지 않아요"가 나오면 App이 `nocturne`에 설치되지 않은 것이다. App 화면의 **Install App**에서 `nocturne`에 설치한다. 설치된 목록은 GitHub **Settings** → **Applications** → **Installed GitHub Apps**에서 본다 (만든 App과 설치된 App은 다르다).
  - "이 GitHub 계정으로는 관리할 수 없어요"는 로그인한 계정 또는 App에 `nocturne`의 쓰기 권한이 없다는 뜻이다. 로그인 뒤 일하다가 GitHub가 403으로 거절해도 같은 말이 뜬다.
  - App의 client secret을 새로 만들었다면 Worker의 `CLIENT_SECRET`도 바꿔 넣는다.
  - 폰에서만 안 되면 그 폰 브라우저가 github.com에 로그인돼 있는지 본다.
  - 저절로 로그인하다 실패한 탭은 다시 저절로 하지 않는다. 고친 뒤 **GitHub로 로그인**을 누른다.
- **배포 바로 뒤 관리 페이지가 "불러오는 중…"에서 멈추면**: GitHub Pages는 배포 뒤 최대 10분 동안 옛 관리 페이지 파일을 캐시에서 내줄 수 있다 (새 파일과 옛 파일이 섞인다). 새로고침하거나 10분 기다린 뒤 다시 연다.
- **PC 도우미 토큰이 만료되면**: 도우미는 아무것도 하지 못하고 `helper.log`에 `오류 GitHubError: GitHub 401: Bad credentials`가 남는다. 새 토큰을 만들어(위 PC 도우미 토큰) `py scripts\pc_helper.py --setup`으로 저장하고 도우미를 다시 켠다.
- **"확인할 수 없는 항목"**: `queue/<name>/`에 `item.json`이 없거나 읽을 수 없는 폴더다 (망가진 업로드, 손으로 만든 폴더). AI는 이것을 건너뛰고 기록(`helper.log`, Actions)에 한 번 적는다. 관리 페이지에서 **버리기**로 지운다.
- **"AI 대기"가 오래 가면**: 아무도 맡지 않은 것이다. 올린 지 15분이 넘으면 카드에 "AI가 오래 걸리고 있어요"가 붙는다. 대개 PC 도우미나 Ollama가 꺼져 있고 Draft도 돌지 못한 경우다. Actions 탭에서 Draft가 꺼져 있거나 실패하지 않았는지 본다 (저장소에 60일 동안 활동이 없으면 GitHub가 30분마다 도는 `schedule`을 멈춘다). 바로 돌리려면 Actions 탭의 **Run workflow** 또는 `gh workflow run draft.yml`. PC에서 Ollama와 도우미를 켜도 된다. 필요 없는 사진이면 버린다.
- **"PC AI가 보는 중…"·"GitHub AI가 보는 중…"이 10분 넘게 그대로면** 맡은 쪽이 멈춘 것이다. 다른 쪽이 곧 다시 맡는다 (PC는 20초마다, GitHub는 30분마다 확인). 이때도 "AI가 오래 걸리고 있어요"가 붙고 **버리기**가 나온다.

## 알아둘 것

- 이 PC는 로컬 루프백 연결의 일부를 끊는다 (WinError 10054). 그래서 `github_api.py`와 `curator.py`는 끊긴 요청을 다시 보내고, 브라우저 점검은 `serve.py`를 쓴다.
- Ollama 0.35.1이 같은 증상을 보인다: 요청의 일부가 `wsarecv: An existing connection was forcibly closed` 500으로 실패하고 바로 다시 보내면 성공한다. 그래서 `curator.py`는 최대 3번 시도한다 (연결 거부와 모델 없음은 바로 포기). `draft.yml`도 같은 0.35.1로 고정했고, 내려받은 파일은 그 릴리스의 `sha256sum.txt` 값으로 확인한다. 버전을 올릴 때 이 값도 같이 바꾼다.
- `draft.yml`에서 쓰기 권한이 있는 `GITHUB_TOKEN`은 worker 단계(`--check`, `--run`)에만 준다. 내려받은 Ollama가 도는 단계에 토큰을 넣지 말 것.
- API로 만드는 커밋(worker, PC 도우미, 관리 페이지)은 작성자를 `HPotty36 <112685098+HPotty36@users.noreply.github.com>`로 적는다 (`github_api.AUTHOR`, `admin/config.js`의 `COMMIT_AUTHOR`). 계정 프로필의 이름·이메일이 공개 기록에 들어가지 않게 하려는 것이니 지우지 말 것.
- AI 제목은 40자, 설명은 200자에서 자른다 (낱말 경계에서). 흑백 표시는 자른 뒤에 붙는다.
- 모델: PC `gemma4:12b-it-qat` (기본), Actions `gemma4:e4b-it-qat` (환경변수 `NOCTURNE_MODEL`). 더 작은 e2b는 방 설명 문구를 베껴 써서 쓰지 않는다.
- README 그림(`.github/assets/`)은 자동으로 다시 만들지 않는다. 디자인이 바뀌면 손으로 다시 찍는다. 화면 그림은 공개 사이트를 headless Chrome(DevTools 프로토콜)으로 찍었다: 1440×900, 폰 390×844 2배, `prefers-color-scheme` 어둡게·밝게, JPEG 품질 82. 워드마크(Cormorant Garamond 이탤릭, 배경 투명)와 소셜 미리보기(1280×640, `photos/thumb/`의 사진 다섯 장)는 저장소 밖의 작은 HTML을 같은 방법으로 찍었다. 관리 페이지는 찍지 않는다. `social-preview.jpg`는 저장소 **Settings** → **Social preview**에 손으로 올린다.
- 관리 페이지의 토큰은 로그인으로 받는 8시간짜리 `ghu_…` 토큰이고, 열린 페이지의 메모리에만 있다. localStorage·sessionStorage·쿠키·주소·기록 어디에도 쓰지 않는다. 브라우저에 남는 것은 localStorage `nocturne.signedIn`("이 기기에서 로그인한 적 있음", 비밀 아님)과, 로그인하러 다녀오는 동안의 sessionStorage `nocturne.login`(위조 방지 값과 PKCE 원문, 돌아오자마자 지움)·`nocturne.auto`(이 탭에서 저절로 로그인을 이미 해 봄)뿐이다. 옛 방식의 `nocturne.token`은 페이지를 열 때 지운다.
- 관리 페이지는 `hpotty36.github.io` 출처에서 돈다. 이 계정의 모든 Pages 사이트가 같은 출처라서, 그중 어느 페이지에서 도는 스크립트든 혼자서 로그인을 끝낼 수 있다: 자기 PKCE 값으로 로그인 주소를 팝업으로 열고, 같은 출처인 팝업에서 `?code=`를 읽고, Worker에서 토큰으로 바꾼다 (Worker는 출처만 보니 통과한다). 그 기기 브라우저가 GitHub에 로그인돼 있고 App을 허용한 적이 있으면 아무것도 묻지 않는다. 토큰을 저장하지 않아도 이건 막지 못한다. 그래서 이 출처에는 믿을 수 있는 스크립트만 둔다 (지켜야 할 것). `nocturne.signedIn`도 그 사이트들이 볼 수 있다.
