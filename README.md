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
- `/워들 [단어:<5글자 영단어>]`: 오늘의 NYT Wordle을 시작하거나 선택한 단어를 바로 제출
    - 명령 실행 시 사용자별 비공개 진행 화면 생성
    - `단어 입력` 버튼으로 모달을 열어 최대 6회까지 진행
    - 선택적인 `단어` 파라미터로 모달을 열지 않고 추측을 바로 제출
    - `현재 진행 공유` 버튼을 누른 경우에만 채널 구성원이 볼 수 있는 현재 상태 공유창 생성
    - 단어를 제출하면 서버별 활성 비공개 화면과 현재 상태 공유창, 공개 게임 현황을 함께 갱신
    - 게임 진행은 사용자별로 공유하되 현재 상태 공유창은 서버별로 분리
    - 현재 상태 공유창에는 입력 단어를 숨긴 색상 타일만 표시
    - 비공개 화면에서 색상 추측 기록과 알파벳순 글자 상태를 표시하고 단어 제출 시 같은 화면 수정
    - 성공과 실패 결과 모두 공유할 수 있으며 성공 결과에만 스포하기 버튼 제공
    - 현재 진행 및 결과 공유는 반복할 수 있으며 기존 개인 공개 패널이 있으면 삭제 후 최신 위치에 다시 생성
    - 사용자별 날짜별 게임 진행 사항을 SQLite에 저장하여 봇 재시작 후에도 복원
    - 봇 시작 직후 10분 동안, 그리고 서울 기준 00:00부터 00:10까지 1분마다 NYT Wordle 날짜별 엔드포인트에서 오늘의 퍼즐을 조회해 캐시
    - 프로젝트에 포함된 JSON 영단어 데이터셋에서 입력 단어를 검증하며 잘못된 단어는 횟수에서 제외
    - 비공개 화면의 `공개 현황 보기` 버튼으로 최신 공개 게임 현황의 이동 링크를 확인하고, 현황이 없거나 채팅 위로 올라간 경우 새로 생성
    - 공개 게임 현황에 서버에서 `/워들`을 사용한 최근 활동 순으로 최대 8명 표시
    - 사용자별 상태 텍스트, 시도 횟수, 노란색·초록색으로 구분한 찾은 알파벳 수와 `보기` 버튼 표시
    - `보기` 버튼을 누르면 해당 사용자의 색상 보드를 비공개 응답으로 표시
    - 유효한 단어가 입력되면 사용자가 참여한 서버에 등록된 공개 게임 현황을 자동으로 수정
    - 공개 게임 현황의 사용자 멘션은 알림을 보내지 않음
    - 서버별 참여 활동 순번과 채널별 공개 게임 현황 메시지 ID를 SQLite에 저장하여 재시작 후에도 복원
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
    WORDLE_DATABASE_PATH=data/wordle.sqlite
    ```

    `.env.development`에는 개발용 봇 설정을 입력합니다.

    ```dotenv
    DISCORD_TOKEN=개발용-봇-토큰
    DISCORD_CLIENT_ID=개발용-애플리케이션-ID
    DISCORD_GUILD_ID=개발용-서버-ID
    WORDLE_DATABASE_PATH=data/wordle.development.sqlite
    ```

    `npm run dev`와 `npm run deploy:commands:dev`는 `.env.development`만 읽습니다. `npm start`와 `npm run deploy:commands`는 `.env`만 읽습니다.
    `DISCORD_GUILD_ID`는 선택 사항입니다. 개발 중에는 서버 ID를 지정하는 편이 명령어가 즉시 반영되어 편리합니다. 비워 두면 전역 명령어로 등록됩니다.
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
│   ├── bot/create-client.ts   # Discord 클라이언트와 이벤트 처리
│   ├── commands/test.ts       # 기능 선택 옵션과 다섯 테스트 기능
│   ├── commands/wordle.ts     # Wordle 공개 API
│   ├── commands/wordle/       # 명령어, 버튼, 모달, 공개 현황 및 UI 구성
│   ├── features/wordle/       # 게임 규칙, 외부 API, 퍼즐 및 데이터 저장
│   ├── config/env.ts          # 환경 변수 검증
│   ├── types/command.ts       # 공통 명령어 타입
│   ├── deploy-commands.ts     # Discord API 명령어 등록
│   └── index.ts               # 애플리케이션 진입점
├── tests/                     # Vitest 테스트
├── .env.development.example   # 개발용 환경 변수 예시
├── .env.example               # 환경 변수 예시
├── eslint.config.js           # 정적 분석 설정
├── prettier.config.js         # 코드 포맷 설정
└── tsconfig.json              # TypeScript 컴파일 설정
```

새 테스트 기능은 `src/commands/test.ts`의 명령어 옵션 선택지와 응답 생성 로직에 함께 추가합니다.

Wordle 진행 상태는 사용자와 퍼즐 날짜별로 SQLite에 저장되므로 봇을 재시작해도 `/워들` 명령이나 기존 버튼을 통해 이어서 진행할 수 있습니다. 입력 활동 순번과 채널별 공개 게임 현황 메시지 ID도 저장되므로 재시작 후 현황 갱신을 이어갈 수 있습니다. 현재 상태 공유창과 비공개 응답 객체는 서버별 런타임 상태이므로 재시작 후 다시 생성될 수 있습니다. 비공개 응답은 Discord 상호작용 토큰이 유효한 동안에만 다른 서버에서 실시간으로 갱신할 수 있습니다. NYT 응답은 봇 시작 직후 10분 동안, 그리고 서울 기준 00:00부터 00:10까지 1분마다 조회해 캐시되며, `/워들` 명령 실행 중에는 외부 API를 다시 호출하지 않습니다. 입력 단어는 프로젝트에 포함된 JSON 영단어 데이터셋에서 즉시 검증합니다.

## 개발 명령어

| 명령어                        | 용도                                             |
| ----------------------------- | ------------------------------------------------ |
| `npm run dev`                 | `.env.development`로 개발용 봇 실행 및 변경 감지 |
| `npm run deploy:commands:dev` | 개발용 봇에 슬래시 명령어 등록                   |
| `npm run deploy:commands`     | 메인 봇에 슬래시 명령어 등록                     |
| `npm run check`               | 린트, 포맷, 타입, 테스트 전체 검사               |
| `npm test`                    | 테스트 한 번 실행                                |
| `npm run test:watch`          | 테스트 감시 모드 실행                            |
| `npm run format`              | 프로젝트 파일 자동 포맷                          |
| `npm run build`               | `dist` 디렉터리에 운영용 코드 빌드               |
| `npm start`                   | `.env`로 빌드된 메인 봇 실행                     |

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
