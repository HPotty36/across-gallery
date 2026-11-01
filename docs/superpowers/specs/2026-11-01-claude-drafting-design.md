# AI 초안을 Claude API로 (Ollama는 예비)

작성 2026-11-01 · 브랜치 `claude-drafting`

## 목표

1. 새 사진과 "AI로 다시 쓰기"는 GitHub Actions가 **바로**(60초 기다림 없이) **Claude**(`claude-opus-5-5`)로 방·제목·설명을 쓰고 게시한다.
2. Claude가 안 되면(키 없음·만료, 크레딧 소진, API 오류, 거절) 같은 실행에서 Ollama **e4b**가 이어 쓴다. Actions가 아예 돌지 못하면 **PC 12B**가 올린 지 5분 뒤 이어받는다. 사진이 막히는 일은 없다.
3. PC의 다듬기는 **e4b가 쓴 글만** 12B로 바꾼다. Claude가 쓴 글과 사람이 고친 칸·방은 건드리지 않는다.

## 왜

- 사용자의 Claude Max 요금제에 2026년 10월부터 매달 API 크레딧이 들어온다. 사진 한 장에 약 $0.02(Opus 5.5)라 크레딧 안에서 사실상 무료다.
- 한국어 제목·설명의 품질이 e4b보다 낫고, Actions가 매번 Ollama와 모델(수 GB)을 받지 않으니 게시가 빨라진다. PC를 켜 둘 필요도 없어진다.

## 하지 않는 것

- PC 도우미에서 Claude 부르기. 키는 GitHub 비밀값 한 곳에만 둔다.
- Ollama 제거, `photos.json` 형식 변경(`ai.model`에 새 값이 들어갈 뿐), 대기열 `item.json` 형식 변경.
- Batch API, 프롬프트 캐싱(사진 몇 장이라 이득이 없다).

## 지켜야 할 규칙

- 키는 저장소 Actions 비밀값 `ANTHROPIC_API_KEY`. Claude를 부르는 worker 단계에만 `env`로 준다. 내려받은 Ollama가 도는 단계에는 주지 않는다(지금 `GITHUB_TOKEN` 규칙과 같다). 키와 API 응답 원문은 로그·`item.json`에 남기지 않는다.
- Anthropic에는 **썸네일**(긴 변 1000px, 메타데이터를 지운 사본)만 보낸다.
- 프롬프트의 "장소 이름을 쓰지 말고 짐작하지 말 것" 규칙을 그대로 둔다. 제목 40자·설명 200자 자르기와 흑백 표시는 지금 코드(`clamp`, `finish_alt`)를 그대로 쓴다.
- 사람이 고친 칸과 방은 AI가 바꾸지 않는다(그대로).
- 시험은 네트워크도 `anthropic` 패키지도 없이 통과한다. Claude 클라이언트는 함수 안에서 늦게 불러오고, 시험은 가짜 클라이언트를 넣는다.

## 1. 흐름

| 상황 | 누가 | 쓰는 모델 |
|---|---|---|
| 올림·다시 시도 push, 30분 schedule, 수동 실행 | Actions(`--by github`), 기다림 없이 | Claude → 실패한 사진만 같은 실행에서 e4b |
| Actions가 돌지 못함(꺼짐, 장애) | PC 도우미: `waiting`이고 올린 지 **5분** 넘은 사진만 | 12B (실패하면 지금처럼 `waiting`으로 돌려놓음) |
| 다듬기(PC가 한가할 때 30분마다) | PC 도우미 | `ai.model`이 e4b인 사진만 12B로 |

### 맡는 규칙 (`scripts/queue_items.py`)

- `WAIT_SECONDS = 60`(GitHub가 PC를 기다림)을 없애고 `PC_WAIT_SECONDS = 300`을 둔다.
- `can_take(item, now, by)`: 맡은 지 10분 넘은 맡김은 지금처럼 누구나 다시 맡는다. `waiting`은 `github`이면 바로, `pc`이면 올린 지 `PC_WAIT_SECONDS`가 지난 뒤.

### Actions 안의 두 단계 (`.github/workflows/draft.yml`)

