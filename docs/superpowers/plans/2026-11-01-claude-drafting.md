# Claude Drafting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Actions drafts every upload and redraft at once with the Claude API (`claude-opus-5-5`), falls back to Ollama e4b in the same run, lets the PC helper take only uploads nobody took for 5 minutes, and upgrades only e4b-written text.

**Architecture:** `curator.claude_draft` is a second drafter with the same call shape as `curator.draft`. The worker gains an AI-failure mode (`release` / `handoff` / `fail`) and a `--ai {claude,ollama}` switch; `draft.yml` runs a Claude pass, then an Ollama pass only for what is left. Claim timing moves from "GitHub waits 60 s for the PC" to "the PC waits 5 min for GitHub".

**Tech Stack:** Python 3.14, official `anthropic` SDK 1.x (Actions only, imported lazily), Pillow, GitHub Actions, `unittest` with the existing fake GitHub.

**Spec:** `docs/superpowers/specs/2026-11-01-claude-drafting-design.md`

## Global Constraints

- Model from env `NOCTURNE_CLAUDE_MODEL`, default `claude-opus-5-5`. Request: `client.beta.messages.create`, `max_tokens=16000`, `output_config={"effort": "low", "format": {"type": "json_schema", "schema": …}}`, `betas=["server-side-fallback-2026-07-01"]`, `fallbacks="default"`, no `thinking`, no `temperature`.
- Key only in the Actions secret `ANTHROPIC_API_KEY`, given only to the Claude worker step. Never log or store the key or raw API responses.
- Only the thumbnail (`queue/<name>/thumb.jpg` or `photos/thumb/<file>.jpg`) is sent.
- Prompt keeps the existing rules (no place names, 2~8-character title, alt one sentence). `clamp`/`finish_alt` apply as today (title 40, alt 200, `, 흑백 사진`).
- Tests pass with no network and without the `anthropic` package (lazy import; tests inject a fake client).
- `PC_WAIT_SECONDS = 300`; `STALE_SECONDS = 600` unchanged. GitHub takes `waiting` at once.
- Handoff commit message: `대기열: <name> Claude 실패, Ollama로 넘김` — must not contain `올림` or `다시 시도`.
- Upgrade sources: `curator.UPGRADE_FROM = ("gemma4:e4b-it-qat",)`.
- Exact copy: `Claude API 키가 없어요`, `Claude API 키가 맞지 않아요`, `Claude API 권한이나 크레딧을 확인해 주세요`, `Claude API 요청이 너무 많아요`, `Claude API 오류 <status>`, `Claude API에 연결하지 못했어요`, `Claude가 이 사진의 초안을 거절했어요`, `Claude의 답이 끊겼어요`, `Claude의 답을 읽을 수 없어요 (<reason>)`, `anthropic 패키지가 없어요`, `Claude API 키가 없어서 Claude 단계를 건너뛰어요`.
- This PC's loopback drops connections (WinError 10014/10054): `test_worker`, `test_pc_helper`, `test_github_api` and `FakeHttpTests` fail intermittently on untouched main too. Re-run a module that fails only with those errors; report it.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the implementing model's own attribution line).

## Review Focus

- A broken key or exhausted credit must not fail silently while e4b quietly publishes: every Claude handoff prints a GitHub Actions `::warning` line naming the item and the reason. Pinned in Task 2.
- The `anthropic` package missing on the runner must hand off, not crash: `ImportError` becomes `anthropic 패키지가 없어요`. Pinned in Task 1.
- Claude's fallback model answering must be recorded as that model (`response.model`), not the requested one. Pinned in Task 1.
- `confidence` that is not a number (string, bool, null) gives no confidence (no badge), and numbers outside 0~1 are clamped. Pinned in Task 1.
- A handoff must never retrigger `draft.yml` (no trigger words) and the item must stay takeable by the e4b pass of the same run. Pinned in Task 2.

---

### Task 1: Claude drafter in the curator

**Files:**
- Modify: `scripts/curator.py`
- Create: `requirements-ai.txt` (one line: `anthropic>=1.0,<2`)
- Test: `tests/test_curator.py`

