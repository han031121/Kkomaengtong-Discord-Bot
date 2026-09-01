# 아키텍처

이 프로젝트는 커맨드별 기능 모듈과, 복잡한 기능 내부에서만 사용하는 레이어드 아키텍처를 결합합니다. 단순 커맨드에 불필요한 계층을 강제하지 않으면서도 Wordle처럼 상태와 외부 연동이 많은 기능은 책임을 분리할 수 있습니다.

```text
기능 레지스트리 ──지연 생성──▶ 기능 모듈들 ──주입──▶ 공통 Discord 라우터
       │                           │
       └──순수 명령 정의 수집──────┴────────▶ Discord 명령 배포
```

## 공통 애플리케이션 구조

### 봇 코어 (`src/bot`)

- `contracts.ts`: `BotCommand`, `BotModule`, `BotModuleRegistration` 계약
- `create-client.ts`: 슬래시 명령과 기능별 인터랙션을 라우팅함
- 개별 기능을 import하지 않으며 등록된 모듈만 처리함
- 기능 모듈의 시작·종료 수명주기를 공통 방식으로 실행함

### 기능 레지스트리 (`src/app/feature-registry.ts`)

- 애플리케이션에서 사용할 기능 등록을 한곳에 모음
- 명령 배포 시에는 순수한 명령 정의만 반환함
- 봇 실행 시에만 각 기능의 저장소와 외부 클라이언트를 생성함
- 모듈 이름과 명령어 이름의 중복을 사전에 검사함

### 기능 (`src/features/<feature>`)

단순 기능은 `command.ts`와 `index.ts`만으로 구성할 수 있습니다. 버튼, 모달, 저장소 또는 외부 API가 필요한 복잡한 기능은 필요할 때만 다음 내부 계층을 둡니다.

```text
presentation ──사용──▶ application ──사용──▶ domain
module.ts     ──생성──▶ infrastructure ──구현──▶ application 포트
module.ts     ──주입──▶ presentation
```

## Wordle 내부 계층

### 도메인 (`src/features/wordle/domain`)

- Wordle 게임 규칙과 불변 조건
- 퍼즐, 게임, 기록 및 패널 모델
- Wordle 날짜 계산
- Discord, SQLite, HTTP에 의존하지 않음

### 애플리케이션 (`src/features/wordle/application`)

- 사전과 퍼즐 공급자 포트
- 게임, 활동, 기록, 공지, 패널별 저장소 포트
- 퍼즐 캐시와 날짜 갱신 흐름
- 도메인 계층에만 의존함

### 인프라 (`src/features/wordle/infrastructure`)

- SQLite 저장소 구현
- NYT Wordle HTTP 클라이언트
- 로컬 JSON 사전

SQLite 구현은 스키마, 마이그레이션, 게임, 활동, 기록 및 패널 저장소로 분리되어 있습니다. `wordle-data-store.ts`는 여러 저장소에 걸친 트랜잭션만 조정합니다.

### 표현 (`src/features/wordle/presentation`)

- Discord 슬래시 명령, 버튼과 모달 처리
- Discord Components V2 화면 구성
- 공개 메시지와 비공개 응답 수명주기 관리
- 구체 저장소나 외부 클라이언트를 직접 생성하지 않음

### 기능 조립 (`src/features/wordle/module.ts`)

- Wordle 저장소, 퍼즐 클라이언트, 사전과 잠금을 생성함
- 명령어와 버튼·모달 처리기에 의존성을 주입함
- 퍼즐 갱신 작업을 시작하고 종료 시 타이머와 저장소를 정리함

## 새 커맨드 추가

상태나 버튼이 없는 단순 커맨드는 다음 순서로 추가합니다.

1. `src/features/<이름>/command.ts`에 `BotCommand`를 구현합니다.
2. 같은 기능의 `index.ts`에서 `BotModuleRegistration`을 반환합니다.
3. `src/app/feature-registry.ts`의 등록 목록에 기능을 한 번 추가합니다.

버튼이나 모달이 있다면 기능 모듈의 `handleInteraction`에서 자신이 소유한 custom ID만 판별하고 처리합니다. 백그라운드 작업이나 연결 정리가 필요하면 `start`와 `stop`을 구현합니다. `src/bot/create-client.ts`는 수정하지 않습니다.

## 경계 보호

`eslint.config.js`가 다음 의존성을 금지합니다.

- 기능 도메인 → 애플리케이션, 인프라, 표현 및 조립 코드
- 기능 애플리케이션 → 인프라, 표현 및 조립 코드
- 기능 인프라 → 표현 및 애플리케이션 조립 코드
- 공통 봇·인프라 → 개별 기능

각 기능의 `module.ts`와 애플리케이션의 기능 레지스트리만 구체 구현을 조립할 수 있습니다.