1. `sleep 60` 단계를 없앤다.
2. **Claude 단계**(`id: claude`, env `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `NOCTURNE_CLAUDE_MODEL: claude-opus-5-5`): `python scripts/worker.py --by github --run --ai claude`.
   - 키가 없으면 아무것도 맡지 않고 `published=0`으로 끝난다(키를 넣기 전에도 지금처럼 e4b로 돈다).
   - Claude가 실패한 사진은 `failed`로 두지 않고 `waiting`으로 **넘긴다**(handoff). 커밋 메시지는 `대기열: <name> Claude 실패, Ollama로 넘김`이다. 여기에 `올림`이나 `다시 시도`가 들어가면 draft.yml이 다시 시작돼 같은 실패를 되풀이하므로 넣지 않는다. 이유는 `error`에 남는다.
3. **남은 사진 찾기**(`id: check`): 지금의 `--check`.
4. 남은 사진이 있을 때만 Ollama 내려받기 → 캐시 → 서버 → 모델 받기(지금 단계 그대로, 키 없음).
5. **e4b 단계**(`id: run`): `python scripts/worker.py --by github --run --ai ollama`. 실패는 지금처럼 `failed`.
6. **사이트 다시 만들기**: Claude 단계나 e4b 단계 중 하나라도 `published`가 0보다 크면.

### worker (`scripts/worker.py`)

- 명령줄 `--ai {claude,ollama}`(기본 `ollama`). `claude`면 초안을 Claude로 쓰고, AI 실패는 handoff.
- AI 실패의 처리는 셋이다: `release`(PC, 지금 그대로: `다시 시도 (PC AI 실패)`, 30분 건너뜀), `handoff`(Claude 단계, 위 메시지), `fail`(e4b 단계).
- `upgrade_one`의 대상: `ai.fields`가 남아 있고 `ai.model`이 **다듬을 모델 목록**(`gemma4:e4b-it-qat`)에 있는 사진. 지금의 "PC 모델이 아닌 모든 모델"을 바꾼다.

## 2. Claude 호출 (`scripts/curator.py`)

- 공식 Python SDK(`anthropic`, 1.x)를 쓴다. 패키지는 `requirements-ai.txt`에 두고 draft.yml만 설치한다(사이트 빌드는 Pillow만 그대로).
- 모델: 환경변수 `NOCTURNE_CLAUDE_MODEL`, 기본 `claude-opus-5-5`. 모델을 바꾸려면 draft.yml의 이 값만 고친다.
- 요청 (`client.beta.messages.create`)
  - `max_tokens` 16000, `output_config: {effort: "low", format: {type: "json_schema", schema: …}}`. Opus 5.5는 생각이 늘 켜져 있어서 `thinking`은 보내지 않는다.
  - 거절 대비: `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`(Anthropic 권장).
  - 메시지: 썸네일(JPEG, base64) + 지금과 같은 지시(방 목록과 설명, 기존 사진 예시, 규칙). 끝의 "JSON으로만 답하세요" 줄 대신 `confidence`를 설명하는 줄을 둔다: 고른 방이 맞다고 얼마나 확신하는지 0~1.
  - 스키마: `{room: 방 id 중 하나(enum), title: string, alt: string, confidence: number}`, 모두 필수, 다른 키 없음.
- 답 처리
  - `stop_reason`이 `refusal`이면 "Claude가 이 사진의 초안을 거절했어요", `max_tokens`면 "Claude의 답이 끊겼어요"로 실패.
  - 텍스트 블록의 JSON을 읽어 확인한다(room이 방 id, title·alt가 빈 문자열이 아님). 아니면 실패.
  - `confidence`는 0~1로 자른다(숫자가 아니면 없음). `ai.model`에는 실제로 답한 모델(`response.model`)을 남긴다(거절 대비로 다른 모델이 답하면 그 이름).
  - 자르기·흑백 표시는 `clamp`·`finish_alt` 그대로.
- 오류: SDK 예외를 키나 원문 없이 짧은 한국어로 바꾼다(키가 맞지 않음 401, 권한·크레딧 403/402, 요청이 많음 429, 그 밖 "Claude API 오류 <상태>", 연결 실패). 모두 Ollama로 넘길 수 있는 실패다.
- 키가 없으면 SDK를 불러오지도 않고 "Claude API 키가 없어요"로 실패한다(worker는 키가 없으면 Claude 단계를 아예 건너뛴다).

### "확인 필요" 배지

Ollama는 확률(logprobs)로 방 확신도를 계산했다. Claude API는 그 값을 주지 않으므로 Claude가 스스로 매긴 `confidence`를 쓴다. 0.8 미만이면 지금처럼 배지가 붙는다.

## 3. 시험

- `tests/test_curator.py`: 가짜 클라이언트로 Claude 초안. 보내는 값(모델, 썸네일 base64, effort, 스키마의 방 enum, fallbacks와 beta), 답 정리(자르기, 흑백, confidence 자르기, `response.model`), 실패(거절, 끊김, JSON 아님, 모르는 방, 빈 제목, SDK 예외 종류별 메시지, 키 없음). `anthropic` 패키지 없이 돈다.
- `tests/test_queue_items.py`: github은 바로, pc는 5분 뒤, stale 규칙 그대로.
- `tests/test_worker.py`: Claude 단계의 handoff(메시지에 `올림`·`다시 시도` 없음, `waiting`과 `error`), 키 없으면 아무것도 맡지 않음, e4b 단계는 지금처럼 `failed`, 다듬기는 e4b 글만(12B·Claude 글은 아님).
- `tests/test_workflows.py`: `sleep 60` 없음, `ANTHROPIC_API_KEY`는 Claude 단계에만, Ollama 단계는 `check`가 비어 있지 않을 때만, 사이트 다시 만들기 조건이 두 단계의 `published`를 본다, `requirements-ai.txt` 설치.
- 실제 확인(배포 뒤): 키 없이 한 장(e4b), 키를 넣고 한 장(Claude), "AI로 다시 쓰기" 한 번.

## 4. 문서

- CLAUDE.md: 사진 올리는 흐름(3·4·6·7번), 대기열 규칙(PC 5분), draft.yml 설명, 명령, 알아둘 것(모델과 비용, 키 위치, 썸네일 전송), 문제가 생기면(Claude 실패 문구별로 할 일: 키·크레딧·한도), 키 만들기 안내(Console에서 API 키 → GitHub 비밀값).
- README.md·README.ko.md: "No paid APIs"를 "Claude API(구독 크레딧) + Ollama 예비"로, 흐름도와 기술 표의 AI 줄.

## 5. 내보내는 순서

1. 코드와 시험(브랜치 `claude-drafting`).
2. main에 합치고 push. 키가 아직 없으니 Actions는 바로 e4b로 돈다(60초 기다림만 사라짐).
3. 사용자: claude.ai에서 Console 조직 연결 → Console에서 API 키 만들기 → 저장소 Settings → Secrets and variables → Actions → `ANTHROPIC_API_KEY` → Console에서 월 한도 걸기.
4. 실제 확인 세 가지(위 3절).