**Interfaces:**
- Produces: `curator.CLAUDE_MODEL = "claude-opus-5-5"`; `curator.claude_model_name() -> str` (env `NOCTURNE_CLAUDE_MODEL` or the default); `curator.UPGRADE_FROM = ("gemma4:e4b-it-qat",)`; `curator.claude_draft(image, data, grayscale, *, model=None, client=None) -> {"room", "title", "alt", "confidence", "model"}` raising `CuratorError` on every failure (same shape as `draft`); `curator.build_prompt(data, reply=PROMPT_REPLY)` where the reply line for Claude is `CLAUDE_REPLY`.

- [ ] **Step 1: Write the failing tests** (new `ClaudeDraftTests`; a `FakeClient` whose `beta.messages.create(**kwargs)` records kwargs and returns a `SimpleNamespace(stop_reason=…, model=…, content=[SimpleNamespace(type="text", text=json.dumps(…))])`; fake error classes `class APIStatusError(Exception)` with a `status_code` attribute and `class APIConnectionError(Exception)`; `helpers.SITE` as data; a small JPEG written to a temp file):
  - `test_request`: kwargs have `model == "claude-opus-5-5"`, `max_tokens == 16000`, `betas == ["server-side-fallback-2026-07-01"]`, `fallbacks == "default"`, `output_config["effort"] == "low"`, `output_config["format"]["type"] == "json_schema"`, the schema's `room.enum == [ids of SITE rooms]`, `required == ["room", "title", "alt", "confidence"]`, `additionalProperties is False`; one user message whose first block is `{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": <base64 of the file>}}` and second is text containing `장소의 이름을 쓰지 마세요` and `confidence` and NOT `JSON으로만 답하세요`; no `thinking`, no `temperature` key.
  - `test_model_from_environment`: with `NOCTURNE_CLAUDE_MODEL=claude-sonnet-5-5` the request uses it.
  - `test_reply_is_tidied`: reply `{"room": "night", "title": "  공중전화 부스가 있는 밤거리의 아주 긴 제목 …(over 40 chars) ", "alt": "빨간 공중전화 부스입니다.", "confidence": 0.65}` with `grayscale=True` → title clamped like `curator.clamp(…, 40)`, alt `빨간 공중전화 부스, 흑백 사진`, confidence `0.65`, model = the response's `model`.
  - `test_fallback_model_is_recorded`: response `model="claude-opus-4-8"` → result `model == "claude-opus-4-8"`.
  - `test_confidence_edges`: `1.7 → 1.0`, `-0.2 → 0.0`, `"0.9" → None`, `True → None`, `None → None`.
  - `test_failures` (each raises `CuratorError` with the exact message): `stop_reason="refusal"` → `Claude가 이 사진의 초안을 거절했어요`; `stop_reason="max_tokens"` → `Claude의 답이 끊겼어요`; text `"not json"`, room `"nowhere"`, empty title → message starts with `Claude의 답을 읽을 수 없어요 (`; `APIStatusError(401)` → `Claude API 키가 맞지 않아요`; 402 and 403 → `Claude API 권한이나 크레딧을 확인해 주세요`; 429 → `Claude API 요청이 너무 많아요`; 500 → `Claude API 오류 500`; `APIConnectionError()` → `Claude API에 연결하지 못했어요`; a plain `TypeError` from `create` is NOT converted (re-raised).
  - `test_no_key_and_no_package`: without `client` and with `ANTHROPIC_API_KEY` unset → `Claude API 키가 없어요` and `anthropic` never imported (`sys.modules` patched so importing it would fail the test); with the key set and `import anthropic` raising `ImportError` (patch `builtins.__import__` or `sys.modules["anthropic"] = None`) → `anthropic 패키지가 없어요`.
  - `PromptTests.test_prompt` still passes for `build_prompt(SITE)` (Ollama reply line unchanged).

- [ ] **Step 2: Run to see them fail**

Run: `py -m unittest discover -s tests -p "test_curator.py" -v`
Expected: FAIL — `AttributeError: module 'curator' has no attribute 'claude_draft'`.

- [ ] **Step 3: Implement in `scripts/curator.py`** (update the module docstring: Ollama drafter + Claude drafter; the Claude SDK is imported only inside `claude_draft`):
  - `CLAUDE_REPLY = "confidence에는 고른 방이 맞다고 얼마나 확신하는지 0에서 1 사이의 숫자를 쓰세요."`; `PROMPT_REPLY` = the current `JSON으로만 답하세요: …` line, split out of `PROMPT_RULES` so both prompts share the rules.
  - Error conversion: an exception with an integer `status_code` maps by status as in Global Constraints; an exception whose class (or a base class) is named `APIConnectionError` or `APITimeoutError` → `Claude API에 연결하지 못했어요`; anything else propagates.
  - Room check reuses `parse_reply(text, room_ids)`; `known` false → failure. Confidence read separately from the parsed JSON.
  - Production client: `anthropic.Anthropic(timeout=120, max_retries=2)` (key from the environment).

