# 꼬맹통 Discord 봇

TypeScript와 discord.js로 만든 간단한 Discord 슬래시 명령어 봇입니다. 메시지 내용을 읽지 않으므로 `Message Content Intent` 없이 실행할 수 있습니다.

이 프로젝트의 초기 구조와 예제 코드는 OpenAI Codex를 사용하여 생성되었습니다.

## 포함된 기능

- `/테스트 기능:<선택>`: 명령어 옵션에서 다음 기능 중 하나를 실행
    - 핑: 봇의 WebSocket 응답 속도 확인
    - 서버: 현재 서버 이름, ID, 멤버 수 확인
    - 사용자: 내 Discord 계정 정보 확인
    - 도움말: 사용할 수 있는 테스트 기능 안내
    - 인사: 꼬맹통봇과 인사
- `/워들`: Wordle 기능을 다음 서브커맨드로 제공
    - `/워들 플레이`: 오늘의 NYT Wordle 플레이 화면 표시
    - `/워들 입력 단어:<5글자 영단어>`: 모달 없이 단어를 바로 제출하고 플레이 화면 표시
    - `/워들 점수판`: 현재 채널에 오늘의 Wordle 점수판 표시
    - `/워들 기록 [사용자]`: 사용자를 지정하면 해당 사용자의 개인 기록을 표시하고, 생략하면 현재 서버의 전체 랭킹을 항목별 최대 5위까지 표시하며 기존 전체 기록 메시지를 교체
    - 게임 동작
        - 플레이 또는 입력 명령 실행 시 사용자별 비공개 진행 화면 생성
        - `단어 입력` 버튼으로 모달을 열어 최대 6회까지 진행
        - `/워들 입력`의 필수 `단어` 파라미터로 모달을 열지 않고 추측을 바로 제출
        - `현황 공유` 버튼을 누른 경우에만 채널 구성원이 볼 수 있는 현재 상태 공유창 생성
        - 단어를 제출하면 서버별 활성 비공개 화면과 현재 상태 공유창, 공개 게임 현황을 함께 갱신
        - 게임 진행은 사용자별로 공유하되 현재 상태 공유창은 서버별로 분리
        - 현재 상태 공유창에는 입력 단어를 숨긴 색상 타일만 표시
        - 비공개 화면에서 색상 추측 기록과 알파벳순 글자 상태를 표시하고 단어 제출 시 같은 화면 수정
        - 성공과 실패 결과 모두 공유할 수 있으며 성공 결과에만 스포하기 버튼 제공
        - 현재 진행 및 결과 공유는 반복할 수 있으며 기존 개인 공개 패널이 있으면 삭제 후 최신 위치에 다시 생성
        - 사용자별 날짜별 게임 진행 사항을 SQLite에 저장하여 봇 재시작 후에도 복원
        - 성공·실패·중도 포기 결과와 성공 횟수, 최근 연속 성공, 정답률, 평균 시도 횟수를 영구 기록
        - 정답 갱신 전에 한 번 이상 시도하고 끝내지 않은 전날 게임을 중도 포기로 처리하며 입력하지 않은 게임은 정답률에서 제외
        - 찐스포·짭스포 사용 횟수와 사전 미등록 단어 입력 횟수를 사용자별로 영구 기록
        - 봇 시작 직후 10분 동안, 그리고 서울 기준 00:00부터 00:10까지 1분마다 NYT Wordle 날짜별 엔드포인트에서 오늘의 퍼즐을 조회해 캐시
        - 날짜별 퍼즐 정답은 한 번만 저장하고, 새 퍼즐이 확인되면 당일과 바로 전날의 게임·참여·현황 기록만 유지하되 통계용 기록은 별도 테이블에 계속 보존
        - 프로젝트에 포함된 JSON 영단어 데이터셋에서 입력 단어를 검증하며 잘못된 단어는 횟수에서 제외
        - 비공개 화면의 `점수판` 버튼으로 최신 공개 게임 현황의 이동 링크를 확인하고, 현황이 없거나 채팅 위로 올라간 경우 새로 생성
        - 공개 게임 현황에 서버에서 `/워들 플레이` 또는 `/워들 입력`을 사용한 최근 활동 순으로 최대 8명 표시
        - 사용자별 상태 텍스트, 시도 횟수, 노란색·초록색으로 구분한 찾은 알파벳 수와 `보기` 버튼 표시
        - `보기` 버튼을 누르면 해당 사용자의 색상 보드를 비공개 응답으로 표시
        - 유효한 단어가 입력되면 사용자가 참여한 서버에 등록된 공개 게임 현황을 자동으로 수정
        - 공개 게임 현황의 사용자 멘션은 알림을 보내지 않음
        - 서버별 참여 활동 순번과 채널별 공개 게임 현황 메시지 ID를 SQLite에 저장하여 재시작 후에도 복원
    - 개발용 봇 전용 테스트 기능
        - `/워들 어제기록_test`: 현재 서버의 어제 Wordle 기록판을 테스트 전송
        - `/워들 갱신_test`: 오늘의 NYT Wordle 정답 캐시를 강제로 갱신하고 어제 기록판 전송 처리 실행
        - 어제 정답과 기존 점수판과 동일한 사용자별 상태·시도 횟수·찾은 알파벳 수를 표시
        - 사용자별 `보기` 버튼에서는 입력 단어를 숨긴 색상 보드만 비공개로 표시
        - 새 퍼즐 갱신 후 참여 서버의 최근 Wordle 활동 채널에 기록판을 서버당 한 번 자동 전송
        - 자동 기록판에서는 표시된 참여자 멘션 알림을 허용하고 전송 완료 상태를 SQLite에 저장