- [ ] **Step 4: Run to see them pass**

Run: `py -m unittest discover -s tests -p "test_curator.py" -v`
Expected: PASS (all, including the existing Ollama tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/curator.py requirements-ai.txt tests/test_curator.py
git commit -m "Curator: Claude drafter (structured output, fallback model, plain-Korean errors)"
```

---

### Task 2: Claim timing, handoff and upgrade sources

**Files:**
- Modify: `scripts/queue_items.py`, `scripts/worker.py`, `scripts/photolib.py:199-202`
- Test: `tests/test_queue_items.py`, `tests/test_worker.py`, `tests/test_photodata.py:40-50`, `tests/test_pc_helper.py` (fixture ages only)

**Interfaces:**
- Consumes: Task 1's `curator.claude_draft`, `curator.claude_model_name`, `curator.UPGRADE_FROM`.
- Produces: `queue_items.PC_WAIT_SECONDS = 300` (no `WAIT_SECONDS`); `Worker(gh, *, by, model, workdir, drafter=curator.draft, now_fn=…, pc_model=curator.DEFAULT_MODEL, ai_failure=None)` where `ai_failure` is `"release" | "handoff" | "fail"` and `None` means `"release"` for `by="pc"`, `"fail"` for `by="github"`; `photolib.needs_upgrade(photo, from_models) -> bool` (true while `ai.fields` is non-empty and `ai.model in from_models`); CLI `worker.py --by github {--check|--run} [--ai {claude,ollama}]` (default `ollama`).

- [ ] **Step 1: Write the failing tests**
  - `test_queue_items.py`: replace `test_github_waits` with `test_github_takes_at_once` (`can_take(waiting item uploaded 0 s ago, by="github")` is True) and `test_pc_waits_five_minutes` (False at 299 s, True at 300 s for `by="pc"`); keep the stale and failed tests; boundaries use `PC_WAIT_SECONDS`.
  - `test_photodata.py`: `needs_upgrade(photo with ai.model "gemma4:e4b-it-qat" and fields, ("gemma4:e4b-it-qat",))` True; same with model `"claude-opus-5-5"` False; `"gemma4:12b-it-qat"` False; empty fields False.
  - `test_worker.py`:
    - Fixture: the default `uploaded_at` of `put_item` becomes old enough for both workers (`NOW - 400 s`); update the "WAIT_SECONDS" comment. Tests that relied on "too new for GitHub" now express "too new for the PC" (< 300 s).
    - `HandoffTests`: a `github` worker with `ai_failure="handoff"` and a failing drafter → item.json back to `status "waiting"`, `by None`, `error` = the drafter's message, `uploaded_at` unchanged; the commit message equals `대기열: a Claude 실패, Ollama로 넘김` and contains neither `올림` nor `다시 시도`; `process` returns `"handed off"`; a second `github` worker with `ai_failure="fail"` and a working drafter then publishes it.
    - Defaults: `Worker(by="github")` with a failing drafter still records `failed`; `Worker(by="pc")` still releases with `다시 시도 (PC AI 실패)`.
    - `UpgradeTests`: only the e4b-written photo is upgraded; photos with `ai.model` `claude-opus-5-5` or `gemma4:12b-it-qat` are left alone.
    - `MainTests` (patch `worker.curator.claude_draft` with a fake and set `ANTHROPIC_API_KEY`): `--by github --run --ai claude` publishes with `ai.model` from the fake; with a failing fake it hands off, exits 0, writes `published=0`, and prints a line starting `::warning title=Claude::a: ` followed by the reason; without `ANTHROPIC_API_KEY` it prints `Claude API 키가 없어서 Claude 단계를 건너뛰어요`, claims nothing (no new commits), writes `published=0`, exits 0; `--ai ollama` (and no `--ai`) behave exactly as before.

- [ ] **Step 2: Run to see them fail**

Run: `py -m unittest discover -s tests -p "test_queue_items.py" -v`, then the same for `test_photodata.py` and `test_worker.py`
Expected: FAIL on the new/changed tests (missing `PC_WAIT_SECONDS`, `ai_failure`, `--ai`).

- [ ] **Step 3: Implement**
  - `queue_items.can_take`: stale → True; not `waiting` → False; `github` → True; `pc` → age ≥ `PC_WAIT_SECONDS`. Update the module docstring constants.
  - `worker.Worker`: store `ai_failure`; on `CuratorError` during drafting: `release` → existing `_release`; `handoff` → `_handoff(name, claimed, note)` (commit only while the claim is ours, `queue_items.release(claimed, note)`, message above, returns `"handed off"` or `"skipped"`, does not touch `self.released`); `fail` → `_fail`. Update the module docstring (Claude pass, handoff, upgrade sources).
  - `upgrade_one` and its `build` use `photolib.needs_upgrade(photo, curator.UPGRADE_FROM)`.
  - `main`: `--ai`. For `claude`: no `ANTHROPIC_API_KEY` → print the skip line, `_set_output(published=0)` for `--run` / `names=` for `--check`, return 0; otherwise `Worker(…, model=curator.claude_model_name(), drafter=curator.claude_draft, ai_failure="handoff")`, and for each `"handed off"` result print `::warning title=Claude::<name>: <error>` (read the reason from the released item; the error string is already plain Korean) in addition to the usual `handed off: <name>` line. For `ollama`: as today.
  - `photolib.needs_upgrade(photo, from_models)`: docstring updated.

- [ ] **Step 4: Run to see them pass**

Run: `py -m unittest discover -s tests -p "test_queue_items.py"`, `test_photodata.py`, `test_worker.py`, `test_pc_helper.py`, `test_curator.py`
Expected: PASS (re-run any module that fails only with WinError 10014/10054).

- [ ] **Step 5: Commit**

```bash
git add scripts/queue_items.py scripts/worker.py scripts/photolib.py tests/test_queue_items.py tests/test_worker.py tests/test_photodata.py tests/test_pc_helper.py
git commit -m "Worker: GitHub takes uploads at once, Claude failures hand off to Ollama, upgrade only e4b text"
```

---

### Task 3: draft.yml runs Claude first, Ollama only for what is left

**Files:**
- Modify: `.github/workflows/draft.yml`
- Test: `tests/test_workflows.py`

**Interfaces:**
- Consumes: Task 2's CLI (`--ai claude` writes `published=<n>`; `--check` writes `names=`; `--ai ollama` as before) and Task 1's `requirements-ai.txt`.

- [ ] **Step 1: Write the failing tests** in `tests/test_workflows.py` (update the existing draft tests rather than duplicating them):
  - `sleep 60` and the step "PC가 먼저 맡을 시간 주기" are gone.
  - `pip install -r requirements.txt -r requirements-ai.txt` runs before the first worker step.
  - Step order: `Claude로 초안 쓰고 게시` (`id: claude`, runs `python scripts/worker.py --by github --run --ai claude`, `continue-on-error: true`) → `남은 사진 찾기` (`id: check`, `--check`) → Ollama download/cache/serve/pull, each with `if: steps.check.outputs.names != ''` → `e4b로 초안 쓰고 게시` (`id: run`, `--run --ai ollama`) → site rebuild.
  - `ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}` appears exactly once, in the Claude step's `env`; the job-level `env` has `NOCTURNE_CLAUDE_MODEL: claude-opus-5-5` and keeps `NOCTURNE_MODEL: gemma4:e4b-it-qat`; `GITHUB_TOKEN:` appears exactly 3 times, on the three worker steps (`claude`, `check`, `run`), plus the rebuild step's `GH_TOKEN`.
  - Rebuild `if:` is exactly `${{ !cancelled() && ((steps.claude.outputs.published != '' && steps.claude.outputs.published != '0') || (steps.run.outputs.published != '' && steps.run.outputs.published != '0')) }}`.
  - Kept as today: triggers and the `올림`/`다시 시도` gating, concurrency per job, `persist-credentials: false`, the Ollama checksum, cache key and "cache saved right after pull".

- [ ] **Step 2: Run to see them fail**

Run: `py -m unittest discover -s tests -p "test_workflows.py" -v`
Expected: FAIL on the changed draft tests.

- [ ] **Step 3: Edit `draft.yml`** as the tests describe; rewrite the header comment (Claude first at once; e4b in the same run only for what Claude could not draft; the PC helper takes uploads nobody took for 5 minutes) and keep the comment that the write token goes only to worker steps (now: write token and Anthropic key).

- [ ] **Step 4: Run to see them pass**

Run: `py -m unittest discover -s tests -p "test_workflows.py" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/draft.yml tests/test_workflows.py
git commit -m "Draft workflow: Claude pass first, Ollama only for what is left"
```

---

### Task 4: Docs

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `README.ko.md`, `tests/browser/run_worker.py` (docstring only, if it mentions the 60 s wait)

**Interfaces:** none (describe what Tasks 1-3 built; check every statement against the code).

- [ ] **Step 1: Edit**
  - CLAUDE.md (edit sections in place, Korean, short):
    - 소개와 "사진 올리는 흐름" 3·4·6·7: GitHub Actions가 바로 Claude(`claude-opus-5-5`, 구독 API 크레딧)로 쓰고 게시; Claude가 못 쓰면 같은 실행에서 e4b; Actions가 돌지 못하면 PC 도우미가 5분 뒤 12B로; PC 다듬기는 e4b 글만.
    - 대기열 규칙 문단: `github`은 `waiting`을 바로, `pc`는 올린 지 5분 지난 것만; handoff 메시지와 그것이 draft.yml을 다시 시작하지 않는다는 점.
    - `ai` 설명: Claude의 `confidence`는 Claude가 스스로 매긴 값; 다듬기 대상은 `ai.model`이 e4b인 사진.
    - 구조: `requirements-ai.txt`.
    - 새 절 "Claude API 키 넣기": claude.ai Settings → Billing → API credits에서 Console 조직 연결(Max 요금제) → Console에서 API 키 → 저장소 Settings → Secrets and variables → Actions → New repository secret `ANTHROPIC_API_KEY` → Console에서 월 사용 한도. 키는 GitHub에만, PC에는 두지 않음. 모델 바꾸기: draft.yml의 `NOCTURNE_CLAUDE_MODEL`.
    - 알아둘 것: 썸네일만 Anthropic으로 감; 장당 비용 약 $0.02; 키 없으면 e4b로만 돈다.
    - 문제가 생기면: Actions 기록의 `Claude` 경고와 `error`의 문구별 할 일 (키 없음/맞지 않음 → 비밀값, 권한·크레딧 → Console 크레딧·한도, 요청 많음 → 잠시 뒤, 거절 → e4b가 대신 썼으니 확인).
    - 명령: `run_worker.py --by github`은 바로, `--by pc`는 올린 지 5분 지난 것만 맡는다.
  - README.md / README.ko.md: Highlights "No paid APIs" → Claude API on subscription credits, with Ollama as the fallback (PC 12B, Actions e4b); the flowchart (Actions at once → Claude → e4b fallback; PC after 5 min); the Tech stack AI row.

- [ ] **Step 2: Verify**

Run: `grep -n "60초\|sleep 60\|No paid\|유료 API는 쓰지 않는다" CLAUDE.md README.md README.ko.md`
Expected: no line that still describes the old behaviour (a historical mention in a design note is fine if marked as past). Then `py -m unittest discover -s tests -p "test_build.py"` → OK.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md README.ko.md tests/browser/run_worker.py
git commit -m "Docs: Claude drafting, Ollama fallback, API key setup"
```

---

### Task 5: Rollout (controller + user)

- [ ] **Step 1:** Merge `claude-drafting` into `main` and push (standing permission). Watch `Site` and the next `Draft` run.
- [ ] **Step 2:** Without the secret: upload one photo; expect the Draft log line `Claude API 키가 없어서 Claude 단계를 건너뛰어요`, then e4b publishes (`ai.model` `gemma4:e4b-it-qat`) within ~3 minutes.
- [ ] **Step 3 (user):** Link the Console organisation, create the API key, add the `ANTHROPIC_API_KEY` secret, set a monthly limit.
- [ ] **Step 4:** Upload one photo; expect `ai.model` `claude-opus-5-5` (or the fallback model), published in about a minute, no Ollama steps in that run. Then "AI로 다시 쓰기" on one photo; expect `AI 설명 다시 쓰기:` commit by Claude.
- [ ] **Step 5:** Report timings and the Actions run links; refresh the README screenshots later with the site redesign.