- 환경 변수 유효성 검사
- ESLint, Prettier, TypeScript, Vitest 기반 품질 검사
- GitHub Actions CI

## 준비 사항

- Node.js 22.5 이상
- npm 11 이상
- Discord 계정 및 테스트용 Discord 서버
- NYT Wordle에 접속할 수 있는 네트워크 환경

## 시작하기

1. 의존성을 설치합니다.

    ```powershell
    npm install
    ```

2. [Discord Developer Portal](https://discord.com/developers/applications)에서 애플리케이션과 봇을 만듭니다.

3. 메인 봇과 개발용 봇의 예제 환경 변수 파일을 각각 복사합니다.

    ```powershell
    Copy-Item .env.example .env
    Copy-Item .env.development.example .env.development
    ```

4. `.env`에는 메인 봇 설정을 입력합니다.

    ```dotenv
    DISCORD_TOKEN=메인-봇-토큰
    DISCORD_CLIENT_ID=메인-애플리케이션-ID
    DISCORD_GUILD_ID=
    ENABLE_TEST_COMMANDS=false
    WORDLE_DATABASE_PATH=data/wordle.sqlite
    ```

    `.env.development`에는 개발용 봇 설정을 입력합니다.

    ```dotenv
    DISCORD_TOKEN=개발용-봇-토큰
    DISCORD_CLIENT_ID=개발용-애플리케이션-ID
    DISCORD_GUILD_ID=개발용-서버-ID
    ENABLE_TEST_COMMANDS=true
    WORDLE_DATABASE_PATH=data/wordle.development.sqlite
    ```

    `npm run dev`와 `npm run deploy:commands:dev`는 `.env.development`만 읽습니다. `npm start`와 `npm run deploy:commands`는 `.env`만 읽습니다.
    `DISCORD_GUILD_ID`는 선택 사항입니다. 개발 중에는 서버 ID를 지정하는 편이 명령어가 즉시 반영되어 편리합니다. 비워 두면 전역 명령어로 등록됩니다.
    `ENABLE_TEST_COMMANDS`가 `true`이면 `/워들 갱신_test`와 `/워들 어제기록_test`를 명령 정의와 실행 경로에 포함합니다. 메인 봇에서는 `false`, 개발용 봇에서는 `true`로 설정합니다. 메인 명령을 다시 배포하면 테스트 서브커맨드는 Discord 명령 일괄 갱신 과정에서 자동으로 제거됩니다.
    `WORDLE_DATABASE_PATH`도 선택 사항이며 기본값은 `data/wordle.sqlite`입니다. 지정한 상위 디렉터리가 없으면 봇 시작 시 자동으로 생성합니다.

5. Developer Portal의 OAuth2 URL 생성기에서 `bot`과 `applications.commands` 범위를 선택하여 봇을 서버에 초대합니다. 현재 예제 명령어에는 별도의 관리자 권한이 필요하지 않습니다.

6. 슬래시 명령어를 Discord에 등록합니다. 명령어 정의를 변경할 때도 이 명령을 다시 실행해야 합니다.

    ```powershell
    npm run deploy:commands:dev
    ```

7. 개발 모드로 봇을 실행합니다. 소스가 바뀌면 자동으로 다시 시작됩니다.

    ```powershell
    npm run dev
    ```

## 프로젝트 구조

```text
.
├── .github/workflows/ci.yml   # GitHub Actions 품질 검사
├── assets/
│   └── valid-five-letter-words.json # 로컬 검증용 5글자 영단어 데이터셋
├── src/
│   ├── app/feature-registry.ts # 기능 등록 및 런타임 모듈 생성
│   ├── bot/                    # 기능 독립적인 Discord 라우터와 모듈 계약
│   ├── features/
│   │   ├── test/               # 단일 파일 중심의 단순 커맨드 기능
│   │   └── wordle/             # Wordle 기능과 내부 레이어
│   │       ├── domain/         # 게임 규칙과 모델
│   │       ├── application/    # 유스케이스와 포트
│   │       ├── infrastructure/ # SQLite, NYT API, 로컬 사전
│   │       └── presentation/   # 명령어, 버튼, 모달 및 화면
│   ├── infrastructure/         # 여러 기능이 공유하는 기술 구현
│   ├── config/env.ts           # 환경 변수 검증
│   ├── deploy-commands.ts      # Discord API 명령어 등록
│   └── index.ts                # 애플리케이션 실행 진입점
├── tests/                     # Vitest 테스트
├── .env.development.example   # 개발용 환경 변수 예시
├── .env.example               # 환경 변수 예시
├── eslint.config.js           # 정적 분석 설정
├── prettier.config.js         # 코드 포맷 설정
└── tsconfig.json              # TypeScript 컴파일 설정
```

세부 기능 모듈 계약, 새 커맨드 추가 방법과 계층 의존성 방향은 [`docs/architecture.md`](docs/architecture.md)에 정리되어 있습니다. ESLint가 공통 봇 코드의 기능 결합과 기능 내부 계층의 잘못된 import 방향을 검사합니다.

새 테스트 기능은 `src/features/test/command.ts`의 명령어 옵션 선택지와 응답 생성 로직에 함께 추가합니다.

Wordle 진행 상태는 사용자와 퍼즐 날짜별로 SQLite에 저장되므로 봇을 재시작해도 `/워들 플레이`, `/워들 입력` 명령이나 기존 버튼을 통해 이어서 진행할 수 있습니다. 퍼즐과 정답은 날짜별로 한 번만 저장하며, 새 퍼즐이 확인되면 당일과 바로 전날의 게임·참여·공개 현황 데이터만 남기고 더 오래된 기록은 함께 정리합니다. 새 퍼즐과 최근 2일 보존 처리가 끝나면 전날 참여 서버의 최근 Wordle 활동 채널에 어제 기록판을 자동 전송하며, 성공한 메시지 ID를 저장하여 같은 기록을 중복 전송하지 않습니다. 입력 활동 순번과 채널별 공개 게임 현황 메시지 ID도 저장되므로 재시작 후 현황 갱신을 이어갈 수 있습니다. 현재 상태 공유창과 비공개 응답 객체는 서버별 런타임 상태이므로 재시작 후 다시 생성될 수 있습니다. 비공개 응답은 Discord 상호작용 토큰이 유효한 동안에만 다른 서버에서 실시간으로 갱신할 수 있습니다. NYT 응답은 Discord 로그인 후 시작 직후 10분 동안, 그리고 서울 기준 00:00부터 00:10까지 1분마다 조회해 캐시되며, Wordle 명령 실행 중에는 외부 API를 다시 호출하지 않습니다. 입력 단어는 프로젝트에 포함된 JSON 영단어 데이터셋에서 즉시 검증합니다.

기존 완료 게임과 참여 데이터는 봇 시작 시 기록 통계로 자동 백필하지 않습니다. 현재 기록 통계는 명시적으로 초기화하기 전까지 유지되며, 초기화 후에는 새로 발생한 동작만 누적됩니다.

## 운영 서버의 Wordle 기록 초기화

기록 초기화는 Discord 명령이 아니라 봇을 구동하는 서버의 터미널에서 실행하는 일회성 운영 명령입니다. 먼저 봇 프로세스를 중지하고 최신 소스를 빌드한 뒤 다음 명령을 실행합니다.

```powershell
npm run build
npm run reset:wordle-records -- --confirm-reset
```

기본적으로 `.env`의 `WORDLE_DATABASE_PATH`를 사용합니다. 다른 SQLite 파일을 지정하려면 다음과 같이 절대 경로나 프로젝트 기준 상대 경로를 전달합니다.

```powershell
npm run reset:wordle-records -- --confirm-reset --database-path data/wordle.development.sqlite
```

이 명령은 다음 순서로 동작합니다.

1. 서울 기준 오늘 날짜의 퍼즐이 SQLite에 저장되어 있는지 확인합니다. 없으면 아무 기록도 변경하지 않고 종료합니다.
2. 사용자별 성공 횟수, 플레이 횟수, 평균 시도 계산값, 연속 성공과 일별 결과를 초기화합니다.
3. 찐스포·짭스포 사용 횟수와 사전 미등록 단어 입력 횟수는 기존 값으로 보존합니다.
4. 서버별 기록 참여 관계를 초기화한 뒤 오늘의 참여 관계를 다시 반영합니다.
5. 오늘 완료된 성공·실패 게임을 다시 집계합니다.

진행 중인 오늘 게임은 완료되는 시점에 정상 집계됩니다. 게임 진행, 퍼즐, 점수판, 기록 메시지 위치 정보는 초기화하지 않습니다. 이 명령은 백업을 만들지 않고 기존 게임 통계를 즉시 제거하므로 대상 `WORDLE_DATABASE_PATH`를 반드시 확인해야 합니다.

## 개발 명령어

| 명령어                         | 용도                                              |
| ------------------------------ | ------------------------------------------------- |
| `npm run dev`                  | `.env.development`로 개발용 봇 실행 및 변경 감지  |
| `npm run deploy:commands:dev`  | 개발용 봇에 슬래시 명령어 등록                    |
| `npm run deploy:commands`      | 메인 봇에 슬래시 명령어 등록                      |
| `npm run reset:wordle-records` | `.env`의 Wordle 게임 통계를 초기화 후 오늘 재집계 |
| `npm run check`                | 린트, 포맷, 타입, 테스트 전체 검사                |
| `npm test`                     | 테스트 한 번 실행                                 |
| `npm run test:watch`           | 테스트 감시 모드 실행                             |
| `npm run format`               | 프로젝트 파일 자동 포맷                           |
| `npm run build`                | `dist` 디렉터리에 운영용 코드 빌드                |
| `npm start`                    | `.env`로 빌드된 메인 봇 실행                      |

운영 실행 전에는 다음 순서를 사용합니다.

```powershell
npm run check
npm run build
npm start
```

## 보안 주의 사항

- `.env`, `.env.development`와 봇 토큰은 Git에 커밋하지 않습니다.
- 토큰이 노출되었다면 Developer Portal에서 즉시 재발급합니다.
- 봇에는 실제 기능에 필요한 최소 권한만 부여합니다.
